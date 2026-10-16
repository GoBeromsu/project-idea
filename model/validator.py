import re
import unicodedata
from typing import Tuple, Optional, List

try:
    from model.schemas import Relation, FactClaim
except ImportError:
    from schemas import Relation, FactClaim


def normalize_text(text: str) -> str:
    if not text:
        return ""
    text = unicodedata.normalize("NFKC", text)
    return re.sub(r"\s+", " ", text).strip()


class EvidenceValidator:
    @staticmethod
    def verify_quote(source_text: str, quote: str, strict: bool = False) -> Tuple[bool, Optional[str]]:
        if not quote or not quote.strip():
            return False, "Quote is empty."

        if quote in source_text:
            return True, None

        norm_source = normalize_text(source_text)
        norm_quote = normalize_text(quote)

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

    @staticmethod
    def validate_claim(claim: FactClaim, source_text: str) -> Tuple[bool, Optional[str]]:
        valid, err = EvidenceValidator.verify_quote(source_text, claim.evidence.exact_quote)
        claim.evidence.mechanical_verified = valid
        return valid, err

    @staticmethod
    def validate_referential_integrity(
        relations: List[Relation],
        known_concept_ids: set
    ) -> List[str]:
        errors = []
        for rel in relations:
            if rel.source_id not in known_concept_ids:
                errors.append(f"Relation {rel.id} references unknown source concept: {rel.source_id}")
            if rel.target_id not in known_concept_ids:
                errors.append(f"Relation {rel.id} references unknown target concept: {rel.target_id}")
        return errors
