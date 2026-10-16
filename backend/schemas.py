from enum import Enum
from typing import List, Optional
from pydantic import BaseModel, Field


class VerificationStatus(str, Enum):
    VERIFIED = "VERIFIED"
    PROPOSED = "PROPOSED"
    UNRESOLVED = "UNRESOLVED"
    REJECTED = "REJECTED"


class AlignmentAction(str, Enum):
    MATCH = "MATCH"
    PROPOSE = "PROPOSE"
    UNRESOLVED = "UNRESOLVED"


class SourceEvidence(BaseModel):
    url: Optional[str] = Field(None, description="Source URL or document identifier")
    title: Optional[str] = Field(None, description="Document title")
    section_anchor: Optional[str] = Field(None, description="Header, paragraph anchor or section title")
    exact_quote: str = Field(..., description="Exact verbatim quote span from the source")
    mechanical_verified: bool = Field(False, description="True if verbatim quote verified against raw source text")


class Concept(BaseModel):
    id: str = Field(..., description="Canonical ID (e.g. concept_mcts)")
    name: str = Field(..., description="Canonical human-readable name")
    synonyms: List[str] = Field(default_factory=list, description="Known aliases/synonyms")
    description: str = Field(..., description="Concise definition")
    status: VerificationStatus = Field(VerificationStatus.VERIFIED)
    layer: str = Field("domain", description="Layer in 3D visualization: 'domain' or 'graph'")
    evidence: Optional[SourceEvidence] = None


class Relation(BaseModel):
    id: str = Field(..., description="Unique relation identifier")
    source_id: str = Field(..., description="Source concept ID")
    target_id: str = Field(..., description="Target concept ID")
    predicate: str = Field(..., description="Relationship predicate (e.g. uses, extends, contradicts)")
    description: Optional[str] = None
    status: VerificationStatus = Field(VerificationStatus.VERIFIED)
    evidence: Optional[SourceEvidence] = None


class FactClaim(BaseModel):
    id: str = Field(..., description="Claim identifier")
    concept_id: str = Field(..., description="Associated canonical concept ID")
    statement: str = Field(..., description="Factual claim statement")
    status: VerificationStatus = Field(VerificationStatus.PROPOSED)
    evidence: SourceEvidence
    conflicts_with: Optional[List[str]] = Field(default_factory=list, description="IDs of contradicting existing claims")


class ChangeSet(BaseModel):
    id: str = Field(..., description="ChangeSet identifier (e.g. cs_101)")
    source_title: str
    proposed_concepts: List[Concept] = Field(default_factory=list)
    proposed_relations: List[Relation] = Field(default_factory=list)
    proposed_claims: List[FactClaim] = Field(default_factory=list)
    unresolved_conflicts: List[FactClaim] = Field(default_factory=list)
    status: str = Field("PENDING", description="PENDING, APPROVED, REJECTED")
    created_at: Optional[str] = None


class PipelineTrace(BaseModel):
    turn1_interaction_id: str
    turn2_interaction_id: Optional[str] = None
    self_corrected: bool = False
    initial_failures_count: int = 0
    thought_summaries: List[str] = Field(default_factory=list)


class AssimilateRequest(BaseModel):
    text: Optional[str] = None
    url: Optional[str] = None
    title: Optional[str] = "Pasted Technical Note"
