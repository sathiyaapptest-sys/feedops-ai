"""
FeedOps AI - Playbook RAG index.

Chunks GOOGLE_ORDERING_REDIRECT_PLAYBOOK.md by section, embeds each chunk with
Gemini, and holds them in an in-process cache so agents (and the "Ask
FeedOps" support endpoint) can retrieve the exact relevant passage instead of
working from a hand-written paraphrase in a prompt.

Indexed in memory, not Firestore: the playbook is bundled straight into the
Docker image (see the Dockerfile's `COPY GOOGLE_ORDERING_REDIRECT_PLAYBOOK.md
.` -- present in the deployed container, excluded only from git), so there's
a real local copy to chunk on every process start. That sidesteps two real
costs a Firestore-backed index would carry: a `google-cloud-firestore`
dependency this codebase otherwise dropped entirely (see
backend/db/firestore_client.py's docstring -- every SDK call, gRPC or REST,
broke under Cloud Run's native service-account credentials), and a Firestore
native vector index that has no REST-only reimplementation here. A ~20-section
markdown file costs nothing to hold in memory, and cosine similarity over
~20 vectors is cheap enough to compute in plain Python -- no vector database
needed at this scale.
"""

import math
import os
import re
import logging
from typing import Dict, List, Optional
from dotenv import load_dotenv

load_dotenv()

from google import genai
from google.genai import types as genai_types

logger = logging.getLogger("feedops.rag")

PLAYBOOK_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "GOOGLE_ORDERING_REDIRECT_PLAYBOOK.md"
)
EMBEDDING_MODEL = os.getenv("GEMINI_EMBEDDING_MODEL", "gemini-embedding-001")
EMBEDDING_DIMENSION = int(os.getenv("GEMINI_EMBEDDING_DIMENSION", "768"))

_HEADER_RE = re.compile(r"^(#{2,3})\s+(.*)$", re.MULTILINE)

_indexed_chunks: Optional[List[Dict]] = None


def chunk_markdown(text: str) -> List[Dict[str, str]]:
    """
    Splits a markdown doc into one chunk per ##/### section, keyed by a slug of
    its header. Content before the first header (if any) is dropped -- the
    playbook's own title/intro isn't a retrievable rule.
    """
    matches = list(_HEADER_RE.finditer(text))
    chunks = []
    for i, match in enumerate(matches):
        title = match.group(2).strip()
        start = match.end()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
        content = text[start:end].strip()
        if not content:
            continue
        slug = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")
        chunks.append({"id": slug, "title": title, "content": content})
    return chunks


def _embed_batch(texts: List[str], task_type: str) -> List[List[float]]:
    client = genai.Client()
    response = client.models.embed_content(
        model=EMBEDDING_MODEL,
        contents=texts,
        config=genai_types.EmbedContentConfig(
            task_type=task_type, output_dimensionality=EMBEDDING_DIMENSION
        ),
    )
    return [e.values for e in response.embeddings]


def _cosine_similarity(a: List[float], b: List[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    norm_a = math.sqrt(sum(x * x for x in a))
    norm_b = math.sqrt(sum(y * y for y in b))
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return dot / (norm_a * norm_b)


def _load_and_embed_chunks(playbook_path: str = PLAYBOOK_PATH) -> List[Dict]:
    """Chunks + embeds the playbook once per process. Cheap enough (one file,
    one batched Gemini call) to just do lazily on first retrieval rather than
    needing a separate build step run ahead of time."""
    with open(playbook_path, "r") as f:
        text = f.read()

    chunks = chunk_markdown(text)
    if not chunks:
        return []

    embeddings = _embed_batch(
        [f"{c['title']}\n\n{c['content']}" for c in chunks], task_type="RETRIEVAL_DOCUMENT"
    )
    for chunk, embedding in zip(chunks, embeddings):
        chunk["embedding"] = embedding

    logger.info(f"Indexed {len(chunks)} playbook section(s) in memory.")
    return chunks


def retrieve_playbook_context(query: str, k: int = 3) -> List[Dict[str, str]]:
    """
    Retrieves the top-k playbook sections most relevant to `query`. Returns
    [{"title": ..., "content": ...}, ...], most relevant first. Returns an
    empty list (never raises) if the playbook file is missing or Gemini is
    unreachable -- callers should treat that as "no grounding available",
    not a hard failure.
    """
    global _indexed_chunks
    try:
        if _indexed_chunks is None:
            _indexed_chunks = _load_and_embed_chunks()
        if not _indexed_chunks:
            return []

        query_embedding = _embed_batch([query], task_type="RETRIEVAL_QUERY")[0]
        ranked = sorted(
            _indexed_chunks,
            key=lambda c: _cosine_similarity(c["embedding"], query_embedding),
            reverse=True,
        )
        return [{"title": c["title"], "content": c["content"]} for c in ranked[:k]]
    except Exception as e:
        logger.warning(f"Playbook retrieval unavailable ({e}); continuing without grounding.")
        return []
