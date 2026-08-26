import os
from typing import List, Optional
from pydantic import BaseModel, Field
from google import genai
from google.genai import types

GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-3.6-flash")


class FeedRowSuggestion(BaseModel):
    feed_type: str = Field(description="One of: entity, action, service")
    suggested_status: str = Field(description="One of: confirmed_clean, flagged_errors")
    confidence: float = Field(description="0.0-1.0 confidence in this suggestion")
    evidence_quote: str = Field(description="Verbatim text/row the model saw supporting this suggestion")
    observed_at: Optional[str] = Field(None, description="Timestamp text shown on screen for this row, if any")


class FeedScreenshotAnalysis(BaseModel):
    screen_type: str = Field(description="One of: ingestion_history, task_rollup, onboarding_plan, other")
    summary: str = Field(description="1-3 sentence plain-language summary of what this screen shows, always populated")
    next_steps: List[str] = Field(description="Concrete next actions for the user, always populated even for 'other'")
    feed_suggestions: List[FeedRowSuggestion] = Field(
        default_factory=list,
        description="Per-feed-type accept/reject suggestions. MUST stay empty unless screen_type is 'ingestion_history'.",
    )


class FeedScreenshotAnalyzer:
    """
    Reads a screenshot of Google's Partner Portal (the only place feed
    acceptance / ingestion state is visible -- Google exposes no API for it)
    and explains it in plain language. Only suggests a per-feed accept/reject
    mark when the screenshot is the Ingestion History table, which is the one
    screen with real per-batch pass/fail rows; other screens (task rollups,
    the onboarding plan) carry aggregate/cadence signals that don't map to a
    single batch, so they get explanation only. Suggestions are advisory --
    the caller must still route them through a human confirmation step (the
    existing Mark Accepted/Rejected buttons), never write status directly.
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
        """

        response = self.client.models.generate_content(
            model=GEMINI_MODEL,
            contents=[
                types.Part.from_bytes(data=image_bytes, mime_type=mime_type),
                prompt,
            ],
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                response_schema=FeedScreenshotAnalysis,
            ),
        )
        return response.parsed
