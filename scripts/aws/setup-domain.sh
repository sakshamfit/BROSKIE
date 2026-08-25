#!/usr/bin/env bash
#
# setup-domain.sh — point a Route53-registered domain at the +one EC2 box and
# turn on HTTPS (Caddy + automatic Let's Encrypt).
#
# Run this AFTER provision.sh and AFTER the domain shows "Registered" in
# Route 53 (console → Route 53 → Registered domains). Route53 auto-creates
# the matching hosted zone; this script just adds the A records and tells
# Caddy the domain name.
#
# Usage (in CloudShell, same region as provision = ap-south-1):
#   bash scripts/aws/setup-domain.sh yourdomain.com
#
set -euo pipefail

PROJECT="plusone"
REGION="${AWS_REGION:-ap-south-1}"
export AWS_DEFAULT_REGION="$REGION"
KEY_FILE="${KEY_FILE:-$HOME/.ssh/${PROJECT}-key.pem}"

DOMAIN="${1:-}"
[ -n "$DOMAIN" ] || { echo "Usage: $0 yourdomain.com" >&2; exit 1; }
DOMAIN="${DOMAIN%.}"   # tolerate a trailing dot

say() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
die() { printf '\033[1;31mERROR:\033[0m %s\n' "$*" >&2; exit 1; }

# ------------------------------------------------------------ hosted zone
ZONE_ID=$(aws route53 list-hosted-zones-by-name --dns-name "$DOMAIN" \
  --query "HostedZones[?Name=='${DOMAIN}.'].Id | [0]" --output text)
[ -n "$ZONE_ID" ] && [ "$ZONE_ID" != "None" ] \
  || die "No Route53 hosted zone for ${DOMAIN}. Is the domain registered in THIS account? (Route 53 → Registered domains). If the registration is still pending, wait for it."
say "Hosted zone: ${ZONE_ID}"

# ------------------------------------------------------------ elastic IP
PUBLIC_IP=$(aws ec2 describe-addresses --filters "Name=tag:Name,Values=${PROJECT}-ip" \
  --query 'Addresses[0].PublicIp' --output text)
[ -n "$PUBLIC_IP" ] && [ "$PUBLIC_IP" != "None" ] || die "No ${PROJECT}-ip Elastic IP found — run provision.sh first."
say "Target: ${PUBLIC_IP}"

# ------------------------------------------------------------ DNS records
CHANGE=$(cat <<EOF
{"Changes":[
  {"Action":"UPSERT","ResourceRecordSet":{"Name":"${DOMAIN}.","Type":"A","TTL":300,"ResourceRecords":[{"Value":"${PUBLIC_IP}"}]}},
  {"Action":"UPSERT","ResourceRecordSet":{"Name":"www.${DOMAIN}.","Type":"A","TTL":300,"ResourceRecords":[{"Value":"${PUBLIC_IP}"}]}}
]}
EOF
)
aws route53 change-resource-record-sets --hosted-zone-id "$ZONE_ID" --change-batch "$CHANGE" >/dev/null
say "A records upserted: ${DOMAIN} and www.${DOMAIN} -> ${PUBLIC_IP}"

# ------------------------------------------------------------ Caddy on the box
say "Configuring Caddy over SSH (starting Let's Encrypt)..."
ssh -i "$KEY_FILE" -o StrictHostKeyChecking=accept-new -o ConnectTimeout=15 "ubuntu@${PUBLIC_IP}" bash -s <<EOF
set -e
sudo tee /etc/caddy/Caddyfile >/dev/null <<CADDY
${DOMAIN}, www.${DOMAIN} {
	reverse_proxy 127.0.0.1:4000
	encode zstd gzip
}
CADDY
sudo systemctl enable caddy
sudo systemctl restart caddy
EOF

say "Waiting for DNS + certificate issuance (up to ~2 min)..."
for i in $(seq 1 24); do
  sleep 5
  if curl -fsS --max-time 5 "https://${DOMAIN}/health" >/dev/null 2>&1; then
    break
  fi
  [ "$i" = "24" ] && die "https://${DOMAIN}/health is not responding yet. DNS can take a few more minutes — retry: curl -i https://${DOMAIN}/health — or check Caddy: ssh -i ${KEY_FILE} ubuntu@${PUBLIC_IP} 'sudo journalctl -u caddy -n 50'"
done

cat <<EOF

$(printf '\033[1;32m')──────────────────────────────────────────────────────────$(printf '\033[0m')
 HTTPS is live:  https://${DOMAIN}/health
 Web app:        https://${DOMAIN}          (open it, Sign Up, done)

 Tell your Arena session the final domain so app/src/api.js,
 vercel.json and wrangler.jsonc can be repointed from Railway to
 https://${DOMAIN} for future native builds.

 Next: migrate existing users/chats from Railway:
   bash scripts/aws/migrate-data.sh
$(printf '\033[1;32m')──────────────────────────────────────────────────────────$(printf '\033[0m')
EOF
