ARG NODE_VERSION=24

# ---------- Build stage: install, build web + server, assemble production deps ----------
FROM node:${NODE_VERSION}-bookworm-slim AS build
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0
# Toolchain is only used when no prebuilt better-sqlite3 binary matches the platform.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*
RUN corepack enable
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile

COPY . .
RUN pnpm build
# Standalone copy of the server package (dist, migrations) with production node_modules only.
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm --filter @mcproute/server deploy --prod --legacy /prod/server

# ---------- Runtime stage: API + built web UI, SQLite on a volume ----------
FROM node:${NODE_VERSION}-bookworm-slim AS runtime
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    DATABASE_PATH=/data/mcproute.db
WORKDIR /app
COPY --from=build --chown=node:node /prod/server ./apps/server
COPY --from=build --chown=node:node /app/apps/web/dist ./apps/web/dist
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/healthz').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"]
CMD ["node", "apps/server/dist/index.js"]
