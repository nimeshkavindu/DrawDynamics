#!/bin/bash

# Exit script if any command fails
set -e

PROJECT_ID="drawdynamics-backend" 
SERVICE_NAME="physics-ai-backend"
REGION="us-central1"

echo "Deploying to Google Cloud Run..."

# This single command builds the Docker container and deploys it to Cloud Run
gcloud run deploy $SERVICE_NAME \
  --source . \
  --region $REGION \
  --project $PROJECT_ID \
  --allow-unauthenticated \
  --use-http2

echo "Deployment complete!"