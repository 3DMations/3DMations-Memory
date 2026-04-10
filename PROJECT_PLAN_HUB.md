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

**Status:** [ ] Open

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

**Status:** [ ] Open

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

**Status:** [ ] Open

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

**Status:** [ ] Open

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

## Issue Summary

| ID | Title | Severity | Status | Depends On |
|----|-------|----------|--------|------------|
| AUDIT-001 | Circuit breaker file locking | CRITICAL | [ ] Open | — |
| AUDIT-002 | Meta-Harness citation unverifiable | CRITICAL | [ ] Open | — |
| AUDIT-003 | UPSERT timestamp nondeterminism | CRITICAL | [ ] Open | — |
| AUDIT-004 | Pending-sync retry trigger | HIGH | [ ] Open | — |
| AUDIT-005 | Bootstrap rollback on failure | HIGH | [ ] Open | — |
| AUDIT-006 | No schema migration (Alembic) | HIGH | [ ] Open | — |
| AUDIT-007 | No PostgreSQL backup | HIGH | [ ] Open | AUDIT-009 |
| AUDIT-008 | Port 5173 collision OPS+DEV | HIGH | [ ] Open | — |
| AUDIT-009 | Docker network isolation | HIGH | [ ] Open | — |
| AUDIT-010 | DEV missing .claude/memory/ | HIGH | [ ] Open | — |
| AUDIT-011 | ~~Second PostgreSQL instance waste~~ | MEDIUM | [x] Closed — dedicated PG confirmed | — |
| AUDIT-012 | gen_random_uuid() attribution | MEDIUM | [ ] Open | — |
| AUDIT-013 | nginx DN vs CN rate limiting | MEDIUM | [ ] Open | — |
| AUDIT-014 | Cert expiry silent failure | MEDIUM | [ ] Open | — |
| AUDIT-015 | Bootstrap cert catch-22 | MEDIUM | [ ] Open | — |
| AUDIT-016 | Shared API key no audit trail | MEDIUM | [ ] Open | AUDIT-006 |
| AUDIT-017 | Corrupted breaker JSON recovery | MEDIUM | [ ] Open | AUDIT-001 |
| AUDIT-018 | Clock skew on breaker timer | MEDIUM | [ ] Open | AUDIT-001 |
| AUDIT-019 | requirements.lock not generated | LOW | [ ] Open | — |
| AUDIT-020 | Google Fonts CDN fallback | LOW | [ ] Open | — |

**Total: 3 CRITICAL · 7 HIGH · 7 MEDIUM · 2 LOW = 19 open issues (1 closed)**

---

*Generated: 2026-04-10 | Audit: complete-audit-workflow.md + multi-agent review*
*Next action: resolve AUDIT-001, AUDIT-003, AUDIT-008, AUDIT-009 first (blocking for any deployment)*
