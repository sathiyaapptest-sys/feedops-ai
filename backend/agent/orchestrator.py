"""
FeedOps AI - Master Agent Orchestrator
Coordinates a multi-agent hierarchy using Google ADK (google-adk) and Gemini.
"""

import os
import json
import time
import logging
from typing import Dict, Any, AsyncGenerator, Optional
from pydantic import BaseModel

from google.adk.agents import Agent
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.adk.tools import google_search
from google.genai import types as genai_types

from backend.tools.places_matcher import resolve_entity_match, generate_gbp_draft
from backend.tools.feed_compiler import ActionsCenterFeedCompiler
from backend.tools.conversion_sentry import ConversionSentryTool

logger = logging.getLogger("feedops.orchestrator")
logger.setLevel(logging.INFO)

GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-flash-latest")


class AgentStreamEvent(BaseModel):
    agent_name: str
    stage: str
    status: str  # "thinking" | "calling_tool" | "completed" | "flagged"
    detail: str
    payload: Optional[Dict[str, Any]] = None


class FeedOpsOrchestrator:
    """
    Hierarchical agent orchestrator managing Entity Matching, Schema Auditing,
    and Conversion Sentry tasks for Google Actions Center, built on Google ADK.
    """

    APP_NAME = "feedops-ai"

    def __init__(self):
        self.environment = os.getenv("ENVIRONMENT", "sandbox")
        self.session_service = InMemorySessionService()

        self.compiler = ActionsCenterFeedCompiler()
        self.conversion_sentry_tool = ConversionSentryTool()

        self.entity_matcher = self._build_entity_matcher_agent()
        self.schema_auditor = self._build_schema_auditor_agent()
        self.conversion_sentry_agent = self._build_conversion_sentry_agent()

        self.entity_matcher_runner = Runner(
            agent=self.entity_matcher, app_name=self.APP_NAME, session_service=self.session_service
        )
        self.schema_auditor_runner = Runner(
            agent=self.schema_auditor, app_name=self.APP_NAME, session_service=self.session_service
        )
        self.conversion_sentry_runner = Runner(
            agent=self.conversion_sentry_agent, app_name=self.APP_NAME, session_service=self.session_service
        )

    def _build_entity_matcher_agent(self) -> Agent:
        """
        Sub-agent for reviewing Places match confidence and grounding ambiguous matches.

        The deterministic resolve_entity_match/generate_gbp_draft calls happen in plain
        Python (see execute_onboarding_pipeline) and their result is handed to this agent
        as context -- it is not given them as tools. Gemini's google_search grounding tool
        cannot be combined with custom function-calling tools on the same agent (Google
        disables automatic function calling for the custom tools when both are present),
        so this agent is deliberately single-purpose: judge the pre-computed match and,
        if it's ambiguous, use Search to verify it.
        """
        return Agent(
            model=GEMINI_MODEL,
            name="entity_matcher_agent",
            description="Reviews Places match confidence for a merchant and grounds ambiguous matches via Search.",
            tools=[google_search],
            instruction="""
            You are the EntityMatcherAgent in FeedOps AI. You will be given a merchant's
            name/address and a deterministic Google Places match result (with a confidence
            score) in the prompt.
            1. If confidence is 0.90 or above, confirm the match is trustworthy.
            2. If confidence is between 0 and 0.90, use Google Search to try to verify the
               merchant's real store hours, phone number, and official domain, and say what
               you found (or didn't).
            3. If confidence is 0.0 (no candidate at all), note that this merchant has no
               Google Business Profile listing yet and will need one drafted.
            4. Always end with one clear recommendation: MATCHED, NEEDS_REVIEW, or NO_LISTING.
            Keep your final answer under 5 sentences.
            """,
        )

    def _build_schema_auditor_agent(self) -> Agent:
        """Sub-agent for Actions Center JSON feed validation and deep-link auditing."""
        return Agent(
            model=GEMINI_MODEL,
            name="schema_auditor_agent",
            description="Compiles and audits Actions Center feed bundles for schema and pricing compliance.",
            tools=[self.compiler.compile_merchant_feed],
            instruction="""
            You are the SchemaAuditorAgent in FeedOps AI. Given a merchant record and its
            Places match result, call compile_merchant_feed to produce its Actions Center
            feed bundle, then report:
            1. Which feed files were generated (entity/service/action/menu).
            2. Any compliance risk you notice in the input data (e.g. missing address parts,
               a price that doesn't look like it's already in micros, a missing phone number).
            Keep your final answer under 4 sentences.
            """,
        )

    def _build_conversion_sentry_agent(self) -> Agent:
        """Sub-agent for synthetic conversion token health monitoring."""
        return Agent(
            model=GEMINI_MODEL,
            name="conversion_sentry_agent",
            description="Dispatches and interprets synthetic rwg_token conversion pings.",
            tools=[self.conversion_sentry_tool.dispatch_conversion_ping],
            instruction="""
            You are the ConversionSentryAgent in FeedOps AI. Call dispatch_conversion_ping
            for the environment you're given, then report:
            1. Whether every token got a 200 response.
            2. Whether the rolling health log still supports the "3 events / 7 days" check
               needed to keep launch eligibility, based on the results you receive.
            Keep your final answer under 4 sentences.
            """,
        )

    async def _run_tool_agent(self, runner: Runner, session_prefix: str, prompt: str):
        """
        Runs an ADK agent that has exactly one function tool, and captures both its final
        narration and the raw return value of whatever tool call it made (if any).

        Returns (narration: str, tool_result: Optional[Any]). tool_result is None both when
        the agent never called its tool (e.g. it decided not to) and when the Gemini call
        itself failed (e.g. no/exhausted API key) -- callers should fall back to calling the
        underlying tool function directly in either case, the same graceful-degradation
        pattern used for the EntityMatcherAgent.
        """
        session_id = f"{session_prefix}-{int(time.time())}"
        try:
            await self.session_service.create_session(
                app_name=self.APP_NAME, user_id="pipeline", session_id=session_id
            )
            message = genai_types.Content(role="user", parts=[genai_types.Part(text=prompt)])

            narration = ""
            tool_result = None
            async for event in runner.run_async(user_id="pipeline", session_id=session_id, new_message=message):
                for function_response in event.get_function_responses():
                    tool_result = function_response.response
                if event.is_final_response() and event.content and event.content.parts:
                    narration = event.content.parts[0].text or narration

            return narration, tool_result
        except Exception as e:
            logger.warning(f"Agent run '{session_prefix}' failed, falling back to direct tool call: {e}")
            return f"(agent unavailable: {e})", None

    async def _run_entity_matcher_agent(self, merchant_data: Dict[str, Any], match_result: Dict[str, Any]) -> str:
        """
        Runs the EntityMatcherAgent through a real ADK session so it can reason about the
        deterministic Places match above and, if it judges the match too weak, invoke Google
        Search grounding or draft a GBP record itself via its own tools.

        Falls back to a static note (rather than raising) if the Gemini call fails -- e.g. no
        API key configured yet -- so the deterministic pipeline below can still complete.
        """
        session_id = f"onboard-{merchant_data.get('store_id', 'unknown')}-{int(time.time())}"
        try:
            await self.session_service.create_session(
                app_name=self.APP_NAME, user_id="pipeline", session_id=session_id
            )
            prompt = (
                f"Merchant: {merchant_data.get('name')}\n"
                f"Address: {merchant_data.get('address')}\n"
                f"Deterministic Places match result: {json.dumps(match_result)}\n"
                "Review this match per your instructions and give your recommendation."
            )
            message = genai_types.Content(role="user", parts=[genai_types.Part(text=prompt)])

            final_text = ""
            async for event in self.entity_matcher_runner.run_async(
                user_id="pipeline", session_id=session_id, new_message=message
            ):
                if event.is_final_response() and event.content and event.content.parts:
                    final_text = event.content.parts[0].text or final_text

            return final_text or "EntityMatcherAgent returned no response."
        except Exception as e:
            logger.warning(f"EntityMatcherAgent run failed, continuing with deterministic result only: {e}")
            return f"(EntityMatcherAgent unavailable: {e})"

    async def execute_onboarding_pipeline(self, merchant_data: Dict[str, Any]) -> AsyncGenerator[str, None]:
        """
        Executes the full asynchronous onboarding lifecycle, streaming progress events
        over SSE for real-time frontend visualization.
        """
        # Step 1: Deterministic Places resolution (fast, cheap, reliable baseline)
        yield json.dumps(AgentStreamEvent(
            agent_name="EntityMatcherAgent",
            stage="places_resolution",
            status="calling_tool",
            detail=f"Searching Google Maps Platform for '{merchant_data.get('name')}'...",
            payload={"address": merchant_data.get("address")}
        ).model_dump())

        match_result = await resolve_entity_match(
            name=merchant_data.get("name", ""),
            address=merchant_data.get("address", "")
        )
        confidence = match_result.get("confidence", 0.0)

        # Step 2: Hand off to the real ADK EntityMatcherAgent for judgment
        yield json.dumps(AgentStreamEvent(
            agent_name="EntityMatcherAgent",
            stage="agent_reasoning",
            status="thinking",
            detail="EntityMatcherAgent reviewing match confidence via Gemini...",
            payload=match_result
        ).model_dump())

        agent_reasoning = await self._run_entity_matcher_agent(merchant_data, match_result)

        if confidence < 0.90 and confidence > 0.0:
            yield json.dumps(AgentStreamEvent(
                agent_name="EntityMatcherAgent",
                stage="hitl_triage",
                status="flagged",
                detail=f"Staged entity match ({confidence:.0%}) in HITL Review Queue.",
                payload={
                    "match_candidate": match_result,
                    "input_record": merchant_data,
                    "agent_reasoning": agent_reasoning,
                }
            ).model_dump())
        elif confidence == 0.0:
            yield json.dumps(AgentStreamEvent(
                agent_name="EntityMatcherAgent",
                stage="gbp_generation",
                status="calling_tool",
                detail="Storefront unindexed on Google Maps. Generating Google Business Profile draft...",
                payload={"draft": generate_gbp_draft(merchant_data), "agent_reasoning": agent_reasoning}
            ).model_dump())
        else:
            yield json.dumps(AgentStreamEvent(
                agent_name="EntityMatcherAgent",
                stage="places_resolution",
                status="completed",
                detail=f"Matched Place ID: {match_result.get('place_id')} (Confidence: {confidence:.0%})",
                payload={**match_result, "agent_reasoning": agent_reasoning}
            ).model_dump())

        # Step 3: Schema Compilation & Validation -- run through the real SchemaAuditorAgent
        yield json.dumps(AgentStreamEvent(
            agent_name="SchemaAuditorAgent",
            stage="schema_compilation",
            status="calling_tool",
            detail="SchemaAuditorAgent compiling Actions Center JSON feeds via Gemini..."
        ).model_dump())

        audit_prompt = (
            f"merchant_data: {json.dumps(merchant_data)}\n"
            f"match_result: {json.dumps(match_result)}\n"
            "Compile this merchant's feed bundle and audit it."
        )
        audit_narration, feed_bundle = await self._run_tool_agent(
            self.schema_auditor_runner, f"audit-{merchant_data.get('store_id', 'unknown')}", audit_prompt
        )
        agent_unreachable = feed_bundle is None
        if agent_unreachable:
            logger.warning("SchemaAuditorAgent didn't call its tool; compiling directly instead.")
            feed_bundle = self.compiler.compile_merchant_feed(merchant_data, match_result)

        yield json.dumps(AgentStreamEvent(
            agent_name="SchemaAuditorAgent",
            stage="schema_compilation",
            status="completed",
            detail=(
                "Feed bundle compiled (SchemaAuditorAgent unavailable, used deterministic compiler)."
                if agent_unreachable else (audit_narration or "Feed bundle compiled.")
            ),
            payload={"files": list(feed_bundle.keys()), "agent_reasoning": audit_narration}
        ).model_dump())

        # Step 4: Synthetic Conversion Verification -- run through the real ConversionSentryAgent
        yield json.dumps(AgentStreamEvent(
            agent_name="ConversionSentryAgent",
            stage="conversion_health",
            status="calling_tool",
            detail="ConversionSentryAgent dispatching synthetic rwg_token ping via Gemini..."
        ).model_dump())

        sentry_prompt = f"environment: {self.environment}\nDispatch the conversion ping and report on health."
        sentry_narration, ping_response = await self._run_tool_agent(
            self.conversion_sentry_runner, f"sentry-{merchant_data.get('store_id', 'unknown')}", sentry_prompt
        )
        agent_unreachable = ping_response is None
        if agent_unreachable:
            logger.warning("ConversionSentryAgent didn't call its tool; pinging directly instead.")
            ping_response = await self.conversion_sentry_tool.dispatch_conversion_ping(self.environment)

        first_result = (ping_response.get("results") or [{}])[0]
        fallback_detail = (
            f"Conversion ping verified (Status: {first_result.get('status_code')}, "
            f"Latency: {first_result.get('latency_ms')}ms)."
        )

        yield json.dumps(AgentStreamEvent(
            agent_name="ConversionSentryAgent",
            stage="conversion_health",
            status="completed",
            detail=(
                f"{fallback_detail} (ConversionSentryAgent unavailable, pinged directly.)"
                if agent_unreachable else (sentry_narration or fallback_detail)
            ),
            payload={**ping_response, "agent_reasoning": sentry_narration}
        ).model_dump())
