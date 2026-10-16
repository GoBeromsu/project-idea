from fastapi.testclient import TestClient
from frontend.server import app as frontend_app
from backend.server import app as backend_app, store as backend_store
from model.server import app as model_app
from backend.schemas import ChangeSet, Concept, FactClaim, SourceEvidence, VerificationStatus

frontend_client = TestClient(frontend_app)
backend_client = TestClient(backend_app)
model_client = TestClient(model_app)


def test_frontend_tier_endpoints():
    res_health = frontend_client.get("/health")
    assert res_health.status_code == 200
    assert res_health.json()["tier"] == "frontend"
    assert res_health.json()["status"] == "ok"

    res_index = frontend_client.get("/")
    assert res_index.status_code == 200
    assert "window.BACKEND_API_URL" in res_index.text
    assert "/static/app.js" in res_index.text

    res_js = frontend_client.get("/static/app.js")
    assert res_js.status_code == 200
    assert "API_BASE" in res_js.text


def test_model_tier_endpoints():
    res_health = model_client.get("/health")
    assert res_health.status_code == 200
    assert res_health.json()["tier"] == "model"
    assert res_health.json()["model"] == "gemini-4-argon"

    # Test deterministic quote verification endpoint
    source_text = "Monte Carlo Tree Search combines tree search with random rollouts."
    res_verify = model_client.post(
        "/api/v1/verify-quote",
        json={
            "source_text": source_text,
            "quote": "combines tree search with random rollouts",
            "strict": False,
        },
    )
    assert res_verify.status_code == 200
    assert res_verify.json()["valid"] is True

    # Test build-changeset endpoint
    res_cs = model_client.post(
        "/api/v1/build-changeset",
        json={
            "doc_data": {
                "title": "MCTS Overview",
                "url": "local://mcts",
                "full_text": source_text,
            },
            "extraction": {
                "aligned_concepts": [
                    {
                        "id": "concept_mcts",
                        "name": "Monte Carlo Tree Search",
                        "action": "MATCH",
                        "synonyms": ["MCTS"],
                        "description": "Heuristic tree search algorithm.",
                    }
                ],
                "extracted_relations": [],
                "claims": [
                    {
                        "concept_id": "concept_mcts",
                        "statement": "MCTS combines tree search with random rollouts.",
                        "status": "PROPOSED",
                        "conflicts_with": [],
                        "evidence": {
                            "section_anchor": "Introduction",
                            "exact_quote": "combines tree search with random rollouts",
                        },
                    }
                ],
                "rationale": "Aligned MCTS to seed concept.",
            },
        },
    )
    assert res_cs.status_code == 200
    cs_data = res_cs.json()
    assert cs_data["source_title"] == "MCTS Overview"
    assert cs_data["status"] == "PENDING"
    assert len(cs_data["proposed_claims"]) == 1
    assert cs_data["proposed_claims"][0]["evidence"]["mechanical_verified"] is True


def test_backend_tier_health_and_state():
    res = backend_client.get("/health")
    assert res.status_code == 200
    assert res.json()["tier"] == "backend"
    assert res.json()["service"] == "project-idea"
    assert res.json()["model"] == "gemini-4-argon"

    res_state = backend_client.get("/api/state")
    assert res_state.status_code == 200
    data = res_state.json()
    assert "concepts" in data
    assert len(data["concepts"]) >= 5
    assert "relations" in data


def test_backend_approve_and_reject_changeset_flow():
    # Reset store
    res = backend_client.post("/api/reset")
    assert res.status_code == 200

    # Non-existent changeset returns 404
    res_404 = backend_client.post("/api/changesets/nonexistent/approve")
    assert res_404.status_code == 404
    res_reject_404 = backend_client.post("/api/changesets/nonexistent/reject")
    assert res_reject_404.status_code == 404

    # Stage a pending ChangeSet and test approve
    cs_approve = ChangeSet(
        id="cs_test_approve",
        source_title="Approve Test Doc",
        proposed_concepts=[
            Concept(
                id="concept_new_node",
                name="New Node",
                synonyms=[],
                description="Test concept",
                status=VerificationStatus.PROPOSED,
                layer="graph",
            )
        ],
        proposed_claims=[
            FactClaim(
                id="claim_test_1",
                concept_id="concept_new_node",
                statement="New Node is verified.",
                status=VerificationStatus.PROPOSED,
                evidence=SourceEvidence(
                    exact_quote="New Node is verified.",
                    mechanical_verified=True,
                ),
            )
        ],
    )
    backend_store.add_changeset(cs_approve)

    res_app = backend_client.post("/api/changesets/cs_test_approve/approve")
    assert res_app.status_code == 200
    assert res_app.json()["status"] == "approved"
    assert res_app.json()["changeset"]["status"] == "APPROVED"

    # Stage another ChangeSet and test reject
    cs_reject = ChangeSet(
        id="cs_test_reject",
        source_title="Reject Test Doc",
    )
    backend_store.add_changeset(cs_reject)
    res_rej = backend_client.post("/api/changesets/cs_test_reject/reject")
    assert res_rej.status_code == 200
    assert res_rej.json()["status"] == "rejected"
    assert res_rej.json()["changeset"]["status"] == "REJECTED"

    # Clean up back to seed
    backend_client.post("/api/reset")
