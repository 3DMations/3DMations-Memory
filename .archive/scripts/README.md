# scripts/

Operational helper scripts for the 3DMations Memory Hub.

## Index

| Script | Purpose | Run from | Audit ref |
|---|---|---|---|
| `hub-sync-retry.sh` | Retries entries queued in a client project's `.claude/memory/pending-sync.json` when a previous `hub-sync` failed. Reads `.claude/hub-config.env` for hub URL / mTLS certs / API key. Uses `flock` to serialize concurrent runs and atomically rewrites `pending-sync.json` via tempfile+`mv`. | The client project root (the directory that contains `.claude/memory/pending-sync.json`), **not** the hub repo. | AUDIT-004 |

## Exit codes (hub-sync-retry.sh)

- `0` — queue drained, empty, missing, or network/transient failures left in queue for next run.
- `2` — client certificate expired (fail fast, distinct from network failure — see AUDIT-014).

## Integration

Per AUDIT-004 Option A, add to the OPS project's `schedule.conf`:

```
17:35 hub-sync-retry  # runs after daily-digest (17:00) + quality-grading (17:30)
```

so pending entries are flushed after the nightly batch jobs. Option B (trigger at
Claude session start) is also viable; see `PROJECT_PLAN_HUB.md` AUDIT-004 for
tradeoffs.

## Manual test

From a client project whose hub-config is wired up:

```bash
cd /path/to/client-project
bash /home/aiwork/Documents/Projects/3DMations-Memory/scripts/hub-sync-retry.sh
```

Script logs every action to stderr under the `[hub-sync-retry]` prefix.
