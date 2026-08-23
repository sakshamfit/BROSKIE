#!/usr/bin/env bash
# Build and exercise the Dockerized backend without deleting its named volume.
# Usage: npm run docker:smoke
set -euo pipefail

cd "$(dirname "$0")/.."

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required for this check. Install/start Docker, then run: npm run docker:smoke" >&2
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  echo "Docker is installed but its daemon is not reachable. Start Docker and retry." >&2
  exit 1
fi

# Shell values take precedence over .env, so this check can run without
# creating a secret-bearing local file. It deliberately does not use down -v.
export JWT_SECRET="${JWT_SECRET:-$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")}"
export CORS_ORIGIN="${CORS_ORIGIN:-*}"
# Isolate the smoke stack from a developer's normal Compose project. The
# stack has no host-side dependency, so it uses a non-default port as well.
export PLUSONE_PORT="${PLUSONE_SMOKE_PORT:-4100}"
compose=(docker compose --project-name plusone-smoke)

cleanup() {
  "${compose[@]}" down --remove-orphans
}
trap cleanup EXIT

"${compose[@]}" build
"${compose[@]}" up -d --wait

"${compose[@]}" exec -T backend node - <<'NODE'
const http = require('http');
http.get('http://127.0.0.1:4000/health', (res) => {
  let body = '';
  res.setEncoding('utf8');
  res.on('data', (chunk) => { body += chunk; });
  res.on('end', () => {
    let payload;
    try { payload = JSON.parse(body); } catch { process.exitCode = 1; return; }
    if (res.statusCode !== 200 || payload.ok !== true) process.exitCode = 1;
  });
}).on('error', () => { process.exitCode = 1; });
NODE

echo "Docker smoke check passed: backend is healthy and SQLite migrations completed."
