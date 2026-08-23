# syntax=docker/dockerfile:1

# Build the Expo web bundle separately. The mobile app itself is not run in
# Docker; EAS/Expo still creates and tests Android and iOS binaries.
FROM node:24-bookworm-slim AS web-build
WORKDIR /app/app

COPY app/package.json app/package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY app/ ./
RUN CI=true npx expo export --platform web --output-dir /tmp/plusone-web

# Install only the backend runtime dependencies. better-sqlite3 installs its
# platform-specific native binding here, inside the same Debian family used by
# the final runtime image.
FROM node:24-bookworm-slim AS server-deps
WORKDIR /app/server

# Keep compilers out of the final image, but make dependency installation
# resilient when better-sqlite3 has no matching prebuilt binary yet.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

# A small, non-root runtime image. Runtime state is written only to /data,
# which Compose mounts as a named volume; no environment files are copied.
FROM node:24-bookworm-slim AS runtime
WORKDIR /app/server

ENV NODE_ENV=production \
    PORT=4000 \
    DATA_DIR=/data

COPY --chown=node:node server/package.json ./
COPY --from=server-deps --chown=node:node /app/server/node_modules ./node_modules
COPY --chown=node:node server/src ./src
COPY --from=web-build --chown=node:node /tmp/plusone-web ./public

RUN mkdir -p /data && chown node:node /data

USER node
EXPOSE 4000

# Uses Node rather than curl/wget so no diagnostic package is carried in the
# final image. /health intentionally returns only a small, non-sensitive JSON
# readiness response after SQLite has opened and migrations have completed.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:4000/health', (res) => process.exit(res.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

CMD ["node", "src/index.js"]
