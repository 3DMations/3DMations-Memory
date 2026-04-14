# 3DMations Memory Hub — Integration Smoke Test Checklist

> **Scope:** Iteration 1 — verify the hub itself (gateway + api + db) before any OPS/DEV
> clients connect. Phase 1 rollout sync tests and Phase 2 LAN-machine tests are
> intentionally out of scope for this iteration.
>
> **Why this exists:** The hub has zero unit or integration tests today. This checklist
> is the *first* verification layer for regressions that unit tests can't catch —
> Docker bring-up, mTLS, nginx rate limiting, the credential scrubber, UPSERT
> concurrency, dashboard behavior, and end-to-end sync flows. It exists because the
> project plan resolved 3 CRITICAL concurrency bugs (AUDIT-001, 003) manually, and
> there is no automated way to confirm a future edit doesn't reintroduce them.
>
> **Last updated:** 2026-04-13

---

## Iteration Methodology — Shake-Out Loop

Run each pass as a disciplined loop, not a free-form poke. Separate signal collection
from repair so the hotspot analysis in Section 10 reflects reality.

1. **Run** a pass top-to-bottom. Log every issue in Section 9. **Do NOT fix during the pass.**
   The purpose of a pass is to learn what is broken, not to fix it.
2. **Triage** by severity once the pass is complete.
3. **Fix** P0 and P1 items in batch. P2/P3 graduate to a polish backlog.
4. **Re-run unit tests** to confirm no regressions. *(Not applicable for iteration 1 —
   no unit test layer exists yet. Revisit after the first test suite lands.)*
5. **Snapshot** the completed pass to `docs/smoke-test-pass-{N}.md` with all checkboxes,
   logged issues, and hotspot tally frozen in place.
6. **Reset** checkboxes in this file, increment the pass counter, begin the next pass.

**Exit criteria:** A full pass completes with **zero P0 and zero P1 issues**. Only then
is the baseline considered clean. After the first clean pass, run Section 8 (Edge Cases)
as the capstone.

### Iteration Log

| Pass | Date | P0 | P1 | P2 | P3 | Status | Snapshot file |
|------|------|----|----|----|----|--------|---------------|
| 1    | 2026-04-13 | 0 | 2 | 0 | 3 | P1s fixed, pass 2 required for clean-exit | — |

**Pass 1 notes:**
- Sections 1–2 run by sub-agent A-Alpha (93 tool calls, clean signal). Sections 3–5 run in main context because sub-agent A-Beta was denied `docker exec` / `curl` by sandbox — not a hub issue, a session-level permission constraint. No issues fabricated.
- Two P1s found and **fixed between pass 1 and pass 2**: (1) `memory-gateway` IPv6-bind fix in `nginx/nginx.conf` (`listen [::]:80;` added to healthz server block); (2) `api-sync` date handling rewritten in `api/main.py` to parse ISO strings and default to `date.today()` before hitting asyncpg — CAST removed.
- AUDIT-003 regression guard **passed** after the fix: LOWER recurrence_count preserves the higher stored value (verified with rec=5 → resync rec=2 → still 5 → resync rec=10 → 10).
- Batch C endpoints validated end-to-end with real data: `/api/friction-points` correctly flags the regression-guard entry (rec=10, conf=0.3); `/api/trends` returns 3 distinct first_seen dates; `/api/cross-machine-overlap` returns empty on single-machine data (expected).
- Custom `client_type: "qwen"` stored and queryable — model-agnostic foundation confirmed functional.
- Scrubber verified end-to-end (`ghp_...` → `[REDACTED:github-pat]`).
- Pass 2 should rerun from scratch against the fixed build and exit with zero P1s.

---

## Section 0 — Pre-flight

Run before every pass. None of these should be skipped even if "nothing changed."

