"""
FeedOps AI - Firestore-backed merchant persistence.

Merchant records are the system of record for the daily feed push, the HITL
triage queue, and the launch-readiness scorecard. This is deliberately a thin
repository over plain Firestore documents (no ORM) so the query shapes stay
obvious and match what the FastAPI routes and scheduled jobs actually need.

Talks to Firestore over raw authenticated REST rather than the
google-cloud-firestore SDK. Root cause, found via a temporary debug endpoint
that dumped full exception/traceback (the app's normal error handling only
ever surfaced str(e), which wasn't enough to diagnose this): every SDK call
-- gRPC (the default transport) AND the SDK's own REST transport, across
google-cloud-firestore 2.28.1 and 2.29.0 alike -- failed in production with
"400 Invalid database id (default)" specifically when authenticated as Cloud
Run's native service-account credentials (Compute Engine-style, from the
metadata server). The identical code, identical database, identical service
account (tested via impersonation) worked perfectly locally. Raw authenticated
REST calls (google.auth.transport.requests.AuthorizedSession, no SDK
involved) work correctly in every case tested, including the exact failing
Cloud Run environment -- confirmed live before this rewrite. The
google-cloud-firestore SDK is no longer a dependency of this codebase at
all -- backend/rag/playbook_index.py, its one remaining user, now indexes
the (Docker-bundled) playbook file in memory instead of via Firestore's
native vector search, sidestepping the same broken SDK entirely.
"""

import datetime
import logging
import os
from typing import Any, Dict, List, Optional

import google.auth
import google.auth.transport.requests

logger = logging.getLogger("feedops.db")

MERCHANTS_COLLECTION = os.getenv("FIRESTORE_MERCHANTS_COLLECTION", "merchants")
ORGANIZATIONS_COLLECTION = os.getenv("FIRESTORE_ORGANIZATIONS_COLLECTION", "organizations")
UPLOAD_BATCHES_COLLECTION = os.getenv("FIRESTORE_UPLOAD_BATCHES_COLLECTION", "upload_batches")
MENUS_COLLECTION = os.getenv("FIRESTORE_MENUS_COLLECTION", "menus")
CONVERSION_CHECKS_COLLECTION = os.getenv("FIRESTORE_CONVERSION_CHECKS_COLLECTION", "conversion_checks")

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

# A stand-in for firestore.SERVER_TIMESTAMP -- pass this in a payload's value
# and it's replaced with the current UTC time at write time. Client-side, not
# server-authoritative like the SDK's real sentinel, which is fine here: every
# use in this file is bookkeeping ("when was this last touched"), not
# anything needing microsecond server-clock precision.
SERVER_TIMESTAMP = object()

_FIRESTORE_BASE = "https://firestore.googleapis.com/v1"


