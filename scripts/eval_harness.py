import asyncio
import json
import os
import sys
from pathlib import Path
import httpx
from dotenv import load_dotenv

ROOT_DIR = Path(__file__).resolve().parent.parent
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from backend.ingest import DocumentIngester
from backend.model_client import ModelServiceClient
from backend.schemas import FactClaim, SourceEvidence, VerificationStatus
from model.server import app as model_app

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

    print("\nALL 3 BENCHMARK TESTS PASSED SUCCESSFULLY!")


if __name__ == "__main__":
    asyncio.run(run_benchmark())
