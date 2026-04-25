# APP_MAP — 3DMations Memory Hub

**Last updated:** 2026-04-25 (Phase 1.6 sealed — session delete + orphan view)
**Stack version:** v4.3
**Authority:** This file is the single source of truth for every wire/connection in the running hub. Update it at the seal of each phase.

---

## Purpose

The Hub is a single-user, multi-machine memory store for Claude Code sessions. It is reached locally over HTTP and (Phase 3+) over HTTPS / Tailscale by other machines on the user's tailnet. The frontend is a Next.js dashboard; the backend is the same Next.js process exposing `/api/*` route handlers; storage is a PostgreSQL 18 container; AI capabilities reuse the OPS-owned `jarvis-ollama` container over a shared Docker network.

---

## Phase 0 — what is wired today

All wires below are live and verified by `curl` / `psql` / `docker exec` as of 2026-04-24.

```
                                   HOST: aiwork-Legion
 ┌──────────────────────────────────────────────────────────────────────────┐
 │                                                                          │
 │   Browser / curl ──HTTP──▶ 127.0.0.1:3000  ──┐                           │
 │                                              │                           │
 │   bind mounts:                               │   network: hub-internal   │
 │   ./app           ──▶ hub-app:/app           ▼                           │
 │   hub-node-modules──▶ hub-app:/app/node_modules    ┌──────────────────┐  │
 │   hub-next-cache  ──▶ hub-app:/app/.next     ┌────▶│  hub-app         │  │
 │                                              │     │  Next.js 16.2.4  │  │
 │                                              │     │  React 19.2.4    │  │
 │                                              │     │  Turbopack dev   │  │
 │                                              │     │  TS 5.9.3        │  │
 │                                              │     └────┬─────────────┘  │
 │                                              │          │                │
 │                                              │          │ DATABASE_URL   │
 │                                              │          ▼                │
 │   volume: hub-db-data                        │     ┌──────────────────┐  │
 │   ──▶ /var/lib/postgresql (PG18 root)        │     │  hub-db          │  │
 │                                              └────▶│  postgres:18     │  │
 │                                                    │  hub@memories    │  │
 │                                                    │  port 5432       │  │
 │                                                    └──────────────────┘  │
 │                                                                          │
 │                              network: jarvis-internal (external)         │
 │                                              ┌──────────────────┐        │
 │                                       wired  │  jarvis-ollama   │        │
 │                                  AI_FEATURES │  qwen3.6:35b     │        │
 │                                  _ENABLED=  ─┤  port 11434      │        │
 │                                  false       │  (OPS-owned)     │        │
 │                                              └──────────────────┘        │
 └──────────────────────────────────────────────────────────────────────────┘
```

---

## Containers (live)

| Container  | Image                  | Owner   | Networks                          | Host port           | Internal | Purpose |
|------------|------------------------|---------|-----------------------------------|---------------------|----------|---------|
| `hub-app`  | `3dmations-memory-app` | hub     | `hub-internal`, `jarvis-internal` | `127.0.0.1:3000`    | 3000     | Next.js dev server (frontend + API routes) |
| `hub-db`   | `postgres:18-alpine`   | hub     | `hub-internal`                    | (none — internal)   | 5432     | Memory store |
| `jarvis-ollama` | `ollama/ollama` | OPS     | `jarvis-internal`                 | `127.0.0.1:11434`   | 11434    | LLM inference (qwen3.6:35b). Reused, not duplicated. |

`jarvis-ollama` is **not** managed by this project's `docker-compose.yml`; we attach to it by joining `jarvis-internal` as `external: true`. The hub never restarts it.

## Networks

| Network             | Driver | Scope     | Members                             | Purpose |
|---------------------|--------|-----------|-------------------------------------|---------|
| `hub-internal`      | bridge | this stack | `hub-app`, `hub-db`                 | App ↔ database, isolated from OPS |
| `jarvis-internal`   | bridge | external   | `hub-app`, `jarvis-ollama`, OPS svcs| Hub reaches Ollama by container name |

## Volumes

| Volume               | Mounted at                       | Owner    | Purpose |
|----------------------|----------------------------------|----------|---------|
| `hub-db-data`        | `hub-db:/var/lib/postgresql`     | hub      | Postgres data root (PG18 layout — NOT `/data`) |
| `hub-node-modules`   | `hub-app:/app/node_modules`      | hub      | Speeds rebuilds; isolates host from Linux glibc deps |
| `hub-next-cache`     | `hub-app:/app/.next`             | hub      | Turbopack/dev cache |
| `./app` (bind)       | `hub-app:/app`                   | host     | Live source mount for dev hot-reload |

