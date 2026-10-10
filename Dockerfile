# Phase 0 — dev-mode Next.js container.
# Hardened multi-stage prod build lands in Phase 3.
FROM node:20-alpine

RUN apk add --no-cache libc6-compat \
 && corepack enable \
 && corepack prepare pnpm@10.33.0 --activate

WORKDIR /app

# Pin pnpm store inside the named-volume mount point so build-time and
# exec-time pnpm agree on store location (avoids ERR_PNPM_UNEXPECTED_STORE
# when running `pnpm add` later).
ENV PNPM_STORE_DIR=/app/.pnpm-store
RUN pnpm config set store-dir /app/.pnpm-store --global

COPY app/package.json app/pnpm-lock.yaml app/pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY app/ ./

EXPOSE 3000

# Loopback fallback: only Serve (same netns) may reach the app. If compose's
# command is ever dropped, dev mode must NOT re-expose :3000 on shared bridges.
CMD ["pnpm", "dev", "--port", "3000", "--hostname", "127.0.0.1"]
