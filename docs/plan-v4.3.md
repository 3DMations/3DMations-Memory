# Claude Memory Hub — Project Plan v4.3
**Date:** 2026-04-22
**Supersedes:** v4.0, v4.1, v4.2, execution brief v1.0 and v4.2
**Target machine:** Legion laptop, Ubuntu, Docker + Ollama/Qwen32B already running

One document. Strategic plan on top, tactical runbook for tonight's `claude -p`
at the bottom. Read start to finish.

---

## Philosophy

Start small. Build what you feel the absence of. Let v3.3's research become
the library of future upgrades, not the blueprint for v1.

The v3.3 plan was designing for a multi-tenant production system — mTLS with
private CA, FastMCP middleware, fire-and-forget async queues, session merging,
LLM-based goal classification, a 335-test suite. The actual use case is: one
person, six machines, no external users, on a LAN or Tailscale network.

That mismatch produced architectural research and design work that's genuinely
valuable, just not on day one. v4.3 keeps all of that as **conditional future
phases**, triggered by specific pain points rather than scheduled upfront.

---

## Governing Principles (DevOps Handbook)

**First Way — Flow.** Each phase ships a working, deployable system. If you
stopped the project after any phase, you'd still have something usable.

**Second Way — Feedback.** Every phase adds one new observability capability
before moving on. Structured logs ship with Phase 1.

**Third Way — Continual Learning.** Each phase has a wait-and-watch interval
of real use before the next starts. This is where deferred features get
validated as needed or quietly dropped.

---

## Keep / Toss / Defer — v3.3 Inventory

### Keep

| Concept | Why |
|---|---|
| Block-based design (INPUT/OUTPUT/SEAL contracts) | Valuable at any scale |
| Trigram similarity via `pg_trgm` | Correct choice; avoids embedding costs until Phase 5 |
| Tag array with GIN index | Fast, simple, scales to thousands |
| UPSERT with `GREATEST()` for confidence/recurrence | Right idempotency pattern |
| `content_hash` (SHA-256) | Detects entry mutation over time |
| Schema version table | Migration discipline is cheap upfront |
| Scrubber regex set (14 patterns) | Port into client-side skill |
| Dashboard visual design | UX was thought through; port the design, not the code |
| Capability request concept | One extra endpoint, real value |

### Toss

mTLS with private CA, FastMCP middleware, fire-and-forget analytics queue,
nginx gateway, 335-test suite, separate analytics module, error fingerprinting
with triage states, materialized views, session merging, bcrypt machine tokens.
All solved problems we don't have.

### Defer (trigger-based)

| Feature | Activation trigger |
|---|---|
| MCP protocol support | Claude Code ships native MCP clearly better than curl here |
| ⬇ Semantic search via embeddings | Trigram search misses memory you know exists, 3+ times. Uses Ollama locally → no API cost. |
| Rate limiting | Hub exposed beyond trusted network OR second user |
| Multi-user / teams | Second person wants own sessions |
| Error grouping and trend charts | Same error debugged >3 times from logs |
| Async write queue + backpressure | `/api/memories POST` p95 latency > 500ms under real use |
| Session merging | Fragmented sessions observed from one machine |
| ⬇ Goal classification | >200 sessions AND desire for pattern insights. Local Ollama → no API cost. |
| Comprehensive chaos test suite | Production bug escapes, >1 hour lost |
| Prompt/skill versioning | Need to A/B test skill changes against memory patterns |

⬇ = cheaper now that we have local Ollama/Qwen 32B.

---

## Verified Package Versions (April 22, 2026)

All verified against primary source documentation.

