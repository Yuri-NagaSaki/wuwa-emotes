# 潮池 application image. One image, four entry points (all on Bun):
#   web      bun .output/server/index.mjs   (default CMD)
#   worker   bun src/worker.ts
#   migrate  bun src/migrate.ts
#   cli      bun src/cli.ts <command>
# Build: docker build -t chaochi/app:<tag> --build-arg CHAOCHI_REVISION=<tag> .

ARG BUN_IMAGE=oven/bun:1.4.3-slim

# ---- dependencies (all, for the build) ----
FROM ${BUN_IMAGE} AS deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# ---- build: Nitro output in .output/ ----
FROM deps AS build
COPY . .
RUN bun run build

# ---- production dependencies only (sharp + its linux-x64 glibc @img/* packages, pg, pg-boss, ...) ----
FROM ${BUN_IMAGE} AS prod-deps
WORKDIR /app
COPY package.json bun.lock ./
# bun installs every libc variant of optional native packages; the base image is glibc (Debian),
# so the musl builds (sharp/libvips, rolldown, lightningcss) can never load. Dropping them saves ~57 MB.
RUN bun install --frozen-lockfile --production \
 && find node_modules -mindepth 1 -maxdepth 2 -type d \( -name '*linuxmusl*' -o -name '*-musl' \) -prune -exec rm -rf {} + \
 && ls node_modules/@img

# ---- PGDG signing key, delivered through Debian's own signed archive (postgresql-common) ----
FROM ${BUN_IMAGE} AS pgdg-key
RUN apt-get update \
 && apt-get install -y --no-install-recommends postgresql-common \
 && cp /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc /pgdg.asc

# ---- runtime ----
FROM ${BUN_IMAGE} AS runtime
ARG PG_MAJOR=18
# tini: PID 1 that forwards SIGTERM to bun and reaps children (pg_dump in the backup job).
# postgresql-client-18: pg_dump / pg_restore matching the PostgreSQL 18 server, from the PGDG repo.
COPY --from=pgdg-key /pgdg.asc /usr/share/keyrings/pgdg.asc
RUN set -eux; \
    . /etc/os-release; \
    apt-get update; \
    apt-get install -y --no-install-recommends ca-certificates; \
    echo "deb [signed-by=/usr/share/keyrings/pgdg.asc] https://apt.postgresql.org/pub/repos/apt ${VERSION_CODENAME}-pgdg main" \
      > /etc/apt/sources.list.d/pgdg.list; \
    apt-get update; \
    apt-get install -y --no-install-recommends tini "postgresql-client-${PG_MAJOR}"; \
    rm -rf /var/lib/apt/lists/*; \
    pg_dump --version

WORKDIR /app
ENV NODE_ENV=production
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/.output ./.output
COPY package.json tsconfig.json ./
COPY drizzle ./drizzle
COPY src ./src
COPY deploy/healthcheck.ts ./deploy/healthcheck.ts

ARG CHAOCHI_REVISION=dev
ENV CHAOCHI_REVISION=${CHAOCHI_REVISION}
LABEL org.opencontainers.image.title="chaochi" \
      org.opencontainers.image.revision="${CHAOCHI_REVISION}"

# Files stay root-owned and read-only for the app; the process runs as the base image's `bun` user.
USER bun
ENV PORT=3000
EXPOSE 3000

# Web health (/api/health, see deploy/healthcheck.ts). compose.yaml disables it for worker and migrate.
# --start-interval needs Docker Engine 25+.
HEALTHCHECK --interval=10s --timeout=4s --start-period=60s --start-interval=1s --retries=3 \
  CMD ["bun", "/app/deploy/healthcheck.ts"]

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["bun", ".output/server/index.mjs"]