## Persistent port allocation policy

| Port | Container  | Phase wired | Status   |
|------|------------|-------------|----------|
| 3000 | `hub-app`  | 0           | claimed  |
| 5432 | `hub-db`   | 0           | claimed (internal only — no host binding) |
| 8443 | `hub-tls`  | 3           | reserved (Caddy or Tailscale-funnel) |
| 8444 | TBD        | —           | reserved expansion |
| 8445 | TBD        | —           | reserved expansion |

Forbidden — owned by other 3DMations stacks: 3001-3011, 3100, 4000, 4001, 5173, 8888, 11434.

---

## Workflow paths

### W1 — Browser request to landing page (Phase 0)
```
User browser
  → http GET 127.0.0.1:3000/
  → hub-app (Next.js dev server, Turbopack)
  → app/app/page.tsx (RSC, no data fetch)
  → HTML response (200)
```
No DB hit, no Ollama hit. This is the seal smoke test.

### W2 — Operator opens psql shell
```
User shell
  → make db
  → docker compose exec db psql -U hub -d memories
  → hub-db (UNIX socket inside container)
```
`hub-db` is not exposed to the host network; access requires entering the container.

### W3 — App boot (compose up)
```
docker compose up -d
  → starts hub-db
  → healthcheck: pg_isready -U hub -d memories (every 5s, ≤10 retries)
  → on healthy: starts hub-app
  → pnpm dev (next dev --port 3000 --hostname 0.0.0.0)
  → reads .env (DATABASE_URL composed at runtime, OLLAMA_URL, AUTH_SECRET, AI_FEATURES_ENABLED)
```

---

## Environment variable flow

`.env` (project root, gitignored) is loaded by both services via `env_file: .env`:

| Var                   | Consumer       | Used for |
|-----------------------|----------------|----------|
| `POSTGRES_DB`         | hub-db, hub-app| db name `memories` |
| `POSTGRES_USER`       | hub-db, hub-app| db user `hub` |
| `POSTGRES_PASSWORD`   | hub-db, hub-app| db auth (48-hex random) |
| `DATABASE_URL`        | hub-app        | `postgres://hub:<pw>@db:5432/memories` (composed in compose, not stored verbatim) |
| `AUTH_SECRET`         | hub-app        | bearer-token signing (Phase 1+) |
| `OLLAMA_URL`          | hub-app        | `http://jarvis-ollama:11434` (reached over `jarvis-internal`) |
| `OLLAMA_MODEL`        | hub-app        | `qwen3.6:35b` |
| `AI_FEATURES_ENABLED` | hub-app        | feature flag — Phase 1.5 wires this |
| `APP_PORT`            | compose        | host-side port mapping |
| `DEPLOYMENT_TARGET`   | hub-app        | `local` (Phase 0/1), `lan`/`tailscale` (Phase 3) |
| `TLS_MODE`            | hub-app        | `none` (Phase 0/1), `caddy`/`tailscale` (Phase 3) |

---

## Frontend connections (Phase 0)

| Route          | File                  | Renders                     | Data source |
|----------------|-----------------------|-----------------------------|-------------|
| `/`            | `app/app/page.tsx`    | "Hub — Phase 0" landing     | none (static RSC) |
| `/_next/*`     | (Turbopack)           | dev assets / HMR            | filesystem |
| `/favicon.ico` | `app/app/favicon.ico` | scaffold default            | filesystem |

No client-side state, no hooks, no API calls yet.

---

## Backend connections (Phase 0)

None. `hub-app` has no `/api/*` route handlers yet. The Next.js process can talk to:

- `hub-db` over TCP `db:5432` (resolved via Docker DNS on `hub-internal`) — **wired but unused**
- `jarvis-ollama` over TCP `jarvis-ollama:11434` (resolved via Docker DNS on `jarvis-internal`) — **wired but unused, gated by `AI_FEATURES_ENABLED=false`**

These will start carrying traffic in Phase 1 and Phase 1.5 respectively.

---

## Schema (Phase 1 — live)

`pg_trgm 1.6` extension enabled. PG18 native `uuidv7()` available — verified.

| Table            | Columns / notes |
|------------------|-----------------|
| `sessions`       | `id` (12-char nanoid PK), `name`, `token_hash` (sha256 hex), `created_at`, `last_seen` |
| `memories`       | `id` (uuid PK, `default uuidv7()`), `session_id` FK→sessions **ON DELETE SET NULL** (was CASCADE pre-1.6), `local_entry_id`, `title`, `content`, `category`, `tags TEXT[]`, `confidence REAL`, `recurrence INT`, `content_hash`, `metadata JSONB`, `created_at`, `updated_at` |
| `schema_version` | `version` (PK), `description`, `applied_at` — currently `(1, 'initial schema — PG18 with uuidv7')` |

