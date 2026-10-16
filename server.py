import os
from typing import Optional
from fastapi import FastAPI, HTTPException, Body
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from dotenv import load_dotenv

from models import ChangeSet
from store import KnowledgeStore
from ingest import DocumentIngester
from agent_loop import AssimilationEngine

load_dotenv()

app = FastAPI(title="Project IDEA - Knowledge Assimilation Engine")
store = KnowledgeStore()
engine = AssimilationEngine()

# Mount static frontend
os.makedirs("static", exist_ok=True)
app.mount("/static", StaticFiles(directory="static"), name="static")

class AssimilateRequest(BaseModel):
    text: Optional[str] = None
    url: Optional[str] = None
    title: Optional[str] = "Pasted Technical Note"

@app.get("/health")
def health():
    return {"status": "ok", "service": "project-idea", "model": "gemini-4-argon"}

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

    # Execute Gemini 4 Argon assimilation with two-turn self-correction
    changeset = await engine.assimilate(doc_data, seed_ontology, existing_claims)
    store.add_changeset(changeset)

    return {
        "status": "success",
        "changeset": changeset.model_dump(),
        "requires_human_approval": True
    }

@app.post("/api/changesets/{changeset_id}/approve")
def approve_changeset(changeset_id: str):
    cs = store.approve_changeset(changeset_id)
    if not cs:
        raise HTTPException(status_code=404, detail="ChangeSet not found.")
    return {"status": "approved", "changeset": cs.model_dump(), "new_state": store.get_state()}

@app.post("/api/changesets/{changeset_id}/reject")
def reject_changeset(changeset_id: str):
    cs = store.reject_changeset(changeset_id)
    if not cs:
        raise HTTPException(status_code=404, detail="ChangeSet not found.")
    return {"status": "rejected", "changeset": cs.model_dump()}

@app.post("/api/reset")
def reset_state():
    store.reset_to_seed()
    return {"status": "reset", "state": store.get_state()}

@app.get("/", response_class=HTMLResponse)
def index():
    index_file = "static/index.html"
    if os.path.exists(index_file):
        with open(index_file, "r") as f:
            return f.read()
    return "<h1>Project IDEA Loading...</h1>"