- [ ] `docker --version` → runtime present and responsive
- [ ] `docker compose version` → Compose v2+ (not legacy `docker-compose`)
- [ ] `ss -tln | grep 8443` → host port 8443 is free *before* bring-up
- [ ] `docker network ls | grep 3dmations-shared` → external network exists (created once: `docker network create 3dmations-shared`)
- [ ] `.env` present with `DB_PASSWORD`, `API_KEY`, `LOG_LEVEL` populated (do not echo values)
- [ ] `certs/ca.crt`, `certs/server.crt`, `certs/server.key` exist on disk
- [ ] `certs/clients/aiwork-host/` contains `client.crt`, `client.key`, `client.p12`
- [ ] Browser has `aiwork-host/client.p12` imported (password: `memory-hub`) — one-time human step, re-verify with quick dashboard load
- [ ] Git working tree state recorded in the pass snapshot header (clean vs dirty)
- [ ] Baseline unit test run: `[NOT BUILT]` — no pytest suite exists yet; this row becomes active when the first test lands
- [ ] `docker compose down` issued and exited cleanly (no orphan containers)

---

## Section 1 — Service Bring-Up

`docker compose up -d` → wait → `docker compose ps`

| Host Port | Service | Up | Logs clean | Notes |
|-----------|---------|----|------------|-------|
| 8443 → 443 | memory-gateway | [ ] | [ ] | nginx 1.25-alpine, mTLS termination |
| internal :8484 | memory-api | [ ] | [ ] | FastAPI v2.3.0 |
| internal :5432 | memory-db | [ ] | [ ] | postgres 16-alpine with pgdata volume |

- [ ] `docker compose up -d` exits 0 on first invocation
- [ ] `docker compose ps` shows all 3 containers **healthy** (not just running — wait for healthchecks)
- [ ] `memory-db` logs contain "database system is ready to accept connections"
- [ ] `memory-api` logs contain "Memory Hub API starting — v2.3.0"
- [ ] `memory-gateway` logs contain no error lines
- [ ] No container has restarted (`docker inspect --format='{{.RestartCount}}' memory-{gateway,api,db}` all = 0)
- [ ] `pgdata` volume exists and is mounted to memory-db

---

## Section 2 — Health & Connectivity

- [ ] Gateway self-healthcheck: `docker exec memory-gateway wget -qO- http://localhost:80/healthz` → `ok`
- [ ] API healthcheck via internal DNS: `docker exec memory-gateway wget -qO- http://api:8484/api/health` → `{"status":"ok","version":"2.3.0"}`
- [ ] DB readiness: `docker exec memory-db pg_isready -U claude -d claude_memory` → accepting connections
- [ ] Gateway → API name resolution: `docker exec memory-gateway getent hosts api` returns an IP
- [ ] API → DB name resolution: `docker exec memory-api getent hosts db` returns an IP
- [ ] Public endpoint reachable from host without cert: `curl -k https://aiwork-Legion.local:8443/` → 400 (mTLS required), NOT timeout or connection refused
- [ ] Public endpoint with mTLS: `curl --cert certs/clients/aiwork-host/client.crt --key certs/clients/aiwork-host/client.key --cacert certs/ca.crt -H "X-API-Key: $API_KEY" https://aiwork-Legion.local:8443/api/health` → 200 with version 2.3.0
- [ ] Wrong API key with valid mTLS: same curl with `-H "X-API-Key: WRONG"` → 401
- [ ] Nginx injects `X-Client-CN`: after a sync call, grep memory-api logs for `machine=` → value reflects the cert CN (not "unknown")
- [ ] WebSocket: N/A — HTTP only, no upgrade
- [ ] Client circuit breaker: `[NOT BUILT in hub — lives in client-side hub-sync.md; see Section 5 deferred items]`

---

## Section 3 — Core State Setup

Assumes a fresh DB. If running against a populated DB, adapt counts.