class _FirestoreRest:
    """Minimal Firestore REST client covering exactly what this file's
    repositories need: get/set a document, list a collection, and a single
    equality where-filter. See module docstring for why this exists instead
    of the google-cloud-firestore SDK."""

    def __init__(self, project: Optional[str] = None):
        credentials, default_project = google.auth.default()
        self._session = google.auth.transport.requests.AuthorizedSession(credentials)
        self.project = project or default_project
        self._base = f"{_FIRESTORE_BASE}/projects/{self.project}/databases/(default)/documents"

    # ---- Firestore <-> Python value (de)serialization ----

    def _to_value(self, v: Any) -> Dict[str, Any]:
        if v is SERVER_TIMESTAMP:
            now = datetime.datetime.now(datetime.timezone.utc)
            return {"timestampValue": now.isoformat().replace("+00:00", "Z")}
        if v is None:
            return {"nullValue": None}
        if isinstance(v, bool):
            return {"booleanValue": v}
        if isinstance(v, int):
            return {"integerValue": str(v)}
        if isinstance(v, float):
            return {"doubleValue": v}
        if isinstance(v, str):
            return {"stringValue": v}
        if isinstance(v, dict):
            return {"mapValue": {"fields": {k: self._to_value(val) for k, val in v.items()}}}
        if isinstance(v, (list, tuple)):
            return {"arrayValue": {"values": [self._to_value(item) for item in v]}}
        if isinstance(v, datetime.datetime):
            return {"timestampValue": v.astimezone(datetime.timezone.utc).isoformat().replace("+00:00", "Z")}
        # Unrecognized type (e.g. an unexpected object) -- stringify rather
        # than silently drop the field.
        return {"stringValue": str(v)}

    def _from_value(self, v: Dict[str, Any]) -> Any:
        if "nullValue" in v:
            return None
        if "booleanValue" in v:
            return v["booleanValue"]
        if "integerValue" in v:
            return int(v["integerValue"])
        if "doubleValue" in v:
            return v["doubleValue"]
        if "stringValue" in v:
            return v["stringValue"]
        if "timestampValue" in v:
            return v["timestampValue"]
        if "mapValue" in v:
            return {k: self._from_value(val) for k, val in v.get("mapValue", {}).get("fields", {}).items()}
        if "arrayValue" in v:
            return [self._from_value(item) for item in v.get("arrayValue", {}).get("values", [])]
        return None

    def _doc_to_dict(self, doc_json: Dict[str, Any]) -> Dict[str, Any]:
        fields = doc_json.get("fields", {})
        return {k: self._from_value(v) for k, v in fields.items()}

    # ---- operations ----

    def get(self, collection: str, doc_id: str) -> Optional[Dict[str, Any]]:
        resp = self._session.get(f"{self._base}/{collection}/{doc_id}")
        if resp.status_code == 404:
            return None
        resp.raise_for_status()
        return self._doc_to_dict(resp.json())

    def set(self, collection: str, doc_id: str, data: Dict[str, Any], merge: bool = False) -> None:
        fields = {k: self._to_value(v) for k, v in data.items()}
        params: List[tuple] = []
        if merge:
            for key in data.keys():
                params.append(("updateMask.fieldPaths", key))
        resp = self._session.patch(
            f"{self._base}/{collection}/{doc_id}",
            json={"fields": fields},
            params=params,
        )
        resp.raise_for_status()

    def list_all(self, collection: str) -> List[Dict[str, Any]]:
        results: List[Dict[str, Any]] = []
        page_token: Optional[str] = None
        while True:
            params = {"pageSize": 300}
            if page_token:
                params["pageToken"] = page_token
            resp = self._session.get(f"{self._base}/{collection}", params=params)
            resp.raise_for_status()
            body = resp.json()
            results.extend(self._doc_to_dict(doc) for doc in body.get("documents", []))
            page_token = body.get("nextPageToken")
            if not page_token:
                break
        return results

    def query_equals(self, collection: str, field: str, value: Any) -> List[Dict[str, Any]]:
        body = {
            "structuredQuery": {
                "from": [{"collectionId": collection}],
                "where": {
                    "fieldFilter": {
                        "field": {"fieldPath": field},
                        "op": "EQUAL",
                        "value": self._to_value(value),
                    }
                },
            }
        }
        resp = self._session.post(f"{self._base}:runQuery", json=body)
        resp.raise_for_status()
        results = []
        for chunk in resp.json():
            doc = chunk.get("document")
            if doc:
                results.append(self._doc_to_dict(doc))
        return results


_client_singleton: Optional[_FirestoreRest] = None


def get_client() -> _FirestoreRest:
    """Returns a shared Firestore REST client using Application Default
    Credentials (a service account on Cloud Run, or `gcloud auth
    application-default login` locally)."""
    global _client_singleton
    if _client_singleton is None:
        _client_singleton = _FirestoreRest()
    return _client_singleton


