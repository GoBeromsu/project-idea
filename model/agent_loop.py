"""
Gemini 4 Argon Knowledge Assimilation Agent Loop (Model Tier).
Implements the 4-stage pipeline: Ingest -> Align -> Assimilate -> Verify.
Utilizes the Google GenAI Interactions API with previous_interaction_id for self-correction.
"""
import os
import json
import logging
from typing import Dict, Any, List, Optional, Union
from google import genai

try:
    from model.schemas import (
        Concept,
        Relation,
        FactClaim,
        SourceEvidence,
        ChangeSet,
        VerificationStatus,
        AlignmentAction,
        AssimilationExtraction,
        ExtractResponse,
        CorrectResponse,
        PipelineTrace,
        AssimilatePipelineResponse,
    )
    from model.validator import EvidenceValidator
except ImportError:
    from schemas import (
        Concept,
        Relation,
        FactClaim,
        SourceEvidence,
        ChangeSet,
        VerificationStatus,
        AlignmentAction,
        AssimilationExtraction,
        ExtractResponse,
        CorrectResponse,
        PipelineTrace,
        AssimilatePipelineResponse,
    )
    from validator import EvidenceValidator

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """You are the Project IDEA Knowledge Assimilation Engine.
Your mission is to assimilate new technical knowledge into a canonical Knowledge Graph while rigorously preventing:
1. Concept Fragmentation (unnecessarily creating duplicate concepts when an existing canonical concept matches).
2. Hallucinated Citations (every claim MUST cite a verbatim exact quote from the source text).
3. Silent Overwrite (any contradiction against existing knowledge must be flagged as UNRESOLVED).

Rules:
- For every concept found in the source:
  - If it is synonymous with or identical to an existing concept in the domain ontology, mark action as "MATCH" and use the existing concept ID.
  - If it is genuinely novel, mark action as "PROPOSE", generate a canonical ID prefixed with 'concept_', name, and synonyms.
  - If ambiguous or conflicting, mark as "UNRESOLVED".
- For every fact claim:
  - You MUST provide `exact_quote` which is an EXACT verbatim substring from the source text.
  - Include the `section_anchor`.
  - Check if it contradicts any existing verified claim in the Knowledge Graph. If it contradicts, flag status as "UNRESOLVED" and note the conflict in `conflicts_with`.
- Return valid JSON matching the schema."""


from dotenv import load_dotenv

load_dotenv()

