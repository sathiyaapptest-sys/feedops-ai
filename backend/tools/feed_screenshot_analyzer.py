import os
from typing import List, Optional
from pydantic import BaseModel, Field
from google import genai
from google.genai import types
from backend.tools.model_cascade import generate_content_with_cascade


class FeedRowSuggestion(BaseModel):
    feed_type: str = Field(description="One of: entity, action, service")
    suggested_status: str = Field(description="One of: confirmed_clean, flagged_errors")
    confidence: float = Field(description="0.0-1.0 confidence in this suggestion")
    evidence_quote: str = Field(description="Verbatim text/row the model saw supporting this suggestion")
    observed_at: Optional[str] = Field(None, description="Timestamp text shown on screen for this row, if any")


class OnboardingStepSuggestion(BaseModel):
    step_key: str = Field(
        description=(
            "The closest matching step from this fixed list -- match by the "
            "row's number and label, not just the label text, since Partner "
            "Portal's own wording can drift slightly: "
            "setup, feeds_sandbox, conversion_sandbox, sandbox_to_prod_review, "
            "feeds_production, conversion_production, launch_review"
        )
    )
    suggested_status: str = Field(description="One of: complete, needs_attention -- read from the row's own color/marker (green check vs red warning), not inferred from position")
    evidence_quote: str = Field(description="The visible label and status text for this row, verbatim, e.g. 'Feeds ready in Sandbox -- Needs attention'")


class FeedScreenshotAnalysis(BaseModel):
    screen_type: str = Field(description="One of: ingestion_history, task_rollup, onboarding_plan, other")
    summary: str = Field(description="1-3 sentence plain-language summary of what this screen shows, always populated")
    next_steps: List[str] = Field(description="Concrete next actions for the user, always populated even for 'other'")
    feed_suggestions: List[FeedRowSuggestion] = Field(
        default_factory=list,
        description="Per-feed-type accept/reject suggestions. MUST stay empty unless screen_type is 'ingestion_history'.",
    )
    onboarding_step_suggestions: List[OnboardingStepSuggestion] = Field(
        default_factory=list,
        description=(
            "One entry per visible numbered step row (there are normally 7). "
            "MUST stay empty unless screen_type is 'onboarding_plan'."
        ),
    )


class FeedScreenshotAnalyzer:
    """
    Reads a screenshot of Google's Partner Portal (the only place feed
    acceptance / ingestion state is visible -- Google exposes no API for it)
    and explains it in plain language. Only suggests a per-feed accept/reject
    mark when the screenshot is the Ingestion History table, which is the one
    screen with real per-batch pass/fail rows; other screens (task rollups,
    the onboarding plan) carry aggregate/cadence signals that don't map to a
    single batch, so they get explanation only -- except the Onboarding Plan
    screen itself, which directly shows this app's own 7 journey steps
    (colored numbered rows), so that one DOES get a structured per-step
    complete/needs_attention suggestion. Suggestions are advisory -- the
    caller must still route them through a human confirmation step (the
    existing Mark Accepted/Rejected buttons, or the onboarding journey's own
    self-attest buttons), never write status directly.
    """

    def __init__(self):
        # Assumes GEMINI_API_KEY is in environment
        self.client = genai.Client()

    def analyze_from_file(self, file_path: str) -> FeedScreenshotAnalysis:
        try:
            with open(file_path, "rb") as f:
                image_bytes = f.read()
            return self.analyze_from_bytes(image_bytes, os.path.splitext(file_path)[1].lower().strip("."))
        except Exception as e:
            raise Exception(f"Failed to read image file: {e}")

    def analyze_from_bytes(self, image_bytes: bytes, mime_type_suffix: str) -> FeedScreenshotAnalysis:
        mime_type = f"image/{mime_type_suffix}"
        if mime_type_suffix == "pdf":
            mime_type = "application/pdf"

        prompt = """
        This is a screenshot from Google's Partner Portal (used to onboard and
        monitor Reserve with Google / Ordering feeds). Identify which known
        screen type it is:

        - "ingestion_history": a table listing individual feed ingestion
          batches, one row per batch/feed type, with a real per-row Status
          column (e.g. Done, Processing, Failed) and a timestamp. Only THIS
          screen type carries single-batch pass/fail truth.
        - "task_rollup": a task-detail screen like "Feeds ready in Sandbox" or
          "Feeds ready in Production" showing aggregate cadence errors such as
          "found feeds uploaded later than expected" or "only uploaded N
          successful feeds in the past M days". These are NOT single-batch
          results -- they describe a pattern over several days.
        - "onboarding_plan": a multi-step (commonly 7-step) numbered overview
          or checklist screen showing overall onboarding progress.
        - "other": anything not matching the above (e.g. an entity-matching
          table, an "Edit match" panel, or an unrecognized screen).

        Always write a short plain-language summary of what the screen is
        telling the user, and always list concrete next steps -- even for
        "other". Translate Google's jargon into plain language a non-expert
        can act on.

        Only when screen_type is "ingestion_history", AND a row clearly and
        unambiguously shows a recent status for one of the feed types
        (entity, action, service), populate feed_suggestions with a
        suggested_status ("confirmed_clean" for Done/success, "flagged_errors"
        for Failed/error), a confidence score, and a verbatim evidence_quote
        from the row. For every other screen_type, feed_suggestions MUST be
        an empty list -- do not infer a batch-level accept/reject from an
        aggregate or unrelated screen.

        Only when screen_type is "onboarding_plan" (a numbered list, normally
        7 rows, each with a colored status marker -- green check for done,
        red warning triangle for needs attention -- and a label like "Feeds
        ready in Sandbox" or "Launch Review"), populate
        onboarding_step_suggestions: one entry per visible row, with
        step_key mapped to the closest match from this fixed list (in this
        order, matching the row numbers 1-7):
          1. setup
          2. feeds_sandbox ("Feeds ready in Sandbox")
          3. conversion_sandbox ("Conversion Tracking in Sandbox")
          4. sandbox_to_prod_review ("Sandbox to Production Review" / "Sandbox-to-Production Review")
          5. feeds_production ("Feeds ready in Production")
          6. conversion_production ("Conversion Tracking in Production")
          7. launch_review ("Launch Review")
        Read suggested_status directly from that row's own color/marker --
        green/check/"Complete" -> "complete", red/warning/"Needs attention"
        -> "needs_attention". Never guess a row's status from its position or
        from other rows; only include a row you can actually read the marker
        for. For every other screen_type, onboarding_step_suggestions MUST be
        an empty list.
        """

        text, _ = generate_content_with_cascade(
            client=self.client,
            contents=[
                types.Part.from_bytes(data=image_bytes, mime_type=mime_type),
                prompt,
            ],
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                response_schema=FeedScreenshotAnalysis,
            ),
            vision_only=True,
        )
        return FeedScreenshotAnalysis.model_validate_json(text)
