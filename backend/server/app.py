from fastapi import FastAPI, Request, UploadFile, File, Form, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException
import asyncio
import logging
import os
import re
import uuid
from typing import Any, Dict, List, Optional
from dotenv import load_dotenv
load_dotenv()
import shutil
import tempfile
from pydantic import BaseModel

logger = logging.getLogger("feedops.server")
from backend.tools.menu_extractor import ImageMenuExtractor
from backend.tools.excel_parser import SpreadsheetFeedParser
from backend.tools.places_matcher import GooglePlacesClient, resolve_entity_match
from backend.server.auth import get_current_user
from backend.agent.orchestrator import FeedOpsOrchestrator
from backend.db.firestore_client import (
    MerchantRepository, STATUS_NEW, STATUS_MATCHED, STATUS_NEEDS_REVIEW,
    STATUS_NO_LISTING, STATUS_APPROVED, STATUS_REJECTED,
    OrganizationRepository, ORG_TYPE_MERCHANT, ORG_TYPE_AGGREGATOR, PORTAL_STATUS_NOT_STARTED,
    UploadBatchRepository, VERIFICATION_CONFIRMED_CLEAN, VERIFICATION_FLAGGED_ERRORS,
)
from backend.jobs.scheduled_tasks import run_daily_feed_push

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
    placeId: Optional[str] = None
    serviceOptions: ServiceOptionsIn = ServiceOptionsIn()
    timings: List[TimingIn] = []
    leadTimeMinutes: Optional[float] = None


def _service_types_from_options(options: Dict[str, Any]) -> List[str]:
    """Maps MyStore.tsx's service-option checkboxes to Actions Center's
    DELIVERY/TAKEOUT enum (section 3.2) -- inStore has no feed equivalent."""
    types = []
    if options.get("delivery"):
        types.append("DELIVERY")
    if options.get("takeaway"):
        types.append("TAKEOUT")
    return types


