# New-session Memory Hub bootstrap

Self-contained instructions to give a fresh Claude Code session in any project,
on any machine that's already on the tailnet. No SCP, no slash-command imports,
no skill copying — the session creates everything locally from this prompt.

Covers **CRUD minus delete** against the v4.3 hub at
`https://hub.tail1e2290.ts.net`:

- `hub-create` — POST a new memory
- `hub-upsert` — POST with `local_entry_id` (server upserts: recurrence++, GREATEST(confidence))
- `hub-list`   — GET memories for this session
- `hub-search` — GET trigram-ranked search across all sessions
- *no delete* (per project's Destructive Action Guard)

Prereqs on the client machine: `tailscale`, `curl`, `jq`, `bash`. Targets Linux and macOS.

---

## The prompt — paste into a fresh Claude Code session

```
Bootstrap this project for 3DMations Memory Hub access (CRUD minus delete).

You will create exactly two local files in this project. No external transport required.
The hub is at https://hub.tail1e2290.ts.net (tailnet-only).

The user will paste these credentials before you run:
  HUB_SESSION = <paste 12-char session id>
  HUB_TOKEN   = <paste 43-char bearer token>

Constraints — read BEFORE acting:
- NEVER echo HUB_TOKEN in summaries, logs, error messages, or commit text.
- NEVER commit .claude/local/hub.env. Verify it's gitignored before you finish.
- NEVER add a delete operation to the helper. Reads, writes, and upserts only.
- If .claude/local/hub.env already exists, STOP — show me its contents and ask before overwriting.

────────────────────────────────────────
STEP 0 — Prereqs on PATH
────────────────────────────────────────
  command -v curl >/dev/null || { echo "curl required — install before continuing"; exit 1; }
  command -v jq   >/dev/null || { echo "jq required — install before continuing"; exit 1; }

────────────────────────────────────────
STEP 1 — Verify hub reachability
────────────────────────────────────────
  tailscale status                                    # tailnet up?
  curl -s https://hub.tail1e2290.ts.net/api/health    # expect {"status":"ok","db":"ok",...}

Timeout → tailnet down, stop and tell me.
status="error" or 503 → hub or db is down, stop and tell me.

────────────────────────────────────────
STEP 2 — Confirm we're in the project root
────────────────────────────────────────
  pwd
  ls -la

This must be the project's top-level directory. If it's not, stop and ask.

────────────────────────────────────────
STEP 3 — Write .claude/local/hub.env
────────────────────────────────────────
  mkdir -p .claude/local
  cat > .claude/local/hub.env <<'EOF'
  HUB_URL=https://hub.tail1e2290.ts.net
  HUB_SESSION=<paste-session-id>
  HUB_TOKEN=<paste-bearer-token>
  EOF
  chmod 600 .claude/local/hub.env

────────────────────────────────────────
STEP 4 — Write .claude/local/hub-cli.sh (verbatim)
────────────────────────────────────────
Write this file exactly as shown. Preserve every line. Do not add `set -e`,
`set -u`, or `set -o pipefail` — this file is meant to be sourced and those
options would leak into the user's interactive shell.

  #!/usr/bin/env bash
  # .claude/local/hub-cli.sh — CRUD-minus-delete wrapper for the 3DMations Memory Hub.
  # Source from the project root: `source .claude/local/hub-cli.sh`
  # Then call: hub-create | hub-upsert | hub-list | hub-search

  # Auto-load env on source. Fail silently here; per-function calls re-check.
  if [ -f "${HUB_ENV:-.claude/local/hub.env}" ]; then
    # shellcheck source=/dev/null
    . "${HUB_ENV:-.claude/local/hub.env}"
  fi

  _hub_check_env() {
    if [ -z "${HUB_URL:-}" ] || [ -z "${HUB_SESSION:-}" ] || [ -z "${HUB_TOKEN:-}" ]; then
      echo "hub-cli: HUB_URL / HUB_SESSION / HUB_TOKEN missing. Did you source .claude/local/hub.env from the project root?" >&2
      return 1
    fi
  }

  # Fail-closed credential scrubber. 12 patterns, parity with .claude/skills/hub-scrubber/patterns.ts.
  # Order: most-specific first, catch-all last (matches first hit).
  _hub_scrub() {
    local text="${1:-}"
    [ -z "$text" ] && return 0
    local p
    # Case-sensitive shapes (specific prefixes have specific case)
    for p in \
      'ghp_[a-zA-Z0-9]{36,}' \
      'AKIA[0-9A-Z]{16}' \
      'xox[bps]-[a-zA-Z0-9-]+' \
      'sk-ant-[a-zA-Z0-9_-]{90,}' \
      'sk-[a-zA-Z0-9]{20,}' \
      'AIza[0-9A-Za-z_-]{35}' \
      'tskey-(auth|client|api)-[a-zA-Z0-9]+' \
      '-----BEGIN [A-Z ]*PRIVATE KEY-----' \
      '[A-Za-z0-9_-]{64,}'; do
      if printf '%s' "$text" | grep -qE -- "$p"; then
        echo "❌ hub-cli: refused — text matches credential pattern /$p/" >&2
        return 1
      fi
    done
    # Case-insensitive shapes (assignment-style, may appear in any case)
    for p in \
      'Bearer[[:space:]]+[a-zA-Z0-9._~+/-]{20,}' \
      'password[[:space:]]*[:=][[:space:]]*[^[:space:]]+' \
      'secret[[:space:]]*[:=][[:space:]]*[^[:space:]]+'; do
      if printf '%s' "$text" | grep -iqE -- "$p"; then
        echo "❌ hub-cli: refused — text matches credential pattern /$p/i" >&2
        return 1
      fi
    done
    return 0
  }

  _hub_curl() {
    curl -fsS -H "Authorization: Bearer $HUB_TOKEN" "$@"
  }

  # CREATE — hub-create <title> [content] [category] [tag1,tag2,...]
  hub-create() {
    _hub_check_env || return 1
    local title="${1:-}" content="${2:-}" category="${3:-}" tags_csv="${4:-}"
    if [ -z "$title" ]; then echo "hub-create: title required" >&2; return 1; fi
    _hub_scrub "$title"   || return 1
    _hub_scrub "$content" || return 1
    local payload
    payload=$(jq -n \
      --arg s "$HUB_SESSION" --arg t "$title" --arg c "$content" \
      --arg cat "$category"  --arg tg "$tags_csv" \
      '{session_id:$s, title:$t}
       + (if $c   != "" then {content:$c}                else {} end)
       + (if $cat != "" then {category:$cat}             else {} end)
       + (if $tg  != "" then {tags:($tg | split(","))}   else {} end)')
    _hub_curl -X POST -H "Content-Type: application/json" -d "$payload" "$HUB_URL/api/memories"
  }

  # UPSERT — hub-upsert <local_id> <title> [content] [category] [tags] [confidence 0-1] [recurrence>=1]
  # Same local_id => server upserts: recurrence++, confidence = GREATEST(old, new).
  hub-upsert() {
    _hub_check_env || return 1
    local lid="${1:-}" title="${2:-}"
    if [ -z "$lid" ];   then echo "hub-upsert: local_entry_id required" >&2; return 1; fi
    if [ -z "$title" ]; then echo "hub-upsert: title required"          >&2; return 1; fi
    local content="${3:-}" category="${4:-}" tags_csv="${5:-}"
    local conf="${6:-null}"; [ -z "$conf" ] && conf="null"
    local rec="${7:-null}";  [ -z "$rec"  ] && rec="null"
    _hub_scrub "$title"   || return 1
    _hub_scrub "$content" || return 1
    local payload
    payload=$(jq -n \
      --arg s "$HUB_SESSION" --arg lid "$lid" --arg t "$title" --arg c "$content" \
      --arg cat "$category"  --arg tg "$tags_csv" \
      --argjson conf "$conf" --argjson rec "$rec" \
      '{session_id:$s, local_entry_id:$lid, title:$t}
       + (if $c    != ""   then {content:$c}              else {} end)
       + (if $cat  != ""   then {category:$cat}           else {} end)
       + (if $tg   != ""   then {tags:($tg | split(","))} else {} end)
       + (if $conf != null then {confidence:$conf}        else {} end)
       + (if $rec  != null then {recurrence:$rec}         else {} end)')
    _hub_curl -X POST -H "Content-Type: application/json" -d "$payload" "$HUB_URL/api/memories"
  }

  # LIST — hub-list [limit]   — most recent N memories for THIS session
  # Response shape: {"memories":[...]} (wrapper, not bare array)
  hub-list() {
    _hub_check_env || return 1
    local limit="${1:-20}"
    _hub_curl "$HUB_URL/api/memories?session=$HUB_SESSION&limit=$limit"
  }

  # SEARCH — hub-search <query> [limit]   — trigram-ranked across ALL sessions
  # Response shape: {"query":"...","count":N,"results":[...]}
  hub-search() {
    _hub_check_env || return 1
    local q="${1:-}"
    if [ -z "$q" ]; then echo "hub-search: query required" >&2; return 1; fi
    local limit="${2:-20}"
    local q_enc
    q_enc=$(jq -rn --arg q "$q" '$q | @uri')
    _hub_curl "$HUB_URL/api/memories/search?q=$q_enc&limit=$limit"
  }

────────────────────────────────────────
STEP 5 — Gitignore
────────────────────────────────────────
Ensure `.claude/local/` is gitignored:
  - Read .gitignore. If `.claude/local/` (or a broader pattern) is missing, append it.
  - Run `git status` — confirm hub.env and hub-cli.sh do NOT appear as tracked or to-be-committed.
  - If they do, STOP and tell me.

────────────────────────────────────────
STEP 6 — Read-only verify (no probe write)
────────────────────────────────────────
  source .claude/local/hub-cli.sh
  hub-list 1

Expect: `{"memories":[...]}` JSON. The array may be empty for a fresh session — that's fine, the 200 status proves bearer auth works.
401 → token wrong, stop and tell me.
Any other non-2xx → report exact status + body and stop.

(Deliberately read-only — we don't create a probe entry because the project forbids deleting memories, and we don't want to leave a permanent test entry.)

────────────────────────────────────────
USAGE FROM HERE ON
────────────────────────────────────────
After bootstrap, in any later turn in this project:

  source .claude/local/hub-cli.sh
  hub-search "hydration bug"                           # search
  hub-list 50                                          # recent memories
  hub-create "title" "body" "category" "tag1,tag2"     # one-shot create
  hub-upsert "local-id-123" "title" "body" "cat" "" 0.7 2   # idempotent upsert
```

---

## What each helper hits

| Function     | Method | Endpoint                          | Auth header                    | Body / query                                                              |
|--------------|--------|-----------------------------------|--------------------------------|--------------------------------------------------------------------------|
| `hub-create` | POST   | `/api/memories`                   | `Authorization: Bearer …`      | `{session_id, title, content?, category?, tags?}`                        |
| `hub-upsert` | POST   | `/api/memories`                   | `Authorization: Bearer …`      | `{session_id, local_entry_id, title, content?, category?, tags?, confidence?, recurrence?}` |
| `hub-list`   | GET    | `/api/memories?session=…&limit=…` | `Authorization: Bearer …`      | —                                                                        |
| `hub-search` | GET    | `/api/memories/search?q=…&limit=…`| `Authorization: Bearer …`      | —                                                                        |

Server-side notes (verified against `app/app/api/memories/route.ts` and `app/lib/auth.ts`):

- The bearer token is hashed at session-creation; the hub stores only the hash. Lose it → mint a new session.
- `hub-list` filters to the caller's session via the `session` query param — no cross-session leakage.
- `hub-search` is global across all sessions (intentional — that's what makes the hub a *hub*).
- Upsert key is `(session_id, local_entry_id)`. Different sessions can use the same `local_entry_id` independently.

## Scrubber parity

The bash scrubber in `hub-cli.sh` carries all 12 patterns from
`.claude/skills/hub-scrubber/patterns.ts`. If that file gains a pattern, also
update the bash helper (here in this doc) to keep parity.

## Limitations

- **No bulk sync.** This helper is for ad-hoc CRUD. Bulk-syncing
  `.claude/memory/learnings/*.md` to the hub (the old `/hub-sync` slash-command
  use case) is a separate need; if/when it surfaces, write a fresh helper for it.
- **No circuit breaker.** Single calls, fail-fast. The shipped slash commands
  had a flock-based breaker (AUDIT-001) for outage protection during bulk syncs;
  not applicable here.
- **No retries.** A `curl -fsS` failure surfaces immediately. The session can
  retry by re-running the function.