class AssimilationEngine:
    def __init__(self, api_key: Optional[str] = None):
        self.api_key = api_key or os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY") or "placeholder-key"
        self.client = genai.Client(api_key=self.api_key)

    @staticmethod
    def _extract_thought_summaries(interaction: Any) -> List[str]:
        """Extracts thought summaries from interaction.steps where step.type == 'thought'."""
        summaries: List[str] = []
        steps = getattr(interaction, "steps", None) or []
        for step in steps:
            if getattr(step, "type", None) == "thought":
                for block in (getattr(step, "summary", None) or []):
                    if getattr(block, "type", None) == "text":
                        text = getattr(block, "text", None)
                        if text:
                            summaries.append(text)
        return summaries

    @staticmethod
    def _parse_extraction(raw_output: str) -> AssimilationExtraction:
        """Parses structured JSON output using Pydantic v2 model_validate_json with fallback."""
        try:
            return AssimilationExtraction.model_validate_json(raw_output)
        except Exception:
            return AssimilationExtraction.model_validate(json.loads(raw_output))

    @staticmethod
    def _validate_extraction_quotes(
        extraction: AssimilationExtraction,
        source_text: str,
    ) -> List[Dict[str, Any]]:
        """Runs deterministic mechanical quote validation over extracted claims."""
        validation_failures: List[Dict[str, Any]] = []
        for claim in extraction.claims:
            quote = claim.evidence.exact_quote if claim.evidence else ""
            valid, err = EvidenceValidator.verify_quote(source_text, quote)
            if not valid:
                validation_failures.append({
                    "claim": claim.statement,
                    "bad_quote": quote,
                    "error": err,
                })
        return validation_failures

    def extract_turn1(
        self,
        doc_data: Dict[str, Any],
        seed_ontology: Dict[str, Any],
        existing_claims: Optional[List[Union[FactClaim, Dict[str, Any]]]] = None,
    ) -> ExtractResponse:
        """
        Turn 1: Runs Gemini 4 Argon extraction via Interactions API and performs mechanical quote verification.
        """
        existing_claims = existing_claims or []
        source_text = doc_data["full_text"]
        title = doc_data.get("title", "Untitled Document")
        url = doc_data.get("url", "local://input")

        domain_summary = [
            {
                "id": c["id"] if isinstance(c, dict) else c.id,
                "name": c["name"] if isinstance(c, dict) else c.name,
                "synonyms": (c.get("synonyms", []) if isinstance(c, dict) else c.synonyms),
                "description": c["description"] if isinstance(c, dict) else c.description,
            }
            for c in seed_ontology.get("concepts", [])
        ]
        claims_summary = [
            {
                "id": cl["id"] if isinstance(cl, dict) else cl.id,
                "concept_id": cl["concept_id"] if isinstance(cl, dict) else cl.concept_id,
                "statement": cl["statement"] if isinstance(cl, dict) else cl.statement,
            }
            for cl in existing_claims
        ]

        turn1_prompt = f"""
Existing Domain Ontology Concepts:
{json.dumps(domain_summary, indent=2)}

Existing Verified Claims in Living Wiki:
{json.dumps(claims_summary, indent=2)}

Source Document:
Title: {title}
URL: {url}
Content:
\"\"\"{source_text}\"\"\"

Task:
Extract technical concepts, relations, and claims.
For each claim, provide an EXACT verbatim quote from the content.
Align concepts to Existing Domain Ontology Concepts (MATCH) or PROPOSE new ones.
Flag any contradictions with Existing Verified Claims as UNRESOLVED.
"""

        interaction = self.client.interactions.create(
            model="gemini-4-argon",
            input=turn1_prompt,
            system_instruction=SYSTEM_PROMPT,
            generation_config={
                "thinking_level": "medium",
                "thinking_summaries": "auto",
            },
            response_format={
                "type": "text",
                "mime_type": "application/json",
                "schema": AssimilationExtraction.model_json_schema(),
            },
        )

        interaction_id = getattr(interaction, "id", "") or ""
        extraction = self._parse_extraction(interaction.output_text)
        thought_summaries = self._extract_thought_summaries(interaction)
        validation_failures = self._validate_extraction_quotes(extraction, source_text)

        return ExtractResponse(
            interaction_id=interaction_id,
            extraction=extraction,
            thought_summaries=thought_summaries,
            validation_failures=validation_failures,
        )

    def correct_turn2(
        self,
        previous_interaction_id: str,
        source_text: str,
        validation_failures: List[Dict[str, Any]],
    ) -> CorrectResponse:
        """
        Turn 2: Stateful self-correction via previous_interaction_id when mechanical quote validation fails.
        Re-specifies interaction-scoped parameters (system_instruction, generation_config, response_format).
        """
        logger.warning(
            f"Mechanical validation failed for {len(validation_failures)} quotes. "
            f"Triggering Argon self-correction on interaction {previous_interaction_id}."
        )
        correction_prompt = f"""
CRITICAL MECHANICAL VERIFICATION ERROR:
The following quotes failed verbatim matching against the source text:
{json.dumps(validation_failures, indent=2)}

Please re-examine the source text carefully and regenerate the extraction.
Ensure that EVERY `exact_quote` in `claims` is an EXACT verbatim substring from the source text.
"""
        interaction2 = self.client.interactions.create(
            model="gemini-4-argon",
            previous_interaction_id=previous_interaction_id,
            input=correction_prompt,
            system_instruction=SYSTEM_PROMPT,
            generation_config={
                "thinking_level": "medium",
                "thinking_summaries": "auto",
            },
            response_format={
                "type": "text",
                "mime_type": "application/json",
                "schema": AssimilationExtraction.model_json_schema(),
            },
        )

        interaction2_id = getattr(interaction2, "id", "") or ""
        extraction2 = self._parse_extraction(interaction2.output_text)
        thought_summaries2 = self._extract_thought_summaries(interaction2)
        remaining_failures = self._validate_extraction_quotes(extraction2, source_text)

        return CorrectResponse(
            interaction_id=interaction2_id,
            extraction=extraction2,
            thought_summaries=thought_summaries2,
            validation_failures=remaining_failures,
        )

    def build_changeset(
        self,
        doc_data: Dict[str, Any],
        extraction: Union[AssimilationExtraction, Dict[str, Any]],
    ) -> ChangeSet:
        """
        Constructs a staged ChangeSet from a validated AssimilationExtraction and source doc_data.
        """
        if isinstance(extraction, dict):
            extraction = AssimilationExtraction.model_validate(extraction)

        source_text = doc_data["full_text"]
        title = doc_data.get("title", "Untitled Document")
        url = doc_data.get("url", "local://input")

        proposed_concepts: List[Concept] = []
        for c in extraction.aligned_concepts:
            action = c.action or "PROPOSE"
            status = (
                VerificationStatus.VERIFIED
                if action == "MATCH"
                else (
                    VerificationStatus.UNRESOLVED
                    if action == "UNRESOLVED"
                    else VerificationStatus.PROPOSED
                )
            )
            cid = c.id or f"concept_{(c.name or 'unknown').lower().replace(' ', '_')}"
            proposed_concepts.append(
                Concept(
                    id=cid,
                    name=c.name or "Unknown",
                    synonyms=c.synonyms or [],
                    description=c.description or "",
                    status=status,
                    layer="domain" if action == "MATCH" else "graph",
                )
            )

        proposed_relations: List[Relation] = []
        for idx, r in enumerate(extraction.extracted_relations):
            proposed_relations.append(
                Relation(
                    id=f"rel_{idx}_{r.source_id}_{r.target_id}",
                    source_id=r.source_id or "",
                    target_id=r.target_id or "",
                    predicate=r.predicate or "related_to",
                    description=r.description,
                    status=VerificationStatus.PROPOSED,
                )
            )

        proposed_claims: List[FactClaim] = []
        unresolved_conflicts: List[FactClaim] = []

        for idx, cl in enumerate(extraction.claims):
            quote = cl.evidence.exact_quote if cl.evidence else ""
            section_anchor = (
                cl.evidence.section_anchor
                if (cl.evidence and cl.evidence.section_anchor)
                else "Body"
            )
            valid, _ = EvidenceValidator.verify_quote(source_text, quote)

            ev = SourceEvidence(
                url=url,
                title=title,
                section_anchor=section_anchor,
                exact_quote=quote,
                mechanical_verified=valid,
            )

            is_conflicted = bool(cl.conflicts_with) or cl.status == "UNRESOLVED"
            status = (
                VerificationStatus.UNRESOLVED
                if is_conflicted
                else (
                    VerificationStatus.PROPOSED
                    if valid
                    else VerificationStatus.REJECTED
                )
            )

            claim_obj = FactClaim(
                id=f"claim_{idx}_{cl.concept_id or 'unknown'}",
                concept_id=cl.concept_id or "unknown",
                statement=cl.statement or "",
                status=status,
                evidence=ev,
                conflicts_with=cl.conflicts_with or [],
            )

            if is_conflicted:
                unresolved_conflicts.append(claim_obj)
            else:
                proposed_claims.append(claim_obj)

        changeset_id = f"cs_{abs(hash(title + url)) % 100000}"
        return ChangeSet(
            id=changeset_id,
            source_title=title,
            proposed_concepts=proposed_concepts,
            proposed_relations=proposed_relations,
            proposed_claims=proposed_claims,
            unresolved_conflicts=unresolved_conflicts,
            status="PENDING",
        )

    def assimilate_with_trace(
        self,
        doc_data: Dict[str, Any],
        seed_ontology: Dict[str, Any],
        existing_claims: Optional[List[FactClaim]] = None,
    ) -> AssimilatePipelineResponse:
        """
        Executes full 2-turn assimilation pipeline and returns both the ChangeSet and PipelineTrace.
        """
        existing_claims = existing_claims or []
        source_text = doc_data["full_text"]

        turn1_res = self.extract_turn1(doc_data, seed_ontology, existing_claims)
        final_extraction = turn1_res.extraction
        turn2_interaction_id: Optional[str] = None
        self_corrected = False
        thought_summaries = list(turn1_res.thought_summaries)
        initial_failures_count = len(turn1_res.validation_failures)

        if turn1_res.validation_failures:
            turn2_res = self.correct_turn2(
                previous_interaction_id=turn1_res.interaction_id,
                source_text=source_text,
                validation_failures=turn1_res.validation_failures,
            )
            final_extraction = turn2_res.extraction
            turn2_interaction_id = turn2_res.interaction_id
            self_corrected = True
            thought_summaries.extend(turn2_res.thought_summaries)

        changeset = self.build_changeset(doc_data, final_extraction)
        trace = PipelineTrace(
            turn1_interaction_id=turn1_res.interaction_id,
            turn2_interaction_id=turn2_interaction_id,
            self_corrected=self_corrected,
            initial_failures_count=initial_failures_count,
            thought_summaries=thought_summaries,
        )
        return AssimilatePipelineResponse(
            changeset=changeset,
            pipeline_trace=trace,
        )

    def assimilate(
        self,
        doc_data: Dict[str, Any],
        seed_ontology: Dict[str, Any],
        existing_claims: Optional[List[FactClaim]] = None,
    ) -> ChangeSet:
        """
        Executes assimilation and returns the staged ChangeSet (backward-compatible with sync and async callers).
        """
        return self.assimilate_with_trace(doc_data, seed_ontology, existing_claims).changeset
