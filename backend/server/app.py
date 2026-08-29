from fastapi import FastAPI, Request, UploadFile, File, Form, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException
import asyncio
import json
import logging
import os
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional
from dotenv import load_dotenv
load_dotenv()
import shutil
import tempfile
from pydantic import BaseModel

logger = logging.getLogger("feedops.server")
from backend.tools.menu_extractor import ImageMenuExtractor
from backend.tools.excel_parser import SpreadsheetFeedParser
from backend.tools.data_adapter import slugify_store_id
from backend.tools.places_matcher import GooglePlacesClient, resolve_entity_match
from backend.tools.feed_screenshot_analyzer import FeedScreenshotAnalyzer
from backend.tools.entity_match_assist import parse_entity_csv, suggest_matches
from backend.tools.onboarding_journey import compute_journey, compute_conversion_compliance, compute_menu_journey
from backend.server.auth import get_current_user
from backend.agent.orchestrator import FeedOpsOrchestrator
from backend.db.firestore_client import (
    MerchantRepository, STATUS_NEW, STATUS_MATCHED, STATUS_NEEDS_REVIEW,
    STATUS_NO_LISTING, STATUS_APPROVED, STATUS_REJECTED, STATUS_EXCLUDED_CLOSED,
    OrganizationRepository, ORG_TYPE_MERCHANT, ORG_TYPE_AGGREGATOR, PORTAL_STATUS_NOT_STARTED,
    UploadBatchRepository, VERIFICATION_CONFIRMED_CLEAN, VERIFICATION_FLAGGED_ERRORS,
    MenuRepository, ConversionCheckRepository,
)
from backend.jobs.scheduled_tasks import run_daily_feed_push, run_weekly_conversion_sweep
from backend.jobs.menu_feed_push import run_menu_feed_push

app = FastAPI(title="FeedOps AI Backend")

_orchestrator: FeedOpsOrchestrator | None = None


def get_orchestrator() -> FeedOpsOrchestrator:
    global _orchestrator
    if _orchestrator is None:
        _orchestrator = FeedOpsOrchestrator()
    return _orchestrator

# Enable CORS for Vite dev server
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class OrganizationIn(BaseModel):
    org_id: Optional[str] = None
    org_type: str  # "merchant" | "aggregator"
    name: str
    contact_email: str
    goal: str  # free text: what they want to achieve (visibility only? conversion tracking too?)


class OrganizationConfigIn(BaseModel):
    sftp_username_sandbox: Optional[str] = None
    sftp_username_production: Optional[str] = None
    conversion_partner_id: Optional[str] = None
    portal_status_sandbox: Optional[str] = None
    portal_status_production: Optional[str] = None
    sandbox_to_prod_review_status: Optional[str] = None
    launch_review_status: Optional[str] = None
    # Menu Feeds -- a separate, opt-in onboarding track (see
    # backend/tools/onboarding_journey.py's compute_menu_journey). Defaults
    # off; every field below is additive and never read by the core 7-step
    # Ordering Redirect journey.
    menu_feeds_enabled: Optional[bool] = None
    generic_sftp_username_sandbox: Optional[str] = None
    generic_sftp_username_production: Optional[str] = None
    menu_sandbox_review_status: Optional[str] = None
    menu_launch_review_status: Optional[str] = None


class ServiceOptionsIn(BaseModel):
    delivery: bool = False
    takeaway: bool = False
    inStore: bool = False


class TimingIn(BaseModel):
    day: str
    isOpen: bool
    openTime: str
    closeTime: str


class MerchantProfileIn(BaseModel):
    """MyStore.tsx's self-service profile form -- the fields the daily feed
    push, and now the service feed (lead time + hours), actually need."""
    storeName: str
    address: str
    phone: Optional[str] = None
    email: Optional[str] = None
    actionUrl: Optional[str] = None
    placeId: Optional[str] = None
    serviceOptions: ServiceOptionsIn = ServiceOptionsIn()
    timings: List[TimingIn] = []
    leadTimeMinutes: Optional[float] = None


def _service_types_from_options(options: Dict[str, Any]) -> List[str]:
    """Maps MyStore.tsx's service-option checkboxes to Actions Center's
    DELIVERY/TAKEOUT/DINE_IN enum (section 3.2)."""
    types = []
    if options.get("delivery"):
        types.append("DELIVERY")
    if options.get("takeaway"):
        types.append("TAKEOUT")
    if options.get("inStore") or options.get("dineIn"):
        types.append("DINE_IN")
    return types


@app.post("/api/organizations")
async def create_organization(payload: OrganizationIn, current_user: dict = Depends(get_current_user)):
    """Onboarding intake: who's using FeedOps AI and what they're trying to achieve,
    before any merchant data processing starts."""
    if payload.org_type not in (ORG_TYPE_MERCHANT, ORG_TYPE_AGGREGATOR):
        return {"status": "error", "message": f"org_type must be '{ORG_TYPE_MERCHANT}' or '{ORG_TYPE_AGGREGATOR}'."}

    org = {
        "org_id": payload.org_id or uuid.uuid4().hex[:12],
        "org_type": payload.org_type,
        "name": payload.name,
        "contact_email": payload.contact_email,
        "goal": payload.goal,
        "portal_status": {"sandbox": PORTAL_STATUS_NOT_STARTED, "production": PORTAL_STATUS_NOT_STARTED},
        "config": {},
    }
    try:
        await asyncio.to_thread(OrganizationRepository().create, org)
        return {"status": "created", "org": org}
    except Exception as e:
        return {"status": "error", "message": str(e)}


