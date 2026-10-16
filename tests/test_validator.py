import pytest
from validator import EvidenceValidator, normalize_text
from models import FactClaim, SourceEvidence, VerificationStatus

def test_evidence_validator_exact_match():
    source = "Monte Carlo Tree Search (MCTS) is a heuristic search algorithm for decision processes."
    quote = "heuristic search algorithm for decision processes"
    valid, err = EvidenceValidator.verify_quote(source, quote)
    assert valid is True
    assert err is None

def test_evidence_validator_normalized_whitespace():
    source = "Monte Carlo   Tree Search\n(MCTS) is a heuristic search algorithm."
    quote = "Monte Carlo Tree Search (MCTS)"
    valid, err = EvidenceValidator.verify_quote(source, quote)
    assert valid is True

def test_evidence_validator_reject_hallucination():
    source = "Monte Carlo Tree Search is effective for combinatorial games."
    hallucinated = "Monte Carlo Tree Search was proven by Alan Turing in 1950."
    valid, err = EvidenceValidator.verify_quote(source, hallucinated)
    assert valid is False
    assert "Hallucination detected" in err
