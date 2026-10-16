import os
from typing import Optional
import uvicorn
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

try:
    from model.schemas import (
        AssimilatePipelineResponse,
        BuildChangeSetRequest,
        ChangeSet,
        CorrectRequest,
        CorrectResponse,
        ExtractRequest,
        ExtractResponse,
        ModelQueryRequest,
        ModelQueryResponse,
        VerifyQuoteRequest,
        VerifyQuoteResponse,
    )
    from model.validator import EvidenceValidator
    from model.agent_loop import AssimilationEngine
except ImportError:
    from schemas import (
        AssimilatePipelineResponse,
        BuildChangeSetRequest,
        ChangeSet,
        CorrectRequest,
        CorrectResponse,
        ExtractRequest,
        ExtractResponse,
        ModelQueryRequest,
        ModelQueryResponse,
        VerifyQuoteRequest,
        VerifyQuoteResponse,
    )
    from validator import EvidenceValidator
    from agent_loop import AssimilationEngine

load_dotenv()

app = FastAPI(title="Project IDEA - Model Tier (Gemini 4 Argon Agent API)")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

_engine: Optional[AssimilationEngine] = None


def get_engine() -> AssimilationEngine:
    global _engine
    if _engine is None:
        _engine = AssimilationEngine()
    return _engine


@app.get("/health")
def health():
    return {
        "status": "ok",
        "tier": "model",
        "service": "project-idea-model",
        "model": "gemini-4-argon",
    }


@app.post("/api/v1/verify-quote", response_model=VerifyQuoteResponse)
def verify_quote_endpoint(req: VerifyQuoteRequest) -> VerifyQuoteResponse:
    valid, err = EvidenceValidator.verify_quote(
        source_text=req.source_text,
        quote=req.quote,
        strict=req.strict,
    )
    return VerifyQuoteResponse(valid=valid, error=err)


@app.post("/api/v1/extract", response_model=ExtractResponse)
def extract_endpoint(req: ExtractRequest) -> ExtractResponse:
    if "full_text" not in req.doc_data:
        raise HTTPException(status_code=400, detail="doc_data must include 'full_text'.")
    engine = get_engine()
    return engine.extract_turn1(
        doc_data=req.doc_data,
        seed_ontology=req.seed_ontology,
        existing_claims=req.existing_claims,
        question=req.question,
    )


@app.post("/api/v1/correct", response_model=CorrectResponse)
def correct_endpoint(req: CorrectRequest) -> CorrectResponse:
    engine = get_engine()
    return engine.correct_turn2(
        previous_interaction_id=req.previous_interaction_id,
        source_text=req.source_text,
        validation_failures=req.validation_failures,
        question=req.question,
    )


@app.post("/api/v1/build-changeset", response_model=ChangeSet)
def build_changeset_endpoint(req: BuildChangeSetRequest) -> ChangeSet:
    if "full_text" not in req.doc_data:
        raise HTTPException(status_code=400, detail="doc_data must include 'full_text'.")
    engine = get_engine()
    return engine.build_changeset(
        doc_data=req.doc_data,
        extraction=req.extraction,
        question=req.question,
        seed_ontology=req.seed_ontology,
    )


@app.post("/api/v1/assimilate", response_model=AssimilatePipelineResponse)
def assimilate_endpoint(req: ExtractRequest) -> AssimilatePipelineResponse:
    if "full_text" not in req.doc_data:
        raise HTTPException(status_code=400, detail="doc_data must include 'full_text'.")
    engine = get_engine()
    return engine.assimilate_with_trace(
        doc_data=req.doc_data,
        seed_ontology=req.seed_ontology,
        existing_claims=req.existing_claims,
        question=req.question,
    )


@app.post("/api/v1/query", response_model=ModelQueryResponse)
def query_endpoint(req: ModelQueryRequest) -> ModelQueryResponse:
    engine = get_engine()
    return engine.answer_query(
        question=req.question,
        seed_ontology=req.seed_ontology,
        existing_claims=req.existing_claims,
    )


if __name__ == "__main__":
    uvicorn.run(
        "model.server:app",
        host="0.0.0.0",
        port=int(os.getenv("MODEL_PORT", "8001")),
        reload=False,
    )
