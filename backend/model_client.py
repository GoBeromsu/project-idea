import os
from typing import Any, Dict, List, Optional, Tuple
import httpx

try:
    from backend.schemas import ChangeSet, FactClaim, PipelineTrace, QueryResponse
except ImportError:
    from schemas import ChangeSet, FactClaim, PipelineTrace, QueryResponse


class ModelServiceClient:
    def __init__(
        self,
        base_url: Optional[str] = None,
        timeout: float = 120.0,
        transport: Optional[httpx.AsyncBaseTransport] = None,
    ):
        self.base_url = (base_url or os.getenv("MODEL_API_URL", "http://127.0.0.1:8001")).rstrip("/")
        self.timeout = timeout
        self.transport = transport

    def _client(self) -> httpx.AsyncClient:
        return httpx.AsyncClient(timeout=self.timeout, transport=self.transport)

    async def check_health(self) -> Dict[str, Any]:
        async with self._client() as client:
            resp = await client.get(f"{self.base_url}/health")
            resp.raise_for_status()
            return resp.json()

    async def scan_jargon(
        self,
        doc_data: Dict[str, Any],
        seed_ontology: Dict[str, Any],
    ) -> Dict[str, Any]:
        async with self._client() as client:
            resp = await client.post(
                f"{self.base_url}/api/v1/jargon-scan",
                json={
                    "doc_data": doc_data,
                    "seed_ontology": seed_ontology,
                },
            )
            resp.raise_for_status()
            return resp.json()

    async def extract_turn1(
        self,
        doc_data: Dict[str, Any],
        seed_ontology: Dict[str, Any],
        existing_claims: List[FactClaim],
        question: Optional[str] = None,
    ) -> Dict[str, Any]:
        async with self._client() as client:
            r1 = await client.post(
                f"{self.base_url}/api/v1/extract",
                json={
                    "doc_data": doc_data,
                    "seed_ontology": seed_ontology,
                    "existing_claims": [c.model_dump() if hasattr(c, "model_dump") else c for c in existing_claims],
                    "question": question,
                },
            )
            r1.raise_for_status()
            return r1.json()

    async def correct_turn2(
        self,
        previous_interaction_id: str,
        source_text: str,
        validation_failures: List[Dict[str, Any]],
        question: Optional[str] = None,
    ) -> Dict[str, Any]:
        async with self._client() as client:
            r2 = await client.post(
                f"{self.base_url}/api/v1/correct",
                json={
                    "previous_interaction_id": previous_interaction_id,
                    "source_text": source_text,
                    "validation_failures": validation_failures,
                    "question": question,
                },
            )
            r2.raise_for_status()
            return r2.json()

    async def build_changeset(
        self,
        doc_data: Dict[str, Any],
        extraction: Dict[str, Any],
        question: Optional[str] = None,
        seed_ontology: Optional[Dict[str, Any]] = None,
    ) -> ChangeSet:
        async with self._client() as client:
            r3 = await client.post(
                f"{self.base_url}/api/v1/build-changeset",
                json={
                    "doc_data": doc_data,
                    "extraction": extraction,
                    "question": question,
                    "seed_ontology": seed_ontology,
                },
            )
            r3.raise_for_status()
            resp3 = r3.json()
            cs_json = (
                resp3["changeset"]
                if isinstance(resp3, dict) and "changeset" in resp3 and isinstance(resp3["changeset"], dict)
                else resp3
            )
            return ChangeSet(**cs_json)

    async def run_assimilation_pipeline(
        self,
        doc_data: Dict[str, Any],
        seed_ontology: Dict[str, Any],
        existing_claims: List[FactClaim],
        question: Optional[str] = None,
    ) -> Tuple[ChangeSet, PipelineTrace]:
        resp1 = await self.extract_turn1(
            doc_data=doc_data,
            seed_ontology=seed_ontology,
            existing_claims=existing_claims,
            question=question,
        )

        turn1_id: str = resp1["interaction_id"]
        extraction: Dict[str, Any] = resp1["extraction"]
        thought_summaries: List[str] = list(resp1.get("thought_summaries", []))
        validation_failures: List[Dict[str, Any]] = resp1.get("validation_failures", [])

        initial_failures_count = len(validation_failures)
        remaining_failures_count = initial_failures_count
        turn2_id: Optional[str] = None
        self_corrected = False

        if validation_failures:
            resp2 = await self.correct_turn2(
                previous_interaction_id=turn1_id,
                source_text=doc_data["full_text"],
                validation_failures=validation_failures,
                question=question,
            )
            extraction = resp2["extraction"]
            turn2_id = resp2.get("interaction_id")
            thought_summaries.extend(resp2.get("thought_summaries", []))
            remaining_failures_count = len(resp2.get("validation_failures", []))
            self_corrected = True

        changeset = await self.build_changeset(
            doc_data=doc_data,
            extraction=extraction,
            question=question,
            seed_ontology=seed_ontology,
        )
        if question and not changeset.question:
            changeset.question = question
        if isinstance(extraction, dict) and extraction.get("answer") and not changeset.answer:
            changeset.answer = extraction.get("answer")

        layer_distribution = {
            "jargon": sum(1 for c in changeset.proposed_concepts if c.node_type == "TERM"),
            "concepts": sum(1 for c in changeset.proposed_concepts if c.node_type == "CONCEPT"),
            "entities": sum(1 for c in changeset.proposed_concepts if c.node_type == "ENTITY"),
            "wiki": len(changeset.proposed_claims),
        }

        trace = PipelineTrace(
            turn1_interaction_id=turn1_id,
            turn2_interaction_id=turn2_id,
            self_corrected=self_corrected,
            initial_failures_count=initial_failures_count,
            remaining_failures_count=remaining_failures_count,
            thought_summaries=thought_summaries,
            jargon_candidates=[c.get("term", "") for c in doc_data.get("jargon_candidates", []) if isinstance(c, dict) and c.get("term")],
            layer_distribution=layer_distribution,
        )
        return changeset, trace

    async def assimilate_via_rest_loop(
        self,
        doc_data: Dict[str, Any],
        seed_ontology: Dict[str, Any],
        existing_claims: List[FactClaim],
        question: Optional[str] = None,
    ) -> Tuple[ChangeSet, PipelineTrace]:
        return await self.run_assimilation_pipeline(
            doc_data=doc_data,
            seed_ontology=seed_ontology,
            existing_claims=existing_claims,
            question=question,
        )

    async def query_knowledge(
        self,
        question: str,
        seed_ontology: Dict[str, Any],
        existing_claims: List[FactClaim],
    ) -> QueryResponse:
        async with self._client() as client:
            resp = await client.post(
                f"{self.base_url}/api/v1/query",
                json={
                    "question": question,
                    "seed_ontology": seed_ontology,
                    "existing_claims": [c.model_dump() if hasattr(c, "model_dump") else c for c in existing_claims],
                },
            )
            resp.raise_for_status()
            return QueryResponse(**resp.json())
