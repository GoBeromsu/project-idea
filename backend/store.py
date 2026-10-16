import json
import os
import re
from pathlib import Path
from typing import Any, Dict, List, Optional

try:
    from backend.schemas import Concept, Relation, FactClaim, ChangeSet, VerificationStatus
except ImportError:
    from schemas import Concept, Relation, FactClaim, ChangeSet, VerificationStatus


def _normalize_for_match(text: str) -> str:
    if not text:
        return ""
    s = (
        text.replace("\u201c", '"')
        .replace("\u201d", '"')
        .replace("\u2018", "'")
        .replace("\u2019", "'")
        .replace("\u2014", "-")
        .replace("\u2013", "-")
    )
    return re.sub(r"\s+", " ", s).strip()


def verify_quote_in_source_text(source_text: str, quote: str) -> bool:
    if not source_text or not quote:
        return False

    norm_source = _normalize_for_match(source_text)
    norm_quote = _normalize_for_match(quote)

    if len(norm_quote) < 8 or not norm_source:
        return False

    if norm_quote in norm_source:
        return True

    lower_source = norm_source.lower()
    lower_quote = norm_quote.lower()
    if lower_quote in lower_source:
        return True

    stripped_quote = lower_quote.strip(" \"'.,;:!?()[]{}-")
    if len(stripped_quote) >= 8 and stripped_quote in lower_source:
        return True

    return False


def _normalize_jargon_key(text: str) -> str:
    if not text:
        return ""
    cleaned = re.sub(r"\([^)]*\)", " ", text)
    return re.sub(r"[^a-z0-9]+", "", cleaned.lower())