- [ ] `docker exec memory-db psql -U claude -d claude_memory -c "SELECT COUNT(*) FROM entries;"` → 0 on fresh volume
- [ ] `upsert_entry()` function present: `\df upsert_entry` shows the signature from `db/init.sql`
- [ ] All indexes present: `SELECT indexname FROM pg_indexes WHERE tablename='entries';` contains `idx_entries_machine`, `idx_entries_category`, `idx_entries_tags`, `idx_entries_status`, `idx_entries_recurrence`, `idx_entries_confidence`, `idx_entries_last_seen`, `idx_entries_fts`
- [ ] CHECK on `confidence_score`: manual insert with `confidence_score=1.5` is rejected
- [ ] CHECK on `status`: manual insert with `status='foo'` is rejected
- [ ] `UNIQUE (machine_id, local_entry_id)`: second insert with same pair upserts (no duplicate row, no error)
- [ ] `pgcrypto` extension loaded: `SELECT extname FROM pg_extension WHERE extname='pgcrypto';` returns one row

---

## Section 4 — Internal Data Plane Integrity

Uses `curl` against `/api/sync`, `/api/stats`, `/api/entries`, `/api/search`.

- [ ] First sync creates a row: POST `/api/sync` with a minimal valid entry → 200, response has `id` (UUID), DB row count is 1
- [ ] Re-sync same `local_entry_id`: `updated_at` changes (server `now()`), `first_seen` unchanged, no duplicate row
- [ ] Sync with HIGHER `recurrence_count`: row's count updates upward
- [ ] Sync with LOWER `recurrence_count` than stored: row keeps the higher value (regression guard for AUDIT-003 — this is critical)
- [ ] `successful_applications` obeys GREATEST semantics
- [ ] `confidence_score` obeys GREATEST semantics
- [ ] Sync 10 distinct entries → `/api/stats` returns `active=10`, `capacity_pct=2.0`, `machines=1` (single cert)
- [ ] `/api/categories` reflects the 10 entries' categories with correct counts
- [ ] `/api/machines` returns the CN of the test client
- [ ] Search latency baseline on empty-ish DB: POST `/api/search` with empty query, `limit=50`, record elapsed ms — flag P2 if >500ms
- [ ] No DLQ / message queue in this architecture — N/A

---

## Section 5 — External Integrations

The hub has no LLM, no third-party API, no message bus. Integration surface is minimal.

- [ ] PostgreSQL from API container: covered in Section 2 (api → db DNS and healthcheck)
- [ ] PostgreSQL from host (dev/debug path): `docker exec -it memory-db psql -U claude -d claude_memory` opens a shell successfully
- [ ] `hub-sync-retry.sh`: `[NOT BUILT — AUDIT-004]`
- [ ] `backup-hub-db.sh`: `[NOT BUILT — AUDIT-007]`
- [ ] OPS client reach via `3dmations-shared`: `[DEFERRED to iteration 2]`
- [ ] DEV client reach via `3dmations-shared`: `[DEFERRED to iteration 2]`
- [ ] Planned analytics endpoints (`/api/friction-points`, `/api/cross-machine-overlap`, `/api/trends`): `[NOT BUILT]`
- [ ] `client_type` column for model-agnostic clients: `[NOT BUILT]`

---

## Section 6 — UI Walkthrough

Open `https://aiwork-Legion.local:8443/` in a browser that has `aiwork-host/client.p12` imported.

### 6.1 — dashboard-bootstrap

- [ ] Page loads without a cert-prompt modal (cert already trusted from pre-flight)
- [ ] Browser console: zero errors, zero unhandled promise rejections
- [ ] Network tab: `/api/token` call fires and returns 200
- [ ] Status pill transitions: `● Connecting…` → `● Connected` (green) within 3s
- [ ] Top-right version label shows `v2.3.0 · ✓ healthy`
- [ ] Hard refresh (Ctrl+R) reinitializes cleanly, no flash of broken state

### 6.2 — dashboard-stats-cards

