# 3DMations Memory Hub — Architecture

> Last updated: 2026-04-10

---

## Overview

The Memory Hub is a central PostgreSQL-backed server that aggregates Claude Code
memory entries from all machines running 3DMations projects. Each Claude session
syncs its learnings to the hub, and can search the full cross-machine knowledge base.

---

## Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| Reverse proxy / mTLS | nginx | 1.25-alpine |
| API | FastAPI + uvicorn | 0.111 / 0.29 |
| ORM | SQLAlchemy async + asyncpg | 2.0.30 / 0.29 |
| Database | PostgreSQL | 16-alpine |
| Runtime | Python | 3.12-slim |
| Container orchestration | Docker Compose | v2 |

---

## Network Topology

```
┌─────────────────────────────── Home LAN (192.168.1.x) ──────────────────────────────┐
│                                                                                       │
│  ┌─────────────────────────────── aiwork-Legion (aiwork-Legion.local) ──────────────────┐   │
│  │                                                                                │   │
│  │  ┌──────────────────────── Docker: hub-internal bridge ─────────────────┐    │   │
│  │  │                                                                        │    │   │
│  │  │  ┌──────────────┐      ┌──────────────┐      ┌──────────────────┐    │    │   │
│  │  │  │ memory-gateway│─────▶│  memory-api  │─────▶│   memory-db      │    │    │   │
│  │  │  │ nginx:1.25    │      │  FastAPI     │      │   PostgreSQL 16   │    │    │   │
│  │  │  │ :443 (int)    │      │  :8484       │      │   :5432           │    │    │   │
│  │  │  └──────┬────────┘      └──────────────┘      └──────────────────┘    │    │   │
│  │  │         │                                                               │    │   │
│  │  └─────────┼─────────────────────────────────────────────────────────────┘    │   │
│  │            │                                                                    │   │
│  │  aiwork-Legion.local:8443 ◀── mTLS ──────────────────────────────────────────────   │   │
│  │                                                                                │   │
│  └────────────────────────────────────────────────────────────────────────────────┘   │
│                          ▲                    ▲                    ▲                   │
│                          │                    │                    │                   │
│                   CachyOS/Wayland         Mac Mini           Work Laptop               │
│                   (cachyos cert)        (macmini cert)     (worklaptop cert)           │
└───────────────────────────────────────────────────────────────────────────────────────┘

 Also on aiwork-host (same cert — aiwork-host):
   3DMations-OPS  ──┐
   3DMations-DEV  ──┼──▶ aiwork-Legion.local:8443
   3DMations-Memory ┘
```

---

## Security Model

### mTLS (Mutual TLS)

Both sides of every connection present a certificate signed by the project CA.

| Certificate | Location | Purpose |
|-------------|----------|---------|
| `certs/ca.crt` + `ca.key` | Hub machine only | Signs all other certs |
| `certs/server.crt` + `server.key` | nginx container | Proves this is the real hub |
| `certs/clients/{machine}/client.crt` | Each client machine | Proves machine identity |

- CA private key never leaves `certs/ca.key` — never shared, never in a container
- Server cert SAN includes: `memory-hub`, `memory-gateway`, `localhost`, `aiwork-Legion.local`, `127.0.0.1`
- All certs expire 365 days from generation; `hub-sync.md` warns 14 days before expiry

### API Key

- Used as a secondary auth layer (`X-API-Key` header) on all `/api/*` endpoints except `/api/health` and `/api/token`
- `/api/token` returns the key to mTLS-authenticated clients — dashboard bootstraps via this
- Key stored in `.env` (gitignored), injected at container start

### nginx Rate Limiting

- `limit_req_zone $ssl_client_s_dn zone=per_client:10m rate=10r/s`
- Burst: 20 requests, nodelay
- Keyed on client cert DN — each machine has its own rate window
- HTTP 429 on limit breach

---

## Client Identity

nginx injects the client cert CN as `X-Client-CN` header. The API reads this as
`machine_id` — all entries synced from a machine are tagged with it.

```
CachyOS  → CN=cachyos   → machine_id="cachyos"
Mac Mini → CN=macmini   → machine_id="macmini"
aiwork   → CN=aiwork-host → machine_id="aiwork-host"
```

This allows dashboard filtering by machine and per-machine memory search.

---

## Database Schema

