"""
FeedOps AI - Playbook RAG index.

Chunks GOOGLE_ORDERING_REDIRECT_PLAYBOOK.md by section, embeds each chunk with
Gemini, and stores them in Firestore's native vector search so agents (and the
"Ask FeedOps" support endpoint) can retrieve the exact relevant passage instead
of working from a hand-written paraphrase in a prompt.

Requires a Firestore single-field vector index on the `embedding` field of the
`playbook_chunks` collection -- see deploy/README.md. Without it, find_nearest()
raises FailedPrecondition with a link to create it.
"""

import os
import re
import logging
from typing import Dict, List

from google import genai
from google.genai import types as genai_types
from google.cloud.firestore_v1.vector import Vector
from google.cloud.firestore_v1.base_vector_query import DistanceMeasure

from backend.db.firestore_client import get_client

logger = logging.getLogger("feedops.rag")

PLAYBOOK_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "GOOGLE_ORDERING_REDIRECT_PLAYBOOK.md"
)
CHUNKS_COLLECTION = os.getenv("FIRESTORE_PLAYBOOK_COLLECTION", "playbook_chunks")
EMBEDDING_MODEL = os.getenv("GEMINI_EMBEDDING_MODEL", "gemini-embedding-001")
EMBEDDING_DIMENSION = int(os.getenv("GEMINI_EMBEDDING_DIMENSION", "768"))

_HEADER_RE = re.compile(r"^(#{2,3})\s+(.*)$", re.MULTILINE)


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


def _embed(text: str, task_type: str) -> List[float]:
    client = genai.Client()
    response = client.models.embed_content(
        model=EMBEDDING_MODEL,
        contents=text,
        config=genai_types.EmbedContentConfig(
            task_type=task_type, output_dimensionality=EMBEDDING_DIMENSION
        ),
    )
    return response.embeddings[0].values


def build_index(playbook_path: str = PLAYBOOK_PATH) -> int:
    """Chunks + embeds + writes the playbook into Firestore. Run once, or after
    the playbook doc changes."""
    with open(playbook_path, "r") as f:
        text = f.read()

    chunks = chunk_markdown(text)
    collection = get_client().collection(CHUNKS_COLLECTION)

    for chunk in chunks:
        embedding = _embed(f"{chunk['title']}\n\n{chunk['content']}", task_type="RETRIEVAL_DOCUMENT")
        collection.document(chunk["id"]).set({
            "title": chunk["title"],
            "content": chunk["content"],
            "embedding": Vector(embedding),
        })

    logger.info(f"Indexed {len(chunks)} playbook section(s) into Firestore collection '{CHUNKS_COLLECTION}'.")
    return len(chunks)


def retrieve_playbook_context(query: str, k: int = 3) -> List[Dict[str, str]]:
    """
    Retrieves the top-k playbook sections most relevant to `query`. Returns
    [{"title": ..., "content": ...}, ...], most relevant first. Returns an
    empty list (never raises) if the index isn't built yet or Firestore/Gemini
    is unreachable -- callers should treat that as "no grounding available",
    not a hard failure.
    """
    try:
        query_embedding = _embed(query, task_type="RETRIEVAL_QUERY")
        collection = get_client().collection(CHUNKS_COLLECTION)
        results = collection.find_nearest(
            vector_field="embedding",
            query_vector=Vector(query_embedding),
            limit=k,
            distance_measure=DistanceMeasure.COSINE,
        ).get()
        return [{"title": doc.to_dict()["title"], "content": doc.to_dict()["content"]} for doc in results]
    except Exception as e:
        logger.warning(f"Playbook retrieval unavailable ({e}); continuing without grounding.")
        return []