- [ ] All 5 cards render: Active Entries, Archived, Machines, Categories, Capacity Used
- [ ] Values are populated (not the `—` placeholder) after initial load completes
- [ ] On fresh DB: Active=0, Archived=0, Machines=0, Categories=0, Capacity Used=0%
- [ ] Auto-refresh every 60s observable in Network tab (`/api/stats` + `/api/health` on interval)
- [ ] Refresh spinner appears briefly during `/api/stats` fetch

### 6.3 — dashboard-capacity-bar

- [ ] Bar width matches the `capacity_pct` value
- [ ] Color bands: green below 60%, amber 60–80%, red above 80%
- [ ] Label format: `{active} / 500 entries · last sync: {timestamp}`
- [ ] Empty DB shows `last sync: never`
- [ ] After a sync, timestamp updates to local-formatted string within 60s

### 6.4 — dashboard-search-panel

- [ ] Category dropdown populates from `/api/categories`
- [ ] Machine dropdown populates from `/api/machines`
- [ ] Empty search with no filters → no output, no error
- [ ] Keyword search → results table renders
- [ ] `#tag` extraction: query `error #docker` strips `#docker` into the tags array (verify in Network payload)
- [ ] Category filter alone → results filtered to that category
- [ ] Machine filter alone → results filtered to that machine
- [ ] Combined keyword + category + machine → AND semantics (all conditions applied)
- [ ] Status toggle button (Active ↔ Archived) re-renders Recent Entries with the selected status
- [ ] Pagination: Prev/Next disabled at bounds, page count accurate
- [ ] Clear button wipes inputs *and* results, hides pagination
- [ ] Enter key in search input triggers search

### 6.5 — dashboard-entries-table

- [ ] Loads up to 25 entries on init (default `page.entries.limit = 25`)
- [ ] Columns render in order: Type, Sev, Title, Category, Machine, Tags, Rec., Conf., Last Seen
- [ ] Type badges colored correctly: mistake=red, decision=blue, insight=green, pattern=light-blue, anti-pattern=amber, learning=grey
- [ ] Severity badges colored correctly: critical/blocker=red, major=amber, minor=grey
- [ ] Click a row → detail row expands showing Trigger Context, Root Cause, What Happened, Correct Solution, Prevention Rule, Context Notes
- [ ] Click again → collapses
- [ ] Detail row for an entry missing all 6 fields → shows "No detail fields available."
- [ ] **XSS guard:** sync an entry with `title = "<script>alert(1)</script>"`, then view in table → text renders literally, no script execution
- [ ] Recurrence column formats integers, Confidence column formats as percent (e.g. `80%`)
- [ ] Category/machine filter changes reset offset to 0 and reload

---

## Section 7 — End-to-End Flows

### Flow A — Sync a net-new entry and observe it propagate (non-destructive)

Uses a unique `local_entry_id` so the test never collides with existing data and
never requires wiping the volume. Verifies *delta* behavior, not absolute state.

1. [ ] Record baseline from `/api/stats`: note `active`, `machines`, `categories`, `last_sync`
2. [ ] Generate a unique test ID for this pass, e.g. `smoke-test-$(date +%s)`
3. [ ] `curl` sync with mTLS from host using the unique `local_entry_id` and a recognizable title like `"SMOKE TEST — Flow A — {timestamp}"`
4. [ ] API response is 200 with a UUID in `id`
5. [ ] GET `/api/stats` again → `active` has incremented by exactly 1, `last_sync` is newer than the baseline
6. [ ] If the cert CN was not previously present, `machines` incremented by 1 as well
7. [ ] Dashboard auto-refresh (within 60s) or manual reload reflects the new stats
8. [ ] In Recent Entries, filter by the test CN (or search for the unique title) → the new entry is visible
9. [ ] Click the row → detail row expands with the fields from the payload
10. [ ] **Cleanup (non-destructive):** the smoke-test entry stays in the DB. To keep noise out of the live dashboard, either:
     - mark it archived via a follow-up sync with a tombstone tag like `smoke-test-archived`, OR
     - leave it; it's a single row and will be filtered out by real queries once enough real data exists
     - Do **NOT** run `TRUNCATE`, `DELETE`, or `docker compose down -v` to clean up — the destructive action guard forbids it and a leftover smoke-test row is harmless

