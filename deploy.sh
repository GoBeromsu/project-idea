#!/usr/bin/env bash
set -e

PROJECT_ID="obsidian-385509"
SERVICE_NAME="project-idea"
REGION="asia-northeast3"

# Load GEMINI_API_KEY from .env if present
if [ -f .env ]; then
  export $(grep -v '^#' .env | xargs)
fi

echo "Deploying $SERVICE_NAME to Google Cloud Run (Region: $REGION)..."
gcloud run deploy "$SERVICE_NAME" \
  --source . \
  --project "$PROJECT_ID" \
  --region "$REGION" \
  --set-env-vars "GEMINI_API_KEY=$GEMINI_API_KEY" \
  --allow-unauthenticated \
  --quiet

echo "Deployment finished successfully!"
