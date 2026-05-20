#!/usr/bin/env bash
set -euo pipefail

# Deploys apps/client to S3 static-website bucket fronting game.marche-ou-creve.com.
# Requires: AWS CLI with profile `deploy`, pnpm.

BUCKET="${BUCKET:-game.marche-ou-creve.com}"
PROFILE="${AWS_PROFILE:-deploy}"
REGION="${AWS_REGION:-eu-west-3}"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "==> Building shared + client"
pnpm --filter @hips/shared build
pnpm --filter client build

echo "==> Syncing apps/client/dist/ to s3://$BUCKET (region=$REGION, profile=$PROFILE)"
# Hashed asset files (vite emits content-hashed names): immutable, cache 1y.
aws s3 sync apps/client/dist/assets/ "s3://$BUCKET/assets/" \
  --profile "$PROFILE" \
  --region "$REGION" \
  --delete \
  --cache-control "public, max-age=31536000, immutable"

# Everything else (index.html, favicon, etc): no-cache so deploys are visible immediately.
aws s3 sync apps/client/dist/ "s3://$BUCKET/" \
  --profile "$PROFILE" \
  --region "$REGION" \
  --delete \
  --exclude "assets/*" \
  --cache-control "no-cache"

echo "==> Done. https://game.marche-ou-creve.com"
