"""
Knowledge Store for Project IDEA Backend Tier.
Maintains canonical concepts, relations, living wiki claims, pending ChangeSets, and pipeline traces.
"""
import json
import os
from pathlib import Path
from typing import Dict, Optional

try:
    from backend.schemas import Concept, Relation, FactClaim, ChangeSet, VerificationStatus
except ImportError:
    from schemas import Concept, Relation, FactClaim, ChangeSet, VerificationStatus


class KnowledgeStore:
    def __init__(self, seed_path: Optional[str] = None):
        self.seed_path = self._resolve_seed_path(seed_path)
        self.concepts: Dict[str, Concept] = {}
        self.relations: Dict[str, Relation] = {}
        self.claims: Dict[str, FactClaim] = {}
        self.changesets: Dict[str, ChangeSet] = {}
        self.traces: Dict[str, Dict] = {}
        self._load_seed()

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
            for c in data.get("concepts", []):
                self.concepts[c["id"]] = Concept(**c)
            for r in data.get("relations", []):
                self.relations[r["id"]] = Relation(**r)
            for cl in data.get("claims", []):
                self.claims[cl["id"]] = FactClaim(**cl)

    def get_state(self) -> Dict:
        return {
            "concepts": [c.model_dump() for c in self.concepts.values()],
            "relations": [r.model_dump() for r in self.relations.values()],
            "claims": [cl.model_dump() for cl in self.claims.values()],
            "pending_changesets": [cs.model_dump() for cs in self.changesets.values() if cs.status == "PENDING"],
            "all_changesets": [cs.model_dump() for cs in self.changesets.values()],
        }

    def add_changeset(self, cs: ChangeSet, trace: Optional[Dict] = None):
        self.changesets[cs.id] = cs
        if trace is not None:
            self.traces[cs.id] = trace

    def get_changeset(self, cs_id: str) -> Optional[ChangeSet]:
        return self.changesets.get(cs_id)

    def approve_changeset(self, cs_id: str) -> Optional[ChangeSet]:
        cs = self.changesets.get(cs_id)
        if not cs:
            return None
        cs.status = "APPROVED"

        # Assimilate concepts into graph
        for c in cs.proposed_concepts:
            c.status = VerificationStatus.VERIFIED
            c.layer = "graph"
            self.concepts[c.id] = c

        # Assimilate relations
        for r in cs.proposed_relations:
            r.status = VerificationStatus.VERIFIED
            self.relations[r.id] = r

        # Assimilate proposed claims (only verified/proposed claims; unresolved conflicts remain in cs.unresolved_conflicts)
        for cl in cs.proposed_claims:
            cl.status = VerificationStatus.VERIFIED
            self.claims[cl.id] = cl

        return cs

    def reject_changeset(self, cs_id: str) -> Optional[ChangeSet]:
        cs = self.changesets.get(cs_id)
        if not cs:
            return None
        cs.status = "REJECTED"
        return cs

    def reset_to_seed(self):
        self.concepts.clear()
        self.relations.clear()
        self.claims.clear()
        self.changesets.clear()
        self.traces.clear()
        self._load_seed()
