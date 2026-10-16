"""
Data models for Project IDEA: Autonomous Knowledge Assimilation Engine.
Adheres to Pydantic v2 and strict verification status semantics.
"""
from enum import Enum
from typing import List, Optional, Dict, Any
from pydantic import BaseModel, Field

class VerificationStatus(str, Enum):
    VERIFIED = "VERIFIED"        # Verified against domain and exact source evidence
    PROPOSED = "PROPOSED"        # Novel concept or relation, waiting for user review
    UNRESOLVED = "UNRESOLVED"    # Contradiction or ambiguity detected, requires human decision
    REJECTED = "REJECTED"        # Disproven or explicitly rejected by user

class AlignmentAction(str, Enum):
    MATCH = "MATCH"              # Maps to canonical concept in seed ontology
    PROPOSE = "PROPOSE"          # Novel concept requiring graph expansion
    UNRESOLVED = "UNRESOLVED"    # Conflicting definition requiring resolution

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

class AssimilationExtraction(BaseModel):
    aligned_concepts: List[Dict[str, Any]] = Field(
        default_factory=list,
        description="Concepts extracted with action: MATCH, PROPOSE, or UNRESOLVED"
    )
    extracted_relations: List[Dict[str, Any]] = Field(
        default_factory=list,
        description="Extracted relational triples"
    )
    claims: List[Dict[str, Any]] = Field(
        default_factory=list,
        description="Factual claims with exact source evidence quote"
    )
    rationale: str = Field(..., description="Reasoning for alignment and conflict detection")
