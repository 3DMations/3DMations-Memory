# Claude Memory Hub — Resolution Project Plan
# 3DMations Implementation

> **Audit Date:** 2026-04-10
> **Status:** Planning — not yet built
> **Audit Sources:** Multi-agent review of project-plan-v2.2-final.md,
>   CLAUDE_MEMORY_CENTRAL-v2.2-final.md, complete-audit-workflow.md,
>   Memory_prompt_v2_3.md + direct inspection of 3DMations-OPS and 3DMations-DEV
>
> **Legend:** [ ] Open | [~] In Progress | [x] Resolved | [!] Blocked

---

## CRITICAL ISSUES — Must fix before any production use

### AUDIT-001 — Circuit breaker has no file locking (race condition)

**Severity:** CRITICAL
**Memory entry:** learn-2026-0410-001.md
**Root cause:** Two concurrent sessions both read `failures=0`, both increment to `1`, both write back. Breaker never trips.
**Impact in 3DMations:** OPS fires multiple systemd tasks in overlapping windows (08:00 health-check, 08:05 morning-brief, 09:00 seo-audit). Concurrent Claude sessions are a certainty, not an edge case.

**Fix — all hub-sync/hub-search commands + circuit breaker check logic:**
```bash
LOCK_FILE="/tmp/claude-hub-breaker-$(basename $(pwd)).lock"
(
  flock -x 200
  STATE=$(jq -r '.state' .claude/hub-breaker.json)
  FAILURES=$(jq -r '.failures' .claude/hub-breaker.json)
  # ... state transition logic ...
  jq -n --arg state "$NEW_STATE" --argjson failures $NEW_FAILURES \
    --arg last_trip "$LAST_TRIP" \
    '{state:$state,failures:$failures,last_trip:$last_trip}' \
    > .claude/hub-breaker.json
) 200>"$LOCK_FILE"
```

**Also add:** Corrupted-JSON recovery — if `jq` returns non-zero, recreate file as `{"state":"closed","failures":0,"last_trip":""}`.

**Test criteria:**
- [ ] Run two concurrent hub-search commands; verify failures counter is exactly 2 after both fail
- [ ] Corrupt hub-breaker.json manually; verify recovery without user intervention

**Status:** [ ] Open

---

### AUDIT-002 — Meta-Harness citation is unverifiable

**Severity:** CRITICAL
**Memory entry:** learn-2026-0410-002.md
**Root cause:** "Lee et al. 2026" cannot be located on arXiv, Google Scholar, DBLP, or Semantic Scholar. "TerminalBench-2" is not a registered benchmark. No DOI or arXiv ID provided.
**Impact:** The entire v2.3 trace architecture (MH1-MH7) has no verified empirical justification.

**Fix:**
1. Add to `taxonomy.yaml`:
   ```yaml
   trace_capture_enabled: false   # experimental; enable after internal validation
   ```
2. Update `Memory_prompt_v2_3.md` Section 11 to replace the citation with:
   > "Execution traces capture diagnostic detail that summaries compress away. This hypothesis is under internal validation — see evolve-log.md for results."
3. Make all MH1/MH2 trace-capture steps conditional on `trace_capture_enabled: true`
4. Design internal validation protocol: capture traces for 60 tasks, measure retrieval utility

**Test criteria:**
- [ ] With `trace_capture_enabled: false`, verify no trace files are created during normal operation
- [ ] With `trace_capture_enabled: true`, verify traces are captured and searchable
- [ ] Internal study: 60-task sample, measure whether trace matches improved outcomes vs. summary-only

**Status:** [x] Resolved — `trace_capture_enabled: false` added to taxonomy.yaml; memory-system.md rules 11-16 now conditional on flag; citation replaced with internal validation note; rule-version snapshot created.

---

### AUDIT-003 — UPSERT timestamp nondeterminism under concurrent writes

**Severity:** CRITICAL
**Memory entry:** learn-2026-0410-004.md
**Root cause:** `updated_at = EXCLUDED.updated_at` means whichever concurrent INSERT wins the network race sets the timestamp. The earlier sync can make an entry appear older than it is.