### Flow B — Credential scrubber end-to-end

1. [ ] Sync entry with `title = "fix ghp_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA token"` → stored title contains `[REDACTED:github-pat]`
2. [ ] Sync with OpenAI-style key `sk-AAAAAAAAAAAAAAAAAAAA` → `[REDACTED:openai-key]`
3. [ ] Sync with 64-char unbroken alphanumeric → `[REDACTED:long-token]`
4. [ ] Sync with `password: hunter2` in trigger_context → `[REDACTED:password]`
5. [ ] **False-positive guard:** sync with 40-char git SHA (e.g. `a1b2c3d4e5f60718293a4b5c6d7e8f9012345678`) → **NOT** redacted
6. [ ] **False-positive guard:** sync with UUID `550e8400-e29b-41d4-a716-446655440000` → **NOT** redacted
7. [ ] Verify scrubbing happens server-side: check DB row directly, not just API response

### Flow C — Multi-client simulation (single host)

1. [ ] Generate second client cert: `./gen-certs.sh --client test-client-b`
2. [ ] Sync an entry using `aiwork-host` cert
3. [ ] Sync an entry using `test-client-b` cert
4. [ ] `/api/machines` returns both CNs
5. [ ] Dashboard Machines stat card = 2
6. [ ] Recent Entries machine filter dropdown shows both
7. [ ] Filtering by `test-client-b` shows only that client's entries

### Flow D — Rate limiting

1. [ ] Fire ~50 rapid requests from the same cert (e.g. `for i in {1..50}; do curl ... & done`)
2. [ ] Observe bursts of up to 20 succeeding, subsequent requests return 429
3. [ ] After a 1s pause, new requests accepted
4. [ ] Nginx error log records `limit_req` entries

---

## Section 8 — Edge Cases Pass (Capstone)

**Only run Section 8 after a full Section 1–7 pass completes with zero P0 and zero P1 issues.**
These checks deliberately try to break the system. Expect some to fail — the point is
to learn where the boundaries are.

### 8.1 Network / service resilience

- [ ] `docker compose kill db` mid-flight → in-progress sync returns 500, logged clearly
- [ ] `docker compose start db` → api recovers (pool reconnects on next request)
- [ ] `docker compose restart gateway` → dashboard reconnects within 60s auto-refresh cycle
- [ ] Kill `memory-api` container → gateway returns 502 Bad Gateway, `docker compose ps` shows api unhealthy
- [ ] Simulate slow DB (hold a transaction with `SELECT pg_sleep(35)`) → nginx 30s `proxy_read_timeout` fires, client gets 504
- [ ] Bring DB back up → api healthcheck transitions back to healthy without container restart

### 8.2 Concurrent / race

- [ ] **AUDIT-003 regression guard:** 20 parallel syncs with SAME `(machine_id, local_entry_id)` → exactly 1 row in DB
- [ ] 20 parallel syncs with 20 DIFFERENT `local_entry_id`s → exactly 20 rows
- [ ] Two browser tabs with different filter selections: no state bleed between tabs
- [ ] Concurrent `/api/search` during a burst of syncs → search results reflect post-commit state, no 500s

### 8.3 Data boundary / validation

- [ ] Sync with `confidence_score = 2.0` → 422 from Pydantic
- [ ] Sync with `confidence_score = -0.1` → 422
- [ ] Sync with empty `title` → 422 (Pydantic) or 500 from DB NOT NULL (either is acceptable, note which)
- [ ] Sync with `tags = null` → clean rejection, NOT a silent 500
- [ ] Sync with 100 KB `trigger_context` → accepted, searchable via FTS
- [ ] Sync with 10 MB `trigger_context` → rejected with clear error (nginx `client_max_body_size` default or api)
- [ ] Sync with malformed `first_seen: "not-a-date"` → clean 422 or 500 with a parseable error message, NOT silent success
- [ ] Sync missing required field → 422 with field name in detail

