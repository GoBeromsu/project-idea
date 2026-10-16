from enum import Enum
from typing import List, Optional, Dict, Any
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


class NodeType(str, Enum):
    TERM = "TERM"
    CONCEPT = "CONCEPT"
    ENTITY = "ENTITY"
    CLAIM = "CLAIM"
    SOURCE = "SOURCE"


class SourceEvidence(BaseModel):
    url: Optional[str] = Field(None, description="Source URL or document identifier")
    resolved_url: Optional[str] = Field(None, description="Resolved final URL after redirects")
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
    node_type: str = Field("CONCEPT", description="TERM, CONCEPT, or ENTITY")
    action: Optional[str] = Field(None, description="MATCH, PROPOSE, or UNRESOLVED")
    alignment_reason: Optional[str] = Field(None, description="Explanation for canonical alignment or new proposal")
    is_seed: bool = Field(False, description="True if pre-seeded in initial domain knowledge")
    verification_badges: List[str] = Field(default_factory=list)
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
    conditions: Optional[str] = Field(None, description="Conditions or experimental scope for the claim")
    status: VerificationStatus = Field(VerificationStatus.PROPOSED)
    evidence: SourceEvidence
    conflicts_with: Optional[List[str]] = Field(
        default_factory=list, description="IDs of contradicting existing claims"
    )
    conflict_reason: Optional[str] = Field(None, description="Reason for conflict or unresolved status")
    semantic_review_note: Optional[str] = Field(None, description="Argon semantic review note")
    verification_badges: List[str] = Field(default_factory=list)
    is_seed: bool = Field(False, description="True if part of initial seed knowledge")


class ChangeSet(BaseModel):
    id: str = Field(..., description="ChangeSet identifier (e.g. cs_101)")
    source_title: str
    source_url: Optional[str] = None
    resolved_url: Optional[str] = None
    question: Optional[str] = None
    answer: Optional[str] = None
    rationale: Optional[str] = None
    proposed_concepts: List[Concept] = Field(default_factory=list)
    proposed_relations: List[Relation] = Field(default_factory=list)
    proposed_claims: List[FactClaim] = Field(default_factory=list)
    unresolved_conflicts: List[FactClaim] = Field(default_factory=list)
    blocked_claims: List[FactClaim] = Field(default_factory=list)
    status: str = Field("PENDING", description="PENDING, APPROVED, REJECTED")
    created_at: Optional[str] = None


class PipelineTrace(BaseModel):
    turn1_interaction_id: str
    turn2_interaction_id: Optional[str] = None
    self_corrected: bool = False
    initial_failures_count: int = 0
    remaining_failures_count: int = 0
    thought_summaries: List[str] = Field(default_factory=list)
    execution_stage: str = "Complete"
    flash_scan_interaction_id: Optional[str] = None
    jargon_candidates: List[Any] = Field(default_factory=list)
    adversarial_flags: List[Dict[str, Any]] = Field(default_factory=list)
    layer_distribution: Dict[str, int] = Field(default_factory=dict)


class JargonScanRequest(BaseModel):
    text: Optional[str] = None
    url: Optional[str] = None
    title: Optional[str] = "Jargon Scan"


class AssimilateRequest(BaseModel):
    text: Optional[str] = None
    url: Optional[str] = None
    title: Optional[str] = "Pasted Technical Note"
    question: Optional[str] = None


class ApproveChangeSetRequest(BaseModel):
    concept_ids: Optional[List[str]] = None
    relation_ids: Optional[List[str]] = None
    claim_ids: Optional[List[str]] = None


class QueryCitation(BaseModel):
    node_id: str
    label: str
    node_type: str = "CONCEPT"
    source_url: Optional[str] = None
    source_title: Optional[str] = None
    section_anchor: Optional[str] = None
    exact_quote: Optional[str] = None
    is_seed: bool = False


class QueryRequest(BaseModel):
    question: str


class QueryResponse(BaseModel):
    question: str
    answer: str
    citations: List[QueryCitation] = Field(default_factory=list)
    referenced_concept_ids: List[str] = Field(default_factory=list)
    referenced_claim_ids: List[str] = Field(default_factory=list)
    interaction_id: Optional[str] = None
    thought_summaries: List[str] = Field(default_factory=list)
    mutated_wiki: bool = False
