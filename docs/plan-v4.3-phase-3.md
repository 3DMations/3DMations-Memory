# Phase 3 — Trusted (HTTPS via Tailscale + Integrity)

**Date proposed:** 2026-04-25
**Slot:** After Phase 2 (sealed at 12cc6fa) — next phase to seal
**Status:** SEALED 2026-04-25. 3a tailnet HTTPS live at `https://hub.tail1e2290.ts.net`; 3b verify endpoint working (28 memories checked, 0 drift). Full vitest suite 51/51.

**Actual tailnet domain:** `tail1e2290.ts.net` (NOT `3dmations.github.ts.net` — Tailscale uses a random tailnet identifier for the DNS suffix; the org name shown in admin UI is just a display label).

## Bring-up gotchas hit (2026-04-25)

For a future hub (or someone redoing this on another tailnet):

1. **HTTPS toggle required.** ts-hub starts but cert provisioning fails until you go to https://login.tailscale.com/admin/dns and click **Enable HTTPS** under HTTPS Certificates section. MagicDNS must be on. Acknowledge the public Certificate Transparency log disclosure (machine names get published).
2. **Netns invalidation on sidecar restart.** `docker compose restart ts-hub` leaves dependent app's `network_mode: service:ts-hub` reference pointing to a stale netns ID. Symptom: `wget 127.0.0.1:3000` from inside ts-hub returns "connection refused" while same call from inside app works. Verify with `sudo readlink /proc/$(docker inspect hub-ts --format '{{.State.Pid}}')/ns/net` vs same for hub-app — they should be identical. Fix: `docker compose up -d --force-recreate app`. **Always** force-recreate dependents after touching the sidecar.
3. **Drizzle non-interactive prompt.** `drizzle-kit push` blocks on a TTY prompt when it sees the manually-managed `schema_version` table (created by `post-push-init.sql`, not in `db/schema.ts`) — drizzle wants to drop it. Skip drizzle-kit push when the only diff is schema_version; verify columns directly via `psql -c '\d memories'`.
4. **Skill volume mount needed for tests.** `__tests__/scrubber.test.ts` imports the source-of-truth at `../../.claude/skills/hub-scrubber/...`. The default `./app:/app` bind mount doesn't expose `.claude/`. Add `./.claude/skills:/.claude/skills:ro` to the app service's volumes.
5. **GitHub SSO identity casing.** Tailscale preserves GitHub username casing in user identities (`3DMations@github`) but operators commonly normalize to lowercase when setting `HUB_ADMIN_LOGIN`. Verify the *exact* string with `tailscale whois <ip>` rather than guessing. Server compare is now case-insensitive (`tailscale-identity.ts`) so this is forgiving.
6. **SSH agent signing.** `git push` may fail with "agent refused operation" if the SSH agent has the key but requires GUI/passphrase confirmation that's not surfaced. `ssh -T git@github.com` to force the prompt.

---

## Why now

Phases 0 → 2 proved the hub works. Three projects are creating sessions; the dashboard, search, and compare flows are live. What's missing before this carries *real* work memory:

1. **No transport security.** The app binds `127.0.0.1:${APP_PORT}` — fine on the hub host, useless from the other four machines.
2. **No tamper detection.** A row could be silently mutated (manual SQL, restored backup drift, replication accident) and we'd never know.
3. **No credential firebreak on write.** A careless paste of an API key into a memory body would land in Postgres in plaintext.

Phase 3 closes those three gaps with two slices.

## Decisions locked in this session

