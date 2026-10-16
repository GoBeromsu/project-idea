from pathlib import Path
from typing import Optional
import httpx
from fastapi import Body, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from dotenv import load_dotenv

try:
    from backend.schemas import (
        ApproveChangeSetRequest,
        AssimilateRequest,
        JargonScanRequest,
        QueryRequest,
    )
    from backend.store import KnowledgeStore
    from backend.ingest import prepare_document
    from backend.model_client import ModelServiceClient
except ImportError:
    from schemas import (
        ApproveChangeSetRequest,
        AssimilateRequest,
        JargonScanRequest,
        QueryRequest,
    )
    from store import KnowledgeStore
    from ingest import prepare_document
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
        "fast_model": "gemini-3.8-flash",
        "layers": 4,
        "model_api_url": model_client.base_url,
    }


@app.get("/api/state")
def get_state():
    return store.get_state()


@app.post("/api/jargon-scan")
async def jargon_scan(req: JargonScanRequest):
    try:
        doc_data = await prepare_document(
            text=req.text,
            url=req.url,
            title=req.title,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    try:
        res = await model_client.scan_jargon(
            doc_data=doc_data,
            seed_ontology=store.get_seed_ontology(),
        )
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"Model service error: {exc}") from exc

    return res


@app.post("/api/query")
async def query_knowledge(req: QueryRequest):
    question = (req.question or "").strip()
    if not question:
        raise HTTPException(status_code=400, detail="Question must not be empty.")

    try:
        res = await model_client.query_knowledge(
            question=question,
            seed_ontology=store.get_seed_ontology(),
            existing_claims=list(store.claims.values()),
        )
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"Model service error: {exc}") from exc

    return res.model_dump() if hasattr(res, "model_dump") else res


@app.post("/api/assimilate")
async def assimilate_document(req: AssimilateRequest):
    try:
        doc_data = await prepare_document(
            text=req.text,
            url=req.url,
            title=req.title,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    seed_ontology = store.get_seed_ontology()
    existing_claims = list(store.claims.values())

    try:
        changeset, trace = await model_client.run_assimilation_pipeline(
            doc_data=doc_data,
            seed_ontology=seed_ontology,
            existing_claims=existing_claims,
            question=req.question,
        )
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"Model service error: {exc}") from exc

    store.add_changeset(
        changeset,
        source_text=doc_data["full_text"],
        trace=trace.model_dump(),
    )

    return {
        "status": "success",
        "document": {
            "title": doc_data["title"],
            "url": doc_data["url"],
            "resolved_url": doc_data.get("resolved_url"),
            "length": len(doc_data["full_text"]),
            "section_anchors": doc_data.get("section_anchors", []),
            "jargon_candidates": doc_data.get("jargon_candidates", []),
        },
        "question": req.question,
        "answer": changeset.answer,
        "pipeline_trace": trace.model_dump(),
        "changeset": changeset.model_dump(),
        "requires_human_approval": True,
    }


@app.post("/api/changesets/{cs_id}/approve")
def approve_changeset(
    cs_id: str,
    req: Optional[ApproveChangeSetRequest] = Body(default=None),
):
    try:
        cs = store.approve_changeset(
            cs_id,
            concept_ids=req.concept_ids if req else None,
            relation_ids=req.relation_ids if req else None,
            claim_ids=req.claim_ids if req else None,
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return {
        "status": "approved",
        "changeset": cs.model_dump(),
        "new_state": store.get_state(),
    }


@app.post("/api/changesets/{cs_id}/reject")
def reject_changeset(cs_id: str):
    try:
        cs = store.reject_changeset(cs_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return {
        "status": "rejected",
        "changeset": cs.model_dump(),
        "new_state": store.get_state(),
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
