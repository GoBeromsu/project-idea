#!/usr/bin/env bash
set -euo pipefail

MODEL_PORT="${MODEL_PORT:-8001}"
BACKEND_PORT="${BACKEND_PORT:-8000}"
FRONTEND_PORT="${FRONTEND_PORT:-3000}"

export MODEL_API_URL="${MODEL_API_URL:-http://127.0.0.1:${MODEL_PORT}}"
export BACKEND_API_URL="${BACKEND_API_URL:-http://localhost:${BACKEND_PORT}}"

PIDS=()

cleanup() {
    echo ""
    echo "Shutting down Project IDEA 3-Tier services..."
    for pid in "${PIDS[@]:-}"; do
        if kill -0 "$pid" 2>/dev/null; then
            kill "$pid" 2>/dev/null || true
        fi
    done
    wait 2>/dev/null || true
    echo "All tiers stopped."
}

trap cleanup SIGINT SIGTERM EXIT

echo "Starting Tier 3 — Model Service (Gemini 4 Argon Agent API) on port ${MODEL_PORT}..."
uv run uvicorn model.server:app --host 0.0.0.0 --port "${MODEL_PORT}" &
PIDS+=($!)

echo "Starting Tier 2 — Backend Orchestrator API on port ${BACKEND_PORT} (MODEL_API_URL=${MODEL_API_URL})..."
uv run uvicorn backend.server:app --host 0.0.0.0 --port "${BACKEND_PORT}" &
PIDS+=($!)

echo "Starting Tier 1 — Frontend 3D Visualizer SPA on port ${FRONTEND_PORT} (BACKEND_API_URL=${BACKEND_API_URL})..."
uv run uvicorn frontend.server:app --host 0.0.0.0 --port "${FRONTEND_PORT}" &
PIDS+=($!)

echo ""
echo "=================================================================="
echo "Project IDEA 3-Tier Architecture Running:"
echo "  - Frontend Tier (3D UI)   : http://localhost:${FRONTEND_PORT}"
echo "  - Backend Tier (REST API) : http://localhost:${BACKEND_PORT}"
echo "  - Model Tier (Argon Agent): http://localhost:${MODEL_PORT}"
echo "Press Ctrl+C to stop all tiers."
echo "=================================================================="

wait
