#!/usr/bin/env bash
set -e

PROJECT_ID="obsidian-385509"
SERVICE_NAME="project-idea"
REGION="asia-northeast3"
WORKFLOW_FILE="deploy.yml"

if [[ "${1:-}" != "--direct" ]]; then
  echo "Triggering remote CI/CD & Release pipeline on GitHub Actions ($WORKFLOW_FILE)..."
  if command -v gh >/dev/null 2>&1; then
    gh workflow run "$WORKFLOW_FILE" --ref main
    echo "GitHub Actions workflow triggered! View progress with: gh run watch"
    exit 0
  else
    echo "GitHub CLI (gh) not found. Falling back to remote Cloud Build deployment..."
  fi
fi

# Fallback (--direct): Remote Cloud Build on GCP (no local Docker daemon needed)
if [ -f .env ]; then
  export $(grep -v '^#' .env | xargs)
fi

echo "Deploying $SERVICE_NAME remotely via Google Cloud Run (Region: $REGION, Port: 8000)..."
gcloud run deploy "$SERVICE_NAME" \
  --source . \
  --project "$PROJECT_ID" \
  --region "$REGION" \
  --port 8000 \
  --set-env-vars "GEMINI_API_KEY=${GEMINI_API_KEY:-}" \
  --allow-unauthenticated \
  --quiet

echo "Deployment finished successfully!"

