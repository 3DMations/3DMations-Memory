# Adding a new machine or project to the Memory Hub

The hub lives at `https://hub.tail1e2290.ts.net` (tailnet-only — no public ingress).
Each project that wants to read/write memories needs:

1. Tailscale up + signed in to the same tailnet on the client machine.
2. A per-project `.claude/local/hub.env` containing the project's session id + bearer token.
3. A small CRUD helper in the project (`.claude/local/hub-cli.sh`) — created automatically
   by the bootstrap prompt below.

There is no machine-wide install step anymore. Everything is per-project, self-contained,
and creatable from a single paste.

> **Note on the legacy slash commands.** The original `/hub-sync` and `/hub-search` lived
> at `.claude/commands/hub-{sync,search}.md` and used the v3 mTLS + `X-API-Key` auth model
> (endpoints `/api/sync`, `/api/search`). The hub was migrated to bearer + session auth in
> v4.3 (endpoints `POST /api/memories`, `GET /api/memories/search`); the slash commands
> were not. They have been archived to `.claude/commands/.archive/hub-{sync,search}-v3-mtls.md`
> and the bash helper below is now the canonical client. If a future bulk-sync need
> resurfaces, write a fresh purpose-built helper rather than reviving the v3 scripts.

## Step 1 — Mint a session for the project

Minting is admin-gated (the hub's `AUTH_SECRET` as `X-Admin-Token` — a tailnet
member without it cannot self-issue API credentials). Three ways to approve:

**a) From the hub host — Make target (simplest):**

```bash
make session name=<machine>-<project>   # token printed once in the JSON response
```

**b) From the hub dashboard — /new page:** enter the session name + admin token,
submit. Token shown once, copy it.

**c) From any tailnet machine — curl:**

```bash
# AUTH_SECRET is set in the hub's .env; run this from the hub host (or any
# machine where you hold the admin token)
curl -s -X POST https://hub.tail1e2290.ts.net/api/sessions \
  -H 'Content-Type: application/json' \
  -H "X-Admin-Token: $AUTH_SECRET" \
  -d '{"name":"<machine>-<project>"}'
```

Response:

```json
{
  "id":      "<12-char-id>",
  "name":    "...",
  "token":   "<43-char-bearer-token-shown-once>",
  "message": "Token shown once. Store it now — it cannot be retrieved later."
}
```

**Copy the token immediately — it's hashed server-side after this response. Lose it and you mint a new session.**

## Step 2 — Bootstrap the project on the client machine

Open a Claude Code session in the target project's root directory on the client machine,
then paste the bootstrap prompt from [`docs/new-session-bootstrap.md`](./new-session-bootstrap.md)
into the chat. Fill in the `HUB_SESSION` and `HUB_TOKEN` placeholders with the values
from Step 1.

The session will:

- Verify tailnet reachability (`tailscale status`, `/api/health`).
- Confirm `curl` and `jq` are on PATH.
- Write `.claude/local/hub.env` (chmod 600) with the URL + session + token.
- Write `.claude/local/hub-cli.sh` with `hub-create`, `hub-upsert`, `hub-list`, `hub-search`,
  including a 12-pattern fail-closed credential scrubber that mirrors the
  `.claude/skills/hub-scrubber` skill.
- Add `.claude/local/` to `.gitignore` if it's not already covered.
- Run a read-only round-trip (`hub-list 1`) to confirm bearer auth is wired.

No SCP, no machine-wide install, no copy-pasting of skills or commands across machines.

## Step 3 — Use it

From the project root, in any Claude Code turn or shell:

```bash
source .claude/local/hub-cli.sh
hub-list 50                                            # most recent N memories for THIS session
hub-search "hydration bug"                             # trigram-ranked search across ALL sessions
hub-create "title" "body" "category" "tag1,tag2"       # one-shot create
hub-upsert "local-id-123" "title" "body" "cat" "" 0.7  # idempotent upsert (recurrence++ server-side)
```

Expected wire shapes (verified against `app/app/api/memories/route.ts`):

- `hub-list`   → `{"memories": [...]}` (wrapper, not a bare array)
- `hub-search` → `{"query":"...","count":N,"results":[...]}`
- `hub-create` / `hub-upsert` → `201` + the created/updated row as JSON

401 from any call → bearer token wrong, mint a fresh session.
Timeout → tailnet down on the client.

## Listing existing sessions

The hub admin (anyone with a valid bearer token) can list sessions:

```bash
curl -s -H "Authorization: Bearer <any-valid-token>" https://hub.tail1e2290.ts.net/api/sessions | jq
```

Useful when you've forgotten which session you minted for which project, or to clean up stale ones.

## Deleting a session

From the dashboard at `https://hub.tail1e2290.ts.net/` — trash icon, two-button modal (per Phase 1.6: keep memories, or cascade delete).

Or via API (admin token required, set in hub `.env` as `AUTH_SECRET`):

```bash
# Default: delete session, memories survive as orphans (visit /orphaned to see them)
curl -s -X DELETE -H "X-Admin-Token: $AUTH_SECRET" \
  "https://hub.tail1e2290.ts.net/api/sessions/<id>"

# Cascade: delete session + all its memories
curl -s -X DELETE -H "X-Admin-Token: $AUTH_SECRET" \
  "https://hub.tail1e2290.ts.net/api/sessions/<id>?with_memories=true"
```

## Admin verify (tailnet-identity gated)

```bash
curl -s https://hub.tail1e2290.ts.net/api/memories/verify | jq
# {"checked": N, "ok": M, "unhashed": K, "drift": []}
```

Returns 401 if your `Tailscale-User-Login` (set automatically by Tailscale Serve) doesn't match the hub's `HUB_ADMIN_LOGIN` env var. Returns 409 if any drift detected (rows where stored content_hash ≠ recomputed). Tagged devices and the debug-profile loopback path can't call this — by design (Phase 3 §O4).
