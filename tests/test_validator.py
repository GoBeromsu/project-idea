from fastapi.testclient import TestClient
from model.validator import EvidenceValidator, normalize_text
from model.schemas import FactClaim, SourceEvidence, VerificationStatus, Relation
from model.server import app as model_app

model_client = TestClient(model_app)


def test_evidence_validator_exact_match():
    source = "Monte Carlo Tree Search (MCTS) is a heuristic search algorithm for decision processes."
    quote = "heuristic search algorithm for decision processes"
    valid, err = EvidenceValidator.verify_quote(source, quote)
    assert valid is True
    assert err is None


def test_evidence_validator_normalized_whitespace():
    source = "Monte Carlo   Tree Search\n(MCTS) is a heuristic search algorithm."
    quote = "Monte Carlo Tree Search (MCTS)"
    assert normalize_text(source) == "Monte Carlo Tree Search (MCTS) is a heuristic search algorithm."
    valid, err = EvidenceValidator.verify_quote(source, quote)
    assert valid is True


def test_evidence_validator_reject_hallucination():
    source = "Monte Carlo Tree Search is effective for combinatorial games."
    hallucinated = "Monte Carlo Tree Search was proven by Alan Turing in 1950."
    valid, err = EvidenceValidator.verify_quote(source, hallucinated)
    assert valid is False
    assert "Hallucination detected" in err


def test_evidence_validator_validate_claim_and_referential_integrity():
    source = "Interactions API supports server-side state via previous_interaction_id."
    claim = FactClaim(
        id="cl_1",
        concept_id="concept_interactions_api",
        statement="Interactions API preserves state across turns.",
        status=VerificationStatus.PROPOSED,
        evidence=SourceEvidence(
            exact_quote="supports server-side state via previous_interaction_id",
            mechanical_verified=False,
        ),
    )
    valid, err = EvidenceValidator.validate_claim(claim, source)
    assert valid is True
    assert err is None
    assert claim.evidence.mechanical_verified is True

    rel = Relation(
        id="rel_1",
        source_id="concept_interactions_api",
        target_id="concept_unknown",
        predicate="uses",
    )
    errors = EvidenceValidator.validate_referential_integrity([rel], {"concept_interactions_api"})
    assert len(errors) == 1
    assert "concept_unknown" in errors[0]


def test_model_tier_verify_quote_rest_endpoint():
    source = "Gemini 4 Argon supports implicit context caching with 95% discount."
    res_ok = model_client.post(
        "/api/v1/verify-quote",
        json={
            "source_text": source,
            "quote": "implicit context caching with 95% discount",
            "strict": False,
        },
    )
    assert res_ok.status_code == 200
    data_ok = res_ok.json()
    assert data_ok["valid"] is True
    assert data_ok["error"] is None

    res_bad = model_client.post(
        "/api/v1/verify-quote",
        json={
            "source_text": source,
            "quote": "explicit manual cache tokens with 50% discount",
            "strict": False,
        },
    )
    assert res_bad.status_code == 200
    data_bad = res_bad.json()
    assert data_bad["valid"] is False
    assert "Hallucination detected" in data_bad["error"]
