# syntax=docker/dockerfile:1

# NOTE: the Node version is PINNED (here, .nvmrc, package.json engines,
# render.yaml) on purpose. Node 24.19.0+ ships an ObjectWrap cleanup-hook
# change that aborts NAN-based native addons — better-sqlite3 dies with
# "Assertion failed: (env) != nullptr" in RemoveEnvironmentCleanupHook from
# Statement::~Statement, crash-looping the container. 24.18.0 is the last
# known-good runtime. Bump DELIBERATELY only after a fixed Node release
# (see nodejs/node issue #65446) is confirmed.
# Build the Expo web bundle separately. The mobile app itself is not run in
# Docker; EAS/Expo still creates and tests Android and iOS binaries.
FROM node:24.18.0-bookworm-slim AS web-build
WORKDIR /app/app

COPY app/package.json app/package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY app/ ./
RUN CI=true npx expo export --platform web --output-dir /tmp/plusone-web

# Install only the backend runtime dependencies. better-sqlite3 installs its
# platform-specific native binding here, inside the same Debian family used by
# the final runtime image.
FROM node:24.18.0-bookworm-slim AS server-deps
WORKDIR /app/server

# Keep compilers out of the final image, but make dependency installation
# resilient when better-sqlite3 has no matching prebuilt binary yet.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

# A small runtime image. Runtime state is written only to /data, which
# Compose/Railway mount as a volume. The entrypoint starts as root so it
# can chown that volume (Railway mounts volumes as root) and then drops
# to the `node` user. No environment files are copied.
FROM node:24.18.0-bookworm-slim AS runtime
WORKDIR /app/server

# gosu is used by docker-entrypoint.sh to drop root after fixing volume
# ownership. RAILWAY_RUN_UID=0 is the official Railway override when a
# volume is attached: volumes are mounted as root, and a non-root uid
# cannot write tomodachi.db (SQLITE_READONLY).
RUN apt-get update \
  && apt-get install -y --no-install-recommends gosu \
  && rm -rf /var/lib/apt/lists/* \
  && gosu nobody true

ENV NODE_ENV=production \
    PORT=4000 \
    DATA_DIR=/data \
    RAILWAY_RUN_UID=0

COPY --chown=node:node server/package.json ./
COPY --from=server-deps --chown=node:node /app/server/node_modules ./node_modules
COPY --chown=node:node server/src ./src
COPY --from=web-build --chown=node:node /tmp/plusone-web ./public
COPY --chmod=755 server/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

RUN mkdir -p /data && chown node:node /data

EXPOSE 4000

# Uses Node rather than curl/wget so no diagnostic package is carried in the
# final image. /health intentionally returns only a small, non-sensitive JSON
# readiness response after SQLite has opened and migrations have completed.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:4000/health', (res) => process.exit(res.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "src/index.js"]
