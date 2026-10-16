import json
from types import SimpleNamespace
from unittest.mock import patch
import httpx
from fastapi.testclient import TestClient

import backend.server as backend_server
from backend.model_client import ModelServiceClient
from model.server import app as model_app, get_engine


def _make_mock_interaction(interaction_id: str, payload: dict, thought_text: str):
    thought_step = SimpleNamespace(
        type="thought",
        summary=[SimpleNamespace(type="text", text=thought_text)],
    )
    return SimpleNamespace(
        id=interaction_id,
        status="completed",
        output_text=json.dumps(payload),
        steps=[thought_step],
    )


def test_end_to_end_3tier_multiturn_self_correction_rest_loop():
    source_text = (
        "The Interactions API in Gemini 4 Argon preserves server-side state via previous_interaction_id "
        "and grants automatic 95% implicit context caching discounts."
    )

    turn1_payload = {
        "aligned_concepts": [
            {
                "id": "concept_interactions_api",
                "name": "Interactions API",
                "action": "MATCH",
                "synonyms": ["Stateful Interactions API"],
                "description": "Stateful multi-turn API for Gemini 4 Argon.",
            }
        ],
        "extracted_relations": [],
        "claims": [
            {
                "concept_id": "concept_interactions_api",
                "statement": "Interactions API preserves state across turns with 95% cache discount.",
                "status": "PROPOSED",
                "conflicts_with": [],
                "evidence": {
                    "section_anchor": "Architecture",
                    "exact_quote": "HALLUCINATED QUOTE: Interactions API requires manual cache token management.",
                },
            }
        ],
        "rationale": "Initial extraction with a fabricated quote to trigger mechanical validation failure.",
    }

    turn2_payload = {
        "aligned_concepts": turn1_payload["aligned_concepts"],
        "extracted_relations": [],
        "claims": [
            {
                "concept_id": "concept_interactions_api",
                "statement": "Interactions API preserves state across turns with 95% cache discount.",
                "status": "PROPOSED",
                "conflicts_with": [],
                "evidence": {
                    "section_anchor": "Architecture",
                    "exact_quote": "preserves server-side state via previous_interaction_id and grants automatic 95% implicit context caching discounts.",
                },
            }
        ],
        "rationale": "Self-corrected quote to match exact verbatim span from the source text.",
    }

    call_log = []

    def mock_interactions_create(**kwargs):
        call_log.append(kwargs)
        assert kwargs.get("model") == "gemini-4-argon"
        assert kwargs.get("generation_config", {}).get("thinking_level") == "medium"
        if "previous_interaction_id" not in kwargs or kwargs["previous_interaction_id"] is None:
            return _make_mock_interaction(
                "int_turn1_001",
                turn1_payload,
                "Turn 1: Aligning Interactions API concept and extracting claims.",
            )
        else:
            assert kwargs["previous_interaction_id"] == "int_turn1_001"
            return _make_mock_interaction(
                "int_turn2_002",
                turn2_payload,
                "Turn 2: Fixing non-verbatim quote using mechanical validator feedback.",
            )

    original_model_client = backend_server.model_client
    backend_server.model_client = ModelServiceClient(
        base_url="http://model-tier",
        transport=httpx.ASGITransport(app=model_app),
    )

    engine = get_engine()
    try:
        with patch.object(engine.client.interactions, "create", side_effect=mock_interactions_create):
            backend_test_client = TestClient(backend_server.app)
            backend_test_client.post("/api/reset")

            resp = backend_test_client.post(
                "/api/assimilate",
                json={
                    "title": "Gemini 4 Argon Architecture Spec",
                    "text": source_text,
                },
            )
            assert resp.status_code == 200
            data = resp.json()

            assert data["status"] == "success"
            assert data["requires_human_approval"] is True

            trace = data["pipeline_trace"]
            assert trace["self_corrected"] is True
            assert trace["initial_failures_count"] == 1
            assert trace["turn1_interaction_id"] == "int_turn1_001"
            assert trace["turn2_interaction_id"] == "int_turn2_002"
            assert len(trace["thought_summaries"]) == 2
            assert "Turn 1" in trace["thought_summaries"][0]
            assert "Turn 2" in trace["thought_summaries"][1]

            assert len(call_log) == 2
            assert "previous_interaction_id" not in call_log[0]
            assert call_log[1]["previous_interaction_id"] == "int_turn1_001"

            cs = data["changeset"]
            assert cs["status"] == "PENDING"
            assert len(cs["proposed_claims"]) == 1
            assert cs["proposed_claims"][0]["evidence"]["mechanical_verified"] is True

            cs_id = cs["id"]
            approve_resp = backend_test_client.post(f"/api/changesets/{cs_id}/approve")
            assert approve_resp.status_code == 200
            assert approve_resp.json()["status"] == "approved"

            backend_test_client.post("/api/reset")
    finally:
        backend_server.model_client = original_model_client
