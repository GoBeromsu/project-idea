import asyncio
import json
import os
from pathlib import Path
import httpx
from dotenv import load_dotenv
from backend.ingest import DocumentIngester, validate_public_url
from backend.model_client import ModelServiceClient
from backend.schemas import FactClaim, SourceEvidence, VerificationStatus
from backend.store import KnowledgeStore
from model.server import app as model_app

ROOT_DIR = Path(__file__).resolve().parent.parent
load_dotenv()


def _load_seed() -> dict:
    for candidate in (ROOT_DIR / "backend" / "seed_domain.json", ROOT_DIR / "seed_domain.json"):
        if candidate.exists():
            with open(candidate, "r", encoding="utf-8") as f:
                return json.load(f)
    raise FileNotFoundError("Could not locate seed_domain.json")


async def run_benchmark():
    live_url = os.getenv("MODEL_API_URL")
    if live_url:
        client = ModelServiceClient(base_url=live_url)
    else:
        client = ModelServiceClient(
            base_url="http://model-tier",
            transport=httpx.ASGITransport(app=model_app),
        )

    seed = _load_seed()

    existing_claims = [
        FactClaim(
            id="claim_mcts_rollout",
            concept_id="concept_mcts",
            statement="Monte Carlo Tree Search executes rollouts to evaluate state values.",
            status=VerificationStatus.VERIFIED,
            evidence=SourceEvidence(
                exact_quote="Monte Carlo Tree Search combines tree search with random rollouts.",
                mechanical_verified=True,
            ),
        )
    ]

    print("\n--- TEST 1: Synonym Alignment (MCTS alias) ---")
    doc1 = DocumentIngester.parse_text(
        "Tree search heuristic algorithms combine selective tree exploration with Monte Carlo simulations to guide agent planning.",
        title="Search Planning In Autonomous Agents",
    )
    cs1, trace1 = await client.assimilate_via_rest_loop(doc1, seed, existing_claims)
    matched_ids = [c.id for c in cs1.proposed_concepts]
    print(f"Turn 1 Interaction ID: {trace1.turn1_interaction_id} | Self-Corrected: {trace1.self_corrected}")
    print(f"Proposed Concept IDs: {matched_ids}")
    print(f"Claims Extracted: {len(cs1.proposed_claims)}")
    for cl in cs1.proposed_claims:
        print(f" - Claim: '{cl.statement}' | Verified Quote: {cl.evidence.mechanical_verified}")
    assert any("concept_mcts" in cid for cid in matched_ids), "Failed to align synonym to concept_mcts!"

    print("\n--- TEST 2: Mechanical Verification & Provenance Grounding ---")
    doc2 = DocumentIngester.parse_text(
        "The Interactions API in Gemini 4 Argon maintains multi-turn state while granting 95% prompt cache discounts.",
        title="Argon Interactions Guide",
    )
    cs2, trace2 = await client.assimilate_via_rest_loop(doc2, seed, existing_claims)
    print(f"Turn 1 Interaction ID: {trace2.turn1_interaction_id} | Self-Corrected: {trace2.self_corrected}")
    for cl in cs2.proposed_claims:
        print(f" - Claim: '{cl.statement}'")
        print(f"   Quote: '{cl.evidence.exact_quote}'")
        print(f"   Mechanical Verified: {cl.evidence.mechanical_verified}")
        assert cl.evidence.mechanical_verified, f"Evidence quote not mechanically verified: {cl.evidence.exact_quote}"

    print("\n--- TEST 3: Contradiction Flagging (Prevent Silent Overwrite) ---")
    doc3 = DocumentIngester.parse_text(
        "Monte Carlo Tree Search never executes rollouts and relies purely on gradient descent.",
        title="Contradicting Survey",
    )
    cs3, trace3 = await client.assimilate_via_rest_loop(doc3, seed, existing_claims)
    print(f"Turn 1 Interaction ID: {trace3.turn1_interaction_id} | Self-Corrected: {trace3.self_corrected}")
    print(f"Unresolved Conflicts Detected: {len(cs3.unresolved_conflicts)}")
    for uc in cs3.unresolved_conflicts:
        print(f" - Conflicting Claim: '{uc.statement}' | Status: {uc.status}")
    assert len(cs3.unresolved_conflicts) > 0 or any(
        c.status == VerificationStatus.UNRESOLVED for c in cs3.proposed_claims
    ), "Failed to flag contradiction as UNRESOLVED!"

    print("\n--- TEST 4: SSRF & Private/Metadata URL Blocking (AC-03 / AC-10) ---")
    unsafe_targets = [
        "http://127.0.0.1/admin",
        "http://169.254.169.254/latest/meta-data/",
        "http://localhost:8000/health",
        "file:///etc/passwd",
    ]
    for target in unsafe_targets:
        blocked = False
        try:
            validate_public_url(target)
        except ValueError as err:
            blocked = True
            print(f" - Blocked unsafe URL '{target}': {err}")
        assert blocked, f"Failed to block unsafe URL: {target}"

    print("\n--- TEST 5: Pre-Query vs Post-Approval Re-Query & Selective Approval (AC-02 / AC-07 / AC-08) ---")
    temp_store = KnowledgeStore()
    pre_ontology = {
        "concepts": [c.model_dump() for c in temp_store.concepts.values()],
        "relations": [r.model_dump() for r in temp_store.relations.values()],
    }
    pre_query_res = await client.query_knowledge(
        question="How does the Interactions API manage state in Gemini 4 Argon?",
        seed_ontology=pre_ontology,
        existing_claims=list(temp_store.claims.values()),
    )
    print(f"Pre-Query Citations: {len(pre_query_res.citations)} | Mutated Wiki: {pre_query_res.mutated_wiki}")
    assert pre_query_res.mutated_wiki is False
    assert all(c.is_seed is True for c in pre_query_res.citations)

    stored_cs2 = temp_store.add_changeset(cs2, source_text=doc2["full_text"], pipeline_trace=trace2)
    approved_cs2 = temp_store.approve_changeset(
        stored_cs2.id,
        concept_ids=[c.id for c in stored_cs2.proposed_concepts],
        relation_ids=[r.id for r in stored_cs2.proposed_relations],
        claim_ids=[cl.id for cl in stored_cs2.proposed_claims],
    )
    assert approved_cs2 is not None and approved_cs2.status == "APPROVED"

    post_ontology = {
        "concepts": [c.model_dump() for c in temp_store.concepts.values()],
        "relations": [r.model_dump() for r in temp_store.relations.values()],
    }
    post_query_res = await client.query_knowledge(
        question="What prompt cache discount does the Interactions API grant according to our session library?",
        seed_ontology=post_ontology,
        existing_claims=list(temp_store.claims.values()),
    )
    print(
        f"Post-Approval Query Citations: {len(post_query_res.citations)} | "
        f"Session Citations: {sum(1 for c in post_query_res.citations if not c.is_seed)}"
    )
    assert post_query_res.mutated_wiki is False
    assert any(c.is_seed is False for c in post_query_res.citations), (
        "Expected post-approval query to cite newly approved session knowledge!"
    )

    print("\n--- TEST 6: 4-Layer Semantic Jargon Scan (gemini-3.8-flash) & Adversarial Isolation ---")
    state_snapshot = temp_store.get_state()
    assert state_snapshot["rings_count"] == 4
    assert set(state_snapshot["layer_counts"].keys()) == {"jargon", "concepts", "entities", "wiki"}

    scan_res = await client.scan_jargon(
        doc_data={
            "title": "Flash Jargon Benchmark",
            "full_text": "PagedAttention partitions KV-cache blocks while OS Page Table maps kernel virtual memory.",
        },
        seed_ontology=post_ontology,
    )
    candidates = scan_res["scan"]["candidates"]
    print(f"Flash Jargon Scan Model: {scan_res['model_used']} | Candidates: {len(candidates)}")
    assert scan_res["model_used"] == "gemini-3.8-flash"
    assert any(c.get("action") == "UNRESOLVED" for c in candidates)

    print("\nALL 6 BENCHMARK TESTS PASSED SUCCESSFULLY!")


if __name__ == "__main__":
    asyncio.run(run_benchmark())