### 8.4 External integration edge cases

- [ ] DB connection pool exhaustion: fire 50 concurrent syncs (pool_size=5, max_overflow=10) → all eventually succeed, none dropped
- [ ] Malformed JSON body → 422, not 500
- [ ] Direct API call bypassing nginx (if reachable on host network) → `X-Client-CN` defaults to `"unknown"`, machine_id in DB is `"unknown"`
- [ ] Client cert signed by a different CA → nginx rejects at TLS handshake, no api log entry

### 8.5 State recovery

- [ ] `docker compose restart` all services → every synced entry persists, counts unchanged
- [ ] `docker compose down && docker compose up -d` (**without** `-v`) → data persists
- [ ] Restart mid-sync (kill api after POST received but before DB commit) → entry either fully present or fully absent, never partial
- [ ] `docker volume inspect 3dmations-memory_pgdata` shows mount point still valid after restart cycle

### 8.6 Authorization / tier boundaries

- [ ] No client cert → nginx refuses TLS handshake
- [ ] Expired client cert → nginx rejects (AUDIT-014 verify — server-side check, not client-side)
- [ ] Client cert signed by wrong CA → nginx rejects
- [ ] Valid cert + wrong API key → 401 from api
- [ ] Valid cert + valid API key → 200
- [ ] Dashboard `/api/token` endpoint: does NOT require `X-API-Key` (mTLS-only, by design) — confirm this is intentional, not a bypass
- [ ] Cert with `CN=attacker` sync → `machine_id = "attacker"` in DB (confirms CN is authoritative and NOT user-settable from the request body)

### 8.7 UI stress

- [ ] Chrome DevTools "Slow 3G" throttle: dashboard still loads, status pill correctly reflects the delay
- [ ] JavaScript disabled: page shows static shell, visibly degraded but not broken (no raw HTML dumps)
- [ ] Mobile width (375px): layout reflows, no horizontal scroll, no cut-off columns
- [ ] 500 entries in DB: Recent Entries pagination latency < 2s per page
- [ ] 10-minute soak test (dashboard open, 10 auto-refresh cycles): no climbing memory in DevTools Memory panel, no console error accumulation

---

## Section 9 — Issue Triage

**Severity definitions:**
- **P0** — blocks all work; hub unusable or data at risk
- **P1** — workaround exists but pass cannot proceed cleanly; must fix before exit criteria met
- **P2** — cosmetic or minor; graduates to polish backlog
- **P3** — polish; excluded from hotspot weighted tally

### Canonical Module List (21 modules)

Every logged issue **must** use an exact string from this list — no drift.

**Services (3)**
- `memory-gateway`
- `memory-api`
- `memory-db`

**Infra cross-cutting (5)**
- `docker-network`
- `mtls-certs`
- `nginx-ratelimit`
- `credential-scrubber`
- `pg-schema`

**UI surfaces (5)**
- `dashboard-bootstrap`
- `dashboard-stats-cards`
- `dashboard-capacity-bar`
- `dashboard-search-panel`
- `dashboard-entries-table`

**API surfaces (8)**
- `api-health`
- `api-token`
- `api-machines`
- `api-categories`
- `api-sync`
- `api-search`
- `api-entries`
- `api-stats`

### Issue Log

