#!/usr/bin/env bash
# Rebuild the web bundle from the running Metro dev server and smoke it.
#   ./scripts/check.sh            # logged-out (auth screen)
#   SMOKE_LOGGED_IN=1 ./scripts/check.sh
set -e
cd "$(dirname "$0")/.."
OUT=$(mktemp /tmp/bundle-XXXX.js)
sleep 2   # let Metro's watcher pick up the latest edits
code=$(curl -s -o "$OUT" -w "%{http_code}" "http://localhost:8081/index.bundle?platform=web&dev=true&minify=false")
[ "$code" = "200" ] || { echo "bundle build failed ($code)"; head -c 400 "$OUT"; exit 1; }
echo "bundle ok ($(wc -c < "$OUT") bytes)"
node scripts/smoke-web.js "$OUT"
