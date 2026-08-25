#!/usr/bin/env bash
# user-data.sh — first-boot bootstrap for the +one EC2 instance.
# provision.sh injects REPO_URL / REPO_BRANCH above this line; defaults below
# keep the file runnable standalone for testing.
#
# It installs Docker, formats + mounts the dedicated EBS data volume at /data,
# adds a small swapfile (the Expo web build would OOM on 2 GB without it),
# clones the repo and starts the backend via docker compose. Caddy is
# installed but kept stopped until scripts/aws/setup-domain.sh configures TLS.
exec > >(tee -a /var/log/plusone-bootstrap.log) 2>&1
set -euxo pipefail

REPO_URL="${REPO_URL:-https://github.com/sakshamfit/BROSKIE.git}"
REPO_BRANCH="${REPO_BRANCH:-main}"
APP_DIR="/opt/plusone"

echo "[bootstrap] starting at $(date -u)"

# ------------------------------------------------------------------ packages
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y --no-install-recommends ca-certificates curl git openssl gnupg

# Docker (official convenience script — bundles the compose v2 plugin)
if ! command -v docker >/dev/null; then
  curl -fsSL https://get.docker.com | sh
fi
systemctl enable --now docker

# ------------------------------------------------------------------ data volume
# Root disk is /dev/nvme0n1 (Nitro) or /dev/xvda (Xen). The attached EBS data
# volume is the OTHER whole disk. Wait for it (attach can lag user-data).
DATA_DISK=""
for _ in $(seq 1 60); do
  DATA_DISK=$(lsblk -dn -o NAME,TYPE | awk '$2=="disk"{print $1}' \
    | grep -vE '^(nvme0n1|xvda)$' | head -n1 || true)
  [ -n "$DATA_DISK" ] && break
  sleep 5
done
if [ -z "$DATA_DISK" ]; then
  echo "[bootstrap] WARNING: no extra EBS volume found after 5 min; /data stays on the root disk (NOT persistent across instance replacement)"
else
  DEV="/dev/${DATA_DISK}"
  if ! blkid "$DEV" >/dev/null 2>&1; then
    mkfs.ext4 -q -L plusone-data "$DEV"
  fi
  mkdir -p /data
  UUID=$(blkid -s UUID -o value "$DEV")
  grep -q "$UUID" /etc/fstab || echo "UUID=${UUID} /data ext4 defaults,nofail 0 2" >> /etc/fstab
  mountpoint -q /data || mount /data
  echo "[bootstrap] data volume ${DEV} mounted at /data"
fi

# ------------------------------------------------------------------ swap (2 GB)
if ! swapon --show | grep -q /swapfile; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile >/dev/null
  swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

# ------------------------------------------------------------------ app checkout
if [ ! -d "${APP_DIR}/.git" ]; then
  git clone --depth 1 --branch "$REPO_BRANCH" "$REPO_URL" "$APP_DIR"
else
  git -C "$APP_DIR" fetch --depth 1 origin "$REPO_BRANCH"
  git -C "$APP_DIR" reset --hard FETCH_HEAD
fi

# .env — secrets generated on the box, never committed. Compose refuses to
# start without JWT_SECRET, so this is mandatory, not optional.
if [ ! -f "${APP_DIR}/.env" ]; then
  cat > "${APP_DIR}/.env" <<EOF
JWT_SECRET=$(openssl rand -hex 32)
PLUSONE_PORT=4000
CORS_ORIGIN=*
ADMIN_USERNAMES=saksham
GOLD_TICK_USERNAMES=saksham
BACKUP_KEEP=20
SUPABASE_URL=
SUPABASE_SERVICE_KEY=
SUPABASE_BUCKET=tomodachi-uploads
JAMENDO_CLIENT_ID=
VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
VAPID_SUBJECT=mailto:hello@plusone.app
EOF
  chmod 600 "${APP_DIR}/.env"
fi

# ------------------------------------------------------------------ build + run
cd "$APP_DIR"
docker compose up --build -d
echo "[bootstrap] backend container started"

# ------------------------------------------------------------------ Caddy (TLS)
# Installed now, configured later by scripts/aws/setup-domain.sh once DNS exists.
if ! command -v caddy >/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
    | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
    > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y
  apt-get install -y caddy
fi
systemctl disable --now caddy || true

echo "[bootstrap] done at $(date -u) — waiting for domain setup (scripts/aws/setup-domain.sh)"