@app.get("/api/organizations/{org_id}")
async def get_organization(org_id: str, current_user: dict = Depends(get_current_user)):
    try:
        org = await asyncio.to_thread(OrganizationRepository().get, org_id)
        if not org:
            return {"status": "error", "message": "Organization not found."}
        return {"status": "ok", "org": org}
    except Exception as e:
        return {"status": "error", "message": str(e)}


@app.patch("/api/organizations/{org_id}/config")
async def update_organization_config(
    org_id: str, payload: OrganizationConfigIn, current_user: dict = Depends(get_current_user)
):
    """Captures the Partner Portal values FeedOps AI actually needs (SFTP username,
    numeric conversion partner ID, per-environment setup status) -- see the
    walkthrough guide for where to find these in the portal."""
    config = {k: v for k, v in payload.model_dump().items() if v is not None}
    try:
        await asyncio.to_thread(OrganizationRepository().update_config, org_id, config)
        return {"status": "updated", "config": config}
    except Exception as e:
        return {"status": "error", "message": str(e)}


@app.post("/api/merchants/onboard")
async def onboard_merchant(request: Request, current_user: dict = Depends(get_current_user)):
    """
    Accepts the merchant's initial store name/address/phone/email and runs only
    the EntityMatcher stage (Places resolution + agent review) -- SchemaAuditor
    and ConversionSentry run later, from the Services page, once My Store has
    collected the hours/lead-time/service-types a real feed needs.

    store_id is always the authenticated user's email, not whatever the client
    sends -- the same identifier space `merchants/{email}` My Store's profile
    save and the Services page's audit both read/write, so all three pages
    merge into one record instead of three disconnected ones.
    """
    merchant_data = await request.json()
    email = current_user.get("email")
    if email:
        merchant_data["store_id"] = email
        merchant_data.setdefault("email", email)
    orchestrator = get_orchestrator()

    async def event_generator():
        async for event_json in orchestrator.execute_entity_matching(merchant_data):
            yield f"data: {event_json}\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")

@app.get("/api/merchants/profile")
async def get_merchant_profile(current_user: dict = Depends(get_current_user)):
    """Returns the authenticated merchant's own record from the `merchants`
    collection -- the system of record the daily feed push, triage queue, and
    readiness scorecard all read from. Distinct from the `stores` collection
    MyStore.tsx also writes directly for its own display -- this is the copy
    that actually reaches Google."""
    email = current_user.get("email")
    if not email:
        return {"status": "error", "message": "No email on the authenticated user."}
    try:
        record = await asyncio.to_thread(MerchantRepository().get, email)
        return {"status": "success", "profile": record}
    except Exception as e:
        return {"status": "error", "message": str(e)}

@app.post("/api/merchants/profile")
async def save_merchant_profile(payload: MerchantProfileIn, current_user: dict = Depends(get_current_user)):
    """
    Self-service merchant profile save. Writes into the same `merchants`
    collection the daily feed push compiles from, so editing hours/lead-time
    here actually reaches the entity/action/service feeds instead of sitting
    in the separate `stores` collection MyStore.tsx also writes for its own
    (unrelated) display purposes. Keyed by the authenticated user's email,
    matching the identifier space `stores/{email}` already uses.
    """
    email = current_user.get("email")
    if not email:
        return {"status": "error", "message": "No email on the authenticated user."}

    store_id = email
    try:
        repo = MerchantRepository()
        existing = await asyncio.to_thread(repo.get, store_id)
        record: Dict[str, Any] = {
            "store_id": store_id,
            "name": payload.storeName,
            "address": payload.address,
            "telephone": payload.phone or "",
            "email": payload.email or email,
            "action_link": payload.actionUrl,
            "action_url": payload.actionUrl,
            "service_types": _service_types_from_options(payload.serviceOptions.model_dump()),
            "opening_hours": [t.model_dump() for t in payload.timings],
            "lead_time_minutes": payload.leadTimeMinutes,
            "place_id": payload.placeId if payload.placeId is not None else "",
        }
        if not existing:
            record["status"] = STATUS_NEW
        await asyncio.to_thread(repo.upsert, {k: (v if v is not None else "") for k, v in record.items()})
        return {"status": "success", "store_id": store_id}
    except Exception as e:
        return {"status": "error", "message": str(e)}

