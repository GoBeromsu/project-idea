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


PROMPT_INJECTION_PATTERNS = [
    r"ignore\s+(?:all\s+)?(?:previous|prior|above)\s+(?:instructions|prompts|rules|gates)",
    r"disregard\s+(?:all\s+)?(?:previous|prior|system)\s+(?:instructions|rules|gates)",
    r"override\s+(?:verification|validation|security|system)\s+(?:gate|gates|rules|prompt)",
    r"mark\s+(?:all\s+|this\s+)?(?:claim|claims|ungrounded)\s+as\s+verified",
    r"system\s*override\s*:",
    r"<\s*script\b",
]

CROSS_DOMAIN_FALSE_FRIENDS = {
    "page table": {
        "conflicting_canonical_ids": {"concept_paged_attention", "concept_kv_cache"},
        "reason": "Cross-domain lookalike jargon: OS virtual memory 'Page Table' is distinct from LLM 'PagedAttention' KV-block tables.",
    },
    "os page table": {
        "conflicting_canonical_ids": {"concept_paged_attention", "concept_kv_cache"},
        "reason": "Cross-domain lookalike jargon: OS kernel 'Page Table' must not be merged into LLM 'PagedAttention'.",
    },
    "virtual memory page table": {
        "conflicting_canonical_ids": {"concept_paged_attention", "concept_kv_cache"},
        "reason": "Cross-domain lookalike jargon: Hardware MMU 'Virtual Memory Page Table' must not be merged into LLM 'PagedAttention'.",
    },
    "speculative execution": {
        "conflicting_canonical_ids": {"concept_speculative_decoding"},
        "reason": "Cross-domain lookalike jargon: CPU branch 'Speculative Execution' is distinct from LLM 'Speculative Decoding'.",
    },
}


def detect_prompt_injection(text: str) -> List[str]:
    if not text:
        return []
    matches: List[str] = []
    for pattern in PROMPT_INJECTION_PATTERNS:
        found = re.search(pattern, text, flags=re.IGNORECASE)
        if found:
            matches.append(f"Adversarial prompt injection pattern detected: '{found.group(0)}'")
    return matches


def normalize_jargon_key(text: str) -> str:
    if not text:
        return ""
    cleaned = unicodedata.normalize("NFKC", text).lower()
    cleaned = re.sub(r"[-_/]+", " ", cleaned)
    cleaned = re.sub(r"[^a-z0-9\s]+", "", cleaned)
    return re.sub(r"\s+", " ", cleaned).strip()


def validate_extraction_quotes(
    extraction: AssimilationExtraction,
    source_text: str,
) -> List[Dict[str, Any]]:
    validation_failures: List[Dict[str, Any]] = []
    for idx, claim in enumerate(extraction.claims):
        quote = claim.evidence.exact_quote if claim.evidence else ""
        inj_claim = detect_prompt_injection(claim.statement) + detect_prompt_injection(quote)
        if inj_claim:
            validation_failures.append(
                {
                    "claim_index": idx,
                    "claim": claim.statement,
                    "statement": claim.statement,
                    "bad_quote": quote,
                    "exact_quote": quote,
                    "error": inj_claim[0],
                    "reason": inj_claim[0],
                    "adversarial": True,
                }
            )
            continue
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


def validate_semantic_jargon_alignment(
    extraction: AssimilationExtraction,
    seed_ontology: Optional[Dict[str, Any]] = None,
) -> List[Dict[str, Any]]:
    warnings: List[Dict[str, Any]] = []
    seed_map: Dict[str, Dict[str, Any]] = {}
    if seed_ontology:
        for c in seed_ontology.get("concepts", []):
            if isinstance(c, dict) and c.get("id"):
                seed_map[c["id"]] = c
            elif getattr(c, "id", None):
                seed_map[c.id] = c.model_dump() if hasattr(c, "model_dump") else {}

    for c in extraction.aligned_concepts:
        norm_name = normalize_jargon_key(c.name)
        cand_aliases = getattr(c, "aliases", None) or getattr(c, "synonyms", None) or []
        all_keys = [norm_name] + [normalize_jargon_key(a) for a in cand_aliases if a]
        for key in all_keys:
            if key in CROSS_DOMAIN_FALSE_FRIENDS:
                rule = CROSS_DOMAIN_FALSE_FRIENDS[key]
                if c.action == "MATCH" and (not c.id or c.id in rule["conflicting_canonical_ids"]):
                    warnings.append(
                        {
                            "type": "semantic_jargon_collision",
                            "concept_name": c.name,
                            "concept_id": c.id,
                            "error": rule["reason"],
                        }
                    )
                break
        if c.action == "MATCH" and c.id and c.id in seed_map:
            seed_node = seed_map[c.id]
            seed_keys = {normalize_jargon_key(seed_node.get("name", ""))}
            raw_seed_aliases = seed_node.get("aliases", []) or seed_node.get("synonyms", []) or []
            for a in raw_seed_aliases:
                if a:
                    seed_keys.add(normalize_jargon_key(a))
            seed_compact = {k.replace(" ", "") for k in seed_keys if k}
            cand_compact = {k.replace(" ", "") for k in all_keys if k}
            has_lexical_overlap = bool((set(all_keys) & seed_keys) or (cand_compact & seed_compact))
            if not has_lexical_overlap:
                for ck in all_keys:
                    for sk in seed_keys:
                        if ck and sk and (ck in sk or sk in ck):
                            has_lexical_overlap = True
                            break
            if not has_lexical_overlap:
                warnings.append(
                    {
                        "type": "unverified_jargon_synonym_merge",
                        "concept_name": c.name,
                        "concept_id": c.id,
                        "error": f"Concept '{c.name}' attempted MATCH to '{c.id}' without lexical or alias overlap in Semantic Layer.",
                    }
                )
    return warnings


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

    failures.extend(validate_semantic_jargon_alignment(extraction, seed_ontology))

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
        inj = detect_prompt_injection(claim.statement) + detect_prompt_injection(
            claim.evidence.exact_quote if claim.evidence else ""
        )
        if inj:
            claim.evidence.mechanical_verified = False
            return False, inj[0]
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
