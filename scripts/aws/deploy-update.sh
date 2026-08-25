#!/usr/bin/env bash
#
# deploy-update.sh — pull the latest code on the EC2 box and rebuild/restart
# the backend. Run it right from CloudShell:
#
#   bash scripts/aws/deploy-update.sh            # uses the main branch
#
# Safe to run repeatedly. Docker keeps the old container serving until the new
# image is built; the SQLite database, uploads, backups and VAPID keys all
# live on the /data EBS volume and are untouched by rebuilds.
#
set -euo pipefail

PROJECT="plusone"
REGION="${AWS_REGION:-ap-south-1}"
export AWS_DEFAULT_REGION="$REGION"
KEY_FILE="${KEY_FILE:-$HOME/.ssh/${PROJECT}-key.pem}"
BRANCH="${BRANCH:-main}"

PUBLIC_IP=$(aws ec2 describe-addresses --filters "Name=tag:Name,Values=${PROJECT}-ip" \
  --query 'Addresses[0].PublicIp' --output text)
[ -n "$PUBLIC_IP" ] && [ "$PUBLIC_IP" != "None" ] || { echo "No ${PROJECT}-ip Elastic IP found — run provision.sh first." >&2; exit 1; }

printf '\033[1;34m==>\033[0m Updating +one on %s from branch %s...\n' "$PUBLIC_IP" "$BRANCH"
ssh -i "$KEY_FILE" -o StrictHostKeyChecking=accept-new "ubuntu@${PUBLIC_IP}" bash -s <<EOF
set -e
cd /opt/plusone
# Local runtime files (.env) must survive the reset; only tracked code updates.
sudo -n true 2>/dev/null || true
git fetch --depth 1 origin ${BRANCH}
git reset --hard FETCH_HEAD
sudo docker compose up --build -d
sudo docker image prune -f
sleep 8
curl -fsS localhost:4000/health >/dev/null && echo "OK: updated + healthy"
EOF
printf '\033[1;32m✓ Update deployed.\033[0m\n'
