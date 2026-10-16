import os
from typing import Any, Dict, List, Optional, Tuple
import httpx

try:
    from backend.schemas import ChangeSet, FactClaim, PipelineTrace
except ImportError:
    from schemas import ChangeSet, FactClaim, PipelineTrace


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

    async def assimilate_via_rest_loop(
        self,
        doc_data: Dict[str, Any],
        seed_ontology: Dict[str, Any],
        existing_claims: List[FactClaim],
    ) -> Tuple[ChangeSet, PipelineTrace]:
        async with self._client() as client:
            r1 = await client.post(
                f"{self.base_url}/api/v1/extract",
                json={
                    "doc_data": doc_data,
                    "seed_ontology": seed_ontology,
                    "existing_claims": [c.model_dump() for c in existing_claims],
                },
            )
            r1.raise_for_status()
            resp1 = r1.json()

            turn1_id: str = resp1["interaction_id"]
            extraction: Dict[str, Any] = resp1["extraction"]
            thought_summaries: List[str] = list(resp1.get("thought_summaries", []))
            validation_failures: List[Dict[str, Any]] = resp1.get("validation_failures", [])

            initial_failures_count = len(validation_failures)
            turn2_id: Optional[str] = None
            self_corrected = False

            if validation_failures:
                r2 = await client.post(
                    f"{self.base_url}/api/v1/correct",
                    json={
                        "previous_interaction_id": turn1_id,
                        "source_text": doc_data["full_text"],
                        "validation_failures": validation_failures,
                    },
                )
                r2.raise_for_status()
                resp2 = r2.json()

                extraction = resp2["extraction"]
                turn2_id = resp2.get("interaction_id")
                thought_summaries.extend(resp2.get("thought_summaries", []))
                self_corrected = True

            r3 = await client.post(
                f"{self.base_url}/api/v1/build-changeset",
                json={
                    "doc_data": doc_data,
                    "extraction": extraction,
                },
            )
            r3.raise_for_status()
            resp3 = r3.json()

            cs_json = (
                resp3["changeset"]
                if isinstance(resp3, dict) and "changeset" in resp3 and isinstance(resp3["changeset"], dict)
                else resp3
            )

            changeset = ChangeSet(**cs_json)
            trace = PipelineTrace(
                turn1_interaction_id=turn1_id,
                turn2_interaction_id=turn2_id,
                self_corrected=self_corrected,
                initial_failures_count=initial_failures_count,
                thought_summaries=thought_summaries,
            )
            return changeset, trace