class MerchantRepository:
    """Firestore-backed CRUD + queries over the `merchants` collection."""

    def __init__(self, client: Optional[_FirestoreRest] = None):
        self.client = client or get_client()

    def upsert(self, merchant: Dict[str, Any]) -> None:
        """Creates or updates a merchant document, keyed by its store_id."""
        store_id = merchant["store_id"]
        payload = {**merchant, "updated_at": SERVER_TIMESTAMP}
        self.client.set(MERCHANTS_COLLECTION, store_id, payload, merge=True)

    def get(self, store_id: str) -> Optional[Dict[str, Any]]:
        return self.client.get(MERCHANTS_COLLECTION, store_id)

    def list_all(self) -> List[Dict[str, Any]]:
        return self.client.list_all(MERCHANTS_COLLECTION)

    def list_by_status(self, status: str) -> List[Dict[str, Any]]:
        return self.client.query_equals(MERCHANTS_COLLECTION, "status", status)

    def list_active(self) -> List[Dict[str, Any]]:
        """Merchants eligible to appear in the daily feed push."""
        excluded_statuses = {STATUS_EXCLUDED_CLOSED, STATUS_REJECTED}
        return [m for m in self.list_all() if m.get("status") not in excluded_statuses]

    def update_status(self, store_id: str, status: str, extra: Optional[Dict[str, Any]] = None) -> None:
        payload = {"status": status, "updated_at": SERVER_TIMESTAMP}
        if extra:
            payload.update(extra)
        self.client.set(MERCHANTS_COLLECTION, store_id, payload, merge=True)

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

    def __init__(self, client: Optional[_FirestoreRest] = None):
        self.client = client or get_client()

    def create(self, org: Dict[str, Any]) -> Dict[str, Any]:
        org_id = org["org_id"]
        payload = {**org, "created_at": SERVER_TIMESTAMP, "updated_at": SERVER_TIMESTAMP}
        self.client.set(ORGANIZATIONS_COLLECTION, org_id, payload, merge=False)
        return org

    def get(self, org_id: str) -> Optional[Dict[str, Any]]:
        return self.client.get(ORGANIZATIONS_COLLECTION, org_id)

    def update_config(self, org_id: str, config: Dict[str, Any]) -> None:
        """Merges into the org's `config` map -- SFTP username(s), conversion
        partner ID, portal setup status per environment."""
        existing = self.get(org_id) or {}
        merged_config = {**existing.get("config", {}), **config}
        self.client.set(
            ORGANIZATIONS_COLLECTION, org_id,
            {"config": merged_config, "updated_at": SERVER_TIMESTAMP}, merge=True,
        )

    def save_adapter(self, org_id: str, adapter: Dict[str, Any]) -> None:
        self.client.set(
            ORGANIZATIONS_COLLECTION, org_id,
            {"adapter": adapter, "updated_at": SERVER_TIMESTAMP}, merge=True,
        )

    def get_adapter(self, org_id: str) -> Optional[Dict[str, Any]]:
        org = self.get(org_id)
        return org.get("adapter") if org else None


