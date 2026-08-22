# syntax=docker/dockerfile:1
#
# BROSKIE server — the stateful Socket.IO + SQLite process.
#
#   docker build -t broskie-server:local .
#   docker run -p 4000:4000 -e JWT_SECRET=devsecret -v broskie_data:/data broskie-server:local
#
# Only `server/` belongs in a container (see ../K8S.md). The Expo app ships via
# EAS (native) or `npx expo export` (web static) and does not need Kubernetes.
#
# This is a server-only image: it serves the API, WebSockets and /uploads, and
# behaves exactly like `npm start` — i.e. it does NOT bundle the web app. Serve
# the web build from a static host/CDN (or an nginx pod in this cluster).

# ---- build stage ---------------------------------------------------------
# Compile native addons (better-sqlite3) with the toolchain present, then
# leave the toolchain behind in this stage.
FROM node:20-bookworm-slim AS build
WORKDIR /app
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*
# Reproducible install from the lockfile, production dependencies only.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# ---- runtime stage -------------------------------------------------------
# Same base image (same glibc) so the .node addon built above loads as-is.
FROM node:20-bookworm-slim AS runtime

ENV NODE_ENV=production \
    PORT=4000 \
    # Matches the PVC mount in k8s/ and the named volume in docker-compose.
    # The DB (SQLite + WAL), local uploads, auto-backups and VAPID keys all
    # land here, so they survive restarts/redeploys (see DEPLOY.md + db.js).
    DATA_DIR=/data

WORKDIR /app

# Non-root runtime user (uid/gid 1001 — matches the pod securityContext).
RUN groupadd --system --gid 1001 broskie \
 && useradd  --system --uid 1001 --gid 1001 --home-dir /app broskie

# App code + the compiled node_modules carried over from the build stage.
COPY --from=build --chown=broskie:broskie /app/node_modules ./node_modules
COPY --chown=broskie:broskie package.json ./
COPY --chown=broskie:broskie src ./src

# Persistent data is volume-mounted at /data at runtime. Pre-create it so the
# non-root user can write even on the first run before a volume is attached.
RUN mkdir -p /data/uploads && chown -R broskie:broskie /data

USER broskie
EXPOSE 4000

# Uses Node's built-in fetch (no curl/wget needed in the slim image). Mirrors
# the Kubernetes readiness/liveness probes so `docker ps` shows health too.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Express runs in the foreground. Node is PID 1 here and explicitly traps
# SIGTERM/SIGINT (src/index.js) to run the pre-shutdown backup, then exits —
# so `terminationGracePeriodSeconds` in the Deployment gives that backup time
# to finish before the kubelet sends SIGKILL.
CMD ["node", "src/index.js"]