| Decision | Choice | Rationale |
|---|---|---|
| HTTPS path | **Tailscale Serve** (sidecar pattern) | All 5 machines on a tailnet; no public exposure; Caddy/Let's Encrypt avoided. |
| Public reachability | **No** — `AllowFunnel: false` | Personal hub. Tailnet identity is the auth boundary. |
| Backups | **Skipped** at this phase | Synology DS1520+ snapshots `Documents/` covers the bind-mounted volumes. |
| Tailscale install on hub host | **No** — runs as sidecar container | Per current Tailscale Docker guidance (validated 2026-03). Keeps everything in compose. |
| Debug fallback | **Yes** — compose profile | If tailnet/auth-key fails, recovery via `docker compose --profile debug up`. |
| Scrubber location | **Source-of-truth in this repo at `.claude/skills/hub-scrubber/`** | Distributed by copy to client machines; install step documented. |
| Server-side scrubbing | **No** — client-side only | Per plan-v4.3 §Phase 3: "Shift left. Client-side = safety net, not policy engine." |
| Tailscale auth-key form | **Reusable + non-ephemeral + tagged** (`tag:hub`) | OAuth client deferred until second hub or prod-grade dependency lands. |
| `/api/memories/verify` auth | **Tailscale-identity** via `Tailscale-User-Login` header | All callers will be on tailnet; spoof-safe (Serve strips inbound copies). |
| Pattern count | **Curated 12** — original 8 + 4 modern shapes | Faithful-8 was an option; curated-12 catches Anthropic/Google/SSH/Tailscale keys. |

---

## Phase 3a — Tailscale Serve

### Compose changes

The current `docker-compose.yml` exposes the app at `127.0.0.1:${APP_PORT}:3000`. After 3a:

- Add a new `ts-hub` service (Tailscale sidecar).
- App switches to `network_mode: service:ts-hub` — drops its own `ports:` and `networks:`.
- DB stays unchanged on `hub-internal`. Sidecar joins both `hub-internal` and the tailnet.
- A new `debug` profile reintroduces `127.0.0.1:${APP_PORT}:3000` for emergency local access.

### Sketch (illustrative — exact form lands in 3a build)

```yaml
services:
  ts-hub:
    image: tailscale/tailscale:latest
    container_name: hub-ts
    hostname: hub                        # → hub.<tailnet>.ts.net
    environment:
      TS_AUTHKEY: ${TS_AUTHKEY}          # ephemeral=false; tag:hub
      TS_EXTRA_ARGS: --advertise-tags=tag:hub
      TS_SERVE_CONFIG: /config/serve.json
      TS_STATE_DIR: /var/lib/tailscale
    volumes:
      - hub-ts-state:/var/lib/tailscale
      - ./tailscale/serve.json:/config/serve.json:ro
    devices:
      - /dev/net/tun:/dev/net/tun
    cap_add: [net_admin, sys_module]
    restart: unless-stopped
    networks: [hub-internal, jarvis-internal]

  app:
    # ... existing build/env/volumes ...
    network_mode: service:ts-hub          # share ts-hub's netns
    depends_on:
      db: { condition: service_healthy }
      ts-hub: { condition: service_started }
    # NO `ports:` — tailnet is the only ingress
    # NO `networks:` — inherited from ts-hub

  app-debug:
    extends: app
    profiles: [debug]
    network_mode: bridge                  # break out of ts-hub netns
    ports:
      - "127.0.0.1:${APP_PORT}:3000"
    networks: [hub-internal]
```

### serve.json

```json
{
  "TCP": { "443": { "HTTPS": true } },
  "Web": {
    "${TS_CERT_DOMAIN}:443": {
      "Handlers": { "/": { "Proxy": "http://127.0.0.1:3000" } }
    }
  },
  "AllowFunnel": { "${TS_CERT_DOMAIN}:443": false }
}
```

### Bootstrap flow (one-time, user runs these)

1. Create tailnet (free tier; 5 machines well under limits).
2. In admin console → Access Controls → define `tag:hub` (owner = your login).
3. In admin console → Settings → Keys → generate auth key:
   - Reusable: **yes**
   - Ephemeral: **no**
   - Tags: `tag:hub`