class KnowledgeStore:
    def __init__(self, seed_path: Optional[str] = None):
        self.seed_path = self._resolve_seed_path(seed_path)
        self.concepts: Dict[str, Concept] = {}
        self.relations: Dict[str, Relation] = {}
        self.claims: Dict[str, FactClaim] = {}
        self.changesets: Dict[str, ChangeSet] = {}
        self.changeset_sources: Dict[str, str] = {}
        self.traces: Dict[str, Dict] = {}
        self._load_seed()

    def resolve_canonical_concept(self, name_or_synonym: str, synonyms: Optional[List[str]] = None) -> Optional[Concept]:
        candidates = [name_or_synonym] + list(synonyms or [])
        norm_targets = {_normalize_jargon_key(x) for x in candidates if _normalize_jargon_key(x)}
        if not norm_targets:
            return None
        for concept in self.concepts.values():
            keys = {_normalize_jargon_key(concept.name), _normalize_jargon_key(concept.id)}
            for s in concept.synonyms:
                keys.add(_normalize_jargon_key(s))
            keys.discard("")
            if norm_targets & keys:
                return concept
        return None

    @staticmethod
    def _resolve_seed_path(seed_path: Optional[str] = None) -> str:
        if seed_path and os.path.exists(seed_path):
            return seed_path
        candidates = [
            Path(__file__).resolve().parent / "seed_domain.json",
            Path("backend/seed_domain.json"),
            Path("seed_domain.json"),
        ]
        for candidate in candidates:
            if candidate.exists():
                return str(candidate)
        return seed_path or str(Path(__file__).resolve().parent / "seed_domain.json")

    def _load_seed(self):
        if os.path.exists(self.seed_path):
            with open(self.seed_path, "r", encoding="utf-8") as f:
                data = json.load(f)
            for c_raw in data.get("concepts", []):
                concept = Concept(**c_raw)
                concept.is_seed = True
                if not concept.verification_badges:
                    concept.verification_badges = ["Seed knowledge"]
                elif "Seed knowledge" not in concept.verification_badges:
                    concept.verification_badges.insert(0, "Seed knowledge")
                self.concepts[concept.id] = concept

            for r_raw in data.get("relations", []):
                rel = Relation(**r_raw)
                self.relations[rel.id] = rel

            for cl_raw in data.get("claims", []):
                claim = FactClaim(**cl_raw)
                claim.is_seed = True
                if not claim.verification_badges:
                    claim.verification_badges = ["Seed knowledge"]
                elif "Seed knowledge" not in claim.verification_badges:
                    claim.verification_badges.insert(0, "Seed knowledge")
                self.claims[claim.id] = claim

    def get_seed_ontology(self) -> Dict[str, Any]:
        return {
            "concepts": [c.model_dump() for c in self.concepts.values()],
            "relations": [r.model_dump() for r in self.relations.values()],
        }

    def get_state(self) -> Dict[str, Any]:
        jargon_count = sum(1 for c in self.concepts.values() if c.node_type == "TERM")
        concept_count = sum(1 for c in self.concepts.values() if c.node_type == "CONCEPT")
        entity_count = sum(1 for c in self.concepts.values() if c.node_type == "ENTITY")
        wiki_claim_count = len(self.claims)
        return {
            "concepts": [c.model_dump() for c in self.concepts.values()],
            "relations": [r.model_dump() for r in self.relations.values()],
            "claims": [cl.model_dump() for cl in self.claims.values()],
            "pending_changesets": [cs.model_dump() for cs in self.changesets.values() if cs.status == "PENDING"],
            "all_changesets": [cs.model_dump() for cs in self.changesets.values()],
            "rings_count": 4,
            "layer_counts": {
                "jargon": jargon_count,
                "concepts": concept_count,
                "entities": entity_count,
                "wiki": wiki_claim_count,
            },
        }

    def add_changeset(
        self,
        cs: ChangeSet,
        source_text: Optional[str] = None,
        trace: Optional[Dict[str, Any]] = None,
    ) -> ChangeSet:
        if isinstance(source_text, dict) and trace is None:
            trace = source_text
            source_text = None

        if isinstance(source_text, str):
            self.changeset_sources[cs.id] = source_text

        id_remap: Dict[str, str] = {}
        for c in cs.proposed_concepts:
            if c.status == VerificationStatus.UNRESOLVED or c.action == "UNRESOLVED":
                continue
            matched = self.resolve_canonical_concept(c.name, c.synonyms)
            if matched and matched.id != c.id:
                if matched.node_type == c.node_type or c.action == "MATCH":
                    id_remap[c.id] = matched.id
                    c.id = matched.id
                    c.action = "MATCH"

        if id_remap:
            for cl in cs.proposed_claims:
                if cl.concept_id in id_remap:
                    cl.concept_id = id_remap[cl.concept_id]
            for r in cs.proposed_relations:
                if r.source_id in id_remap:
                    r.source_id = id_remap[r.source_id]
                if r.target_id in id_remap:
                    r.target_id = id_remap[r.target_id]

        verified_proposed: List[FactClaim] = []
        blocked_ids = {b.id for b in cs.blocked_claims}
        unresolved_ids = {u.id for u in cs.unresolved_conflicts}

        for cl in list(cs.proposed_claims):
            quote = cl.evidence.exact_quote if cl.evidence else ""
            if source_text is not None:
                quote_ok = verify_quote_in_source_text(source_text, quote)
            else:
                quote_ok = bool(cl.evidence and cl.evidence.mechanical_verified) and (
                    cl.status != VerificationStatus.REJECTED
                )

            if not quote_ok:
                if cl.evidence:
                    cl.evidence.mechanical_verified = False
                cl.status = VerificationStatus.REJECTED
                cl.verification_badges = ["Blocked"]
                if cl.id not in blocked_ids:
                    cs.blocked_claims.append(cl)
                    blocked_ids.add(cl.id)
            elif cl.status == VerificationStatus.UNRESOLVED or len(cl.conflicts_with or []) > 0:
                if cl.evidence:
                    cl.evidence.mechanical_verified = True
                cl.status = VerificationStatus.UNRESOLVED
                cl.verification_badges = ["Source located", "Needs review"]
                if cl.id not in unresolved_ids:
                    cs.unresolved_conflicts.append(cl)
                    unresolved_ids.add(cl.id)
            else:
                if cl.evidence:
                    cl.evidence.mechanical_verified = True
                cl.status = VerificationStatus.PROPOSED
                required_badges = ["Source located", "Quote matched", "Model-reviewed"]
                for badge in required_badges:
                    if badge not in cl.verification_badges:
                        cl.verification_badges.append(badge)
                verified_proposed.append(cl)

        cs.proposed_claims = verified_proposed

        retained_unresolved: List[FactClaim] = []
        for u_cl in list(cs.unresolved_conflicts):
            quote = u_cl.evidence.exact_quote if u_cl.evidence else ""
            if source_text is not None and not verify_quote_in_source_text(source_text, quote):
                if u_cl.evidence:
                    u_cl.evidence.mechanical_verified = False
                u_cl.status = VerificationStatus.REJECTED
                u_cl.verification_badges = ["Blocked"]
                if u_cl.id not in blocked_ids:
                    cs.blocked_claims.append(u_cl)
                    blocked_ids.add(u_cl.id)
            else:
                if source_text is not None and u_cl.evidence:
                    u_cl.evidence.mechanical_verified = True
                u_cl.status = VerificationStatus.UNRESOLVED
                if not u_cl.verification_badges:
                    u_cl.verification_badges = ["Source located", "Needs review"]
                retained_unresolved.append(u_cl)

        cs.unresolved_conflicts = retained_unresolved

        for b_cl in cs.blocked_claims:
            if b_cl.evidence:
                b_cl.evidence.mechanical_verified = False
            b_cl.status = VerificationStatus.REJECTED
            b_cl.verification_badges = ["Blocked"]

        self.changesets[cs.id] = cs
        if trace is not None:
            self.traces[cs.id] = trace
        return cs

    def get_changeset(self, cs_id: str) -> Optional[ChangeSet]:
        return self.changesets.get(cs_id)

    def approve_changeset(
        self,
        cs_id: str,
        concept_ids: Optional[List[str]] = None,
        relation_ids: Optional[List[str]] = None,
        claim_ids: Optional[List[str]] = None,
    ) -> ChangeSet:
        if cs_id not in self.changesets:
            raise KeyError(f"ChangeSet {cs_id} not found")

        cs = self.changesets[cs_id]
        if cs.status == "APPROVED":
            return cs
        if cs.status == "REJECTED":
            raise ValueError(f"ChangeSet {cs_id} was already rejected and cannot be approved")

        unresolved_claim_ids = {cl.id for cl in cs.unresolved_conflicts}
        blocked_claim_ids = {cl.id for cl in cs.blocked_claims}
        proposed_claim_map = {cl.id: cl for cl in cs.proposed_claims}

        if claim_ids is not None:
            for requested_cid in claim_ids:
                if (
                    requested_cid in unresolved_claim_ids
                    or requested_cid in blocked_claim_ids
                    or requested_cid not in proposed_claim_map
                ):
                    raise ValueError("Cannot approve unverified, blocked, or unresolved claims")
            selected_claims = [cl for cl in cs.proposed_claims if cl.id in set(claim_ids)]
        else:
            selected_claims = list(cs.proposed_claims)

        stored_source = self.changeset_sources.get(cs_id)
        for cl in selected_claims:
            if (
                not cl.evidence
                or not cl.evidence.mechanical_verified
                or cl.status in (VerificationStatus.UNRESOLVED, VerificationStatus.REJECTED)
                or len(cl.conflicts_with or []) > 0
            ):
                raise ValueError("Cannot approve unverified, blocked, or unresolved claims")
            if stored_source is not None and not verify_quote_in_source_text(stored_source, cl.evidence.exact_quote):
                raise ValueError("Cannot approve unverified, blocked, or unresolved claims")

        proposed_concept_map = {c.id: c for c in cs.proposed_concepts}
        if concept_ids is not None:
            for requested_con_id in concept_ids:
                if requested_con_id not in proposed_concept_map and requested_con_id not in self.concepts:
                    raise ValueError(f"Unknown concept ID in approval: {requested_con_id}")
            selected_concepts = [c for c in cs.proposed_concepts if c.id in set(concept_ids)]
            for c in selected_concepts:
                if c.status == VerificationStatus.UNRESOLVED or c.action == "UNRESOLVED":
                    raise ValueError("Cannot approve unresolved concepts")
        else:
            selected_concepts = [
                c
                for c in cs.proposed_concepts
                if c.status != VerificationStatus.UNRESOLVED and c.action != "UNRESOLVED"
            ]

        proposed_relation_map = {r.id: r for r in cs.proposed_relations}
        if relation_ids is not None:
            for requested_rel_id in relation_ids:
                if requested_rel_id not in proposed_relation_map:
                    raise ValueError(f"Unknown relation ID in approval: {requested_rel_id}")
            selected_relations = [r for r in cs.proposed_relations if r.id in set(relation_ids)]
        else:
            selected_relations = list(cs.proposed_relations)

        selected_concept_ids = {c.id for c in selected_concepts}

        for cl in selected_claims:
            ref_id = cl.concept_id
            if ref_id not in self.concepts and ref_id not in selected_concept_ids:
                if ref_id in proposed_concept_map:
                    cand = proposed_concept_map[ref_id]
                    if cand.status == VerificationStatus.UNRESOLVED or cand.action == "UNRESOLVED":
                        raise ValueError("Dangling concept reference in ChangeSet approval")
                    selected_concepts.append(cand)
                    selected_concept_ids.add(cand.id)
                else:
                    raise ValueError("Dangling concept reference in ChangeSet approval")

        for r in selected_relations:
            for endpoint_id in (r.source_id, r.target_id):
                if endpoint_id not in self.concepts and endpoint_id not in selected_concept_ids:
                    if endpoint_id in proposed_concept_map:
                        cand = proposed_concept_map[endpoint_id]
                        if cand.status == VerificationStatus.UNRESOLVED or cand.action == "UNRESOLVED":
                            raise ValueError("Dangling concept reference in ChangeSet approval")
                        selected_concepts.append(cand)
                        selected_concept_ids.add(cand.id)
                    else:
                        raise ValueError("Dangling concept reference in ChangeSet approval")

        for c in selected_concepts:
            if c.id in self.concepts:
                existing = self.concepts[c.id]
                merged_syns = list(existing.synonyms)
                for syn in c.synonyms:
                    if syn and syn not in merged_syns and syn.lower() != existing.name.lower():
                        merged_syns.append(syn)
                existing.synonyms = merged_syns
                if not existing.description and c.description:
                    existing.description = c.description
                if "Added to this session" not in existing.verification_badges:
                    existing.verification_badges.append("Added to this session")
            else:
                c.status = VerificationStatus.VERIFIED
                c.is_seed = False
                if not c.layer or c.layer == "domain":
                    c.layer = "graph"
                if "Added to this session" not in c.verification_badges:
                    c.verification_badges.append("Added to this session")
                self.concepts[c.id] = c

        for r in selected_relations:
            r.status = VerificationStatus.VERIFIED
            self.relations[r.id] = r

        for cl in selected_claims:
            cl.status = VerificationStatus.VERIFIED
            cl.is_seed = False
            if "Added to this session" not in cl.verification_badges:
                cl.verification_badges.append("Added to this session")
            self.claims[cl.id] = cl

        cs.status = "APPROVED"
        return cs

    def reject_changeset(self, cs_id: str) -> ChangeSet:
        if cs_id not in self.changesets:
            raise KeyError(f"ChangeSet {cs_id} not found")
        cs = self.changesets[cs_id]
        if cs.status == "APPROVED":
            raise ValueError(f"ChangeSet {cs_id} was already approved and cannot be rejected")
        cs.status = "REJECTED"
        return cs

    def reset_to_seed(self):
        self.concepts.clear()
        self.relations.clear()
        self.claims.clear()
        self.changesets.clear()
        self.changeset_sources.clear()
        self.traces.clear()
        self._load_seed()