| Package | Version | Notes |
|---|---|---|
| Postgres | **18-alpine** (18.3 current) | AIO subsystem, native `uuidv7()`, stats preserved across major upgrades |
| Next.js | **^16.2.0** (16.2.4 current) | 15.x has CVE-2025-66478 RCE on CISA KEV list — do not use |
| React / React DOM | ^19.0.0 | Pulled by Next.js 16 |
| Drizzle ORM | **^0.45.2** | Security floor — <0.45.2 has CVE-2026-39356 SQL injection |
| Drizzle Kit | **^0.45.2** | Must match drizzle-orm |
| pg (node-postgres) | **^8.20.0** | Drizzle's recommended driver path |
| @types/pg | latest | TypeScript types |
| openai (SDK for Ollama) | **^6.34.0** | Ollama exposes `/v1/` OpenAI-compatible layer |
| Vitest | **^4.0.18** | Native ESM, zero-config TypeScript |
| Node.js | **22 LTS** | 20.9 minimum for Next.js 16; 22 recommended |
| pnpm | 10.x | Project package manager |
| Docker | 20.10+ | Needs `host.docker.internal:host-gateway` for Linux |
| Ollama | 0.3+ (0.21.x current) | Required for `/api/embed` endpoint |

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│  LAN or Tailscale network                                        │
│                                                                  │
│  Machine A (Claude Code)           Machine B (Claude Code)       │
│         │                                 │                      │
│         │ HTTPS + Bearer Token            │                      │
│         ▼                                 ▼                      │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  Hub Machine (Legion laptop, Ubuntu)                       │  │
│  │                                                            │  │
│  │  ┌──────────────────────────────┐   ┌───────────────────┐  │  │
│  │  │  Docker: Next.js 16.2.4      │   │  Host: Ollama     │  │  │
│  │  │  ├── /api/* (Route Handlers) │◄──┤  0.21.x           │  │  │
│  │  │  ├── /(pages) (dashboard)    │   │  qwen2.5:32b      │  │  │
│  │  │  └── Drizzle 0.45.2 + pg     │   │  :11434           │  │  │
│  │  └───────────┬──────────────────┘   └───────────────────┘  │  │
│  │              │                                             │  │
│  │  ┌───────────▼──────────────┐                              │  │
│  │  │  Docker: Postgres 18.3   │                              │  │
│  │  │  pg_trgm, uuidv7 native  │                              │  │
│  │  └──────────────────────────┘                              │  │
│  └────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────┘
```

Two Docker containers (`app`, `db`). Ollama runs natively on host.
Containers reach Ollama via `host.docker.internal:11434` (requires
`extra_hosts: "host.docker.internal:host-gateway"` on Linux).

---

# Phase 0 — Deployment Pipeline First

**Value:** Deploy changes with one command. Future phases depend on this.

**Principle:** Infrastructure before features.

**Build:**

```bash
cd ~/projects/claude-memory-hub
pnpm create next-app@latest app --yes
# --yes accepts defaults: TypeScript, Tailwind, ESLint, App Router,
# Turbopack, @/* import alias, AGENTS.md (helps coding agents write current Next.js code)
```

Plus `docker-compose.yml`, `Dockerfile`, CI workflow, `Makefile` (`up`/`down`/`logs`/`db`/`reset`/`test`), README.

**Seal:** `make reset && make up` from empty state → http://localhost:3000
shows "Hub — Phase 0". `make logs` shows both containers healthy. `make db`
opens psql prompt.

**Wait-and-watch:** 2–3 Hello World revisions through the pipeline before Phase 1.

---

# Phase 1 — MVP Core

**Value:** Claude Code on any machine creates memories tagged to a session
and retrieves them. Dashboard shows them.

**Principle:** Small batch size.

## Install

```bash
# Production
pnpm add drizzle-orm@^0.45.2 pg@^8.20.0 openai@^6.34.0
# Dev
pnpm add -D drizzle-kit@^0.45.2 @types/pg vitest@^4.0.18 \
  @vitejs/plugin-react jsdom @testing-library/react \
  @testing-library/dom vite-tsconfig-paths
```

## Schema (Postgres 18)

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;
-- No uuid-ossp needed — uuidv7() is native in PG18

CREATE TABLE schema_version (
  version     INTEGER PRIMARY KEY,
  description TEXT NOT NULL,
  applied_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE sessions (
  id          TEXT PRIMARY KEY,                  -- 12-char nanoid
  name        TEXT NOT NULL,                     -- "macbook-work-2026"
  token_hash  TEXT NOT NULL,                     -- SHA-256 of bearer token
  created_at  TIMESTAMPTZ DEFAULT now(),
  last_seen   TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE memories (
  id            UUID PRIMARY KEY DEFAULT uuidv7(),   -- PG18 native, time-ordered
  session_id    TEXT REFERENCES sessions(id) ON DELETE CASCADE,
  local_entry_id TEXT,                               -- from v2.3 local memory
  title         TEXT NOT NULL,
  content       TEXT,
  category      TEXT,
  tags          TEXT[] DEFAULT '{}',
  confidence    REAL DEFAULT 0.5 CHECK (confidence BETWEEN 0 AND 1),
  recurrence    INTEGER DEFAULT 1 CHECK (recurrence >= 1),
  content_hash  TEXT,                                -- SHA-256 of normalized content
  metadata      JSONB DEFAULT '{}',
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX idx_memories_session_local_id
  ON memories (session_id, local_entry_id)
  WHERE local_entry_id IS NOT NULL;

CREATE INDEX idx_memories_title_trgm ON memories USING gin (title gin_trgm_ops);
CREATE INDEX idx_memories_content_trgm ON memories USING gin (content gin_trgm_ops);
CREATE INDEX idx_memories_tags ON memories USING gin (tags);

INSERT INTO schema_version VALUES (1, 'initial schema — PG18 with uuidv7');
```

**Why uuidv7:** Random v4 UUIDs scatter across B-tree index pages, causing
write amplification. v7 embeds a timestamp, so inserts append sequentially.
Better cache locality, faster inserts, smaller indexes. Free win.

## Drizzle Schema

```typescript
// db/schema.ts
import { pgTable, text, uuid, timestamp, integer, real, jsonb,
         uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  tokenHash: text("token_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  lastSeen: timestamp("last_seen", { withTimezone: true }).defaultNow(),
});

export const memories = pgTable("memories", {
  id: uuid("id").primaryKey().default(sql`uuidv7()`),   // PG18 native
  sessionId: text("session_id").references(() => sessions.id, { onDelete: "cascade" }),
  localEntryId: text("local_entry_id"),
  title: text("title").notNull(),
  content: text("content"),
  category: text("category"),
  tags: text("tags").array().default([]),
  confidence: real("confidence").default(0.5),
  recurrence: integer("recurrence").default(1),
  contentHash: text("content_hash"),
  metadata: jsonb("metadata").default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
}, (t) => ({
  uniqueLocal: uniqueIndex("idx_memories_session_local_id")
    .on(t.sessionId, t.localEntryId)
    .where(sql`${t.localEntryId} IS NOT NULL`),
}));
```

```typescript
// db/index.ts
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
export const db = drizzle({ client: pool });
```

Use `drizzle-kit push` for schema sync during Phase 1. Switch to `generate` +
`migrate` in Phase 3 when real data exists.

## docker-compose.yml

```yaml
services:
  app:
    build: .
    ports:
      - "3000:3000"
    environment:
      DATABASE_URL: postgres://hub:${POSTGRES_PASSWORD}@db:5432/memories
      AUTH_SECRET: ${AUTH_SECRET}
      OLLAMA_URL: http://host.docker.internal:11434
      OLLAMA_MODEL: qwen2.5:32b
      AI_FEATURES_ENABLED: "false"
    extra_hosts:
      - "host.docker.internal:host-gateway"     # Linux Docker-to-host
    depends_on:
      db:
        condition: service_healthy

  db:
    image: postgres:18-alpine                    # AIO, uuidv7, better indexes
    environment:
      POSTGRES_DB: memories
      POSTGRES_USER: hub
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    volumes:
      - pgdata:/var/lib/postgresql               # PG18+ path
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U hub -d memories"]
      interval: 5s
      timeout: 5s
      retries: 5

volumes:
  pgdata:
```

## API Routes

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/sessions` | Create session, return `{id, token}` once |
| `GET`  | `/api/sessions` | List sessions |
| `POST` | `/api/memories` | Create or upsert memory (Bearer token auth) |
| `GET`  | `/api/memories?q=&session=` | Query with trigram similarity |
| `GET`  | `/api/health` | Healthcheck |

**Next.js 16 breaking change:** `params` and `searchParams` are Promises — must `await`:

```typescript
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;  // REQUIRED in Next.js 16
}
```

## Dashboard (3 pages)

- `/` — sessions list with counts and last activity
- `/s/[id]` — session memories with filter + search
- `/new` — create session, show token once

## Block Contracts

```
BLOCK: api.create_memory
INPUT:  valid bearer token, session exists, body has {title, category}
OUTPUT: 201 with memory; duplicate local_entry_id → UPSERT, not duplicate
SEAL:   test_create_returns_201
        test_upsert_idempotent_same_local_entry_id
        test_rejects_invalid_token_401

BLOCK: api.query_memories
INPUT:  session_id valid, optional q and limit params
OUTPUT: memories ordered by relevance (trigram similarity DESC when q set)
SEAL:   test_query_no_q_returns_recent
        test_query_with_q_returns_trigram_ranked
        test_query_respects_session_filter
```

## Vitest Config

```typescript
// vitest.config.mts
import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",  // API route tests; "jsdom" for React components
    globals: true,
  },
});
```

Vitest 4.x doesn't support async Server Components — fine for Phase 1 since
we're testing API routes, utility functions, and the scrubber. Component
testing waits for Playwright later.

## Seal

- `docker compose up` on fresh machine → working hub
- Create session in dashboard → copy token → curl POST memory → see in dashboard
- ~12 tests green: 4 session CRUD, 6 memory CRUD + upsert, 2 auth

**Wait-and-watch (1 week):** Use from real Claude Code sessions on 2+ machines.
Signal: did you actually remember to write to it?

---

# Phase 1.5 — Ollama Integration (Plumbing)

**Value:** Ollama connection wired and verified. No user-facing AI yet —
infrastructure ready for Phase 5.

**Principle:** Shift left. Linux Docker-to-host networking is the most likely
silent failure. Discover it tonight, not in three weeks with real data at risk.

**Effort:** ~2 hours, no wait-and-watch.

## lib/ollama.ts — Typed Client via OpenAI SDK

Ollama exposes OpenAI-compatible `/v1/`. Using the `openai` npm package (v6.34+)
points at Ollama with one config change: typed client, streaming, tool calling
all free.

```typescript
// lib/ollama.ts
import OpenAI from "openai";

const BASE_URL = process.env.OLLAMA_URL ?? "http://host.docker.internal:11434";

export const ollama = new OpenAI({
  baseURL: BASE_URL + "/v1",
  apiKey: "ollama",  // required by SDK, ignored by Ollama server
});

// Native Ollama endpoint for model list (not exposed via /v1)
export async function ollamaHealth() {
  const res = await fetch(`${BASE_URL}/api/tags`);
  if (!res.ok) throw new Error(`Ollama unreachable: HTTP ${res.status}`);
  return res.json() as Promise<{ models: Array<{ name: string; size: number }> }>;
}
```

## /api/ai/health Endpoint

```typescript
// app/api/ai/health/route.ts
import { ollamaHealth } from "@/lib/ollama";
import { NextResponse } from "next/server";

export async function GET() {
  if (process.env.AI_FEATURES_ENABLED !== "true") {
    return NextResponse.json(
      { ok: false, reason: "AI features disabled" },
      { status: 503 }
    );
  }
  try {
    const { models } = await ollamaHealth();
    return NextResponse.json({
      ok: true,
      model: process.env.OLLAMA_MODEL ?? "qwen2.5:32b",
      available: models.map((m) => m.name),
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 503 });
  }
}
```

## Seal

- `curl http://localhost:3000/api/ai/health` → 503 "AI features disabled" (flag off)
- Flip `AI_FEATURES_ENABLED=true` in `.env`, `make down && make up`
- `curl http://localhost:3000/api/ai/health` → `{"ok":true,"model":"qwen2.5:32b",...}`
- One integration test confirming Ollama reachable from app container

Flag stays off until Phase 5 or a Phase 6+ trigger needs it.

---

# Phase 2 — Useful (Search, Similarity, Compare)

**Value:** Find memories when you half-remember them. See knowledge gaps
between machines.

**What to build:**
- `GET /api/memories/search?q=` — global trigram search
- `GET /api/memories/compare?a=X&b=Y` — three-column: in A only, in B only, in both (similarity > 0.4)
- Dashboard `/search` page with debounced input
- Dashboard `/compare` page with two session pickers

```sql
-- "in both" query
SELECT a.id AS a_id, b.id AS b_id,
       similarity(a.title, b.title) AS sim,
       a.title AS a_title, b.title AS b_title
FROM memories a, memories b
WHERE a.session_id = $1 AND b.session_id = $2
  AND similarity(a.title, b.title) > 0.4
ORDER BY sim DESC
LIMIT 50;
```

**Seal:** Search returns in <200ms for <1000 memories. Compare correctly
identifies overlap. 6 new tests.

**Wait-and-watch (1 week):** Is compare surfacing real insights or noise?
Tune threshold if needed.

---

# Phase 3 — Trusted (HTTPS, Backups, Integrity)

**Value:** Put real work memories in this hub and sleep at night.

**What to build:**
- Caddy reverse proxy with automatic Let's Encrypt (or Tailscale HTTPS — simpler if already using Tailscale)
- `pg_dump` cron container, 14-day rotation
- Weekly automated backup restore smoke test
- Client-side scrubber: 14 regex patterns from v3.3 into the Claude Code skill
- `content_hash` populated on write; `/api/memories/verify` recomputes hashes

## Scrubber (client-side in Claude Code skill)

```javascript
// client-scrubber.js — runs before POST
const PATTERNS = [
  { name: 'AWS Access Key', regex: /AKIA[0-9A-Z]{16}/ },
  { name: 'Anthropic/OpenAI Key', regex: /sk-ant-[a-zA-Z0-9-]{90,}/ },
  { name: 'GitHub Token', regex: /ghp_[a-zA-Z0-9]{36}/ },
  // ...11 more from v3.3
];

function checkPayload(payload) {
  for (const [field, value] of Object.entries(payload)) {
    if (typeof value !== 'string') continue;
    for (const p of PATTERNS) {
      if (p.regex.test(value)) {
        throw new Error(`Scrubber rejected: ${p.name} in ${field}`);
      }
    }
  }
}
```

Client-side = safety net, not policy engine. Shift left.

**Postgres upgrade path:** Because we started on PG18 with the new volume
path, future major upgrades are just `postgres:18-alpine → postgres:19-alpine`
with the same volume. Stats preserved across major versions. PG19 ships
September 2026.

**Seal:** HTTPS only. Backup from last 24 hours. Restore test passed last 7
days. Scrubber blocks fake AWS key. 4 new tests.

**Wait-and-watch:** 2 weeks. Run manual restore drill at least once.

---

# Phase 4 — Observable

**Value:** Diagnose unexpected behavior in minutes, not hours.

**What to build:**
- Structured JSON logs on every API route (request_id, session_id, duration_ms, status)
- `audit_log` table — every write generates a row
- Dashboard `/stats` page: memories over time, most recurrent, recent sessions, top tags
- `/api/admin/logs` endpoint (admin token required)

```sql
CREATE TABLE audit_log (
  id          BIGSERIAL PRIMARY KEY,
  session_id  TEXT REFERENCES sessions(id),
  action      TEXT NOT NULL,
  entity_id   UUID,
  diff        JSONB,
  request_id  TEXT,
  created_at  TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_audit_session ON audit_log (session_id, created_at DESC);
```

v3.3's separate `analytics.py` with tool_calls, error_fingerprints, session_counters
collapses to this one table. Split later only if triggers demand it.

**Seal:** Every API request → structured log. Every write → audit row.
`/stats` loads in <500ms with 100+ memories. 4 new tests.

---

# Phase 5 — Self-Improving

**Value:** Hub notices patterns. Tells you what's repeated.

**What to build:**
- `GET /api/memories/gotchas` — `recurrence >= 3` OR cross-session trigram matches
- UPSERT auto-increments recurrence with `GREATEST(confidence)`
- Dashboard `/gotchas` page
- Weekly digest via local Ollama/Qwen 32B — flip `AI_FEATURES_ENABLED=true`
- "Promote to skill" export — Ollama formats memory content into markdown

## UPSERT (from v3.3)

```sql
INSERT INTO memories (session_id, local_entry_id, title, content, category, confidence, recurrence)
VALUES ($1, $2, $3, $4, $5, $6, 1)
ON CONFLICT (session_id, local_entry_id)
  WHERE local_entry_id IS NOT NULL
DO UPDATE SET
  recurrence = memories.recurrence + 1,
  confidence = GREATEST(memories.confidence, EXCLUDED.confidence),
  content    = EXCLUDED.content,
  updated_at = now()
RETURNING *;
```

## Ollama-Powered Digest

```typescript
// app/api/gotchas/digest/route.ts
import { ollama } from "@/lib/ollama";
import { db } from "@/db";
import { memories } from "@/db/schema";
import { gte } from "drizzle-orm";
import { NextResponse } from "next/server";

export async function POST() {
  const gotchas = await db.select().from(memories).where(gte(memories.recurrence, 3));
  const prompt = `Summarize these recurring gotchas into a weekly digest...\n\n${JSON.stringify(gotchas)}`;
  const completion = await ollama.chat.completions.create({
    model: process.env.OLLAMA_MODEL ?? "qwen2.5:32b",
    messages: [{ role: "user", content: prompt }],
  });
  return NextResponse.json({ digest: completion.choices[0].message.content });
}
```

All AI analysis stays local. No data leaves the Legion laptop.

**Seal:** Creating same `local_entry_id` 3 times → `recurrence = 3` and appears
in `/gotchas`. Weekly digest generates via Ollama. "Promote to skill" yields
valid markdown.

**Wait-and-watch:** 1 month. Value depends on accumulated use.

---

# Phase 6+ — Conditional Upgrades

Deferred until triggers fire. v3.3 research is a reference library now.

| Trigger | Upgrade | Effort |
|---|---|---|
| Claude Code MCP clearly better than curl | MCP protocol (v3.3 Phase D: FastMCP middleware) | 1 week |
| Search miss rate >3 | Semantic search via pgvector + Ollama `/api/embed` (local, no API cost) | 3 days |
| 2nd person wants own hub | Multi-user auth, per-user sessions | 2 weeks |
| Same error debugged >3 times | Error fingerprinting (v3.3 Phase C) | 3 days |
| API p95 > 500ms | Async write queue (v3.3 correction 2) | 3 days |
| Fragmented sessions observed | Session merging (v3.3 Phase F) | 1 week |
| >200 sessions, want patterns | Goal classification via local Ollama | 4 days |
| Production bug escapes, >1hr lost | Expand tests toward v3.3 335-test spec | Ongoing |

---

## Phase Dependency Graph

```
  Phase 0 (Pipeline)
        │
        ▼
  Phase 1 (MVP Core) ──────┐
        │                   │
        ▼                   │
  Phase 1.5 (Ollama) ───┐  │
        │                │  │
        ▼                │  │
  Phase 2 (Useful) ─────│─┐│
        │                │ ││
        ▼                │ ││
  Phase 3 (Trusted)      │ ││
        │                │ ││
        ▼                │ ││
  Phase 4 (Observable) ◄─┘ ││
        │                   │
        ▼                   │
  Phase 5 (Self-Improving)◄─┘
        │
        ▼
  Phase 6+ (Conditional — wait for triggers)
```

Phase 1.5 can happen in parallel with Phase 2 or before. Only hard dependency
is Phase 5's Ollama features needing Phase 1.5's plumbing.

---

## Timeline

| Phase | Effort | Wait-and-watch | Calendar |
|---|---|---|---|
| 0. Pipeline | 1 day | 2–3 days | 3–4 days |
| 1. MVP Core | 2–3 days | 1 week | ~10 days |
| 1.5. Ollama Plumbing | 2 hours | none | same day as Phase 1 seal |
| 2. Useful | 2 days | 1 week | ~9 days |
| 3. Trusted | 2–3 days | 2 weeks | ~17 days |
| 4. Observable | 1–2 days | 2 weeks | ~16 days |
| 5. Self-Improving | 3–4 days | 1 month | ~35 days |

Total to Phase 5: ~90 days calendar, 12–15 days build. Wait-and-watch is most
of the calendar time — that's where deferred features get validated or dropped.

---

## What Success Looks Like

**After Phase 1:** Stop re-explaining Docker networking quirks on two machines.

**After Phase 1.5:** Ollama reachable, green health check, flag off.

**After Phase 2:** Open compare view and learn something real — "I figured
out the asyncpg pool thing on work laptop but never captured it on personal."

**After Phase 3:** Real credential attempt blocked by scrubber before network.

**After Phase 4:** Dashboard glitch happens. Logs → request_id → audit_log →
fixed in 5 minutes.

**After Phase 5:** Qwen summarizes recurring gotchas: "asyncpg connection
closed hit 5 times across 3 projects — promote to root CLAUDE.md?" You do.
Error stops. All analysis stayed local.

---

## One Thing to Watch For

Scope creep during wait-and-watch periods. Every time you use Phase 1, you'll
think of 10 improvements. Resist shortcutting the wait. Most "improvements"
look silly by week 2. Real pain points emerge once obvious missing pieces
stop distracting you.

Ship bug fixes or UI polish during waits — not new functionality.

---

# ─────────────────────────────────────────────────────────────────────
# EXECUTION BRIEF — For tonight's `claude -p` run
# ─────────────────────────────────────────────────────────────────────

Everything above is strategic, 90-day. Everything below is tactical, tonight.

**Scope tonight:** Phase 0 + Phase 1 + Phase 1.5. Stop after Phase 1.5
regardless of remaining time. Phases 2–5 need real usage data between them
that `claude -p` can't generate unattended.

**Duration:** ~2–3 hours build, ~10 minutes verification.

---

## Pre-Flight Checks (Run Before Starting `claude -p`)

All must pass. The unattended run can't recover from these.

```bash
# 1. Confirm Node.js (20.9 minimum, 22 LTS recommended)
node --version

# 2. Confirm pnpm
pnpm --version
# If missing: npm install -g pnpm

# 3. Confirm Docker + Compose
docker --version && docker compose version

# 4. Confirm exact Ollama model tag
ollama list | grep -i qwen
# Adjust OLLAMA_MODEL in env block below if tag differs from "qwen2.5:32b"

# 5. Confirm Ollama version (must be 0.3+ for /api/embed)
ollama --version

# 6. Confirm Docker can reach Ollama via host.docker.internal
docker run --rm --add-host=host.docker.internal:host-gateway \
  alpine sh -c 'apk add --quiet curl && \
    curl -fsS http://host.docker.internal:11434/api/embed \
      -d "{\"model\":\"qwen2.5:32b\",\"input\":\"test\"}" | head -c 200'
# Expect: JSON with "embeddings" array
# If 404: Ollama too old. Upgrade.
# If connection refused: host-gateway broken. Check Docker 20.10+.

# 7. Pre-pull Postgres 18 image (saves time during build)
docker pull postgres:18-alpine
```

Also confirm:
- Ports 3000, 5432, 11434 not in use by other services
- `~/projects/claude-memory-hub/` is where you want the project

---

## Environment Variables (Pre-Declared for the Prompt)

These go in the prompt so Claude Code doesn't guess:

```bash
# Paths
WORK_DIR=/home/$(whoami)/projects/claude-memory-hub
ARCHIVE_DIR=${WORK_DIR}/server-v3.3-archived
APP_DIR=${WORK_DIR}/app

# Ports
APP_PORT=3000
DB_PORT=5432
OLLAMA_PORT=11434

# Database
POSTGRES_DB=memories
POSTGRES_USER=hub
POSTGRES_PASSWORD=$(openssl rand -hex 24)
DATABASE_URL=postgres://hub:${POSTGRES_PASSWORD}@db:5432/memories

# Auth
AUTH_SECRET=$(openssl rand -hex 32)

# Ollama
OLLAMA_URL=http://host.docker.internal:11434
OLLAMA_MODEL=qwen2.5:32b
AI_FEATURES_ENABLED=false

# Feature flags
DEPLOYMENT_TARGET=local
TLS_MODE=none
```

Secrets generated via `openssl rand` persist in `.env` for future `docker compose up`.

---

## v3.3 Archive Guard (Include in Prompt)

```bash
# Only archive if server/ contains v3.3 code
if [ -d "${WORK_DIR}/server" ] && [ -f "${WORK_DIR}/server/db.py" ]; then
    mv "${WORK_DIR}/server" "${ARCHIVE_DIR}"
    echo "Archived v3.3 server/ to ${ARCHIVE_DIR}"
elif [ -d "${WORK_DIR}/server" ]; then
    echo "ERROR: ${WORK_DIR}/server exists but doesn't look like v3.3 code"
    echo "       (no db.py found). Not archiving. Aborting."
    exit 1
fi

mkdir -p "${APP_DIR}"
cd "${APP_DIR}"
```

Do NOT refactor v3.3 into v4.3. Archive and start fresh with `create-next-app`.
Scrubber patterns get ported in Phase 3, not tonight.

---

## Hard Stops (Include in Prompt Verbatim)

> If any of the following happen, STOP, write state to `${WORK_DIR}/RUN_STATE.md`,
> and exit 1. Do not attempt workarounds.
>
> 1. Port 3000, 5432, or 11434 in use by something other than hub services.
>    Workaround risk: breaking unrelated service.
> 2. Docker daemon not running or `docker compose` not found.
>    Workaround risk: installing wrong version.
> 3. Ollama returns non-JSON or times out.
>    Workaround risk: silently disabling AI features without user knowing.
> 4. Tests fail for infrastructure reasons (syntax/import/type errors in scaffolding).
>    Workaround risk: suppressing tests to make run "succeed".
> 5. `pnpm install` or `docker build` fails.
>    Workaround risk: switching package managers, downgrading Node, cascading changes.
>
> For all other failures (a feature test failing, a migration needing
> adjustment), fix and continue normally.

Distinction: fix things you're building, stop on things you're not.

---

## Out-of-Scope (Include in Prompt)

Phases 2–5 are out of scope tonight. Mark them as TODO in a file, not build
targets. Specifically resist:

- "Just add search since it's small" — Phase 2 needs real Phase 1 usage data
- "Just set up HTTPS" — Phase 3 depends on Caddy vs Tailscale decision
- "Just add error fingerprinting" — Phase 4 needs usage data

---

## Verification Commands (Post-Run)

```bash
cd ~/projects/claude-memory-hub

# Services healthy
docker compose ps
# Expect: app and db both Up, both healthy

# Phase 0 seal
curl -fsS http://localhost:3000/
# Expect: 200 with "Hub" in response

# Confirm PG18 running
docker compose exec db psql -U hub -d memories -c "SELECT version();"
# Expect: "PostgreSQL 18.x" in output

# Confirm uuidv7 available natively
docker compose exec db psql -U hub -d memories -c "SELECT uuidv7();"
# Expect: valid UUID, no error

# Phase 1 seal — create session
SESSION=$(curl -fsS -X POST http://localhost:3000/api/sessions \
  -H "Content-Type: application/json" \
  -d '{"name":"verification-test"}')
echo "$SESSION"
SESSION_ID=$(echo "$SESSION" | jq -r .id)
TOKEN=$(echo "$SESSION" | jq -r .token)

# Phase 1 seal — create memory
curl -fsS -X POST "http://localhost:3000/api/memories" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"session_id\":\"$SESSION_ID\",\"title\":\"Verification memory\",\"category\":\"test\"}"
# Expect: 201 with memory object

# Phase 1 seal — query back
curl -fsS "http://localhost:3000/api/memories?session=$SESSION_ID" \
  -H "Authorization: Bearer $TOKEN"
# Expect: array with the memory

# Phase 1.5 seal — Ollama health (flag off)
curl -fsS http://localhost:3000/api/ai/health
# Expect: 503 "AI features disabled"

# Flip flag and re-verify
sed -i 's/AI_FEATURES_ENABLED=false/AI_FEATURES_ENABLED=true/' .env
docker compose down && docker compose up -d
sleep 5
curl -fsS http://localhost:3000/api/ai/health
# Expect: {"ok":true,"model":"qwen2.5:32b",...}

# Tests
make test
# Expect: ~13 tests, all green
```

Six blocks pass → run succeeded. Any fail → `RUN_STATE.md` tells you where.

---

## What the `claude -p` Prompt Must Include

1. This entire document (strategic plan for context, execution brief for action)
2. Top-line scope directive: *"Execute Phase 0, Phase 1, Phase 1.5. Stop after
   Phase 1.5 regardless of remaining time. Phases 2–5 are out of scope."*
3. Environment variable block above
4. v3.3 archive guard script above
5. Hard stops block verbatim
6. Closing instruction: *"At completion, write `RUN_STATE.md` with a checklist
   of what was built and the results of each seal condition."*

If anything fails during the run, `RUN_STATE.md` is the source of truth.
Paste it in the morning and we'll sort it.