@app.post("/api/merchants/audit")
async def audit_merchant(current_user: dict = Depends(get_current_user)):
    """
    Services page's real trigger: runs SchemaAuditor (compiles + audits the
    entity/action/service feed bundle) and ConversionSentry (synthetic ping)
    against the authenticated merchant's full saved record, and streams both
    agents' progress plus the actual compiled feed JSON -- so the page (and a
    judge watching it) sees the real pipeline output, not a canned demo.
    """
    email = current_user.get("email")
    if not email:
        async def error_stream():
            yield 'data: {"agent_name": "SchemaAuditorAgent", "stage": "schema_compilation", "status": "flagged", "detail": "No authenticated email on this session."}\n\n'
        return StreamingResponse(error_stream(), media_type="text/event-stream")

    merchant = await asyncio.to_thread(MerchantRepository().get, email)
    if not merchant:
        async def missing_stream():
            yield 'data: {"agent_name": "SchemaAuditorAgent", "stage": "schema_compilation", "status": "flagged", "detail": "No merchant profile on file yet -- complete Onboard Store first."}\n\n'
        return StreamingResponse(missing_stream(), media_type="text/event-stream")

    orchestrator = get_orchestrator()

    async def event_generator():
        async for event_json in orchestrator.execute_feed_compilation(merchant):
            yield f"data: {event_json}\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")

@app.get("/api/merchants/audit")
async def get_merchant_audit(current_user: dict = Depends(get_current_user)):
    """Returns the last persisted feed audit (compiled feed content + conversion
    health) without re-running the agents -- so revisiting the Services page
    shows the last real result instead of a blank slate."""
    email = current_user.get("email")
    if not email:
        return {"status": "error", "message": "No email on the authenticated user."}
    try:
        record = await asyncio.to_thread(MerchantRepository().get, email) or {}
        return {
            "status": "success",
            "compiled_feeds": record.get("compiled_feeds"),
            "feed_audit_reasoning": record.get("feed_audit_reasoning"),
            "conversion_health": record.get("conversion_health"),
            "feeds_compiled_at": record.get("feeds_compiled_at"),
        }
    except Exception as e:
        return {"status": "error", "message": str(e)}

@app.get("/api/merchants")
async def list_merchants():
    """
    Validated merchant directory for the aggregator's Merchants page -- only
    merchants that have actually cleared entity matching (status matched, a
    high-confidence automatic Places match, or approved, a human's Triage
    Queue decision on an ambiguous one). A merchant still needs_review or
    unresolved isn't real inventory yet; it belongs in the Triage Queue until
    someone acts on it, not in the roster of merchants actually being served.
    """
    try:
        merchants = await asyncio.to_thread(MerchantRepository().list_all)
        validated = [m for m in merchants if m.get("status") in (STATUS_MATCHED, STATUS_APPROVED)]
        return {"merchants": validated}
    except Exception as e:
        return {"merchants": [], "error": str(e)}

@app.get("/api/merchants/{store_id}")
async def get_merchant_detail(store_id: str):
    """
    Full read-only detail for one merchant, for the Merchants page's
    click-through -- the same `merchants` doc self-service MyStore.tsx and
    bulk upload both write to, plus its menu (the same `menus/{store_id}` doc
    Menu.tsx reads/writes). A bulk-uploaded merchant won't have
    service_types/opening_hours/lead_time_minutes set -- only self-service
    MyStore collects those -- so this returns whatever's actually on the
    record (missing fields stay missing) rather than guessing at a value.

    Declared after /api/merchants/profile and /api/merchants/audit above so
    this catch-all {store_id} route can never shadow those literal paths.
    """
    try:
        merchant = await asyncio.to_thread(MerchantRepository().get, store_id)
        if not merchant:
            return {"status": "error", "message": "Merchant not found."}
        menu = await asyncio.to_thread(MenuRepository().get, store_id)
        return {"status": "ok", "merchant": merchant, "menu": menu}
    except Exception as e:
        return {"status": "error", "message": str(e)}

@app.post("/api/merchants/{store_id}/remove")
async def remove_merchant(store_id: str):
    """
    Soft-removes a merchant from the active roster by setting status to
    excluded_closed -- the same status MerchantRepository.list_active() already
    treats as excluded from the daily feed push, so this immediately stops the
    merchant from being fed without a hard Firestore delete. The record (and
    any upload_batches history referencing this store_id) stays intact.
    """
    try:
        merchant = await asyncio.to_thread(MerchantRepository().get, store_id)
        if not merchant:
            return {"status": "error", "message": "Merchant not found."}
        await asyncio.to_thread(MerchantRepository().update_status, store_id, STATUS_EXCLUDED_CLOSED)
        return {"status": "ok", "store_id": store_id}
    except Exception as e:
        return {"status": "error", "message": str(e)}

@app.get("/api/triage/queue")
async def get_triage_queue():
    """
    Returns merchants flagged for manual review (< 90% Places match confidence),
    each annotated with a real `issue` string (previously always missing --
    TriageQueue.tsx rendered `item.issue` but nothing ever set that field) so
    the reviewer sees why a row needs a decision instead of a blank column.
    """
    try:
        queue = await asyncio.to_thread(MerchantRepository().list_by_status, STATUS_NEEDS_REVIEW)
        for item in queue:
            if not item.get("place_id"):
                item["issue"] = "No Google Places listing found for this name/address."
            else:
                confidence = item.get("confidence") or 0.0
                item["issue"] = f"Low-confidence match ({round(confidence * 100)}%) -- confirm before approving."
        return {"queue": queue}
    except Exception as e:
        return {"queue": [], "error": str(e)}

