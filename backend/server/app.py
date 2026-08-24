from fastapi import FastAPI, Request, UploadFile, File, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles
import asyncio
import os
from dotenv import load_dotenv
load_dotenv()
import shutil
import tempfile
from backend.tools.menu_extractor import ImageMenuExtractor
from backend.tools.excel_parser import SpreadsheetFeedParser
from backend.tools.places_matcher import GooglePlacesClient
from backend.server.auth import get_current_user
from backend.agent.orchestrator import FeedOpsOrchestrator
from backend.db.firestore_client import MerchantRepository, STATUS_NEEDS_REVIEW, STATUS_APPROVED, STATUS_REJECTED
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

@app.post("/api/merchants/onboard")
async def onboard_merchant(request: Request, current_user: dict = Depends(get_current_user)):
    """Accepts merchant metadata, runs the real FeedOps agent pipeline, and streams its progress."""
    merchant_data = await request.json()
    orchestrator = get_orchestrator()

    async def event_generator():
        async for event_json in orchestrator.execute_onboarding_pipeline(merchant_data):
            yield f"data: {event_json}\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")

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

@app.post("/api/upload/spreadsheet")
async def upload_spreadsheet(file: UploadFile = File(...)):
    """Accepts multipart/form-data Excel/CSV and populates the merchant batch."""
    try:
        fd, temp_path = tempfile.mkstemp(suffix=os.path.splitext(file.filename)[1])
        with os.fdopen(fd, 'wb') as buffer:
            shutil.copyfileobj(file.file, buffer)
            
        parser = SpreadsheetFeedParser()
        data = parser.parse(temp_path)
        os.remove(temp_path)
        
        # Serialize objects to dicts for JSON response
        merchants = [m.model_dump() for m in data["merchants"]]
        menus = [m.model_dump() for m in data["menus"]]
        
        return {
            "status": "success", 
            "merchants_count": len(merchants), 
            "menus_count": len(menus),
            "data": {
                "merchants": merchants,
                "menus": menus
            }
        }
    except Exception as e:
        return {"status": "error", "message": str(e)}

# Mount static files for /dist if running in production mode
if os.path.isdir("frontend/dist"):
    app.mount("/", StaticFiles(directory="frontend/dist", html=True), name="static")
