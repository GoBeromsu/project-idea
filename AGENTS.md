# AGENTS.md — Gemini 4 Argon & Project IDEA Guidelines

## 1. Gemini 4 Argon API Rules (Mandatory)

1. **Always use the Interactions API (`client.interactions.create`)**:
   - Require `google-genai >= 2.30.1` (Python) or `@google/genai >= 2.29.1` (Node/TS).
   - Use `model="gemini-4-argon"` for core Knowledge Assimilation, semantic verification, and multi-file synthesis.
   - Use `previous_interaction_id` for multi-turn verification/self-correction loops to preserve server-side state and leverage automatic implicit context caching (95% discount). Note: `tools`, `system_instruction`, and `generation_config` are interaction-scoped and must be passed on each turn.
   - For structured JSON output with Pydantic models, pass:
     ```python
     response_format={
         "type": "text",
         "mime_type": "application/json",
         "schema": MyPydanticModel.model_json_schema(),
     }
     ```

2. **Control reasoning with `thinking_level`**:
   - `"low"`: Fast classification, routing, or lightweight formatting checks.
   - `"medium"` (default): Interactive coding, Knowledge Assimilation (`Ingest -> Align -> Assimilate -> Verify`), and tool use within the 3-minute live demo target.
   - `"high"`: Deep multi-file debugging, complex contradiction resolution, or architecture synthesis.

3. **Long decode (`background=True`)**:
   - Default output cap is `65536` tokens.
   - If `max_output_tokens > 65536` is needed (sharing the 1M-token context window), set `background=True` and poll `client.interactions.get(id=interaction.id)`.

4. **NEVER use deprecated Gemini 2.5 / 3 parameters**:
   - Do **NOT** pass `thinking_budget` (use `thinking_level` instead).
   - Do **NOT** pass `temperature`, `top_p`, or `top_k` (custom sampling parameters are ignored by `gemini-4-argon` and trigger deprecation warnings).
   - Do **NOT** create explicit `cached_content` calls (implicit caching is automatic).

## 2. Project IDEA Core Architecture Rules

1. **Human-in-the-Loop Control (Test 3)**:
   - Unverified claims or unresolved semantic conflicts (`UNRESOLVED`) must **NEVER** be auto-committed to the Knowledge Store or Wiki.
   - Every proposed mutation must be staged as a `ChangeSet` (Knowledge Diff) and explicitly approved by the user before mutating `WikiPage` or committed graph state.

2. **Distinguish Mechanical vs. Semantic Verification**:
   - **Mechanical Verification (`Evidence Validator`)**: Deterministic code checks that source URLs, section anchors, and exact/normalized quote spans actually exist in the fetched source text, and referenced `Term`/`Concept` IDs exist in the registry.
   - **Semantic Verification (`gemini-4-argon`)**: Evaluates synonymy (`MATCH`), novel concepts (`PROPOSE`), and conceptual ambiguity or contradiction against existing Wiki claims (`UNRESOLVED`).

3. **3D Visualization Integrity**:
   - The 4 rotating layers (Source, Domain Semantic Layer, Knowledge Graph, Wiki) must reflect real agent pipeline states and verification statuses (`VERIFIED`, `PROPOSED`, `UNRESOLVED`, `REJECTED`).
