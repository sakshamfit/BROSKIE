#!/usr/bin/env bash
#
# migrate-data.sh — move your existing +one data (users, chats, messages,
# communities, push keys, uploads) from Railway onto the new EC2 box.
#
# STEP 1 — get the database out of Railway (run on your own machine where the
#          Railway CLI is logged in):
#
#     railway link                        # pick the BROSKIE project/service
#     railway shell "ls -t /data/backups | head -1"
#     railway ssh "cat /data/backups/<name-from-above>" > tomodachi.db
#     # (the backups/ copy is a consistent online snapshot — safe to copy live)
#     # also grab push keys if you want browser-push sessions to keep working:
#     railway ssh "cat /data/vapid-keys.json" > vapid-keys.json   # optional
#
#   Fallback if `railway ssh` isn't available in your CLI version:
#     railway shell                      # opens a shell INSIDE the container
#     base64 -w0 /data/tomodachi.db      # copy the output, then locally:
#     pbpaste | base64 -d > tomodachi.db
#
# STEP 2 — push it to AWS (from wherever the files + the SSH .pem are —
#          CloudShell works if you upload the files via its Actions menu):
#
#     bash scripts/aws/migrate-data.sh tomodachi.db [vapid-keys.json]
#
# The script stops the backend, swaps in your database, removes stale WAL/SHM
# sidecars, fixes ownership and starts everything again. Nothing on the box
# is deleted — the previous (fresh) database is kept as /data/tomodachi.db.pre-migrate.
#
set -euo pipefail

PROJECT="plusone"
REGION="${AWS_REGION:-ap-south-1}"
export AWS_DEFAULT_REGION="$REGION"
KEY_FILE="${KEY_FILE:-$HOME/.ssh/${PROJECT}-key.pem}"

DB_FILE="${1:-}"
VAPID_FILE="${2:-}"
[ -n "$DB_FILE" ] || { echo "Usage: $0 <tomodachi.db> [vapid-keys.json]" >&2; exit 1; }
[ -f "$DB_FILE" ] || { echo "ERROR: ${DB_FILE} not found" >&2; exit 1; }

# Every SQLite database file starts with this 16-byte magic header.
if ! head -c 15 "$DB_FILE" | grep -q "SQLite format 3"; then
  echo "ERROR: ${DB_FILE} does not look like a SQLite database (missing 'SQLite format 3' header)." >&2
  echo "       Did the base64/ssh copy get mangled? Re-export it from Railway." >&2
  exit 1
fi

say() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
die() { printf '\033[1;31mERROR:\033[0m %s\n' "$*" >&2; exit 1; }

PUBLIC_IP=$(aws ec2 describe-addresses --filters "Name=tag:Name,Values=${PROJECT}-ip" \
  --query 'Addresses[0].PublicIp' --output text 2>/dev/null || true)
if [ -z "$PUBLIC_IP" ] || [ "$PUBLIC_IP" = "None" ]; then
  # Allow running without AWS CLI context: PLUSONE_IP=1.2.3.4 ./migrate-data.sh ...
  PUBLIC_IP="${PLUSONE_IP:-}"
fi
[ -n "$PUBLIC_IP" ] || die "Could not find the ${PROJECT}-ip Elastic IP. Set PLUSONE_IP=<ip> env and retry, or run provision.sh first."

SSH="ssh -i ${KEY_FILE} -o StrictHostKeyChecking=accept-new ubuntu@${PUBLIC_IP}"
SCP="scp -i ${KEY_FILE} -o StrictHostKeyChecking=accept-new"

say "Uploading $(du -h "$DB_FILE" | cut -f1) database to ${PUBLIC_IP}..."
$SCP "$DB_FILE" "ubuntu@${PUBLIC_IP}:/tmp/restore-tomodachi.db"

if [ -n "$VAPID_FILE" ] && [ -f "$VAPID_FILE" ]; then
  $SCP "$VAPID_FILE" "ubuntu@${PUBLIC_IP}:/tmp/restore-vapid-keys.json"
  say "Uploaded vapid-keys.json (browser push keeps working without re-subscribing)"
fi

say "Swapping databases on the server..."
$SSH 'bash -s' <<'EOF'
set -e
sudo systemctl start docker || true
cd /opt/plusone
sudo docker compose stop backend
sudo cp -a /data/tomodachi.db /data/tomodachi.db.pre-migrate 2>/dev/null || true
sudo mv /tmp/restore-tomodachi.db /data/tomodachi.db
sudo rm -f /data/tomodachi.db-wal /data/tomodachi.db-shm /data/tomodachi.db-journal
[ -f /tmp/restore-vapid-keys.json ] && sudo mv /tmp/restore-vapid-keys.json /data/vapid-keys.json
sudo chown -R 1000:1000 /data        # 'node' user inside the container
sudo docker compose up -d
sleep 8
curl -fsS localhost:4000/health >/dev/null && echo "OK: backend healthy with restored database"
EOF

say "Migration complete. Old fresh database kept on the box at /data/tomodachi.db.pre-migrate."
say "Open https://your-domain and log in with one of your existing accounts to verify."