@app.post("/api/triage/resolve")
async def resolve_triage(request: Request):
    """
    Accepts manual approval or rejection for an entity match. An approve may
    optionally carry a corrected `address` the reviewer typed after visually
    checking Google Maps' free text-search page (no Places API call, no key,
    no cost) -- when present, it overwrites the merchant's stored address and
    sets confidence to 1.0 (a human just confirmed it, so the old
    low-confidence automatic score no longer reflects reality).
    """
    data = await request.json()
    merchant_id = data.get("id")
    action = data.get("action")
    corrected_address = data.get("address")
    status = STATUS_APPROVED if action == "approve" else STATUS_REJECTED
    try:
        extra = {"address": corrected_address, "confidence": 1.0} if (action == "approve" and corrected_address) else None
        await asyncio.to_thread(MerchantRepository().update_status, merchant_id, status, extra)
        return {"status": "resolved", "id": merchant_id, "action": action}
    except Exception as e:
        return {"status": "error", "message": str(e)}

@app.get("/api/feeds/readiness")
async def feeds_readiness():
    """Computes the live Launch Readiness Scorecard from real merchant records."""
    try:
        summary = await asyncio.to_thread(MerchantRepository().readiness_summary)
        return {
            "score": summary["score"],
            "status": "Launch Ready \U0001f7e2" if summary["score"] >= 100 else "In Progress",
            "metrics": {
                "fully_operational": summary["fully_operational"],
                "resolved_edge_cases": summary["resolved_edge_cases"],
                "total": summary["total"],
            }
        }
    except Exception as e:
        return {"score": 0, "status": "Unavailable", "metrics": {}, "error": str(e)}

@app.post("/api/feeds/trigger-pipeline")
async def trigger_pipeline(environment: str = "sandbox"):
    """
    Runs the real daily feed push (closed-merchant guard, compile, SFTP upload) on
    demand. allow_fixture_fallback=False -- unlike the scheduled Cloud Run Job, an
    interactive click here must never silently substitute the fixture snapshot's
    fake chain-restaurant data when there's no real merchant data on file yet, and
    report that as a successful push.
    """
    if environment not in ("sandbox", "production"):
        return {"ok": False, "error": f"environment must be 'sandbox' or 'production', got '{environment}'."}
    # run_daily_feed_push is a synchronous CLI job entrypoint that manages its own
    # event loop internally (asyncio.run); to_thread keeps that safe to call from
    # inside FastAPI's already-running event loop.
    summary = await asyncio.to_thread(run_daily_feed_push, environment, allow_fixture_fallback=False)
    return summary

@app.get("/api/batches")
async def list_batches():
    """Upload batch history for the Ordering Redirect track.

    Excludes kind == "menu" batches -- those live in the same collection but
    belong to the separate Menu Feeds track's own /api/menu-feeds/batches, and
    must never surface in the Redirect FeedStatus/FeedHealth cards."""
    try:
        batches = await asyncio.to_thread(UploadBatchRepository().list_all)
        batches = [b for b in batches if b.get("kind", "ordering") != "menu"]
        return {"batches": batches}
    except Exception as e:
        return {"batches": [], "error": str(e)}

def _read_feed_file(path: str) -> Any:
    with open(path, "r") as f:
        return json.load(f)

@app.get("/api/batches/{batch_id}/feed-content")
async def get_batch_feed_content(batch_id: str):
    """
    Reads the actual compiled entity/action/service (or menu, for a Menu Feed
    batch) feed rows for a batch, for the same "preview what would be sent to
    Google" toggle Services.tsx already
    gives merchants. Unlike the merchant-side SchemaAuditor (which returns
    compiled content directly), ActionsCenterFeedCompiler writes each feed to a
    local JSON file and only stores the file PATH on the batch document -- so
    this only works while the same server instance that ran the push is still
    alive with that file on disk (fine for this app's current in-process
    "Upload Now" flow; a real distributed deployment running the daily push as
    a separate Cloud Run Job would need real storage instead, not local disk).
    Missing files are reported per feed type rather than failing the whole request.
    """
    try:
        batch = await asyncio.to_thread(UploadBatchRepository().get, batch_id)
        if not batch:
            return {"status": "error", "message": "Batch not found."}

        feed_files = batch.get("feed_files") or {}
        feeds: Dict[str, Any] = {}
        missing: List[str] = []
        for feed_type in ("entity", "action", "service", "menu"):
            path = feed_files.get(feed_type)
            if not path:
                continue
            try:
                feeds[feed_type] = await asyncio.to_thread(_read_feed_file, path)
            except Exception:
                missing.append(feed_type)

        return {"status": "ok", "feeds": feeds, "missing": missing}
    except Exception as e:
        return {"status": "error", "message": str(e)}

@app.get("/api/batches/{batch_id}")
async def get_batch(batch_id: str):
    try:
        batch = await asyncio.to_thread(UploadBatchRepository().get, batch_id)
        if not batch:
            return {"status": "error", "message": "Batch not found."}
        return {"status": "ok", "batch": batch}
    except Exception as e:
        return {"status": "error", "message": str(e)}

class FeedVerifyIn(BaseModel):
    feed_type: str  # "entity" | "action" | "service"
    status: str  # "confirmed_clean" | "flagged_errors"

