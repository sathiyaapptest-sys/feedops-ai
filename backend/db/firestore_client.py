"""
FeedOps AI - Firestore-backed merchant persistence.

Merchant records are the system of record for the daily feed push, the HITL
triage queue, and the launch-readiness scorecard. This is deliberately a thin
repository over plain Firestore documents (no ORM) so the query shapes stay
obvious and match what the FastAPI routes and scheduled jobs actually need.
"""

import logging
import os
from typing import Any, Dict, List, Optional

import firebase_admin
from firebase_admin import firestore
from google.cloud.firestore_v1.base_query import FieldFilter

logger = logging.getLogger("feedops.db")

MERCHANTS_COLLECTION = os.getenv("FIRESTORE_MERCHANTS_COLLECTION", "merchants")

# Lifecycle statuses a merchant document can hold.
STATUS_NEW = "new"
STATUS_MATCHED = "matched"
STATUS_NEEDS_REVIEW = "needs_review"
STATUS_NO_LISTING = "no_listing"
STATUS_EXCLUDED_CLOSED = "excluded_closed"
STATUS_APPROVED = "approved"
STATUS_REJECTED = "rejected"


def get_client() -> "firestore.Client":
    """
    Returns a Firestore client using Application Default Credentials (a service
    account on Cloud Run, or `gcloud auth application-default login` locally).
    Set FIRESTORE_EMULATOR_HOST to point this at a local emulator instead.
    """
    if not firebase_admin._apps:
        firebase_admin.initialize_app()
    return firestore.client()


class MerchantRepository:
    """Firestore-backed CRUD + queries over the `merchants` collection."""

    def __init__(self, client: Optional["firestore.Client"] = None):
        self.client = client or get_client()
        self.collection = self.client.collection(MERCHANTS_COLLECTION)

    def upsert(self, merchant: Dict[str, Any]) -> None:
        """Creates or updates a merchant document, keyed by its store_id."""
        store_id = merchant["store_id"]
        payload = {**merchant, "updated_at": firestore.SERVER_TIMESTAMP}
        self.collection.document(store_id).set(payload, merge=True)

    def get(self, store_id: str) -> Optional[Dict[str, Any]]:
        snapshot = self.collection.document(store_id).get()
        return snapshot.to_dict() if snapshot.exists else None

    def list_all(self) -> List[Dict[str, Any]]:
        return [doc.to_dict() for doc in self.collection.stream()]

    def list_by_status(self, status: str) -> List[Dict[str, Any]]:
        query = self.collection.where(filter=FieldFilter("status", "==", status))
        return [doc.to_dict() for doc in query.stream()]

    def list_active(self) -> List[Dict[str, Any]]:
        """Merchants eligible to appear in the daily feed push."""
        excluded_statuses = {STATUS_EXCLUDED_CLOSED, STATUS_REJECTED}
        return [m for m in self.list_all() if m.get("status") not in excluded_statuses]

    def update_status(self, store_id: str, status: str, extra: Optional[Dict[str, Any]] = None) -> None:
        payload = {"status": status, "updated_at": firestore.SERVER_TIMESTAMP}
        if extra:
            payload.update(extra)
        self.collection.document(store_id).set(payload, merge=True)

    def readiness_summary(self) -> Dict[str, Any]:
        """Counts backing the launch-readiness scorecard, computed from real documents."""
        merchants = self.list_all()
        total = len(merchants)
        by_status: Dict[str, int] = {}
        for m in merchants:
            status = m.get("status", STATUS_NEW)
            by_status[status] = by_status.get(status, 0) + 1

        fully_operational = by_status.get(STATUS_MATCHED, 0) + by_status.get(STATUS_APPROVED, 0)
        resolved_edge_cases = by_status.get(STATUS_APPROVED, 0) + by_status.get(STATUS_REJECTED, 0)
        score = round((fully_operational / total) * 100) if total else 0

        return {
            "score": score,
            "total": total,
            "fully_operational": fully_operational,
            "resolved_edge_cases": resolved_edge_cases,
            "by_status": by_status,
        }


def seed_from_snapshot(merchants: List[Dict[str, Any]], repo: Optional[MerchantRepository] = None) -> int:
    """Loads a merchant snapshot (see backend/jobs/scheduled_tasks.py's loader) into Firestore."""
    repo = repo or MerchantRepository()
    count = 0
    for m in merchants:
        repo.upsert({**m, "status": m.get("status", STATUS_NEW)})
        count += 1
    logger.info(f"Seeded {count} merchant(s) into Firestore collection '{MERCHANTS_COLLECTION}'.")
    return count