**Fix — init.sql and api/main.py UPSERT clause:**
```sql
DO UPDATE SET
    updated_at = now(),
    last_seen = GREATEST(entries.last_seen, EXCLUDED.last_seen),
    recurrence_count = GREATEST(entries.recurrence_count, EXCLUDED.recurrence_count),
    successful_applications = GREATEST(entries.successful_applications, EXCLUDED.successful_applications),
    confidence_score = GREATEST(entries.confidence_score, EXCLUDED.confidence_score),
    what_happened = EXCLUDED.what_happened,
    correct_solution = EXCLUDED.correct_solution,
    prevention_rule = EXCLUDED.prevention_rule,
    context_notes = EXCLUDED.context_notes,
    content_hash = EXCLUDED.content_hash
```

**Test criteria:**
- [ ] Send two concurrent POSTs with same machine_id + local_entry_id; verify `updated_at` equals server time (not either client's timestamp)
- [ ] Run concurrency test from project plan Section 11.1 (20 concurrent writes from 2 terminals); verify exactly 20 entries

**Status:** [x] Resolved — `db/init.sql` uses `upsert_entry()` function with `updated_at = now()` (server-side); never `EXCLUDED.updated_at`. Same pattern enforced in `api/main.py`.

---

## HIGH PRIORITY — Fix before multi-machine deployment

### AUDIT-004 — Pending-sync retry has no trigger

**Severity:** HIGH
**Root cause:** `pending-sync.json` queues failed syncs, but no workflow specifies when retry fires.

**Fix — two options for 3DMations-OPS:**

Option A (recommended): Add to OPS's `schedule.conf`:
```
17:35 hub-sync-retry  # After daily-digest (17:00) + quality-grading (17:30)
```
Then in a new `scripts/hub-sync-retry.sh`:
```bash
#!/bin/bash
PENDING=".claude/memory/pending-sync.json"
[ -f "$PENDING" ] || exit 0
COUNT=$(jq '. | length' "$PENDING")
[ "$COUNT" -eq 0 ] && exit 0
# Source hub config and run hub-sync command
source .claude/hub-config.env
# ... retry each pending entry ...
```

Option B: Trigger retry at the START of each Claude session (read pending-sync.json during session-start capacity display).

**Test criteria:**
- [ ] Create a pending-sync.json with 3 entries; verify all 3 are retried and removed after hub comes back online
- [ ] Verify retry does not duplicate already-synced entries (UPSERT idempotency)

**Status:** [ ] Open

---

### AUDIT-005 — Bootstrap has no rollback on partial failure

**Severity:** HIGH
**Root cause:** If the mTLS test fails, `.claude/hub-config.env` and `.claude/hub-breaker.json` are left in place. Re-running bootstrap fails silently.

**Fix — add `trap` to bootstrap script (Section 3 of CLAUDE_MEMORY_CENTRAL.md):**
```bash
# At top of bootstrap, after config variables are set:
CLEANUP_ON_FAIL=false
trap 'if [ "$CLEANUP_ON_FAIL" = true ]; then
  echo "Bootstrap failed — cleaning up partial state..."
  rm -f .claude/hub-config.env .claude/hub-breaker.json
  echo "Run bootstrap again once the hub is reachable."
fi' ERR

# Before the mTLS test:
CLEANUP_ON_FAIL=true

# After successful test:
CLEANUP_ON_FAIL=false
```

**Test criteria:**
- [ ] Run bootstrap when hub is unreachable; verify no hub-config.env or hub-breaker.json remain after failure
- [ ] Re-run bootstrap after hub comes online; verify it succeeds cleanly

**Status:** [ ] Open

---

### AUDIT-006 — No schema migration strategy

**Severity:** HIGH
**Root cause:** init.sql applied once at container start. Any schema change requires stopping all clients, recreating the container, and losing in-flight syncs.

**Fix:** Add Alembic to `api/`:
```
api/
├── alembic/
│   ├── env.py
│   ├── script.py.mako
│   └── versions/
│       └── 0001_initial_schema.py   ← init.sql converted to migration
├── alembic.ini
├── main.py
├── requirements.txt                  ← add: alembic>=1.13.0
└── scrubber.py
```

Update `api/Dockerfile`:
```dockerfile
# Run migrations on startup, then start server
CMD ["sh", "-c", "alembic upgrade head && uvicorn main:app --host 0.0.0.0 --port 8484"]
```

Add to `requirements.txt`: `alembic>=1.13.0`

**Test criteria:**
- [ ] `alembic upgrade head` runs without error on fresh database
- [ ] `alembic upgrade head` is idempotent (safe to run twice)
- [ ] Add a test migration (add one column); verify it applies without downtime to existing data

**Status:** [ ] Open

---

### AUDIT-007 — No PostgreSQL backup

**Severity:** HIGH
**Root cause:** `pgdata` Docker volume is the only copy of all cross-project learnings. Volume loss = permanent data loss.

**Decision (2026-04-10):** Backup method TBD — options are GitHub (pg_dump → commit) or a dedicated backup tool (e.g., restic, Barman, pg_basebackup to external storage). To be decided before first production data is written.

**Backup script skeleton (method-agnostic):**
```bash
#!/bin/bash
# scripts/backup-hub-db.sh
TIMESTAMP=$(date +%Y%m%d-%H%M)
DUMP_FILE="/tmp/hub-backup-${TIMESTAMP}.dump"

docker exec memory-db pg_dump -U claude claude_memory \
  --format=custom --file="$DUMP_FILE"

docker cp memory-db:"$DUMP_FILE" "$DUMP_FILE"

# TODO: ship $DUMP_FILE to chosen destination (GitHub / restic / S3)
echo "Dump ready: $DUMP_FILE — upload to backup destination"
```

**Test criteria:**
- [ ] Decide backup destination (GitHub vs. external tool)
- [ ] `backup-hub-db.sh` runs without error against dedicated `memory-db` container
- [ ] Restore test: `pg_restore` from dump into a fresh container; verify row counts match

**Status:** [ ] Open — backup destination TBD

---

### AUDIT-008 — Port 5173 collision between OPS and DEV dashboards

**Severity:** HIGH
**Root cause:** Both 3DMations-OPS (Svelte dashboard) and 3DMations-DEV (React dashboard) bind to host port 5173.

**Fix — remap DEV dashboard in DEV's docker-compose.yml:**
```yaml
# In 3DMations-DEV/docker-compose.yml
dashboard:
  ports:
    - "5174:5173"   # was "5173:5173"
```

Update DEV's README and any scripts referencing port 5173 for the dashboard.

**Test criteria:**
- [ ] OPS dashboard accessible at http://localhost:5173
- [ ] DEV dashboard accessible at http://localhost:5174
- [ ] Both running simultaneously without conflict

**Status:** [ ] External action required — this project documents what must change in 3DMations-DEV, but cannot make changes to that project. The fix (remap `5173:5173` → `5174:5173` in DEV's docker-compose.yml) must be applied by whoever manages 3DMations-DEV.

---

### AUDIT-009 — Docker network isolation blocks OPS tasks from reaching hub

**Severity:** HIGH
**Root cause:** OPS uses `automation-internal` network; hub uses its own `hub-internal` network. OPS tasks cannot reach the hub by default.

**Fix:**
1. Create shared external network (one-time, run on host):
   ```bash
   docker network create 3dmations-shared
   ```

2. In 3DMations-Memory `docker-compose.yml` — add hub nginx to shared network:
   ```yaml
   networks:
     hub-internal:
       driver: bridge
     3dmations-shared:
       external: true

   services:
     gateway:
       networks:
         - hub-internal
         - 3dmations-shared
   ```

3. In 3DMations-OPS `docker/automation/docker-compose.yml` — add jarvis-postgres to shared network:
   ```yaml
   networks:
     automation-internal:
       driver: bridge
     3dmations-shared:
       external: true

   services:
     jarvis-postgres:
       networks:
         - automation-internal
         - 3dmations-shared
   ```

**Test criteria:**
- [ ] `docker exec jarvis-core ping memory-gateway` succeeds
- [ ] OPS task scripts can reach `https://memory-hub:8443/api/health`

**Status:** [~] Partial — Memory `docker-compose.yml` declares `3dmations-shared: external: true` and joins `gateway` to it (done). OPS must separately add `3dmations-shared` to its `jarvis-postgres` service — that is an external action for the OPS project. One-time host command also required: `docker network create 3dmations-shared`.

---

### AUDIT-010 — 3DMations-DEV missing .claude/memory/ directory

**Severity:** HIGH
**Root cause:** DEV has only `.claude/rules/` — the v2.3 memory system was never bootstrapped there. Hub client bootstrap requires `.claude/memory/` to exist before it runs.

**Fix:** Run the v2.3 bootstrap for the DEV project before connecting it to the hub:
```bash
cd /home/aiwork/Documents/Projects/3DMations-DEV
# Copy bootstrap script from Memory_prompt_v2_3.md Section 3 and run it
bash bootstrap-memory.sh
```

**Test criteria:**
- [ ] `.claude/memory/index.json` exists in DEV project
- [ ] `./gen-certs.sh --client 3dmations-dev` generates valid client cert
- [ ] DEV bootstrap connects successfully to hub

**Status:** [ ] Open

---

## MEDIUM PRIORITY — Fix before full rollout

### AUDIT-011 — ~~Use OPS PostgreSQL for hub~~ — CLOSED: dedicated instance chosen

**Severity:** MEDIUM → CLOSED
**Decision (2026-04-10):** Keep the hub's PostgreSQL as a dedicated container (original plan). Shared instance creates SPOF, connection pool pressure, and maintenance coupling as both systems grow. The hub's `docker-compose.yml` `db:` service stays as-is.
**AUDIT-009 still required:** The `3dmations-shared` network is still needed so OPS task scripts can reach the hub's nginx on :8443 — just not for postgres sharing.

**Status:** [x] Closed — dedicated PG instance confirmed

---

### AUDIT-012 — gen_random_uuid() misleading attribution to pgcrypto

**Severity:** MEDIUM (documentation only)
**Fix:** Update comment in `init.sql`:
```sql
-- gen_random_uuid() is built-in since PostgreSQL 13; pgcrypto retained for gen_salt() etc.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
```

**Status:** [ ] Open

---

### AUDIT-013 — nginx rate limiting uses full DN, not CN

**Severity:** MEDIUM
**Root cause:** `$ssl_client_s_dn` returns `C=US,CN=machine-a` not just `machine-a`. This works, but two machines with identical hostnames share a rate limit bucket.
**Fix:** Enforce unique hostnames in cert generation. Add to `gen-certs.sh`:
```bash
# Check for CN collision before generating
if openssl x509 -noout -subject -in "$CERT_DIR/clients/*/client.crt" 2>/dev/null | grep -q "CN=$CLIENT_NAME"; then
  echo "ERROR: Certificate with CN=$CLIENT_NAME already exists. Use a unique machine name."
  exit 1
fi
```

**Status:** [ ] Open

---

### AUDIT-014 — Certificate expiry causes silent hub access loss

**Severity:** MEDIUM
**Root cause:** Expired cert causes curl TLS failure → breaker opens → user sees "hub circuit open" with no indication the cert is the cause.
**Fix:** Check cert expiry BEFORE every hub call, not just at bootstrap. Add to hub-search.md and hub-sync.md commands:
```bash
DAYS_LEFT=$(( ($(date -d "$(openssl x509 -enddate -noout -in "$CERT_DIR/client.crt" | cut -d= -f2)" +%s) - $(date +%s)) / 86400 ))
if [ "$DAYS_LEFT" -le 0 ]; then
  echo "❌ Client certificate EXPIRED. Hub access blocked. Regenerate cert."
  echo "   Run: ./gen-certs.sh --client $(hostname) on the hub machine."
  exit 1
elif [ "$DAYS_LEFT" -lt 30 ]; then
  echo "⚠️ Cert expires in $DAYS_LEFT days — regenerate soon."
fi
```

**Status:** [ ] Open

---

### AUDIT-015 — Bootstrap leaves partial state if cert is expired at bootstrap time

**Severity:** MEDIUM
**Root cause:** Catch-22: need a valid cert to test the connection; if cert is expired, bootstrap fails but also can't self-heal.
**Fix:** Add explicit expired-cert detection with a clear message distinct from network failure:
```bash
if [ "$DAYS_LEFT" -le 0 ]; then
  echo "❌ Cannot bootstrap: client certificate is EXPIRED."
  echo "   1. On the hub machine: ./gen-certs.sh --client $(hostname)"
  echo "   2. scp new certs to ~/.claude-hub-certs/ on this machine"
  echo "   3. Re-run this bootstrap script"
  exit 2   # distinct exit code from network failure (exit 1)
fi
```

**Status:** [ ] Open

---

### AUDIT-016 — Shared API key provides no per-client audit trail

**Severity:** MEDIUM
**Root cause:** All clients use the same `API_KEY` from `.env`. A compromised key cannot be traced to a specific machine; revoking it kills all clients.
**Fix:** Extend hub to support per-client API keys stored in a `client_keys` table. Map key → machine_id. On authentication failure, log which CN tried and failed. This is a schema addition — requires AUDIT-006 (Alembic) to be in place first.

**Status:** [ ] Open | **Depends on:** AUDIT-006

---

### AUDIT-017 — Corrupted circuit breaker JSON has no recovery path

**Severity:** MEDIUM
**Fix:** Wrap all `jq` calls on `hub-breaker.json` in a validity check:
```bash
if ! jq empty .claude/hub-breaker.json 2>/dev/null; then
  echo "⚠️ hub-breaker.json corrupted — resetting to closed state"
  echo '{"state":"closed","failures":0,"last_trip":""}' > .claude/hub-breaker.json
fi
```
Add this check inside the `flock` block from AUDIT-001.

**Status:** [ ] Open | **Depends on:** AUDIT-001

---

### AUDIT-018 — Clock skew corrupts circuit breaker 5-minute timer

**Severity:** MEDIUM
**Root cause:** `last_trip` is a client-written timestamp. If the client clock drifts, `(now - last_trip)` calculations are wrong.
**Fix:** When transitioning from open to half-open, also validate that `last_trip` is a parseable date not in the future:
```bash
TRIP_EPOCH=$(date -d "$LAST_TRIP" +%s 2>/dev/null || echo 0)
NOW_EPOCH=$(date +%s)
if [ "$TRIP_EPOCH" -gt "$NOW_EPOCH" ]; then
  echo "⚠️ Breaker last_trip is in the future (clock skew?) — resetting to half-open"
  TRIP_EPOCH=$((NOW_EPOCH - 301))  # force half-open immediately
fi
```

**Status:** [ ] Open | **Depends on:** AUDIT-001

---

## LOW PRIORITY — Polish before public documentation

### AUDIT-019 — requirements.lock file not generated

**Severity:** LOW
**Fix:** Add to hub build instructions (Step 15):
```bash
docker compose run --rm api pip freeze > requirements.lock
git add requirements.lock
```

**Status:** [ ] Open

---

### AUDIT-020 — Dashboard Google Fonts CDN blocked on air-gapped networks

**Severity:** LOW
**Fix:** Add fallback CSS in `dashboard/index.html`:
```css
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600&display=swap');
body { font-family: 'Inter', system-ui, -apple-system, sans-serif; }
```
System font stack is already the fallback — just make it explicit.

**Status:** [ ] Open

---

## Port Registry — All 3DMations Host Ports

Maintained here to prevent future collisions. Update when adding any new service.

### OPS — automation stack (`docker/automation/docker-compose.yml`)
| Host Port | Container | Service | Note |
|-----------|-----------|---------|------|
| `127.0.0.1:4000` | jarvis-api | REST API | Loopback only |
| — | jarvis-postgres | PostgreSQL 16 | No host port |
| — | jarvis-core | Orchestrator | No host port |

### OPS — inference stack (`docker/inference/docker-compose.yml`)
| Host Port | Container | Service | Note |
|-----------|-----------|---------|------|
| `0.0.0.0:3000` | jarvis-webui | Open WebUI | Public-facing |
| `127.0.0.1:8888` | jarvis-searxng | SearXNG | Loopback only |
| `127.0.0.1:11434` | jarvis-ollama | Ollama (GPU) | Loopback only |

### DEV (`docker-compose.yml`)
| Host Port | Container | Service | Note |
|-----------|-----------|---------|------|
| 3001–3011 | various | microservices | — |
| 3100 | gateway | API gateway | Was 3000 — remapped, no conflict |
| 5173 | dashboard | React dashboard | Vite dev server |

### Memory Hub — this project (`docker-compose.yml`)
| Host Port | Container | Service | Note |
|-----------|-----------|---------|------|
| `aiwork-Legion.local:8443` | memory-gateway | nginx mTLS | LAN-accessible; mTLS is auth layer |
| — | memory-api | FastAPI | Internal only |
| — | memory-db | PostgreSQL 16 | Internal only |

**Hub port 8443 is confirmed clear across all stacks.**
**Hub LAN IP:** `aiwork-Legion.local` — confirmed reachable from LAN.
**Next available:** 8444, 8445 (avoid everything in the tables above)

---

## 3DMations-Specific Integration Checklist

Before first `docker compose up`:
- [ ] Create external network: `docker network create 3dmations-shared`
- [ ] Add `3dmations-shared` to OPS's `jarvis-postgres` service
- [ ] Create `claude_memory` database on OPS postgres
- [ ] Apply `init.sql` to `claude_memory` (using Alembic once AUDIT-006 is done, or manually)
- [ ] Remap DEV dashboard to port 5174
- [ ] Bootstrap DEV project's `.claude/memory/` directory
- [ ] Generate certs: `./gen-certs.sh` (CA + server)
- [ ] Generate client certs: `./gen-certs.sh --client aiwork-host`
- [ ] Generate client certs: `./gen-certs.sh --client 3dmations-dev` (if DEV runs on separate machine)
- [ ] Add hub-sync-retry to OPS `schedule.conf` at 17:35
- [ ] Add backup-hub-db to OPS `schedule.conf` at 18:00
- [ ] Set `trace_capture_enabled: false` in taxonomy.yaml (pending AUDIT-002 validation)

---

## OPS/DEV Client Integration

**Rollout order:**
1. **Phase 1 — Local (this machine):** OPS + DEV first. Same machine, same cert (`aiwork-host`). Do when each session is idle.
2. **Phase 2 — LAN machines:** CachyOS, Mac Mini, Work Laptop. Hub now bound to `aiwork-Legion.local:8443`. Certs pre-generated in `certs/clients/{machine}/`. Deploy once Phase 1 is stable and metrics are verified in dashboard.

These steps connect 3DMations-OPS and 3DMations-DEV to the Memory Hub as client machines.
**Do not run these until each project's Claude Code session is idle.**
These are additive only — no existing files in those projects are modified.

### Files created in each client project

| File | Purpose |
|------|---------|
| `.claude/hub-config.env` | Hub URL, API key, cert paths |
| `.claude/hub-breaker.json` | Circuit breaker initial state |
| `.claude/commands/hub-sync.md` | Slash command — sync entries to hub |
| `.claude/commands/hub-search.md` | Slash command — search hub from any session |

### Step 1 — Copy hub commands into each project

From the hub machine, copy the two command files:

```bash
# For OPS:
cp /home/aiwork/Documents/Projects/3DMations-Memory/.claude/commands/hub-sync.md \
   /home/aiwork/Documents/Projects/3DMations-OPS/.claude/commands/hub-sync.md

cp /home/aiwork/Documents/Projects/3DMations-Memory/.claude/commands/hub-search.md \
   /home/aiwork/Documents/Projects/3DMations-OPS/.claude/commands/hub-search.md

# For DEV:
cp /home/aiwork/Documents/Projects/3DMations-Memory/.claude/commands/hub-sync.md \
   /home/aiwork/Documents/Projects/3DMations-DEV/.claude/commands/hub-sync.md

cp /home/aiwork/Documents/Projects/3DMations-Memory/.claude/commands/hub-search.md \
   /home/aiwork/Documents/Projects/3DMations-DEV/.claude/commands/hub-search.md
```

### Step 2 — Create hub-config.env in each project

Create `.claude/hub-config.env` in each project (replace API_KEY_HERE with value from Memory Hub's `.env`):

```bash
# .claude/hub-config.env (same content for OPS and DEV — same machine, same cert)
HUB_URL=https://aiwork-Legion.local:8443
HUB_API_KEY=API_KEY_HERE
HUB_CERT_DIR=/home/aiwork/Documents/Projects/3DMations-Memory/certs/clients/aiwork-host
HUB_CA=/home/aiwork/Documents/Projects/3DMations-Memory/certs/ca.crt
```

Note: OPS and DEV share the `aiwork-host` cert — they are the same physical machine.
Replace `API_KEY_HERE` with the value of `API_KEY` from `.env` in this project.

Add to each project's `.gitignore` if not already present:
```
.claude/hub-config.env
.claude/hub-breaker.json
```

### Step 3 — Initialize circuit breaker state

```bash
# Run for each project:
echo '{"state":"closed","failures":0,"last_trip":""}' \
  > /home/aiwork/Documents/Projects/3DMations-OPS/.claude/hub-breaker.json

echo '{"state":"closed","failures":0,"last_trip":""}' \
  > /home/aiwork/Documents/Projects/3DMations-DEV/.claude/hub-breaker.json
```

### Step 4 — Verify connection from each project

```bash
# Test OPS → hub
cd /home/aiwork/Documents/Projects/3DMations-OPS
source .claude/hub-config.env
curl -sk --cert $HUB_CERT_DIR/client.crt \
         --key  $HUB_CERT_DIR/client.key \
         --cacert /home/aiwork/Documents/Projects/3DMations-Memory/certs/ca.crt \
         -H "X-API-Key: $HUB_API_KEY" \
         $HUB_URL/api/health

# Test DEV → hub
cd /home/aiwork/Documents/Projects/3DMations-DEV
source .claude/hub-config.env
curl -sk --cert $HUB_CERT_DIR/client.crt \
         --key  $HUB_CERT_DIR/client.key \
         --cacert /home/aiwork/Documents/Projects/3DMations-Memory/certs/ca.crt \
         -H "X-API-Key: $HUB_API_KEY" \
         $HUB_URL/api/health
```

Expected: `{"status":"ok","version":"2.3.0"}` from both.

### Step 5 — First sync

In each project's Claude Code session, run:
```
/hub-sync
```

After the first sync, entries appear in the dashboard at https://localhost:8443.

### Per-project .gitignore additions

Add to OPS `.gitignore` and DEV `.gitignore`:
```
.claude/hub-config.env
.claude/hub-breaker.json
```

### Phase 1 Checklist — Local (OPS + DEV on this machine)

- [ ] OPS: hub-sync.md + hub-search.md copied
- [ ] OPS: hub-config.env created with correct API key
- [ ] OPS: hub-breaker.json initialized
- [ ] OPS: hub-config.env + hub-breaker.json added to .gitignore
- [ ] OPS: connection verified (curl returns 200)
- [ ] OPS: first /hub-sync run — entries visible in dashboard
- [ ] DEV: hub-sync.md + hub-search.md copied
- [ ] DEV: hub-config.env created with correct API key
- [ ] DEV: hub-breaker.json initialized
- [ ] DEV: hub-config.env + hub-breaker.json added to .gitignore
- [ ] DEV: connection verified (curl returns 200)
- [ ] DEV: first /hub-sync run — entries visible in dashboard
- [ ] Dashboard shows 3 machines (aiwork-host via OPS, aiwork-host via DEV, aiwork-host via Memory)
- [ ] Dashboard metrics verified: active count, capacity bar, category breakdown

---

## Phase 2 — LAN Machine Integration (after Phase 1 stable)

**Pre-generated certs** (all expire 2027-04-10):

| Machine | Cert location | CN |
|---------|--------------|-----|
| CachyOS | `certs/clients/cachyos/` | cachyos |
| Mac Mini | `certs/clients/macmini/` | macmini |
| Work Laptop | `certs/clients/worklaptop/` | worklaptop |

**Per-machine setup (repeat for each):**

```bash
# 1. Copy certs to remote machine (replace USER and HOSTNAME)
scp certs/clients/cachyos/client.crt \
    certs/clients/cachyos/client.key \
    certs/clients/cachyos/client.p12 \
    certs/ca.crt \
    USER@cachyos:~/.claude-hub-certs/

# 2. SSH into remote machine, create hub-config.env in each project:
# HUB_URL=https://aiwork-Legion.local:8443
# HUB_API_KEY=<same key>
# HUB_CERT_DIR=~/.claude-hub-certs
# HUB_CA=~/.claude-hub-certs/ca.crt

# 3. Install .p12 in browser on that machine (password: memory-hub)
```

### Phase 2 Checklist

- [ ] Phase 1 complete and stable (all local metrics verified)
- [ ] CachyOS: certs copied, hub-config.env created, connection verified
- [ ] Mac Mini: certs copied, hub-config.env created, connection verified
- [ ] Work Laptop: certs copied, hub-config.env created, connection verified
- [ ] Dashboard shows all machines syncing entries

---

## Issue Summary

| ID | Title | Severity | Status | Depends On |
|----|-------|----------|--------|------------|
| AUDIT-001 | Circuit breaker file locking | CRITICAL | [x] Resolved — flock in hub-sync.md + hub-search.md | — |
| AUDIT-002 | Meta-Harness citation unverifiable | CRITICAL | [x] Resolved — trace_capture_enabled: false; steps conditional | — |
| AUDIT-003 | UPSERT timestamp nondeterminism | CRITICAL | [x] Resolved — init.sql + api/main.py use now() | — |
| AUDIT-004 | Pending-sync retry trigger | HIGH | [ ] Open | — |
| AUDIT-005 | Bootstrap rollback on failure | HIGH | [ ] Open | — |
| AUDIT-006 | No schema migration (Alembic) | HIGH | [ ] Open | — |
| AUDIT-007 | No PostgreSQL backup | HIGH | [ ] Open | AUDIT-009 |
| AUDIT-008 | Port 5173 collision OPS+DEV | HIGH | [ ] External action — remap DEV dashboard port in 3DMations-DEV project | — |
| AUDIT-009 | Docker network isolation | HIGH | [~] Partial — Memory hub docker-compose.yml declares 3dmations-shared; OPS must add it separately | — |
| AUDIT-010 | DEV missing .claude/memory/ | HIGH | [ ] Deferred — bootstrap when DEV session is idle; steps documented in OPS/DEV Client Integration section | — |
| AUDIT-011 | ~~Second PostgreSQL instance waste~~ | MEDIUM | [x] Closed — dedicated PG confirmed | — |
| AUDIT-012 | gen_random_uuid() attribution | MEDIUM | [x] Resolved — comment fixed in init.sql | — |
| AUDIT-013 | nginx DN vs CN rate limiting | MEDIUM | [x] Resolved — CN collision check in gen-certs.sh | — |
| AUDIT-014 | Cert expiry silent failure | MEDIUM | [x] Resolved — expiry check in hub-sync.md + hub-search.md + gen-certs.sh | — |
| AUDIT-015 | Bootstrap cert catch-22 | MEDIUM | [ ] Open | — |
| AUDIT-016 | Shared API key no audit trail | MEDIUM | [ ] Open | AUDIT-006 |
| AUDIT-017 | Corrupted breaker JSON recovery | MEDIUM | [x] Resolved — jq validity check inside flock block in both hub commands | AUDIT-001 |
| AUDIT-018 | Clock skew on breaker timer | MEDIUM | [x] Resolved — future-timestamp guard in both hub commands | AUDIT-001 |
| AUDIT-019 | requirements.lock not generated | LOW | [ ] Open | — |
| AUDIT-020 | Google Fonts CDN fallback | LOW | [x] Resolved — system-ui fallback stack in dashboard/index.html | — |

**Total: 0 CRITICAL · 5 HIGH · 2 MEDIUM · 1 LOW = 8 open issues (12 resolved)**
**Note: AUDIT-008 and AUDIT-009 (OPS side) require changes in other projects — not in scope for 3DMations-Memory.**

---

*Generated: 2026-04-10 | Audit: complete-audit-workflow.md + multi-agent review*
*Next action: resolve AUDIT-001, AUDIT-003, AUDIT-008, AUDIT-009 first (blocking for any deployment)*

---

## v4.3 Phase 3 — Tailnet rollout (cross-project, 2026-04-25)

The hub stack on this machine is migrating from `127.0.0.1:${APP_PORT}` (host-bound) to a Tailscale Serve sidecar — see `docs/plan-v4.3-phase-3.md` for the design. This is a cross-project action because each of the 5 machines that consume the hub (incl. 3DMations-OPS and 3DMations-DEV hosts) needs Tailscale installed and signed into the same tailnet.

**Required on each client machine (NOT in this repo):**
- Install Tailscale (`curl -fsSL https://tailscale.com/install.sh | sh` on Linux)
- `sudo tailscale up` and complete login flow (same identity as hub admin)
- Update each project's `.claude/local/hub.json` (per-project hub credentials, gitignored): change `https://<lan-ip>:8443` → `https://hub.<tailnet>.ts.net`

**Deprecated by this rollout:**
- `:8443` reservation (was for hub-tls / mTLS — replaced by Tailscale-managed certs)
- mTLS client certs in OPS/DEV — Tailscale identity is the new auth boundary

**Status:** Hub-side config landed (commit pending). Awaits user to mint Tailscale auth key and bring up. Client-machine Tailscale installs are user-driven; track per-machine status here once rollout begins.