@app.post("/api/batches/{batch_id}/verify-feed")
async def verify_batch_feed(batch_id: str, payload: FeedVerifyIn, current_user: dict = Depends(get_current_user)):
    """
    Records a human's self-reported acceptance status for one feed type (entity,
    action, or service) within a batch -- Partner Portal -> Ingestion -> History
    shows per-file-type status, not one blended result for the whole batch, so
    an aggregator can mark e.g. "action accepted, service flagged" instead of
    one verdict covering files that may not have all landed the same way.
    """
    if payload.status not in (VERIFICATION_CONFIRMED_CLEAN, VERIFICATION_FLAGGED_ERRORS):
        return {
            "status": "error",
            "message": f"status must be '{VERIFICATION_CONFIRMED_CLEAN}' or '{VERIFICATION_FLAGGED_ERRORS}'.",
        }
    try:
        verified_by = current_user.get("email") or current_user.get("uid", "unknown")
        await asyncio.to_thread(UploadBatchRepository().mark_feed_status, batch_id, payload.feed_type, payload.status, verified_by)
        return {"status": "recorded", "batch_id": batch_id, "feed_type": payload.feed_type, "feed_status": payload.status}
    except Exception as e:
        return {"status": "error", "message": str(e)}

CONVERSION_COMPLIANCE_MIN_EVENTS = 3
CONVERSION_COMPLIANCE_WINDOW_DAYS = 7

@app.post("/api/conversion/check")
async def trigger_conversion_check(environment: str = "sandbox", current_user: dict = Depends(get_current_user)):
    """
    Runs the real synthetic conversion sweep (playbook section 7) on demand,
    for an aggregator to submit outside the weekly scheduled cadence. Uses the
    numeric Conversion Partner ID the aggregator saved in their own org config
    (API & Webhooks) if they've set one, falling back to the
    GOOGLE_CONVERSION_PARTNER_ID env var otherwise (what the scheduled Cloud
    Run Job uses, which has no per-org context).

    Unlike run_daily_feed_push (which never raises -- every internal failure
    is individually caught and folded into its summary dict),
    dispatch_conversion_ping raises outright when no partner id is available
    from either source, a real and expected setup gap before an aggregator has
    filled in API & Webhooks -- caught here so that shows up as a clear error
    the frontend can render, not a raw connection failure.
    """
    partner_id = None
    org_id = current_user.get("uid")
    if org_id:
        try:
            org = await asyncio.to_thread(OrganizationRepository().get, org_id)
            partner_id = (org or {}).get("config", {}).get("conversion_partner_id") or None
        except Exception as e:
            logger.warning(f"Could not load org config for '{org_id}': {e}")

    try:
        summary = await asyncio.to_thread(run_weekly_conversion_sweep, environment, partner_id)
        return summary
    except Exception as e:
        return {"all_ok": False, "tokens_pinged": 0, "successful_pings": 0, "error": str(e)}

@app.get("/api/conversion/checks")
async def list_conversion_checks():
    """
    Conversion-tracking history plus whether the playbook's "3 events / 7 days"
    launch-eligibility rule (section 7) is currently satisfied -- counted from
    real recorded sweep runs, not the in-memory log ConversionSentryTool itself
    keeps (which doesn't survive between separate Cloud Run Job executions).
    """
    try:
        checks = await asyncio.to_thread(ConversionCheckRepository().list_all)
        cutoff = datetime.now(timezone.utc) - timedelta(days=CONVERSION_COMPLIANCE_WINDOW_DAYS)

        def _within_window(c: Dict[str, Any]) -> bool:
            ts = c.get("timestamp")
            if not ts:
                return False
            try:
                return datetime.fromisoformat(ts.replace("Z", "+00:00")) >= cutoff
            except ValueError:
                return False

        recent = [c for c in checks if _within_window(c)]
        events_in_window = sum(c.get("successful_pings", 0) for c in recent)
        compliant = events_in_window >= CONVERSION_COMPLIANCE_MIN_EVENTS

        checks_sorted = sorted(checks, key=lambda c: c.get("timestamp") or "", reverse=True)
        return {
            "checks": checks_sorted,
            "compliant": compliant,
            "events_in_window": events_in_window,
            "window_days": CONVERSION_COMPLIANCE_WINDOW_DAYS,
            "min_events_required": CONVERSION_COMPLIANCE_MIN_EVENTS,
        }
    except Exception as e:
        return {"checks": [], "compliant": False, "events_in_window": 0, "error": str(e)}

@app.get("/api/conversion/checks/by-environment")
async def list_conversion_checks_by_environment(environment: str = "sandbox"):
    """
    Same compliance rule as list_conversion_checks(), but scoped to one
    environment -- that endpoint aggregates across sandbox and production
    together, which doesn't work for a per-step (Sandbox vs Production) page.
    Reuses compute_conversion_compliance (backend/tools/onboarding_journey.py)
    rather than a third copy of the same math.
    """
    try:
        checks = await asyncio.to_thread(ConversionCheckRepository().list_all)
        scoped = [c for c in checks if c.get("environment") == environment]
        compliance = compute_conversion_compliance(checks, environment)
        return {
            "checks": sorted(scoped, key=lambda c: c.get("timestamp") or "", reverse=True),
            "compliant": compliance["compliant"],
            "events_in_window": compliance["current"],
            "window_days": CONVERSION_COMPLIANCE_WINDOW_DAYS,
            "min_events_required": compliance["target"],
        }
    except Exception as e:
        return {"checks": [], "compliant": False, "events_in_window": 0, "error": str(e)}