Indexes on `memories`:
- `memories_pkey` (uuid)
- `idx_memories_session_local_id` UNIQUE partial — `(session_id, local_entry_id) WHERE local_entry_id IS NOT NULL` (drives upsert ON CONFLICT)
- `idx_memories_title_trgm` GIN — `(title gin_trgm_ops)`
- `idx_memories_content_trgm` GIN — `(content gin_trgm_ops)`
- `idx_memories_tags` GIN — `(tags)`

Drizzle source: `app/db/schema.ts`. Sync via `pnpm drizzle-kit push` (Phase 1) — switch to `generate` + `migrate` in Phase 3.
Extensions + GIN indexes (out of drizzle-kit's scope) are applied via `app/drizzle/post-push-init.sql`.

## API routes (Phase 1 — live)

| Method | Path                              | Auth   | Purpose |
|--------|-----------------------------------|--------|---------|
| GET    | `/api/health`                     | none   | DB ping + schema version |
| POST   | `/api/sessions`                   | none   | Create session, return `{id, token}` once |
| GET    | `/api/sessions`                   | none   | List sessions (no tokens, no hashes) |
| DELETE | `/api/sessions/:id`               | admin  | `X-Admin-Token: $AUTH_SECRET`; default sets memories' `session_id=NULL`; `?with_memories=true` cascades. 401 / 404 paths covered. |
| POST   | `/api/memories`                   | bearer | Create or upsert (on `local_entry_id`); token must match `session_id` in body |
| GET    | `/api/memories?q=&session=&limit=`| bearer | List or trigram-rank by `q` (`title %% q OR content %% q OR ILIKE`); session filter optional |
| GET    | `/api/ai/health`                  | none   | Ollama reachability behind `AI_FEATURES_ENABLED` flag — 503 when off, 200 with model list when on |

Auth: bearer token compared via SHA-256 `token_hash` with constant-time equality. Successful auth bumps `sessions.last_seen`. POST `/api/memories` requires the token's session to equal `body.session_id` (403 otherwise).

## Frontend (Phase 1 — live)

| Route        | File                          | Component | Data |
|--------------|-------------------------------|-----------|------|
| `/`          | `app/app/page.tsx`            | RSC + client trash button | sessions list with memory counts; orphan-count link (Drizzle direct read) |
| `/s/[id]`    | `app/app/s/[id]/page.tsx`     | RSC       | session detail; `?q=` switches to trigram ranking |
| `/new`       | `app/app/new/page.tsx`        | client    | POST → `/api/sessions`, displays bearer token once |
| `/orphaned`  | `app/app/orphaned/page.tsx`   | RSC       | memories with `session_id IS NULL` (after keep-memories deletes) |
| (component)  | `app/app/_components/SessionDeleteButton.tsx` | client | trash icon → modal with two explicit buttons (keep-memories vs cascade); admin token cached in `sessionStorage` per tab |

Next.js 16 dynamic-route convention: `params` and `searchParams` are awaited Promises (used in `/s/[id]`).

Schema for Phase 0 placeholder: `app/app/page.tsx.bak` (preserved per Destructive Action Guard, gitignored).

---

## Tests (Phase 1 — green)

| Suite | Tests | Coverage |
|-------|-------|----------|
| `app/__tests__/auth.test.ts`             | 2 | sha256 stability, safeEqualHex incl. malformed-hex rejection |
| `app/__tests__/sessions.test.ts`         | 4 | POST 201, POST 400 (missing/empty name), GET list (no token leakage) |
| `app/__tests__/sessions-delete.test.ts`  | 5 | DELETE 401 (no/wrong header), 404 (unknown id), 200 keep-memories (FK SET NULL verified), 200 with_memories (cascade verified) |
| `app/__tests__/memories.test.ts`         | 7 | POST 401 (no bearer), 401 (bad bearer), 403 (mismatched session), 201 + uuidv7, UPSERT idempotency, GET list scoped, GET trigram-ranked |
| `app/__tests__/orphaned.test.ts`         | 1 | After keep-memories delete, `/orphaned` SSR includes the surviving title |
| `app/__tests__/ollama.test.ts`           | 1 | `ollamaHealth()` reaches `jarvis-ollama` and returns the configured model in tag list |
| **total** | **20** | run via `make test` or `docker compose exec app pnpm test` |

Test base URL: `http://localhost:3000` (defaults to in-container; override with `HUB_BASE_URL`). Cleanup: `afterAll` deletes test sessions by name prefix; CASCADE drops their memories.

## Phase 1 seal — verified 2026-04-25

```
✓ PG 18.3 reported by SELECT version()
✓ uuidv7() native — sample 019dc20f-b561-7482-b7ca-013063794a27
✓ POST /api/sessions → 201 {id, token, ...}
✓ POST /api/memories with bearer → 201 with uuidv7 memory
✓ GET /api/memories?session=... → array
✓ vitest run → 13 passed (3 suites)
```

## Phase 1.5 — Ollama plumbing (sealed 2026-04-25)

`hub-app` reaches `jarvis-ollama` over the shared `jarvis-internal` Docker network. The wire was already verified during Phase 0; Phase 1.5 adds the typed client and a flag-gated health endpoint.

| File | Purpose |
|------|---------|
| `app/lib/ollama.ts` | OpenAI SDK pointed at `${OLLAMA_URL}/v1/` (`apiKey:"ollama"` placeholder, ignored by Ollama). `ollamaHealth()` queries Ollama's native `/api/tags` (model list — not exposed via `/v1`). |
| `app/app/api/ai/health/route.ts` | `GET` — returns 503 `{ok:false, reason:"AI features disabled"}` when `AI_FEATURES_ENABLED!=="true"`; otherwise returns 200 `{ok:true, model, available:[…]}` from `ollamaHealth()`. |
| `app/__tests__/ollama.test.ts` | Integration: confirms model list contains `OLLAMA_MODEL`. |

Feature flag default: **off** (`.env` ships with `AI_FEATURES_ENABLED=false`). Flip on only when a Phase 5+ feature needs it.

Flag-flip seal verified 2026-04-25:
```
✓ flag=false → /api/ai/health → 503 "AI features disabled"
✓ flag=true  → /api/ai/health → 200 {"model":"qwen3.6:35b","available":["qwen3.6:35b","qwen3:32b"]}
✓ flag flipped back to false; final 503; .env backups archived to .archive/env-snapshots/
✓ vitest run → 14 passed (4 suites)
```

## Phase 1.6 — Session management (sealed 2026-04-25)

`docs/plan-v4.3-phase-1.6.md` is the authoritative spec.

**Auth model chosen for DELETE:** admin-token, value = `AUTH_SECRET` from `.env`, sent as `X-Admin-Token`. Constant-time string compare (no Node `timingSafeEqual` because admin/provided lengths can differ). Admin token reuse vs `AUTH_SECRET` is a Phase 3 split candidate (TODO note in `app/app/api/sessions/[id]/route.ts`).

**FK predicate:** changed from `ON DELETE CASCADE` → `ON DELETE SET NULL`. Applied via direct ALTER (drizzle-kit push refused interactively in non-TTY context — recorded in commit message). Drizzle schema mirror updated.

**UX:** trash icon next to each session on `/`. Modal forces explicit choice — two buttons (keep-memories / cascade), no checkbox or default action. Admin token cached in `sessionStorage` per tab; cleared automatically on 401.

**Orphan view:** `/orphaned` lists `WHERE session_id IS NULL`. A small panel on `/` links to it when the orphan count is non-zero.

```
✓ ALTER TABLE memories FK → SET NULL
✓ DELETE /api/sessions/:id with X-Admin-Token guard
✓ Trash modal renders with two buttons; admin token sessionStorage cached
✓ /orphaned SSR'd 200 with NULL-session memory titles
✓ vitest run → 20 passed (6 suites)
```

## Out of scope (per plan)

| Phase | Adds | Touches APP_MAP |
|-------|------|-----------------|
| 2     | Search, similarity, compare | `/api/memories/search`, `/api/memories/compare`; `/search`, `/compare` pages |
| 3     | HTTPS termination + admin-token / signing-secret split | Adds `hub-tls` container at :8443; cron `pg_dump`; client-side scrubber; new `ADMIN_TOKEN` env distinct from `AUTH_SECRET` |
| 4-5   | Self-improvement loops | In-app only, no new containers; flips `AI_FEATURES_ENABLED=true` for real use |

This file MUST be updated at the seal of each phase.

---

## How to verify the map matches reality

```bash
docker compose ps                        # hub-app + hub-db running
docker network inspect jarvis-internal   # hub-app listed as a member
docker network inspect 3dmations-memory_hub-internal
curl -i http://localhost:3000/           # 200, "Hub — Phase 0"
make db                                  # psql opens, \dt shows nothing in Phase 0
docker exec hub-app sh -c "wget -qO- http://jarvis-ollama:11434/api/tags | head -5"
                                         # JSON model list — proves Ollama wire
```
