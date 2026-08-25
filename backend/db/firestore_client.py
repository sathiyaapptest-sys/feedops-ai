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
from google.cloud import firestore
from google.cloud.firestore_v1.base_query import FieldFilter

logger = logging.getLogger("feedops.db")

MERCHANTS_COLLECTION = os.getenv("FIRESTORE_MERCHANTS_COLLECTION", "merchants")
ORGANIZATIONS_COLLECTION = os.getenv("FIRESTORE_ORGANIZATIONS_COLLECTION", "organizations")
UPLOAD_BATCHES_COLLECTION = os.getenv("FIRESTORE_UPLOAD_BATCHES_COLLECTION", "upload_batches")

# Lifecycle statuses a merchant document can hold.
STATUS_NEW = "new"
STATUS_MATCHED = "matched"
STATUS_NEEDS_REVIEW = "needs_review"
STATUS_NO_LISTING = "no_listing"
STATUS_EXCLUDED_CLOSED = "excluded_closed"
STATUS_APPROVED = "approved"
STATUS_REJECTED = "rejected"

# Who's using FeedOps AI -- a single restaurant, or a platform managing many.
ORG_TYPE_MERCHANT = "merchant"
ORG_TYPE_AGGREGATOR = "aggregator"

# Where an org is in the Partner Portal setup process (playbook sections 2, 9)
# -- entirely manual, human-only steps on Google's side that our system can't
# do for them, only track.
PORTAL_STATUS_NOT_STARTED = "not_started"
PORTAL_STATUS_CONFIGURED = "configured"          # SFTP key + username registered
PORTAL_STATUS_LAUNCH_APPROVED = "launch_approved"  # Google approved production

# Whether a human has confirmed an uploaded batch actually shows "Done, 0
# errors" in Partner Portal -> Ingestion -> History. There is no API for this
# -- a clean SFTP put only proves delivery, not acceptance (playbook section
# 6) -- so this is deliberately a self-report, never an automated check.
VERIFICATION_PENDING = "pending"
VERIFICATION_CONFIRMED_CLEAN = "confirmed_clean"
VERIFICATION_FLAGGED_ERRORS = "flagged_errors"


def get_client() -> "firestore.Client":
    """
    Returns a Firestore client using Application Default Credentials (a service
    account on Cloud Run, or `gcloud auth application-default login` locally).
    Set FIRESTORE_EMULATOR_HOST to point this at a local emulator instead.

    Uses google.cloud.firestore directly rather than firebase_admin.firestore's
    wrapper -- the wrapper hit a real "Invalid database id (default)" error in
    production (Cloud Run), a known incompatibility between firebase-admin's
    bundled client construction and the current google-cloud-firestore
    library's handling of the (default) database identifier. The direct
    library doesn't have this issue. firebase_admin is still initialized here
    since backend/server/auth.py's token verification depends on it.
    """
    if not firebase_admin._apps:
        firebase_admin.initialize_app()
    return firestore.Client()


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


class OrganizationRepository:
    """
    Firestore-backed CRUD over the `organizations` collection -- who's using
    FeedOps AI (a merchant or an aggregator), their per-environment Partner
    Portal config (SFTP username, numeric conversion partner ID, setup
    status), and their saved data-source adapter (see
    backend.tools.data_adapter) so a returning org's spreadsheet shape is
    remembered instead of re-guessed on every upload.
    """

    def __init__(self, client: Optional["firestore.Client"] = None):
        self.client = client or get_client()
        self.collection = self.client.collection(ORGANIZATIONS_COLLECTION)

    def create(self, org: Dict[str, Any]) -> Dict[str, Any]:
        org_id = org["org_id"]
        payload = {**org, "created_at": firestore.SERVER_TIMESTAMP, "updated_at": firestore.SERVER_TIMESTAMP}
        self.collection.document(org_id).set(payload)
        return org

    def get(self, org_id: str) -> Optional[Dict[str, Any]]:
        snapshot = self.collection.document(org_id).get()
        return snapshot.to_dict() if snapshot.exists else None

    def update_config(self, org_id: str, config: Dict[str, Any]) -> None:
        """Merges into the org's `config` map -- SFTP username(s), conversion
        partner ID, portal setup status per environment."""
        existing = self.get(org_id) or {}
        merged_config = {**existing.get("config", {}), **config}
        self.collection.document(org_id).set(
            {"config": merged_config, "updated_at": firestore.SERVER_TIMESTAMP}, merge=True
        )

    def save_adapter(self, org_id: str, adapter: Dict[str, Any]) -> None:
        self.collection.document(org_id).set(
            {"adapter": adapter, "updated_at": firestore.SERVER_TIMESTAMP}, merge=True
        )

    def get_adapter(self, org_id: str) -> Optional[Dict[str, Any]]:
        org = self.get(org_id)
        return org.get("adapter") if org else None


class UploadBatchRepository:
    """
    Firestore-backed history over the `upload_batches` collection -- one record
    per daily feed push run, so "what did we upload last Tuesday, and to whom"
    is answerable instead of vanishing once run_daily_feed_push()'s return
    dict goes out of scope.

    Also the home of the human verification loop: Google exposes no API to
    confirm a feed was actually *accepted* (only that it was *delivered*, via
    the SFTP put succeeding) -- that's a manual Partner Portal -> Ingestion ->
    History check. This repository never calls Google; mark_verified() only
    records what a human reports after doing that check themselves.
    """

    def __init__(self, client: Optional["firestore.Client"] = None):
        self.client = client or get_client()
        self.collection = self.client.collection(UPLOAD_BATCHES_COLLECTION)

    def create(self, batch: Dict[str, Any]) -> Dict[str, Any]:
        batch = {
            **batch,
            "verification_status": VERIFICATION_PENDING,
            "verified_by": None,
            "verified_at": None,
            "verification_notes": None,
        }
        payload = {**batch, "created_at": firestore.SERVER_TIMESTAMP}
        self.collection.document(batch["batch_id"]).set(payload)
        return batch

    def get(self, batch_id: str) -> Optional[Dict[str, Any]]:
        snapshot = self.collection.document(batch_id).get()
        return snapshot.to_dict() if snapshot.exists else None

    def list_all(self) -> List[Dict[str, Any]]:
        return [doc.to_dict() for doc in self.collection.stream()]

    def list_pending_verification(self) -> List[Dict[str, Any]]:
        query = self.collection.where(filter=FieldFilter("verification_status", "==", VERIFICATION_PENDING))
        return [doc.to_dict() for doc in query.stream()]

    def mark_verified(self, batch_id: str, status: str, verified_by: str, notes: Optional[str] = None) -> None:
        """Records a human's self-reported outcome of manually checking Partner
        Portal -> Ingestion -> History. Never calls Google -- there's no API to."""
        self.collection.document(batch_id).set({
            "verification_status": status,
            "verified_by": verified_by,
            "verified_at": firestore.SERVER_TIMESTAMP,
            "verification_notes": notes,
        }, merge=True)


def seed_from_snapshot(merchants: List[Dict[str, Any]], repo: Optional[MerchantRepository] = None) -> int:
    """Loads a merchant snapshot (see backend/jobs/scheduled_tasks.py's loader) into Firestore."""
    repo = repo or MerchantRepository()
    count = 0
    for m in merchants:
        repo.upsert({**m, "status": m.get("status", STATUS_NEW)})
        count += 1
    logger.info(f"Seeded {count} merchant(s) into Firestore collection '{MERCHANTS_COLLECTION}'.")
    return count