@app.get("/api/onboarding/journey")
async def get_onboarding_journey(current_user: dict = Depends(get_current_user)):
    """
    Assembles the 7-step Google Ordering Redirect onboarding journey (Setup ->
    Feeds ready in Sandbox -> Conversion Tracking in Sandbox -> Sandbox-to-
    Production Review -> Feeds ready in Production -> Conversion Tracking in
    Production -> Launch Review) for the authenticated org, mirroring the
    status language of Google's own Partner Portal onboarding-plan screen,
    which this app has no API to query directly. Aggregator-only in practice
    (Actions Center Ordering Redirect requires an Aggregator/Partner ID and a
    multi-merchant feed -- not applicable to a single-location merchant), but
    this endpoint itself is role-agnostic like the rest of OrganizationRepository.
    """
    org_id = current_user.get("uid")
    if not org_id:
        return {"status": "error", "message": "No authenticated user."}
    try:
        org = await asyncio.to_thread(OrganizationRepository().get, org_id)
        batches = await asyncio.to_thread(UploadBatchRepository().list_all)
        checks = await asyncio.to_thread(ConversionCheckRepository().list_all)
        merchants = await asyncio.to_thread(MerchantRepository().list_active)
        return {"status": "ok", **compute_journey(org, batches, checks, merchant_count=len(merchants))}
    except Exception as e:
        return {"status": "error", "message": str(e)}

@app.get("/api/onboarding/menu-journey")
async def get_menu_onboarding_journey(current_user: dict = Depends(get_current_user)):
    """
    Assembles the separate, opt-in 5-step Google Menu Feeds onboarding journey
    (Setup -> Sandbox Development -> Sandbox Review -> Production Development ->
    Launch Review) for the authenticated org. Always returned (with
    `enabled: false` when the org hasn't opted in) rather than a 404/empty
    response, so the caller doesn't need a second round-trip just to decide
    whether to render anything.
    """
    org_id = current_user.get("uid")
    if not org_id:
        return {"status": "error", "message": "No authenticated user."}
    try:
        org = await asyncio.to_thread(OrganizationRepository().get, org_id)
        batches = await asyncio.to_thread(UploadBatchRepository().list_all)
        merchants = await asyncio.to_thread(MerchantRepository().list_active)
        return {"status": "ok", **compute_menu_journey(org, batches, merchant_count=len(merchants))}
    except Exception as e:
        return {"status": "error", "message": str(e)}

@app.post("/api/menu-feeds/trigger-pipeline")
async def trigger_menu_feed_pipeline(environment: str = "sandbox"):
    """Runs the real menu feed push (compile google.food_menu, Generic SFTP upload) on demand."""
    if environment not in ("sandbox", "production"):
        return {"ok": False, "error": f"environment must be 'sandbox' or 'production', got '{environment}'."}
    summary = await asyncio.to_thread(run_menu_feed_push, environment)
    return summary

@app.get("/api/menu-feeds/batches")
async def list_menu_feed_batches(environment: Optional[str] = None):
    """
    Upload batch history filtered to kind == "menu" -- deliberately a separate
    endpoint from GET /api/batches (which the Ordering Redirect FeedStatus/
    FeedHealth components read) so a menu batch can never leak into their
    counts, and vice versa.
    """
    try:
        batches = await asyncio.to_thread(UploadBatchRepository().list_all)
        menu_batches = [b for b in batches if b.get("kind") == "menu"]
        if environment:
            menu_batches = [b for b in menu_batches if b.get("environment") == environment]
        return {"batches": menu_batches}
    except Exception as e:
        return {"batches": [], "error": str(e)}

@app.post("/api/support/ask")
async def ask_support(request: Request):
    """'Ask FeedOps' -- answers a question grounded in the real Actions Center playbook
    via RAG, and returns which playbook section(s) it cited."""
    data = await request.json()
    question = data.get("question", "")
    if not question:
        return {"answer": "Ask a question.", "sources": []}
    return await get_orchestrator().ask_support(question)

@app.get("/api/places/search")
async def search_places(query: str):
    """Searches for a place using GooglePlacesClient."""
    try:
        client = GooglePlacesClient()
        result = await client.search_places(query)
        return {"status": "success", "data": result}
    except Exception as e:
        return {"status": "error", "message": str(e)}

@app.post("/api/upload/menu-image")
async def upload_menu_image(file: UploadFile = File(...)):
    """Accepts multipart/form-data image and returns extracted JSON."""
    try:
        # Create a temporary file
        fd, temp_path = tempfile.mkstemp(suffix=os.path.splitext(file.filename)[1])
        with os.fdopen(fd, 'wb') as buffer:
            shutil.copyfileobj(file.file, buffer)
            
        extractor = ImageMenuExtractor()
        data = extractor.extract_from_file(temp_path)
        os.remove(temp_path)
        return {"status": "success", "data": data.model_dump()}
    except Exception as e:
        return {"status": "error", "message": str(e)}