```sql
entries (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  machine_id            TEXT NOT NULL,
  local_entry_id        TEXT NOT NULL,
  -- UNIQUE(machine_id, local_entry_id) — upsert key

  title                 TEXT NOT NULL,
  category              TEXT NOT NULL,
  subcategory           TEXT,
  type                  TEXT DEFAULT 'learning',
  severity              TEXT DEFAULT 'minor',
  recurrence_count      INT  DEFAULT 1,
  successful_applications INT DEFAULT 0,
  confidence_score      NUMERIC(3,2) DEFAULT 0.10,
  tags                  TEXT[] DEFAULT '{}',

  trigger_context       TEXT,
  root_cause            TEXT,
  what_happened         TEXT,
  correct_solution      TEXT,
  prevention_rule       TEXT,
  context_notes         TEXT,

  related_files         TEXT[] DEFAULT '{}',
  related_entries       TEXT[] DEFAULT '{}',
  content_hash          TEXT,
  status                TEXT DEFAULT 'active',

  first_seen            DATE,
  last_seen             DATE,
  created_at            TIMESTAMPTZ DEFAULT now(),
  updated_at            TIMESTAMPTZ DEFAULT now()   -- set by upsert_entry(), never by client
)
```

Key indexes:
- `GIN` on `tags` array — fast `&&` overlap queries
- `GIN` on `to_tsvector(title || trigger_context || what_happened || prevention_rule)` — full-text search
- Composite `UNIQUE(machine_id, local_entry_id)` — upsert target

---

## API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/health` | None | Liveness probe |
| `GET` | `/api/token` | mTLS only | Return API key for dashboard bootstrap |
| `POST` | `/api/sync` | API key | Upsert one memory entry |
| `POST` | `/api/search` | API key | Full-text + tag search |
| `GET` | `/api/entries` | API key | Paginated entry list with filters |
| `GET` | `/api/stats` | API key | Capacity + distribution stats |
| `GET` | `/api/machines` | API key | Distinct machine IDs |
| `GET` | `/api/categories` | API key | Categories with entry counts |

---

## Data Flow: Sync

```
Claude session (any machine)
  └── /hub-sync slash command
        ├── flock -x (circuit breaker file lock)
        ├── check cert expiry
        ├── check circuit breaker state
        ├── read .claude/memory/learnings/*.md
        ├── parse YAML frontmatter → JSON
        └── POST /api/sync (one entry at a time)
              └── nginx (mTLS verify → rate limit → X-Client-CN inject)
                    └── FastAPI /api/sync
                          ├── scrub_entry() (strip credentials)
                          └── upsert_entry() PL/pgSQL → PostgreSQL
```

## Data Flow: Dashboard

```
Browser (with client.p12 installed)
  └── https://aiwork-Legion.local:8443
        └── nginx (mTLS verify → serve static files)
              └── dashboard/index.html
                    ├── GET /api/token → get API key
                    ├── GET /api/stats → capacity bar
                    ├── GET /api/categories → filter dropdown
                    ├── GET /api/machines → filter dropdown
                    └── GET /api/entries (or POST /api/search) → entry table
```

---

## Rollout Phases

### Phase 1 — Local (current)
- Hub running on `aiwork-Legion.local:8443`
- OPS + DEV on same machine → share `aiwork-host` cert
- Dashboard accessible at `https://aiwork-Legion.local:8443`

### Phase 2 — LAN Machines
- CachyOS, Mac Mini, Work Laptop get individual certs
- Certs pre-generated in `certs/clients/{machine}/`
- Deploy after Phase 1 metrics verified

---

## File Map

```
3DMations-Memory/
├── docker-compose.yml          — service orchestration
├── .env                        — DB_PASSWORD, API_KEY (gitignored)
├── gen-certs.sh                — CA + server + client cert generation
├── certs/                      — all TLS material (gitignored)
│   ├── ca.crt / ca.key
│   ├── server.crt / server.key
│   └── clients/
│       ├── aiwork-host/        — this machine
│       ├── cachyos/            — CachyOS machine
│       ├── macmini/            — Mac Mini
│       └── worklaptop/         — Work Laptop
├── nginx/
│   └── nginx.conf              — mTLS, rate limiting, proxy + static
├── api/
│   ├── main.py                 — FastAPI endpoints
│   ├── scrubber.py             — credential scrubbing
│   ├── requirements.txt
│   └── Dockerfile
├── db/
│   └── init.sql                — schema + upsert_entry() function
├── dashboard/
│   └── index.html              — single-page dashboard (XSS-safe)
└── .claude/
    ├── commands/
    │   ├── hub-sync.md         — /hub-sync slash command
    │   └── hub-search.md       — /hub-search slash command
    └── memory/                 — local Claude memory (gitignored)
```
