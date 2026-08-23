#!/bin/sh
# Runtime entrypoint for the backend image.
#
# Railway volumes (and Compose named volumes) are mounted as root. The
# process then often runs as the non-root `node` user, so tomodachi.db is
# readable but every write throws SQLITE_READONLY — the crash in Railway
# deploy logs on the branding UPDATE. If we started as root, chown the
# data directory first, then drop privileges.
set -eu

DATA="${DATA_DIR:-${RAILWAY_VOLUME_MOUNT_PATH:-/data}}"

mkdir -p "$DATA" "$DATA/uploads" "$DATA/backups" || true

if [ "$(id -u)" = "0" ]; then
  chown -R node:node "$DATA" 2>/dev/null || true
  chmod -R u+rwX "$DATA" 2>/dev/null || true
  if command -v gosu >/dev/null 2>&1; then
    exec gosu node "$@"
  fi
fi

exec "$@"
