# syntax=docker/dockerfile:1
#
# Multi-stage production build (audit 2026-10-10). Replaces the single-stage
# dev image (archived at Dockerfile.bak) which shipped devDependencies, test
# files, and ran everything as root.
#
# Stages: deps (pnpm install) → build (next build, standalone output) →
# runner (distroless-ish runtime: node + the standalone server only, as the
# non-root `node` user, on a digest-pinned node:22-alpine).
#
# Pin: node:22-alpine@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402
# (verified 2026-10-10 via docker buildx imagetools inspect). Bump deliberately.

FROM node:22-alpine@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402 AS base

RUN apk add --no-cache libc6-compat \
 && corepack enable \
 && corepack prepare pnpm@10.33.0 --activate

# Pin pnpm store inside the named-volume mount point so build-time and
# exec-time pnpm agree on store location (avoids ERR_PNPM_UNEXPECTED_STORE
# when running `pnpm add` later).
ENV PNPM_STORE_DIR=/app/.pnpm-store
RUN pnpm config set store-dir /app/.pnpm-store --global

# ---------------------------------------------------------------- deps
FROM base AS deps
WORKDIR /app
COPY app/package.json app/pnpm-lock.yaml app/pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

# ---------------------------------------------------------------- build
FROM base AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY app/ ./
ENV NEXT_TELEMETRY_DISABLED=1
# next.config.ts sets output: "standalone" — produces .next/standalone with a
# minimal server.js that needs no node_modules.
RUN pnpm build

# ---------------------------------------------------------------- runner
FROM node:22-alpine@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402 AS runner

RUN apk add --no-cache libc6-compat

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=127.0.0.1

WORKDIR /app
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public

USER node
EXPOSE 3000

# Loopback-only: only Tailscale Serve (same netns) may reach the app. See
# docker-compose.yml — "tailnet is the only ingress" is enforced at the bind,
# not assumed.
CMD ["node", "server.js"]