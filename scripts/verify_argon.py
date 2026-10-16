from __future__ import annotations

import os
import sys
from pathlib import Path
from typing import List, Literal
from dotenv import load_dotenv
from google import genai
from pydantic import BaseModel, Field


class ArgonReadinessResponse(BaseModel):
    agent_name: str = Field(description="Name of the Knowledge Assimilation Agent.")
    ready: bool = Field(description="Whether Gemini 4 Argon is ready.")
    term_statuses: List[Literal["MATCH", "PROPOSE", "UNRESOLVED"]] = Field(
        description="Supported Domain Semantic Layer term resolution statuses."
    )
    summary: str = Field(description="One-sentence readiness message.")


def load_env_files() -> None:
    project_env = Path(__file__).resolve().parent.parent / ".env"
    home_env = Path.home() / ".env"
    if project_env.exists():
        load_dotenv(project_env)
    if home_env.exists():
        load_dotenv(home_env, override=False)


def main() -> int:
    load_env_files()
    if not os.environ.get("GEMINI_API_KEY"):
        print(
            "ERROR: GEMINI_API_KEY is not set in .env or ~/.env.",
            file=sys.stderr,
        )
        return 1

    client = genai.Client()
    interaction = client.interactions.create(
        model="gemini-4-argon",
        input=(
            "You are Project IDEA's Knowledge Assimilation Agent. "
            "Confirm your readiness and return the 3 supported term resolution statuses."
        ),
        generation_config={
            "thinking_level": "low",
        },
        response_format={
            "type": "text",
            "mime_type": "application/json",
            "schema": ArgonReadinessResponse.model_json_schema(),
        },
    )
    parsed = ArgonReadinessResponse.model_validate_json(interaction.output_text)
    print(f"Interaction ID: {interaction.id}")
    print(f"Status: {interaction.status}")
    print(f"Validated Structured Output:\n{parsed.model_dump_json(indent=2)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