@app.post("/api/upload/feed-screenshot")
async def upload_feed_screenshot(file: UploadFile = File(...)):
    """
    Accepts a screenshot of Google's Partner Portal and returns a
    plain-language explanation plus, only for the Ingestion History screen
    type, advisory per-feed accept/reject suggestions. This never writes
    feed status itself -- the caller (FeedStatus.tsx) still routes any
    suggestion through the existing Mark Accepted/Rejected buttons for a
    human to confirm.
    """
    temp_path = None
    try:
        fd, temp_path = tempfile.mkstemp(suffix=os.path.splitext(file.filename)[1])
        with os.fdopen(fd, 'wb') as buffer:
            shutil.copyfileobj(file.file, buffer)

        analyzer = FeedScreenshotAnalyzer()
        data = analyzer.analyze_from_file(temp_path)
        return {"status": "success", "data": data.model_dump()}
    except Exception as e:
        return {"status": "error", "message": str(e)}
    finally:
        if temp_path and os.path.exists(temp_path):
            os.remove(temp_path)

@app.post("/api/entity-match/assist")
async def entity_match_assist(file: UploadFile = File(...), org_id: Optional[str] = Form(None)):
    """
    Accepts Google's Entity-match CSV export and suggests a Google Maps URL
    for each unmatched/disabled entity, reusing the existing Places-matching
    engine (resolve_entity_match) and any place_id already stored from prior
    onboarding. Suggestions only -- there's no API to push a match back to
    Google, so the human still pastes the URL into Google's Edit match
    screen themselves.
    """
    try:
        parsed = parse_entity_csv(file.file)
        result = await suggest_matches(parsed["rows"], org_id)
        return {
            "status": "success",
            "rows_total": len(parsed["rows"]),
            "errors": parsed["errors"],
            **result,
        }
    except Exception as e:
        return {"status": "error", "message": str(e)}

async def _persist_bulk_merchant(merchant: Dict[str, Any], org_id: str) -> Dict[str, Any]:
    """
    Bulk upload's per-row equivalent of the single-merchant onboarding
    pipeline's _persist_merchant: a deterministic Places match (no LLM
    narration -- this can run over many rows in one request, so it uses the
    same cheap baseline EntityMatcherAgent itself falls back to, not a Gemini
    call per row) followed by a real Firestore write. Without this, bulk
    upload only validated rows and handed them back to the browser -- they
    never reached the triage queue, readiness scorecard, or daily feed push.
    """
    store_id = slugify_store_id(org_id, merchant["name"])
    try:
        match = await resolve_entity_match(merchant["name"], merchant["address"])
    except Exception as e:
        logger.warning(f"Places lookup failed for bulk row '{merchant['name']}': {e}")
        match = {"confidence": 0.0, "place_id": None}

    confidence = match.get("confidence", 0.0)
    if confidence >= 0.90:
        status = STATUS_MATCHED
    elif confidence > 0.0:
        status = STATUS_NEEDS_REVIEW
    else:
        status = STATUS_NO_LISTING

    record: Dict[str, Any] = {
        "store_id": store_id,
        "org_id": org_id,
        "name": merchant["name"],
        "address": merchant["address"],
        "telephone": merchant.get("telephone"),
        "action_link": merchant.get("action_link"),
        "status": status,
        "visibility": "private",
        "confidence": match.get("confidence"),
        "place_id": match.get("place_id"),
    }
    await asyncio.to_thread(MerchantRepository().upsert, {k: v for k, v in record.items() if v is not None})
    return {"store_id": store_id, "name": merchant["name"], "status": status}

