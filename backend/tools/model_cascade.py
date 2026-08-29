"""
FeedOps AI - Model Fallback Cascade System
Provides automated high-availability failover across Gemini 3.7, 3.6, 3.5, 3.1-Lite, and Gemma models.
"""

import os
import logging
from typing import List, Tuple, Optional, Any
from google import genai
from google.genai import types

logger = logging.getLogger("feedops.model_cascade")
logger.setLevel(logging.INFO)

DEFAULT_CASCADE = [
    "gemini-3.7-flash",
    "gemini-3.6-flash",
    "gemini-3.5-flash",
    "gemini-3.1-flash-lite",
    "gemma-4-31b-it",
]

VISION_MODELS = {
    "gemini-3.7-flash",
    "gemini-3.6-flash",
    "gemini-3.5-flash",
    "gemini-3.1-flash-lite",
    "gemini-flash-latest",
}


def get_model_cascade(vision_only: bool = False) -> List[str]:
    """Returns the ordered list of models to try in sequence."""
    env_str = os.getenv("GEMINI_MODEL_CASCADE", "")
    if env_str.strip():
        models = [m.strip() for m in env_str.split(",") if m.strip()]
    else:
        models = list(DEFAULT_CASCADE)

    if vision_only:
        # Filter out text-only models like Gemma when processing images
        models = [m for m in models if m in VISION_MODELS or "vision" in m or "flash" in m]

    return models if models else ["gemini-3.5-flash"]


def generate_content_with_cascade(
    client: genai.Client,
    contents: Any,
    config: Optional[types.GenerateContentConfig] = None,
    vision_only: bool = False,
) -> Tuple[str, str]:
    """
    Executes generate_content across the fallback cascade.
    Catches 429 Quota, 503 Unavailable, 404 Not Found, and rate limits,
    seamlessly failing over to the next priority model.

    Returns:
        (response_text, model_used)
    """
    models = get_model_cascade(vision_only=vision_only)
    last_error: Optional[Exception] = None

    for model in models:
        try:
            logger.info(f"Invoking model: {model}")
            kwargs = {"model": model, "contents": contents}
            if config is not None:
                kwargs["config"] = config

            resp = client.models.generate_content(**kwargs)
            if resp and resp.text:
                logger.info(f"Model {model} succeeded ({len(resp.text)} chars).")
                return resp.text, model
        except Exception as e:
            err_str = str(e)
            last_error = e
            logger.warning(
                f"Model '{model}' failed ({err_str[:120]}...). Attempting next fallback model in cascade."
            )

    raise RuntimeError(
        f"All models in fallback cascade failed ({models}). Last error: {last_error}"
    )