| # | Pass | Section | Module | Issue | Severity | Notes |
|---|------|---------|--------|-------|----------|-------|
| 1 | 1 | 1 | memory-gateway | Container reports `unhealthy` in `docker compose ps`; compose healthcheck `wget http://localhost:80/healthz` fails with "Connection refused". Root cause: nginx.conf has `listen 80` (IPv4 only, no `listen [::]:80`), and inside the nginx:1.25-alpine container busybox `wget` resolves `localhost` to IPv6 `::1` first — nothing bound on ::1 → refused. `wget http://127.0.0.1:80/healthz` from inside the same container returns `ok`. Public 443/mTLS path is unaffected and works correctly. | P1 | Found via `docker inspect memory-gateway .State.Health` — FailingStreak 10. Fix options: (a) add `listen [::]:80;` to the healthz server in nginx/nginx.conf, or (b) change docker-compose healthcheck test from `http://localhost:80/healthz` to `http://127.0.0.1:80/healthz`. Does NOT affect data plane — purely the compose-level health signal and anything that keys off it (depends_on service_healthy for future dependents). |
| 2 | 1 | 2 | api-sync | `POST /api/sync` returns 500 "Sync failed" for every valid-looking payload. Two stacked bugs: (A) `EntryIn` declares `first_seen`/`last_seen` as `str | None`, but the SQL uses `CAST(:first_seen AS DATE)` which causes asyncpg to demand a Python `date` object — raises `DataError: 'str' object has no attribute 'toordinal'` for any non-null ISO string (tried both `2026-04-13T00:00:00Z` and `2026-04-13`). (B) If `first_seen`/`last_seen` are omitted (None), asyncpg passes them through but Postgres rejects with `NotNullViolationError: null value in column "first_seen" of relation "entries" violates not-null constraint`. Net effect: there is no payload shape that succeeds from an external client — sync is fully broken on this build. | P1 | Reproduced 3× with unique `local_entry_id = smoke-alpha-{ts}-{n}`. Error visible in `docker logs memory-api`. The API schema and the DB schema disagree about nullability, AND the SQLAlchemy param layer is not converting ISO strings to dates before handing to asyncpg. This blocks every downstream smoke test in Sections 3, 4, 7 that needs to write data. Fix probably needs both: parse incoming strings to `datetime.date` in the endpoint, AND either default first_seen/last_seen to `date.today()` or relax NOT NULL in db/init.sql. Caller should decide which. |
| 3 | 1 | 2 | api-health | Checklist bullet "Wrong API key with valid mTLS: same curl with `-H 'X-API-Key: WRONG'` → 401" fails against `/api/health`: endpoint returns 200 regardless of key because `/api/health` is defined in `api/main.py` line 97 with no `verify_api_key` dependency (by-design liveness probe). Spot-checked `/api/stats` with wrong key — correctly returns 401. So auth enforcement is fine overall; the checklist expectation is wrong, not the hub. | P3 | Suggest rewording the check to: "Wrong API key against an authenticated endpoint like `/api/stats` → 401 (note: `/api/health` is intentionally unauthenticated — liveness probe)." No code fix required. |
| 4 | 1 | 1 | memory-gateway | Section 1 check "`docker compose up -d` exits 0 on first invocation" could not be validated — hub was already running at launch time per instructions "do NOT restart or rebuild". Recording as skipped, not failed. Indirect evidence all three containers reached steady state cleanly: RestartCount=0 for gateway/api/db, StartedAt timestamps cluster around 2026-04-14T01:08:58 to 01:16:56 (db first, api 8min later after db healthy, gateway 6s after api healthy — matches `depends_on: service_healthy` ordering). | P3 | Polish only — rule says pass 1 is for signal collection, and the next clean start will validate this directly. |
| 5 | 1 | 4 | api-machines | `/api/machines` returns the full client DN (`CN=aiwork-host,C=US`) rather than just the CN (`aiwork-host`). This is because nginx sets `X-Client-CN: $ssl_client_s_dn` (the full Subject DN, not just the CN attribute), and the API stores that verbatim as `machine_id`. Dashboard machine dropdown will display the ugly DN form. Functionally correct (uniquely identifies a cert), just cosmetic. | P3 | Fix options: (a) parse the CN out server-side in nginx.conf with a regex map, or (b) parse it in api/main.py when reading `X-Client-CN`. Related to AUDIT-013 (rate-limit zone uses the same DN). Reuse whichever fix AUDIT-013 adopts. |
| 6 | 1 | 4 | pg-schema | Two `upsert_entry(...)` function overloads now coexist in the DB: the original 22-argument version (pre-Batch-C) and the new 23-argument version with `p_client_type` default. Function overloading is legal in PostgreSQL and the API uses named binds so it always resolves to the new one, but keeping the dead overload is untidy and a future positional-argument caller could accidentally hit it. | P3 | Resolution requires `DROP FUNCTION upsert_entry(text,text,...,date,date);` — a destructive action per the destructive action guard, so deferred until explicit user approval. |

