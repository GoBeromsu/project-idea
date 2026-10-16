import re
import unicodedata
from typing import Any, Dict, List, Optional, Tuple

try:
    from model.schemas import AssimilationExtraction, FactClaim, Relation
except ImportError:
    from schemas import AssimilationExtraction, FactClaim, Relation


def normalize_whitespace(text: str) -> str:
    if not text:
        return ""
    text = unicodedata.normalize("NFKC", text)
    return re.sub(r"\s+", " ", text).strip()


def normalize_text(text: str) -> str:
    return normalize_whitespace(text)


def verify_quote_in_source(
    source_text: str,
    quote: str,
    strict: bool = False,
) -> Tuple[bool, Optional[str]]:
    if not quote or not quote.strip():
        return False, "Quote is empty."

    if quote in source_text:
        return True, None

    norm_source = normalize_whitespace(source_text)
    norm_quote = normalize_whitespace(quote)

    if norm_quote in norm_source:
        return True, None

    if strict:
        return False, f"Verbatim quote span not found in source text. Given: '{quote[:60]}...'"

    if norm_quote.lower() in norm_source.lower():
        return True, None

    return False, (
        f"Hallucination detected: The quote '{quote[:80]}...' "
        f"cannot be grounded as a verbatim substring in the provided source text."
    )


def validate_extraction_quotes(
    extraction: AssimilationExtraction,
    source_text: str,
) -> List[Dict[str, Any]]:
    validation_failures: List[Dict[str, Any]] = []
    for idx, claim in enumerate(extraction.claims):
        quote = claim.evidence.exact_quote if claim.evidence else ""
        valid, err = verify_quote_in_source(source_text, quote, strict=False)
        if not valid:
            validation_failures.append(
                {
                    "claim_index": idx,
                    "claim": claim.statement,
                    "statement": claim.statement,
                    "bad_quote": quote,
                    "exact_quote": quote,
                    "error": err,
                    "reason": err,
                }
            )
    return validation_failures


def _slugify_concept_id(name: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "_", (name or "unknown").lower()).strip("_")
    return f"concept_{slug or 'unknown'}"


def validate_extraction_referential_integrity(
    extraction: AssimilationExtraction,
    seed_ontology: Optional[Dict[str, Any]] = None,
) -> List[Dict[str, Any]]:
    failures: List[Dict[str, Any]] = []
    seed_ids = set()
    if seed_ontology:
        for c in seed_ontology.get("concepts", []):
            cid = c.get("id") if isinstance(c, dict) else getattr(c, "id", None)
            if cid:
                seed_ids.add(cid)

    known_ids = set(seed_ids)
    for c in extraction.aligned_concepts:
        if c.id:
            known_ids.add(c.id)
        if c.name:
            known_ids.add(_slugify_concept_id(c.name))
            known_ids.add(f"concept_{c.name.lower().replace(' ', '_')}")
        if c.action == "MATCH" and seed_ids and (not c.id or c.id not in seed_ids):
            failures.append(
                {
                    "type": "concept_match_unknown_id",
                    "concept_name": c.name,
                    "concept_id": c.id,
                    "error": f"MATCH concept '{c.name}' references unknown seed concept ID '{c.id}'.",
                }
            )

    if known_ids:
        for claim in extraction.claims:
            if claim.concept_id and claim.concept_id not in known_ids:
                failures.append(
                    {
                        "type": "claim_unknown_concept",
                        "claim": claim.statement,
                        "concept_id": claim.concept_id,
                        "error": f"Claim references unknown concept_id '{claim.concept_id}'.",
                    }
                )
        for rel in extraction.extracted_relations:
            if rel.source_id not in known_ids:
                failures.append(
                    {
                        "type": "relation_unknown_source",
                        "source_id": rel.source_id,
                        "target_id": rel.target_id,
                        "error": f"Relation references unknown source_id '{rel.source_id}'.",
                    }
                )
            if rel.target_id not in known_ids:
                failures.append(
                    {
                        "type": "relation_unknown_target",
                        "source_id": rel.source_id,
                        "target_id": rel.target_id,
                        "error": f"Relation references unknown target_id '{rel.target_id}'.",
                    }
                )

    return failures


class EvidenceValidator:
    @staticmethod
    def verify_quote(
        source_text: str,
        quote: str,
        strict: bool = False,
    ) -> Tuple[bool, Optional[str]]:
        return verify_quote_in_source(source_text, quote, strict=strict)

    @staticmethod
    def validate_claim(claim: FactClaim, source_text: str) -> Tuple[bool, Optional[str]]:
        valid, err = verify_quote_in_source(source_text, claim.evidence.exact_quote)
        claim.evidence.mechanical_verified = valid
        return valid, err

    @staticmethod
    def validate_referential_integrity(
        relations: List[Relation],
        known_concept_ids: set,
    ) -> List[str]:
        errors = []
        for rel in relations:
            if rel.source_id not in known_concept_ids:
                errors.append(f"Relation {rel.id} references unknown source concept: {rel.source_id}")
            if rel.target_id not in known_concept_ids:
                errors.append(f"Relation {rel.id} references unknown target concept: {rel.target_id}")
        return errors
