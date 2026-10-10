# Architecture — 3DMations Memory Hub

*Current as of the 2026-10-10 security hardening pass. The previous
architecture document described the retired v3 stack (nginx + FastAPI +
mTLS); it is preserved verbatim at `.archive/ARCHITECTURE-mtls-era.md`.*

## One-paragraph summary

A single Docker Compose stack serves a Next.js 16 memory hub to a Tailscale
tailnet. A Tailscale sidecar (`hub-ts`) owns the network namespace and
terminates HTTPS on 443; the Next.js app shares that namespace
(`network_mode: service:ts-hub`) and binds **127.0.0.1:3000 only**, so
Tailscale Serve is the sole ingress. PostgreSQL 18 stores memories, sessions,
the audit log, and system metrics. There is no nginx, no mTLS, and no public
ingress — the tailnet is the perimeter, enforced at the bind address.

## Components

| Container | Image | Role |
|---|---|---|
| `hub-ts` | `tailscale/tailscale` (digest-pinned) | Tailnet identity, Serve HTTPS proxy 443→127.0.0.1:3000, identity headers for logged-in users. `AllowFunnel: false`. |
| `hub-app` | multi-stage build (deps → build → runner on `node:22-alpine` digest) | Next.js standalone server (`node server.js`), non-root, read-only rootfs, `cap_drop: ALL`. Frontend RSC pages + `/api/*`. |
| `hub-db` | `postgres:18-alpine` (digest-pinned) | `memories` DB: sessions, memories, audit_log, system_metrics. Internal network only, never published. |

Emergency loopback dev access: `app-debug` profile (compose) binds
`127.0.0.1:${APP_PORT}` on the host and runs `pnpm dev` with HMR. Mutually
exclusive with `hub-app` by discipline, not enforcement.

## Trust model

1. **Tailnet membership** gates everything: pages and read APIs trust any
   authenticated tailnet device.
2. **Admin actions** require either the shared admin token
   (`X-Admin-Token` = `AUTH_SECRET`, constant-time compare) — session
   minting `POST /api/sessions`, session deletion — or the
   `Tailscale-User-Login` header matching `HUB_ADMIN_LOGIN` (verify, admin
   logs, AI endpoints). Serve strips client-spoofed copies of identity
   headers; the loopback bind is the primary control making spoofing require
   netns presence.
3. **Devices** hold per-session bearer tokens (hashed at rest via unique
   index `idx_sessions_token_hash`). Revoking a device = deleting its session.

## Security controls (2026-10-10 audit, all sealed)

- Loopback-only bind inside the shared netns (blocks the shared
  `jarvis-internal` network from reaching the app directly).
- Per-service env allowlists — `TS_AUTHKEY` reaches only `ts-hub`,
  `POSTGRES_*` only `db`.
- Digest-pinned images; no `:latest` drift.
- Non-root, read-only rootfs, `cap_drop: ALL` (+ the five caps Postgres's
  entrypoint needs), `no-new-privileges`, mem/cpu limits on every service.
- Nonce-based CSP (strict `script-src`), HSTS, X-Frame-Options DENY,
  nosniff, Referrer-Policy, Permissions-Policy.
- zod-validated request bodies with length caps; ILIKE wildcard escaping;
  search terms capped at 200 chars.
- `statement_timeout` 5s + in-memory rate limiting (loopback exempt) on
  expensive unauthenticated endpoints; the trigram cross-join caps its
  candidate pool at 500 rows.
- Healthchecks end-to-end: `app` waits for `db` AND an authenticated
  `tailscaled`.
- `.env` is 0600 on the host and gitignored; scrubber skill guards secrets
  from being written into memories.

## Data flow

Claude Code client (bearer token) → Serve 443 → 127.0.0.1:3000 → API route
(zod → auth → drizzle) → Postgres. Every mutating call writes an audit row.
A 5-minute in-process collector records system metrics for `/systemhealth`.

## Build & deploy

`make up` = `docker compose up -d --build` (multi-stage image build; restarts
are instant since the runtime is prebuilt). Schema changes: `drizzle-kit
push` from the host (see `app/drizzle/post-push-init.sql` for extensions).
Tests run on the host via testcontainers (`make test`) — the production
image ships no test code. Detailed file map and phase history:
[APP_MAP.md](./APP_MAP.md).