4. Edit `.env` and set `TS_AUTHKEY=tskey-auth-...` (note: `.env` is permission-locked — set this yourself).
5. `docker compose up -d ts-hub` — verify `hub.<tailnet>.ts.net` appears in admin.
6. `docker compose up -d app db` — verify `https://hub.<tailnet>.ts.net` reaches dashboard from a second tailnet machine.
7. Update each of the 5 client machines: install Tailscale, sign in, confirm.

### Debug profile flow (when tailnet is broken)

```bash
docker compose stop app                            # vacate shared volumes
docker compose --profile debug up -d app-debug     # binds 127.0.0.1:${APP_PORT}
# ... debug ...
docker compose --profile debug down app-debug
docker compose up -d app                           # back to tailnet-only
```

`app` and `app-debug` share `hub-node-modules` and `hub-next-cache` — running both simultaneously will corrupt them. The compose file enforces nothing here; operator discipline does.

### Per-project hub credentials (`.claude/local/`)

Memory note "hub-tls reserved :8443" becomes obsolete; update the Docker port-map memory after seal. Client `.claude/local/hub.json` files switch from `https://<host>:8443` to `https://hub.<tailnet>.ts.net`.

### Acceptance (3a seal)

1. `docker compose up -d` brings the tailnet sidecar up cleanly.
2. From a second tailnet machine: `curl https://hub.<tailnet>.ts.net/api/health` → 200.
3. From a non-tailnet machine: `curl` times out (no public ingress).
4. `docker compose --profile debug up -d app-debug` exposes `127.0.0.1:${APP_PORT}` and reaches dashboard.
5. After `docker compose down && docker compose up -d`: serve config persists; HTTPS still works (no manual `tailscale serve` re-run).
6. APP_MAP.md updated with sidecar topology + debug profile.

---

## Phase 3b — Scrubber + Integrity

### Scrubber: port to TypeScript skill

Lift `.archive/api/scrubber.py` to `.claude/skills/hub-scrubber/scrubber.ts` and extend with 4 modern shapes.

**Pattern source.** The archived Python scrubber has **8** compiled patterns. Plan/amendment references to "14 patterns" are doc drift (no 14-pattern scrubber ever existed in git — verified 2026-04-25). We're going with curated-12: the original 8 plus 4 high-value adds.

**Original 8** (from `.archive/api/scrubber.py`):
1. `ghp_[a-zA-Z0-9]{36,}` — GitHub PAT
2. `AKIA[0-9A-Z]{16}` — AWS access key
3. `xox[bps]-[a-zA-Z0-9\-]+` — Slack tokens
4. `sk-[a-zA-Z0-9]{20,}` — OpenAI-style keys
5. `Bearer\s+[a-zA-Z0-9\-._~+/]{20,}` — Bearer tokens
6. `password\s*[:=]\s*\S+` — password assignments
7. `secret\s*[:=]\s*\S+` — secret assignments
8. `[A-Za-z0-9_\-]{64,}` — long-token catch-all

**Curated additions (4):**
9. `sk-ant-[a-zA-Z0-9_\-]{90,}` — Anthropic API keys (more specific than generic `sk-`)
10. `AIza[0-9A-Za-z_\-]{35}` — Google API keys
11. `-----BEGIN [A-Z ]*PRIVATE KEY-----` — SSH/TLS private key blocks (run with `s` flag for multi-line)
12. `tskey-(auth|client|api)-[a-zA-Z0-9]+` — Tailscale auth keys (newly load-bearing after 3a)

**Excluded for false-positive risk:** Stripe (`sk_live_…`) — not in your stack; JWT shape (`eyJ…\.…\.…`) — too many false positives on hash-like strings.

**Update during 3b seal:** docs/plan-v4.3.md:53, :508 and docs/v4.3-environment-amendments.md:66 — change "14 patterns from v3.3" → "12 patterns (8 from v3.3 archive + 4 modern adds)."

Skill layout:

```
.claude/skills/hub-scrubber/
  SKILL.md                  # invocation contract
  scrubber.ts               # pure function: scrub(text) → text
  patterns.ts               # exported PATTERNS array
  scrubber.test.ts          # vitest cases (positives + negatives — git SHAs, UUIDs)
  install.md                # how to copy onto a client machine
```

**Behavior.** Throws `ScrubberError` on detection (per plan v4.3 §Phase 3 sketch) — *fail closed*. Caller catches and surfaces to user. No silent redaction client-side; that hides the mistake.

**Defense-in-depth note.** Server stays unscrubbing per the locked decision above. We are deliberately accepting that a non-skill client (e.g., raw `curl`) can write a credential. Mitigation: server-side `verify` (see below) catches obviously-shaped tokens after the fact.

### Integrity: `content_hash` + `/api/memories/verify`

**Schema (additive, non-breaking).**

```
ALTER TABLE memories ADD COLUMN content_hash text;
```

Drizzle mirror updated. Rows written before 3b have `NULL`; the verify endpoint reports them as "unhashed" rather than "drifted."

**Hash function.** sha256 over a canonicalized JSON of `{title, body, type}` — stable key order, no whitespace. Computed in the route handler on every POST/PATCH; never trusted from the client.

**Endpoint.** `GET /api/memories/verify` — tailnet-identity gated. Handler reads `Tailscale-User-Login` header and rejects (`401`) if it doesn't match the configured admin login (`HUB_ADMIN_LOGIN` env var). Header is spoof-safe: Tailscale Serve strips any inbound `Tailscale-User-*` headers before forwarding.

**Caveat.** Tagged devices don't get `Tailscale-User-*` populated — only logged-in users. The `ts-hub` container itself is tagged (`tag:hub`), so any callback originating from the hub container would be rejected. This is intentional: `/verify` is interactive, called from one of the 5 logged-in machines. Scripts on the hub host that need `/verify` access should use the debug profile (loopback bypasses Serve entirely — see "Debug profile auth" in Open questions below).

```json
{
  "checked": 1234,
  "ok": 1230,
  "unhashed": 4,
  "drift": [
    { "id": "...", "stored_hash": "...", "recomputed_hash": "..." }
  ]
}
```

Status `200` if `drift` is empty; `409` if not.

### Tests (≥ 6 new)

- `__tests__/scrubber.test.ts` (lives in app/ even though source-of-truth is in skill — vitest already runs there)
  1. Each of the 12 patterns → throws (12 sub-cases)
  2. Git SHA (40 chars) does NOT trip the catch-all
  3. UUID (36 chars) does NOT trip the catch-all
  4. Multi-line PEM block triggers private-key pattern with `s` flag
- `__tests__/memories-hash.test.ts`
  4. POST sets `content_hash`
  5. PATCH updates `content_hash`
- `__tests__/verify.test.ts`
  6. Verify with valid `Tailscale-User-Login` matching `HUB_ADMIN_LOGIN`, no drift → 200, drift=[]
  7. Verify with missing header → 401
  8. Verify with non-admin login → 401
  9. Manually mutate row in DB → verify returns the drift entry, status 409

