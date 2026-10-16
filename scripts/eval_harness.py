"""
Evaluation and Benchmark Harness for Project IDEA.
Validates the 3 core criteria:
1. Synonym Blindness Test (Canonical Matching vs Fragmentation)
2. Hallucinated Quote Rejection Test (Mechanical Validator + Argon Self-Correction)
3. Contradiction Detection Test (Silent Overwrite Prevention -> UNRESOLVED)
"""
import asyncio
import os
import json
from dotenv import load_dotenv
from agent_loop import AssimilationEngine
from ingest import DocumentIngester
from models import FactClaim, SourceEvidence, VerificationStatus

load_dotenv()

async def run_benchmark():
    engine = AssimilationEngine()

    with open("seed_domain.json", "r") as f:
        seed = json.load(f)

    existing_claims = [
        FactClaim(
            id="claim_mcts_rollout",
            concept_id="concept_mcts",
            statement="Monte Carlo Tree Search executes rollouts to evaluate state values.",
            status=VerificationStatus.VERIFIED,
            evidence=SourceEvidence(
                exact_quote="Monte Carlo Tree Search combines tree search with random rollouts.",
                mechanical_verified=True
            )
        )
    ]

    print("\n--- TEST 1: Synonym Alignment (MCTS alias) ---")
    doc1 = DocumentIngester.parse_text(
        "Tree search heuristic algorithms combine selective tree exploration with Monte Carlo simulations to guide agent planning.",
        title="Search Planning In Autonomous Agents"
    )
    cs1 = await engine.assimilate(doc1, seed, existing_claims)
    matched_ids = [c.id for c in cs1.proposed_concepts]
    print(f"Proposed Concept IDs: {matched_ids}")
    print(f"Claims Extracted: {len(cs1.proposed_claims)}")
    for cl in cs1.proposed_claims:
        print(f" - Claim: '{cl.statement}' | Verified Quote: {cl.evidence.mechanical_verified}")
    assert any("concept_mcts" in cid for cid in matched_ids), "Failed to align synonym to concept_mcts!"

    print("\n--- TEST 2: Mechanical Verification & Provenance Grounding ---")
    doc2 = DocumentIngester.parse_text(
        "The Interactions API in Gemini 4 Argon maintains multi-turn state while granting 95% prompt cache discounts.",
        title="Argon Interactions Guide"
    )
    cs2 = await engine.assimilate(doc2, seed, existing_claims)
    for cl in cs2.proposed_claims:
        print(f" - Claim: '{cl.statement}'")
        print(f"   Quote: '{cl.evidence.exact_quote}'")
        print(f"   Mechanical Verified: {cl.evidence.mechanical_verified}")
        assert cl.evidence.mechanical_verified, f"Evidence quote not mechanically verified: {cl.evidence.exact_quote}"

    print("\n--- TEST 3: Contradiction Flagging (Prevent Silent Overwrite) ---")
    doc3 = DocumentIngester.parse_text(
        "Monte Carlo Tree Search never executes rollouts and relies purely on gradient descent.",
        title="Contradicting Survey"
    )
    cs3 = await engine.assimilate(doc3, seed, existing_claims)
    print(f"Unresolved Conflicts Detected: {len(cs3.unresolved_conflicts)}")
    for uc in cs3.unresolved_conflicts:
        print(f" - Conflicting Claim: '{uc.statement}' | Status: {uc.status}")
    assert len(cs3.unresolved_conflicts) > 0 or any(c.status == VerificationStatus.UNRESOLVED for c in cs3.proposed_claims), (
        "Failed to flag contradiction as UNRESOLVED!"
    )

    print("\n ALL 3 BENCHMARK TESTS PASSED SUCCESSFULLY!")

if __name__ == "__main__":
    asyncio.run(run_benchmark())
