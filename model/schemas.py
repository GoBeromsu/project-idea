from enum import Enum
from typing import List, Optional, Dict, Any
from pydantic import BaseModel, Field


class _AwaitableModelMixin:
    def __await__(self):
        async def _coro():
            return self

        return _coro().__await__()


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


class ChangeSet(BaseModel, _AwaitableModelMixin):
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


class ExtractedConcept(BaseModel):
    id: Optional[str] = Field(None, description="Existing concept ID if MATCH, or proposed ID if PROPOSE")
    name: str = Field(..., description="Canonical or proposed concept name")
    action: str = Field("PROPOSE", description="MATCH, PROPOSE, or UNRESOLVED")
    node_type: str = Field("CONCEPT", description="TERM, CONCEPT, or ENTITY")
    synonyms: List[str] = Field(default_factory=list)
    description: str = Field("", description="Definition of concept")
    alignment_reason: Optional[str] = Field(None, description="Reasoning for MATCH, PROPOSE, or UNRESOLVED")


class ExtractedRelation(BaseModel):
    source_id: str = Field(..., description="Source concept ID")
    target_id: str = Field(..., description="Target concept ID")
    predicate: str = Field(..., description="Relation predicate, e.g. uses, implements_via")
    description: Optional[str] = None


class ExtractedEvidence(BaseModel):
    section_anchor: str = Field("Introduction", description="Section or header name")
    exact_quote: str = Field(..., description="EXACT verbatim substring from source text")


class ExtractedClaim(BaseModel):
    concept_id: str = Field(..., description="Associated concept ID")
    statement: str = Field(..., description="Concise factual statement")
    conditions: Optional[str] = Field(None, description="Conditions or experimental scope for the claim")
    status: Optional[str] = Field("PROPOSED", description="PROPOSED or UNRESOLVED")
    conflicts_with: Optional[List[str]] = Field(default_factory=list, description="IDs of existing conflicting claims")
    conflict_reason: Optional[str] = Field(None, description="Explanation if status is UNRESOLVED or conflicting")
    evidence: ExtractedEvidence = Field(..., description="Verbatim quote citation")


class AssimilationExtraction(BaseModel):
    answer: Optional[str] = Field(None, description="Direct grounded answer to the user's question")
    aligned_concepts: List[ExtractedConcept] = Field(default_factory=list)
    extracted_relations: List[ExtractedRelation] = Field(default_factory=list)
    claims: List[ExtractedClaim] = Field(default_factory=list)
    rationale: str = Field(..., description="Reasoning for alignment and conflict detection")


class VerifyQuoteRequest(BaseModel):
    source_text: str
    quote: str
    strict: bool = False


class VerifyQuoteResponse(BaseModel):
    valid: bool
    error: Optional[str] = None


class ExtractRequest(BaseModel):
    doc_data: Dict[str, Any]
    seed_ontology: Dict[str, Any]
    existing_claims: List[FactClaim] = Field(default_factory=list)
    question: Optional[str] = None


class ExtractResponse(BaseModel, _AwaitableModelMixin):
    interaction_id: str
    extraction: AssimilationExtraction
    thought_summaries: List[str] = Field(default_factory=list)
    validation_failures: List[Dict[str, Any]] = Field(default_factory=list)


class CorrectRequest(BaseModel):
    previous_interaction_id: str
    source_text: str
    validation_failures: List[Dict[str, Any]]
    question: Optional[str] = None


class CorrectResponse(BaseModel, _AwaitableModelMixin):
    interaction_id: str
    extraction: AssimilationExtraction
    thought_summaries: List[str] = Field(default_factory=list)
    validation_failures: List[Dict[str, Any]] = Field(default_factory=list)


class BuildChangeSetRequest(BaseModel):
    doc_data: Dict[str, Any]
    extraction: AssimilationExtraction
    question: Optional[str] = None
    seed_ontology: Optional[Dict[str, Any]] = None


class PipelineTrace(BaseModel):
    turn1_interaction_id: str
    turn2_interaction_id: Optional[str] = None
    self_corrected: bool = False
    initial_failures_count: int = 0
    remaining_failures_count: int = 0
    thought_summaries: List[str] = Field(default_factory=list)
    execution_stage: str = "Complete"


class AssimilatePipelineResponse(BaseModel, _AwaitableModelMixin):
    changeset: ChangeSet
    pipeline_trace: PipelineTrace


class QueryCitation(BaseModel):
    node_id: str
    label: str
    node_type: str = "CONCEPT"
    source_url: Optional[str] = None
    source_title: Optional[str] = None
    section_anchor: Optional[str] = None
    exact_quote: Optional[str] = None
    is_seed: bool = False


class ModelQueryRequest(BaseModel):
    question: str
    seed_ontology: Dict[str, Any]
    existing_claims: List[FactClaim] = Field(default_factory=list)


class ModelQueryResponse(BaseModel, _AwaitableModelMixin):
    question: str
    answer: str
    citations: List[QueryCitation] = Field(default_factory=list)
    referenced_concept_ids: List[str] = Field(default_factory=list)
    referenced_claim_ids: List[str] = Field(default_factory=list)
    interaction_id: Optional[str] = None
    thought_summaries: List[str] = Field(default_factory=list)
    mutated_wiki: bool = False
