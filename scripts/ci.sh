#!/usr/bin/env bash
# One-command CI/CD pipeline (mirrors .github/workflows/ci.yml).
#   bash scripts/ci.sh          — or —          npm run ci
# 1. server: install deps, syntax-check every file, run all offline suites
# 2. app:    install deps, export the production web bundle (same command
#            Railway/Vercel/Render run on deploy — catches wiring errors)
set -euo pipefail
cd "$(dirname "$0")/.."

echo "━━━ [1/5] server: install deps ━━━"
(cd server && npm install --no-audit --no-fund)

echo "━━━ [2/5] server: syntax check ━━━"
(cd server && for f in src/*.js *.js; do
  node --check "$f" || exit 1
done)
echo "  ✓ all server files parse"

echo "━━━ [3/5] server: test suites ━━━"
(cd server && \
  npm run test:message-state      && \
  npm run test:chat-history       && \
  npm run test:offline-messaging  && \
  npm run test:push               && \
  npm run test:phase2             && \
  npm run test:moderation         && \
  npm run test:phase3             && \
  npm run test:ot                 && \
  npm run test:features)

echo "━━━ [4/6] app: install deps ━━━"
(cd app && npm ci --no-audit --no-fund)

echo "━━━ [5/6] app: image editor unit tests ━━━"
(cd app && npm run test:image-editor)

echo "━━━ [6/6] app: production web bundle ━━━"
(cd app && CI=true npx expo export --platform web --output-dir dist)

echo ""
echo "✅ CI/CD pipeline complete — app is wired and builds cleanly."
