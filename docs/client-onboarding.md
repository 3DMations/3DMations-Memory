# Adding a new machine or project to the Memory Hub

The hub lives at `https://hub.tail1e2290.ts.net` (tailnet-only — no public ingress).
Each machine that wants to read/write memories needs:

1. Tailscale up + signed in to the same tailnet
2. The two slash commands installed at `~/.claude/commands/`
3. The `hub-scrubber` skill installed at `~/.claude/skills/`
4. Per-project `.claude/local/hub.env` with a session ID + token

## One-time per machine

```bash
# Verify tailnet reachability
tailscale status                                                     # should list "hub"
curl -s https://hub.tail1e2290.ts.net/api/health                     # expect {"status":"ok",...}

# Pull the client commands + scrubber skill from the hub host
mkdir -p ~/.claude/commands ~/.claude/skills
scp <hub-username>@aiwork-legion:~/.claude/commands/hub-search.md ~/.claude/commands/
scp <hub-username>@aiwork-legion:~/.claude/commands/hub-sync.md   ~/.claude/commands/
scp -r <hub-username>@aiwork-legion:~/Documents/Projects/3DMations-Memory/.claude/skills/hub-scrubber ~/.claude/skills/
```

`aiwork-legion` resolves via tailnet MagicDNS — no IP needed.

## Per project — mint a session and write hub.env

From any machine on the tailnet (the hub host is convenient):

```bash
# Replace the name with whatever describes the project (gets stored verbatim)
curl -s -X POST https://hub.tail1e2290.ts.net/api/sessions \
  -H 'Content-Type: application/json' \
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

Then on the client machine, in the project root:

```bash
mkdir -p .claude/local
cat > .claude/local/hub.env <<EOF
HUB_URL=https://hub.tail1e2290.ts.net
HUB_SESSION=<id-from-response>
HUB_TOKEN=<token-from-response>
EOF
```

Add `.claude/local/` to that project's `.gitignore` if it's not already covered.

## Verify the project is wired

From the project root on the client machine:

```bash
source .claude/local/hub.env
curl -s -H "Authorization: Bearer $HUB_TOKEN" \
  "$HUB_URL/api/memories?session=$HUB_SESSION&limit=1"
```

Expect a JSON list (likely empty for a new session). 401 → token wrong. Timeout → tailnet down.

In Claude Code on that project, `/hub-search` and `/hub-sync` should now work.

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