class MenuRepository:
    """
    Firestore-backed CRUD over the `menus` collection -- the exact same
    `menus/{store_id}` documents Menu.tsx's client-side Firebase SDK reads and
    writes for a self-service merchant's own menu editor (`{items: [...],
    status, updated_at}`). Written here via the service account's own IAM
    access rather than the client SDK, since a bulk menu upload acts on
    behalf of many merchants at once -- Firestore Security Rules restrict the
    client SDK to a single authenticated user's own document, which an
    aggregator's bulk upload is not.
    """

    def __init__(self, client: Optional[_FirestoreRest] = None):
        self.client = client or get_client()

    def get(self, store_id: str) -> Optional[Dict[str, Any]]:
        return self.client.get(MENUS_COLLECTION, store_id)

    @staticmethod
    def _dedupe_key(item: Dict[str, Any]) -> str:
        """Same composite key Menu.tsx's own accumulate/dedupe logic uses
        (name+category+price, not name alone) -- a dish can legitimately
        appear in two categories (e.g. breakfast and dinner) at different
        prices, so name alone would wrongly treat those as duplicates."""
        name = str(item.get("name", "")).strip().lower()
        category = str(item.get("category") or "").strip().lower()
        price = item.get("price")
        try:
            price_key = f"{float(price):.2f}"
        except (TypeError, ValueError):
            price_key = str(price).strip().lower()
        return f"{name}|{category}|{price_key}"

    def add_items(self, store_id: str, new_items: List[Dict[str, Any]]) -> Dict[str, int]:
        """Merges new_items into the merchant's existing menu, skipping any that
        already exist by the composite dedupe key -- the same accumulate-not-
        overwrite behavior Menu.tsx's own uploads use, so a bulk upload can't
        silently wipe out items a merchant already added themselves."""
        existing = self.get(store_id) or {}
        current_items: List[Dict[str, Any]] = existing.get("items") or []
        seen = {self._dedupe_key(item) for item in current_items}

        added = []
        skipped = 0
        for item in new_items:
            key = self._dedupe_key(item)
            if key in seen:
                skipped += 1
                continue
            seen.add(key)
            added.append(item)

        payload = {
            "items": current_items + added,
            "status": existing.get("status", "draft"),
            "updated_at": SERVER_TIMESTAMP,
        }
        self.client.set(MENUS_COLLECTION, store_id, payload, merge=True)
        return {"added": len(added), "skipped_duplicates": skipped, "total": len(current_items) + len(added)}


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

    def __init__(self, client: Optional[_FirestoreRest] = None):
        self.client = client or get_client()

    def create(self, batch: Dict[str, Any]) -> Dict[str, Any]:
        """
        feed_files is expected as the compiler's own {feed_type: path, ...} dict
        (including the "*_descriptor" entries) rather than a flat list, so each
        real feed type present (entity/action/service -- service is optional,
        omitted entirely when no merchant has a real lead_time on file) gets its
        own independently-trackable feed_status_{type} field, initialized to
        pending. Google's Partner Portal shows per-file-type ingestion history,
        not one blended status for the whole batch, so this mirrors that.
        """
        feed_types = sorted({
            k for k in (batch.get("feed_files") or {}).keys() if not k.endswith("_descriptor")
        })
        feed_status_fields = {f"feed_status_{ft}": VERIFICATION_PENDING for ft in feed_types}

        batch = {
            **batch,
            "feed_types": feed_types,
            "verification_status": VERIFICATION_PENDING,
            "verified_by": None,
            "verified_at": None,
            "verification_notes": None,
            **feed_status_fields,
        }
        payload = {**batch, "created_at": SERVER_TIMESTAMP}
        self.client.set(UPLOAD_BATCHES_COLLECTION, batch["batch_id"], payload, merge=False)
        return batch

    def get(self, batch_id: str) -> Optional[Dict[str, Any]]:
        return self.client.get(UPLOAD_BATCHES_COLLECTION, batch_id)

    def list_all(self) -> List[Dict[str, Any]]:
        return self.client.list_all(UPLOAD_BATCHES_COLLECTION)

    def list_pending_verification(self) -> List[Dict[str, Any]]:
        return self.client.query_equals(UPLOAD_BATCHES_COLLECTION, "verification_status", VERIFICATION_PENDING)

    def mark_verified(self, batch_id: str, status: str, verified_by: str, notes: Optional[str] = None) -> None:
        """Records a human's self-reported outcome of manually checking Partner
        Portal -> Ingestion -> History. Never calls Google -- there's no API to."""
        self.client.set(UPLOAD_BATCHES_COLLECTION, batch_id, {
            "verification_status": status,
            "verified_by": verified_by,
            "verified_at": SERVER_TIMESTAMP,
            "verification_notes": notes,
        }, merge=True)

    def mark_feed_status(self, batch_id: str, feed_type: str, status: str, verified_by: str) -> None:
        """
        Records a human's self-reported outcome for one feed type (entity/action/
        service) within a batch. Writes three flat top-level fields (never a
        nested map) so merge=True's field-mask-per-top-level-key semantics touch
        only this feed type -- a nested {feed_status: {entity: ...}} map would
        get merge=True'd as one field and silently wipe out the other feed
        types' statuses already recorded in that same map.
        """
        self.client.set(UPLOAD_BATCHES_COLLECTION, batch_id, {
            f"feed_status_{feed_type}": status,
            f"feed_status_{feed_type}_by": verified_by,
            f"feed_status_{feed_type}_at": SERVER_TIMESTAMP,
        }, merge=True)


class ConversionCheckRepository:
    """
    Firestore-backed history over the `conversion_checks` collection -- one
    record per synthetic rwg_token conversion sweep (see
    backend.tools.conversion_sentry.ConversionSentryTool), so the playbook's
    "3 events / 7 days" launch-eligibility rule (section 7) can be checked
    against real recorded runs instead of an in-memory log that resets
    every time the process restarts (Cloud Run Jobs run as separate ephemeral
    processes, so ConversionSentryTool's own in-memory health_log never
    survives between weekly runs in production).
    """

    def __init__(self, client: Optional[_FirestoreRest] = None):
        self.client = client or get_client()

    def create(self, check: Dict[str, Any]) -> Dict[str, Any]:
        payload = {**check, "created_at": SERVER_TIMESTAMP}
        self.client.set(CONVERSION_CHECKS_COLLECTION, check["check_id"], payload, merge=False)
        return check

    def list_all(self) -> List[Dict[str, Any]]:
        return self.client.list_all(CONVERSION_CHECKS_COLLECTION)


def seed_from_snapshot(merchants: List[Dict[str, Any]], repo: Optional[MerchantRepository] = None) -> int:
    """Loads a merchant snapshot (see backend/jobs/scheduled_tasks.py's loader) into Firestore."""
    repo = repo or MerchantRepository()
    count = 0
    for m in merchants:
        repo.upsert({**m, "status": m.get("status", STATUS_NEW)})
        count += 1
    logger.info(f"Seeded {count} merchant(s) into Firestore collection '{MERCHANTS_COLLECTION}'.")
    return count