(That's 9 cases across 3 files — exceeds the ≥ 6 floor.)

### Acceptance (3b seal)

1. `drizzle-kit push` applies `content_hash` column cleanly.
2. Test suite green and expanded by ≥ 6 new cases.
3. Manual: paste an `AKIA...` line into a session-create on a client → scrubber throws before POST.
4. Manual: `UPDATE memories SET title='tampered' WHERE id=...` → `/api/memories/verify` returns 409 with that id in `drift`.
5. APP_MAP.md updated: schema (`content_hash`), API row (`/api/memories/verify`), skill (`hub-scrubber`).

---

## Open questions

### O1. Tailscale auth-key lifetime — RESOLVED
**Decision (2026-04-25):** Reusable + non-ephemeral + tagged (`tag:hub`). OAuth client deferred until second hub or prod-grade dependency lands.

### O2. Verify endpoint auth — RESOLVED
**Decision (2026-04-25):** Tailscale-identity via `Tailscale-User-Login` header, matched against `HUB_ADMIN_LOGIN` env var. All `/verify` callers will be on tailnet (confirmed: no non-tailnet callers planned). Headers are spoof-safe (Serve strips inbound copies). DELETE auth (Phase 1.6 O1) inherits this model — separate seal.

### O3. Scrubber pattern count — RESOLVED
**Decision (2026-04-25):** Curated 12 — original 8 from `.archive/api/scrubber.py` + 4 additions (Anthropic, Google, SSH/TLS private key marker, Tailscale auth key). The "14 patterns" doc references are drift from a scrubber that never existed in git. Update plan-v4.3.md and v4.3-environment-amendments.md to "12" during 3b seal.

### O4. Debug profile auth — RESOLVED
**Decision (2026-04-25):** Reject loopback. `/verify` requires the tailnet path; debug profile is for "is the app even up?" emergencies, not routine API exercise. If `/verify` is needed and tailnet is down, fix tailnet first.

Implementation note: `requireAdmin(req)` rejects any request without a populated `Tailscale-User-Login` header — no localhost exception.

---

## Out of scope (for Phase 3)

- **Backups** — Synology DS1520+ handles `Documents/` snapshots. Revisit if hub volumes ever leave that tree.
- **Caddy / Let's Encrypt** — replaced by Tailscale Serve.
- **OAuth client for Tailscale** — see O1.
- **Server-side scrubber** — explicitly client-side per plan v4.3.
- **PATCH-time hash recomputation race** — single-writer assumption holds; revisit when concurrent admin mutations are real.
- **Per-token read scoping** — Phase 3 hardening was the original home; defer to Phase 4 with the broader auth model.
- **Tailscale ACLs** — defaults are fine for personal tailnet. Tighten when we add anyone else.

---

## Where this gets implemented when O1 unblocks

**3a:**
- `docker-compose.yml` — add `ts-hub` service, switch app to `network_mode: service:ts-hub`, add `app-debug` profile
- `tailscale/serve.json` (new) — serve config, version-controlled
- `.env.example` — add `TS_AUTHKEY=` placeholder
- `.gitignore` — confirm `.env` already covered
- `APP_MAP.md` — Topology section update
- Memory: update `project_docker_infrastructure.md` (drop `:8443` reservation, note tailnet ingress)

**3b:**
- `app/db/schema.ts` — add `contentHash: text("content_hash")`
- `drizzle-kit push` — applies the column
- `app/lib/hash.ts` (new) — `canonicalize()` + `sha256()` helpers
- `app/lib/tailscale-identity.ts` (new) — `requireAdmin(req)` reads `Tailscale-User-Login`, compares to `HUB_ADMIN_LOGIN`
- `app/app/api/memories/route.ts` — set `content_hash` on POST
- `app/app/api/memories/[id]/route.ts` — set `content_hash` on PATCH
- `app/app/api/memories/verify/route.ts` (new) — GET handler, calls `requireAdmin`
- `.env.example` — add `HUB_ADMIN_LOGIN=` placeholder (e.g., `you@gmail.com`)
- `.claude/skills/hub-scrubber/` (new directory) — skill files per layout above
- `app/__tests__/scrubber.test.ts`, `memories-hash.test.ts`, `verify.test.ts` (new)
- `APP_MAP.md` — Schema, API table, Skills section
- `docs/plan-v4.3.md` lines 53, 508 + `docs/v4.3-environment-amendments.md` line 66 — update "14 patterns" → "12 patterns"

---

## Sequencing

3a before 3b. Reasons:
1. Once tailnet ingress works, 3b can be tested from real client machines (skill running on the laptop, hashing in the route).
2. 3a is the higher-risk/higher-value half — sealing it first banks the win even if 3b slips.
3. Both can land in one phase commit if both green at the same time, but separate seals are fine.