@app.post("/api/upload/spreadsheet")
async def upload_spreadsheet(
    file: UploadFile = File(...),
    org_id: Optional[str] = Form(None),
    replace_existing: bool = Form(False),
):
    """
    Accepts multipart/form-data Excel/CSV of restaurant/merchant rows, validates
    it, and persists every valid row the same way single-merchant onboarding
    does -- a deterministic Places match plus a real `merchants` collection
    write -- so bulk-uploaded merchants actually reach the triage queue,
    readiness scorecard, and daily feed push, not just a parsed preview shown
    once in the browser.

    Menu items are a separate upload now (POST /api/upload/menu-spreadsheet) --
    they used to ride along as a second sheet of the same workbook, which forced
    every aggregator into one specific file shape and meant a menu-only
    re-upload had to carry merchant rows too, even though the two data sources
    are frequently entirely different exports in practice.

    With org_id: loads that organization's saved column-mapping adapter (remembered
    from a previous upload) or infers and saves one, and rows that fail required-field
    validation come back in `errors` instead of being silently dropped or guessed at
    (and are never persisted).

    replace_existing=true turns this into a full roster refresh: any of this
    org's merchants NOT present in this file get soft-removed (see
    remove_merchant) rather than a normal upload's merge-only upsert. Guarded
    to only fire when at least one row from this file actually persisted --
    an empty or fully-invalid file must never wipe an existing roster. Merchants
    are a Firestore collection shared across orgs, so this only ever touches
    rows whose stored org_id matches this upload's -- never another org's data.
    """
    try:
        fd, temp_path = tempfile.mkstemp(suffix=os.path.splitext(file.filename)[1])
        with os.fdopen(fd, 'wb') as buffer:
            shutil.copyfileobj(file.file, buffer)

        parser = SpreadsheetFeedParser()
        data = await asyncio.to_thread(parser.parse_merchants, temp_path, org_id=org_id)
        os.remove(temp_path)

        merchants = [m.model_dump() for m in data["merchants"]]

        persisted: List[Dict[str, Any]] = []
        if merchants:
            effective_org_id = org_id or "unknown"
            results = await asyncio.gather(
                *[_persist_bulk_merchant(m, effective_org_id) for m in merchants],
                return_exceptions=True,
            )
            for m, result in zip(merchants, results):
                if isinstance(result, Exception):
                    logger.warning(f"Could not persist bulk merchant '{m.get('name')}': {result}")
                else:
                    persisted.append(result)

        removed_count = 0
        if persisted and replace_existing:
            effective_org_id = org_id or "unknown"
            kept_store_ids = {p["store_id"] for p in persisted}
            existing = await asyncio.to_thread(MerchantRepository().list_all)
            stale = [
                m for m in existing
                if m.get("org_id") == effective_org_id
                and m.get("store_id") not in kept_store_ids
                and m.get("status") != STATUS_EXCLUDED_CLOSED
            ]
            await asyncio.gather(
                *[asyncio.to_thread(MerchantRepository().update_status, m["store_id"], STATUS_EXCLUDED_CLOSED) for m in stale],
                return_exceptions=True,
            )
            removed_count = len(stale)

        return {
            "status": "success",
            "merchants_count": len(merchants),
            "persisted_count": len(persisted),
            "persisted": persisted,
            "removed_count": removed_count,
            "errors": data["errors"],
            "adapter": data["adapter"],
            "data": {"merchants": merchants},
        }
    except Exception as e:
        return {"status": "error", "message": str(e)}

@app.post("/api/upload/menu-spreadsheet")
async def upload_menu_spreadsheet(file: UploadFile = File(...), org_id: Optional[str] = Form(None)):
    """
    Accepts multipart/form-data Excel/CSV of menu item rows -- one row per dish,
    identified by a merchant-name column -- and persists them into the same
    `menus/{store_id}` documents Menu.tsx's own self-service editor reads and
    writes. Each row's store_id is computed the identical way the restaurant
    upload's does (slugify_store_id(org_id, merchant_name)), so items land on
    the same merchant a restaurant upload for that name already created, or
    will if uploaded afterward -- order between the two uploads doesn't matter.

    Previously, a spreadsheet's menu sheet was parsed and counted in the
    response but never written anywhere -- this endpoint is what that data
    was missing.
    """
    try:
        fd, temp_path = tempfile.mkstemp(suffix=os.path.splitext(file.filename)[1])
        with os.fdopen(fd, 'wb') as buffer:
            shutil.copyfileobj(file.file, buffer)

        parser = SpreadsheetFeedParser()
        effective_org_id = org_id or "unknown"
        data = await asyncio.to_thread(parser.parse_menu, temp_path, org_id=effective_org_id)
        os.remove(temp_path)

        items = [m.model_dump() for m in data["items"]]

        by_store: Dict[str, List[Dict[str, Any]]] = {}
        for item in items:
            by_store.setdefault(item["store_id"], []).append(
                {k: v for k, v in item.items() if k not in ("store_id", "merchant_name")}
            )

        merchants_updated = []
        for store_id, store_items in by_store.items():
            try:
                result = await asyncio.to_thread(MenuRepository().add_items, store_id, store_items)
                merchant_name = next((it["merchant_name"] for it in items if it["store_id"] == store_id), store_id)
                merchants_updated.append({"store_id": store_id, "name": merchant_name, **result})
            except Exception as e:
                logger.warning(f"Could not persist bulk menu items for '{store_id}': {e}")

        return {
            "status": "success",
            "items_count": len(items),
            "merchants_updated": merchants_updated,
            "errors": data["errors"],
        }
    except Exception as e:
        return {"status": "error", "message": str(e)}

class SPAStaticFiles(StaticFiles):
    """StaticFiles(html=True) only auto-serves index.html for the root path,
    not for arbitrary react-router-dom client-side routes (e.g. /login,
    /merchant/store) -- those 404 as raw JSON instead of loading the app,
    since no real file exists at that path. Falls back to index.html for any
    unmatched path so React Router can take over client-side. Mounted last,
    after every /api/* route, so those still take priority.

    StaticFiles.get_response() *raises* HTTPException(404) on a miss rather
    than returning a 404 response object, so the fallback has to be a
    try/except around the call, not an if-check on the return value."""

    async def get_response(self, path: str, scope):
        try:
            return await super().get_response(path, scope)
        except StarletteHTTPException as exc:
            if exc.status_code == 404:
                return await super().get_response("index.html", scope)
            raise

# Mount static files for /dist if running in production mode
if os.path.isdir("frontend/dist"):
    app.mount("/", SPAStaticFiles(directory="frontend/dist", html=True), name="static")
