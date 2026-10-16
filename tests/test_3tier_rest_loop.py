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


def test_end_to_end_5stage_golden_path_and_post_approval_requery():
    source_text = (
        "Speculative Tree Verification pairs MCTS lookahead with parallel draft verification "
        "to cut multi-step reasoning latency by 42% in production benchmarks."
    )

    turn1_payload = {
        "answer": "Speculative Tree Verification combines MCTS lookahead with parallel draft verification to reduce latency by 42%.",
        "aligned_concepts": [
            {
                "id": "concept_mcts",
                "name": "Monte Carlo Tree Search",
                "action": "MATCH",
                "synonyms": ["MCTS lookahead"],
                "description": "Heuristic tree search algorithm.",
            },
            {
                "id": "concept_speculative_tree_verification",
                "name": "Speculative Tree Verification",
                "action": "PROPOSE",
                "synonyms": ["Parallel Draft Tree Verification"],
                "description": "Hybrid verification method pairing MCTS lookahead with parallel draft verification.",
            },
        ],
        "extracted_relations": [
            {
                "source_id": "concept_speculative_tree_verification",
                "target_id": "concept_mcts",
                "predicate": "extends",
                "description": "Pairs MCTS lookahead with parallel draft verification.",
            }
        ],
        "claims": [
            {
                "concept_id": "concept_speculative_tree_verification",
                "statement": "Speculative Tree Verification cuts multi-step reasoning latency by 42% in production benchmarks.",
                "status": "PROPOSED",
                "conflicts_with": [],
                "evidence": {
                    "section_anchor": "Benchmarks",
                    "exact_quote": "cuts latency by 42 percent in synthetic tests",
                },
            },
            {
                "concept_id": "concept_speculative_tree_verification",
                "statement": "Unverified claim that never gets repaired in Turn 2.",
                "status": "PROPOSED",
                "conflicts_with": [],
                "evidence": {
                    "section_anchor": "Benchmarks",
                    "exact_quote": "completely fabricated quote that remains unverified",
                },
            },
        ],
        "rationale": "Matched MCTS lookahead and proposed Speculative Tree Verification.",
    }

    turn2_payload = {
        "answer": turn1_payload["answer"],
        "aligned_concepts": turn1_payload["aligned_concepts"],
        "extracted_relations": turn1_payload["extracted_relations"],
        "claims": [
            {
                "concept_id": "concept_speculative_tree_verification",
                "statement": "Speculative Tree Verification cuts multi-step reasoning latency by 42% in production benchmarks.",
                "status": "PROPOSED",
                "conflicts_with": [],
                "evidence": {
                    "section_anchor": "Benchmarks",
                    "exact_quote": "pairs MCTS lookahead with parallel draft verification to cut multi-step reasoning latency by 42% in production benchmarks.",
                },
            },
            {
                "concept_id": "concept_speculative_tree_verification",
                "statement": "Unverified claim that never gets repaired in Turn 2.",
                "status": "PROPOSED",
                "conflicts_with": [],
                "evidence": {
                    "section_anchor": "Benchmarks",
                    "exact_quote": "completely fabricated quote that remains unverified",
                },
            },
        ],
        "rationale": "Repaired first claim quote; second claim remains unverified.",
    }

    def mock_interactions_create(**kwargs):
        prompt_input = kwargs.get("input", "")
        if "USER QUESTION:" in prompt_input and "Verified Knowledge Graph Concepts:" in prompt_input:
            if "concept_speculative_tree_verification" in prompt_input:
                query_payload = {
                    "answer": "Speculative Tree Verification cuts multi-step reasoning latency by 42% (newly approved session knowledge) and extends Monte Carlo Tree Search (seed knowledge).",
                    "referenced_concept_ids": ["concept_speculative_tree_verification", "concept_mcts"],
                    "referenced_claim_ids": ["claim_0_concept_speculative_tree_verification"],
                    "unverified_gaps": None,
                }
                return _make_mock_interaction(
                    "int_query_post_003", query_payload, "Synthesizing session + seed answer."
                )
            else:
                query_payload = {
                    "answer": "Monte Carlo Tree Search (seed knowledge) is a heuristic search algorithm.",
                    "referenced_concept_ids": ["concept_mcts"],
                    "referenced_claim_ids": [],
                    "unverified_gaps": None,
                }
                return _make_mock_interaction("int_query_pre_001", query_payload, "Synthesizing seed-only answer.")

        if "previous_interaction_id" not in kwargs or kwargs["previous_interaction_id"] is None:
            return _make_mock_interaction("int_gp_turn1", turn1_payload, "Turn 1 extraction.")
        return _make_mock_interaction("int_gp_turn2", turn2_payload, "Turn 2 quote repair.")

    original_model_client = backend_server.model_client
    backend_server.model_client = ModelServiceClient(
        base_url="http://model-tier",
        transport=httpx.ASGITransport(app=model_app),
    )

    engine = get_engine()
    try:
        with patch.object(engine.client.interactions, "create", side_effect=mock_interactions_create):
            client = TestClient(backend_server.app)
            client.post("/api/reset")

            pre_q = client.post("/api/query", json={"question": "What is Monte Carlo Tree Search?"})
            assert pre_q.status_code == 200
            pre_q_data = pre_q.json()
            assert pre_q_data["mutated_wiki"] is False
            assert all(c["is_seed"] is True for c in pre_q_data["citations"])

            assim_res = client.post(
                "/api/assimilate",
                json={
                    "title": "Speculative Tree Verification Benchmark",
                    "text": source_text,
                    "question": "How much latency does Speculative Tree Verification cut?",
                },
            )
            assert assim_res.status_code == 200
            assim_data = assim_res.json()
            cs = assim_data["changeset"]
            assert len(cs["proposed_claims"]) == 1
            assert len(cs["blocked_claims"]) == 1
            assert cs["blocked_claims"][0]["status"] == "REJECTED"
            assert "Blocked" in cs["blocked_claims"][0]["verification_badges"]

            verified_claim_id = cs["proposed_claims"][0]["id"]
            rel_id = cs["proposed_relations"][0]["id"]

            app_res = client.post(
                f"/api/changesets/{cs['id']}/approve",
                json={
                    "concept_ids": ["concept_mcts", "concept_speculative_tree_verification"],
                    "relation_ids": [rel_id],
                    "claim_ids": [verified_claim_id],
                },
            )
            assert app_res.status_code == 200

            post_q = client.post(
                "/api/query",
                json={"question": "How does Speculative Tree Verification improve MCTS latency?"},
            )
            assert post_q.status_code == 200
            post_q_data = post_q.json()
            assert post_q_data["mutated_wiki"] is False
            assert any(c["is_seed"] is False for c in post_q_data["citations"])
            assert any(c["node_id"] == "concept_speculative_tree_verification" for c in post_q_data["citations"])

            client.post("/api/reset")
    finally:
        backend_server.model_client = original_model_client
