#!/usr/bin/env bash
set -e

PROJECT_ID="obsidian-385509"
SERVICE_NAME="project-idea"
REGION="asia-northeast3"

echo "Deploying $SERVICE_NAME to Google Cloud Run (Region: $REGION)..."
gcloud run deploy "$SERVICE_NAME" \
  --source . \
  --project "$PROJECT_ID" \
  --region "$REGION" \
  --allow-unauthenticated \
  --quiet

echo "Deployment finished successfully!"
