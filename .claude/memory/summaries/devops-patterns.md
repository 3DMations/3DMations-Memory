# devops-patterns

*Last regenerated: 2026-04-10 — 2 active entries*

---

## Docker Networking (3DMations Multi-Stack)

**ALWAYS inventory all ports and networks across ALL stacks before adding a new Docker service.**
When running OPS, DEV, and Memory Hub on the same host:
- Create one named external network (`3dmations-shared`) for cross-stack communication
- OPS postgres joins `3dmations-shared` so hub API can reach it
- Hub nginx joins `3dmations-shared` so OPS tasks can reach the hub
- Dashboard port conflicts: OPS :5173 (Svelte), DEV remapped to :5174 (React), Hub served through nginx :8443

Shared PostgreSQL pattern: add `claude_memory` database to existing `jarvis-postgres` container rather than spinning a second PG instance. Apply schema via `docker exec jarvis-postgres psql -U jarvis -d claude_memory < init.sql`.

---

## Circuit Breaker Concurrency (bash + JSON file)

**ALWAYS use `flock` when bash performs read-modify-write on a shared JSON state file.**

The circuit breaker pattern (closed/open/half-open stored in `.claude/hub-breaker.json`) is safe for single-session use but breaks under concurrent sessions. In 3DMations-OPS, systemd fires overlapping tasks — multiple Claude sessions share the same breaker file.

Fix pattern:
```bash
(flock -x 200; [read-modify-write hub-breaker.json]) 200>"/tmp/claude-hub-breaker-$(basename $(pwd)).lock"
```

Also validate JSON integrity before every read: if `jq empty` fails, recreate as `{"state":"closed","failures":0,"last_trip":""}`.