---

## Section 10 — Hotspot Analysis

### Weighted formula

```
weighted_total = (P0 × 5) + (P1 × 3) + (P2 × 1)
```

P3 is excluded from the tally.

### Auto-flag triggers

- 🔥 **Architectural Review required** when any ONE of:
  - 3 or more P0/P1 issues across 2 or more passes for the same module
  - 5 or more P0/P1 issues in a single pass for the same module
  - Cumulative `weighted_total ≥ 10` for the same module
- ⚠️ **Watch** — 2 or more P0/P1 in a single pass for the same module
- ✅ **Healthy** — below all the above thresholds

### Module Tally Table

Rows = modules (from canonical list). Columns = passes. Cell format: `P0/P1/P2`.
Sort descending by `weighted_total` after each pass. Empty until Pass 1 runs.

| Module | Pass 1 | Pass 2 | Pass 3 | Weighted Total | Flag |
|--------|--------|--------|--------|----------------|------|
| memory-gateway | — | — | — | 0 | ✅ |
| memory-api | — | — | — | 0 | ✅ |
| memory-db | — | — | — | 0 | ✅ |
| docker-network | — | — | — | 0 | ✅ |
| mtls-certs | — | — | — | 0 | ✅ |
| nginx-ratelimit | — | — | — | 0 | ✅ |
| credential-scrubber | — | — | — | 0 | ✅ |
| pg-schema | — | — | — | 0 | ✅ |
| dashboard-bootstrap | — | — | — | 0 | ✅ |
| dashboard-stats-cards | — | — | — | 0 | ✅ |
| dashboard-capacity-bar | — | — | — | 0 | ✅ |
| dashboard-search-panel | — | — | — | 0 | ✅ |
| dashboard-entries-table | — | — | — | 0 | ✅ |
| api-health | — | — | — | 0 | ✅ |
| api-token | — | — | — | 0 | ✅ |
| api-machines | — | — | — | 0 | ✅ |
| api-categories | — | — | — | 0 | ✅ |
| api-sync | — | — | — | 0 | ✅ |
| api-search | — | — | — | 0 | ✅ |
| api-entries | — | — | — | 0 | ✅ |
| api-stats | — | — | — | 0 | ✅ |

### Decision options for flagged modules

When a module hits 🔥 Architectural Review, pick one:

- **Rework** — refactor in place (kept behavior, changed internals)
- **Rebuild** — rewrite cleanly (new implementation, same contract)
- **Scrap** — remove the module entirely (feature no longer justified)
- **Accept** — keep as-is (**requires written justification** in the decision log)

### Decision Log

| Date | Module | Decision | Justification | Owner |
|------|--------|----------|---------------|-------|
| —    | —      | —        | —             | —     |

---

## Appendix — References

- `ARCHITECTURE.md` — stack, network topology, security model, API endpoints
- `PROJECT_PLAN_HUB.md` — audit items, Phase 1/2 rollout checklists, port registry
- `CLAUDE.md` — destructive action guard and memory system rules
- `db/init.sql` — schema, `upsert_entry()` function, indexes
- `api/main.py` — endpoint implementations
- `api/scrubber.py` — credential scrubber (X1–X4 rules)
- `nginx/nginx.conf` — mTLS, rate limiting, reverse proxy
- `.claude/rules/audit-rules.md` — audit rules enforced by memory-audit