def _slugify(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return slug or "merchant"


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
        OrganizationRepository().create(org)
        return {"status": "created", "org": org}
    except Exception as e:
        return {"status": "error", "message": str(e)}


@app.get("/api/organizations/{org_id}")
async def get_organization(org_id: str, current_user: dict = Depends(get_current_user)):
    try:
        org = OrganizationRepository().get(org_id)
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
        OrganizationRepository().update_config(org_id, config)
        return {"status": "updated", "config": config}
    except Exception as e:
        return {"status": "error", "message": str(e)}


@app.post("/api/merchants/onboard")
async def onboard_merchant(request: Request, current_user: dict = Depends(get_current_user)):
    """Accepts merchant metadata, runs the real FeedOps agent pipeline, and streams its progress."""
    merchant_data = await request.json()
    orchestrator = get_orchestrator()

    async def event_generator():
        async for event_json in orchestrator.execute_onboarding_pipeline(merchant_data):
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
        record = MerchantRepository().get(email)
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
        existing = repo.get(store_id)
        record: Dict[str, Any] = {
            "store_id": store_id,
            "name": payload.storeName,
            "address": payload.address,
            "telephone": payload.phone,
            "email": payload.email or email,
            "service_types": _service_types_from_options(payload.serviceOptions.model_dump()),
            "opening_hours": [t.model_dump() for t in payload.timings],
            "lead_time_minutes": payload.leadTimeMinutes,
            "place_id": payload.placeId,
        }
        if not existing:
            record["status"] = STATUS_NEW
        repo.upsert({k: v for k, v in record.items() if v is not None})
        return {"status": "success", "store_id": store_id}
    except Exception as e:
        return {"status": "error", "message": str(e)}

@app.get("/api/agent/stream")
async def agent_stream():
    """SSE channel streaming real-time tool calls and thoughts from LiveAgentThoughtStream."""
    async def event_generator():
        yield "data: {\"thought\": \"Initializing LiveAgentThoughtStream...\"}\n\n"
        await asyncio.sleep(1)
        yield "data: {\"thought\": \"Monitoring incoming requests...\"}\n\n"
    return StreamingResponse(event_generator(), media_type="text/event-stream")

@app.get("/api/triage/queue")
async def get_triage_queue():
    """Returns merchants flagged for manual review (< 90% Places match confidence)."""
    try:
        queue = MerchantRepository().list_by_status(STATUS_NEEDS_REVIEW)
        return {"queue": queue}
    except Exception as e:
        return {"queue": [], "error": str(e)}

@app.post("/api/triage/resolve")
async def resolve_triage(request: Request):
    """Accepts manual approval or rejection for an entity match."""
    data = await request.json()
    merchant_id = data.get("id")
    action = data.get("action")
    status = STATUS_APPROVED if action == "approve" else STATUS_REJECTED
    try:
        MerchantRepository().update_status(merchant_id, status)
        return {"status": "resolved", "id": merchant_id, "action": action}
    except Exception as e:
        return {"status": "error", "message": str(e)}

@app.get("/api/feeds/readiness")
async def feeds_readiness():
    """Computes the live Launch Readiness Scorecard from real merchant records."""
    try:
        summary = MerchantRepository().readiness_summary()
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
async def trigger_pipeline():
    """Runs the real daily feed push (closed-merchant guard, compile, SFTP upload) on demand."""
    # run_daily_feed_push is a synchronous CLI job entrypoint that manages its own
    # event loop internally (asyncio.run); to_thread keeps that safe to call from
    # inside FastAPI's already-running event loop.
    summary = await asyncio.to_thread(run_daily_feed_push, "sandbox")
    return summary

class BatchVerifyIn(BaseModel):
    status: str  # "confirmed_clean" | "flagged_errors"
    notes: Optional[str] = None

@app.get("/api/batches")
async def list_batches(pending_only: bool = False):
    """Upload batch history. pending_only=true returns batches still awaiting a
    human's manual Partner Portal -> Ingestion -> History check."""
    try:
        repo = UploadBatchRepository()
        batches = repo.list_pending_verification() if pending_only else repo.list_all()
        return {"batches": batches}
    except Exception as e:
        return {"batches": [], "error": str(e)}

@app.get("/api/batches/{batch_id}")
async def get_batch(batch_id: str):
    try:
        batch = UploadBatchRepository().get(batch_id)
        if not batch:
            return {"status": "error", "message": "Batch not found."}
        return {"status": "ok", "batch": batch}
    except Exception as e:
        return {"status": "error", "message": str(e)}

@app.post("/api/batches/{batch_id}/verify")
async def verify_batch(batch_id: str, payload: BatchVerifyIn, current_user: dict = Depends(get_current_user)):
    """
    Records a human's self-reported result of manually checking Partner Portal ->
    Ingestion -> History for this batch. This endpoint makes NO call to Google --
    there is no API for "was this feed accepted," only the portal's own UI
    (playbook section 6). It exists to record what a person saw there, not to
    check it for them.
    """
    if payload.status not in (VERIFICATION_CONFIRMED_CLEAN, VERIFICATION_FLAGGED_ERRORS):
        return {
            "status": "error",
            "message": f"status must be '{VERIFICATION_CONFIRMED_CLEAN}' or '{VERIFICATION_FLAGGED_ERRORS}'.",
        }
    try:
        verified_by = current_user.get("email") or current_user.get("uid", "unknown")
        UploadBatchRepository().mark_verified(batch_id, payload.status, verified_by, payload.notes)
        return {"status": "recorded", "batch_id": batch_id, "verification_status": payload.status}
    except Exception as e:
        return {"status": "error", "message": str(e)}

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
    store_id = f"{org_id}_{_slugify(merchant['name'])}"
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
    MerchantRepository().upsert({k: v for k, v in record.items() if v is not None})
    return {"store_id": store_id, "name": merchant["name"], "status": status}

@app.post("/api/upload/spreadsheet")
async def upload_spreadsheet(file: UploadFile = File(...), org_id: Optional[str] = Form(None)):
    """
    Accepts multipart/form-data Excel/CSV, validates it, and persists every
    valid row the same way single-merchant onboarding does -- a deterministic
    Places match plus a real `merchants` collection write -- so bulk-uploaded
    merchants actually reach the triage queue, readiness scorecard, and daily
    feed push, not just a parsed preview shown once in the browser.

    With org_id: loads that organization's saved column-mapping adapter (remembered
    from a previous upload) or infers and saves one, and rows that fail required-field
    validation come back in `errors` instead of being silently dropped or guessed at
    (and are never persisted).
    """
    try:
        fd, temp_path = tempfile.mkstemp(suffix=os.path.splitext(file.filename)[1])
        with os.fdopen(fd, 'wb') as buffer:
            shutil.copyfileobj(file.file, buffer)

        parser = SpreadsheetFeedParser()
        data = parser.parse(temp_path, org_id=org_id)
        os.remove(temp_path)

        # Serialize objects to dicts for JSON response
        merchants = [m.model_dump() for m in data["merchants"]]
        menus = [m.model_dump() for m in data["menus"]]

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

        return {
            "status": "success",
            "merchants_count": len(merchants),
            "menus_count": len(menus),
            "persisted_count": len(persisted),
            "persisted": persisted,
            "errors": data["errors"],
            "adapter": data["adapter"],
            "data": {
                "merchants": merchants,
                "menus": menus
            }
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
