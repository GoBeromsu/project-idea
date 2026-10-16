from pathlib import Path
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from dotenv import load_dotenv

try:
    from backend.schemas import AssimilateRequest
    from backend.store import KnowledgeStore
    from backend.ingest import DocumentIngester
    from backend.model_client import ModelServiceClient
except ImportError:
    from schemas import AssimilateRequest
    from store import KnowledgeStore
    from ingest import DocumentIngester
    from model_client import ModelServiceClient

load_dotenv()

app = FastAPI(title="Project IDEA - Backend Tier API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

store = KnowledgeStore()
model_client = ModelServiceClient()

ROOT_DIR = Path(__file__).resolve().parent.parent
FRONTEND_DIR = ROOT_DIR / "frontend"
STATIC_FALLBACK_DIR = ROOT_DIR / "static"

if FRONTEND_DIR.exists():
    app.mount("/static", StaticFiles(directory=str(FRONTEND_DIR)), name="static")
elif STATIC_FALLBACK_DIR.exists():
    app.mount("/static", StaticFiles(directory=str(STATIC_FALLBACK_DIR)), name="static")


@app.get("/health")
def health():
    return {
        "status": "ok",
        "tier": "backend",
        "service": "project-idea",
        "model": "gemini-4-argon",
        "model_api_url": model_client.base_url,
    }


@app.get("/api/state")
def get_state():
    return store.get_state()


@app.post("/api/assimilate")
async def assimilate_document(req: AssimilateRequest):
    if req.url:
        doc_data = await DocumentIngester.fetch_url(req.url)
    elif req.text:
        doc_data = DocumentIngester.parse_text(req.text, title=req.title or "Snippet")
    else:
        raise HTTPException(status_code=400, detail="Provide either 'text' or 'url'.")

    state = store.get_state()
    seed_ontology = {"concepts": state["concepts"]}
    existing_claims = list(store.claims.values())

    changeset, trace = await model_client.assimilate_via_rest_loop(
        doc_data=doc_data,
        seed_ontology=seed_ontology,
        existing_claims=existing_claims,
    )
    store.add_changeset(changeset, trace=trace.model_dump())

    return {
        "status": "success",
        "changeset": changeset.model_dump(),
        "pipeline_trace": trace.model_dump(),
        "requires_human_approval": True,
    }


@app.post("/api/changesets/{changeset_id}/approve")
def approve_changeset(changeset_id: str):
    cs = store.approve_changeset(changeset_id)
    if not cs:
        raise HTTPException(status_code=404, detail="ChangeSet not found.")
    return {
        "status": "approved",
        "changeset": cs.model_dump(),
        "new_state": store.get_state(),
    }


@app.post("/api/changesets/{changeset_id}/reject")
def reject_changeset(changeset_id: str):
    cs = store.reject_changeset(changeset_id)
    if not cs:
        raise HTTPException(status_code=404, detail="ChangeSet not found.")
    return {
        "status": "rejected",
        "changeset": cs.model_dump(),
    }


@app.post("/api/reset")
def reset_state():
    store.reset_to_seed()
    return {
        "status": "reset",
        "state": store.get_state(),
    }


@app.get("/", response_class=HTMLResponse)
def index():
    frontend_index = FRONTEND_DIR / "index.html"
    if frontend_index.exists():
        return frontend_index.read_text(encoding="utf-8")
    static_index = STATIC_FALLBACK_DIR / "index.html"
    if static_index.exists():
        return static_index.read_text(encoding="utf-8")
    return "<h1>Project IDEA Backend Tier API Running</h1>"
