"""
Gemini 4 Argon Knowledge Assimilation Agent Loop.
Implements the 4-stage pipeline: Ingest -> Align -> Assimilate -> Verify.
Utilizes the Google GenAI Interactions API with previous_interaction_id for self-correction.
"""
import os
import json
import logging
from typing import Dict, Any, List, Optional
from google import genai
from models import (
    Concept, Relation, FactClaim, SourceEvidence,
    ChangeSet, VerificationStatus, AlignmentAction, AssimilationExtraction
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

class AssimilationEngine:
    def __init__(self, api_key: Optional[str] = None):
        self.api_key = api_key or os.getenv("GEMINI_API_KEY")
        self.client = genai.Client(api_key=self.api_key)

    async def assimilate(
        self,
        doc_data: Dict[str, Any],
        seed_ontology: Dict[str, Any],
        existing_claims: List[FactClaim]
    ) -> ChangeSet:
        """
        Executes assimilation with two-turn self-correction loop.
        """
        source_text = doc_data["full_text"]
        title = doc_data["title"]
        url = doc_data.get("url", "local://input")

        domain_summary = [
            {"id": c["id"], "name": c["name"], "synonyms": c.get("synonyms", []), "description": c["description"]}
            for c in seed_ontology.get("concepts", [])
        ]
        claims_summary = [
            {"id": cl.id, "concept_id": cl.concept_id, "statement": cl.statement}
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

        # Turn 1: Interactions API with gemini-4-argon
        interaction = self.client.interactions.create(
            model="gemini-4-argon",
            input=turn1_prompt,
            system_instruction=SYSTEM_PROMPT,
            generation_config={
                "thinking_level": "medium",
            },
            response_format={
                "type": "text",
                "mime_type": "application/json",
                "schema": AssimilationExtraction.model_json_schema(),
            }
        )

        interaction_id = interaction.id
        raw_output = interaction.output_text
        data = json.loads(raw_output)

        # Mechanical Verification Gate
        validation_failures = []
        for claim_dict in data.get("claims", []):
            evidence = claim_dict.get("evidence", {})
            quote = evidence.get("exact_quote", "")
            valid, err = EvidenceValidator.verify_quote(source_text, quote)
            if not valid:
                validation_failures.append({
                    "claim": claim_dict.get("statement"),
                    "bad_quote": quote,
                    "error": err
                })

        # Turn 2: Self-correction loop via previous_interaction_id if quote hallucinated
        if validation_failures:
            logger.warning(f"Mechanical validation failed for {len(validation_failures)} quotes. Triggering Argon self-correction.")
            correction_prompt = f"""
CRITICAL MECHANICAL VERIFICATION ERROR:
The following quotes failed verbatim matching against the source text:
{json.dumps(validation_failures, indent=2)}

Please re-examine the source text carefully and regenerate the extraction.
Ensure that EVERY `exact_quote` in `claims` is an EXACT verbatim substring from the source text.
"""
            interaction2 = self.client.interactions.create(
                model="gemini-4-argon",
                previous_interaction_id=interaction_id,
                input=correction_prompt,
                system_instruction=SYSTEM_PROMPT,
                generation_config={
                    "thinking_level": "medium",
                },
                response_format={
                    "type": "text",
                    "mime_type": "application/json",
                    "schema": AssimilationExtraction.model_json_schema(),
                }
            )
            raw_output = interaction2.output_text
            data = json.loads(raw_output)

        # Construct ChangeSet
        proposed_concepts: List[Concept] = []
        for c in data.get("aligned_concepts", []):
            action = c.get("action", "PROPOSE")
            status = VerificationStatus.VERIFIED if action == "MATCH" else (
                VerificationStatus.UNRESOLVED if action == "UNRESOLVED" else VerificationStatus.PROPOSED
            )
            cid = c.get("id") or f"concept_{c.get('name', 'unknown').lower().replace(' ', '_')}"
            proposed_concepts.append(Concept(
                id=cid,
                name=c.get("name", "Unknown"),
                synonyms=c.get("synonyms", []),
                description=c.get("description", ""),
                status=status,
                layer="domain" if action == "MATCH" else "graph"
            ))

        proposed_relations: List[Relation] = []
        for idx, r in enumerate(data.get("extracted_relations", [])):
            proposed_relations.append(Relation(
                id=f"rel_{idx}_{r.get('source_id')}_{r.get('target_id')}",
                source_id=r.get("source_id", ""),
                target_id=r.get("target_id", ""),
                predicate=r.get("predicate", "related_to"),
                description=r.get("description"),
                status=VerificationStatus.PROPOSED
            ))

        proposed_claims: List[FactClaim] = []
        unresolved_conflicts: List[FactClaim] = []

        for idx, cl in enumerate(data.get("claims", [])):
            ev_dict = cl.get("evidence", {})
            quote = ev_dict.get("exact_quote", "")
            valid, _ = EvidenceValidator.verify_quote(source_text, quote)

            ev = SourceEvidence(
                url=url,
                title=title,
                section_anchor=ev_dict.get("section_anchor", "Body"),
                exact_quote=quote,
                mechanical_verified=valid
            )

            is_conflicted = bool(cl.get("conflicts_with")) or cl.get("status") == "UNRESOLVED"
            status = VerificationStatus.UNRESOLVED if is_conflicted else (
                VerificationStatus.PROPOSED if valid else VerificationStatus.REJECTED
            )

            claim_obj = FactClaim(
                id=f"claim_{idx}_{cl.get('concept_id', 'unknown')}",
                concept_id=cl.get("concept_id", "unknown"),
                statement=cl.get("statement", ""),
                status=status,
                evidence=ev,
                conflicts_with=cl.get("conflicts_with", [])
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
            status="PENDING"
        )
