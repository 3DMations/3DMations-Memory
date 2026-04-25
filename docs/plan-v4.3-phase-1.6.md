# Phase 1.6 — Session Management

**Date proposed:** 2026-04-25
**Slot:** Between Phase 1.5 (Ollama plumbing, sealed) and Phase 2 (Search / Compare)
**Status:** Designed. Implementation gated on auth decision (O1 below).

---

## Why now

Phase 1 ships create + read + UPSERT but no delete. With three projects already creating sessions on this hub, the gap is more obvious than the original plan anticipated. Cleanup today requires raw SQL — fine for the developer, hostile to future-me.

Small (~1 hour additive). Unblocks downstream UX.

## Scope

### Schema (one-line, non-breaking)

Change `memories.session_id` foreign key from **ON DELETE CASCADE** → **ON DELETE SET NULL**.

Existing rows untouched. Drizzle mirror updated; `drizzle-kit push` applies it. The CASCADE behavior moves into an explicit query param on DELETE.

### API

`DELETE /api/sessions/:id`

| Aspect | Behavior |
|---|---|
| Default | Deletes session row. Memories survive with `session_id = NULL` (orphaned). |
| `?with_memories=true` | Cascades — session and all its memories deleted. |
| Auth | TBD — see O1. |
| Success | `200 {deleted, memories_kept, memories_deleted}` |
| Unknown id | `404` |
| Auth fail | `401`/`403` per O1 |

(Out of scope for 1.6: `PATCH /api/sessions/:id` rename. Useful, separate.)

### Dashboard

`/` — add a trash icon per session row. Click opens a confirmation modal showing the session's memory count. Modal has **two buttons**, not a checkbox:

```
   [ Delete session — keep memories ]    [ Delete session + all memories ]
                              [ Cancel ]
```

Rationale: destructive choice should require an explicit click, not a tickbox someone scans past.

`/orphaned` — new read-only view listing memories with `session_id IS NULL`. Future enhancement (out of scope for 1.6): "Reassign to existing session…" action.

### Tests (≥ 5 new)

- `__tests__/sessions-delete.test.ts`
  1. DELETE default → session gone, its memories' `session_id` is NULL
  2. DELETE `?with_memories=true` → session and memories both gone
  3. DELETE auth fail (placeholder until O1 resolves)
  4. DELETE 404 for unknown id
- `__tests__/orphaned.test.ts`
  5. After delete-without-memories, the orphan view returns the surviving memories

Existing `memories.test.ts` cleanup uses `?with_memories=true` so failed tests don't litter orphans.

### APP_MAP.md

After seal, add to the API table (DELETE row), Schema section (FK predicate change), and Frontend section (`/orphaned` view).

## Open questions

### O1. Auth for DELETE — DEFERRED
Three options on the table; user has parked the decision:

| Option | How | Why / Why not |
|---|---|---|
| Admin token (`AUTH_SECRET`) | Caller sends `X-Admin-Token` header | Survives client-token leaks; matches single-user reality |
| Self-delete | Session's own bearer deletes its own row only | Fails closed when its token leaks |
| Open | Any valid bearer deletes any session | Same risk as current loose read model — don't |

**Until decided:** the route MUST NOT ship to production. Two implementation paths during the deferral window:
- (a) Route returns `503 {error: "auth model not yet decided"}`. Scaffolding visible, callable in tests via env override only.
- (b) Route accepts `AUTH_SECRET` as a stopgap, documented as temporary, swappable when O1 lands.

Recommendation: (a) for now. Avoids enshrining the stopgap.

### O2. Reassignment vs orphan
Alternative to NULL `session_id`: reassign memories to a system "_orphaned" session row. Simpler queries (FK never NULL) at the cost of a sentinel row. Recommendation: stay with `SET NULL`. The "Orphaned" UI grouping is a render-time concept; no fake session row needed.

### O3. Undo window
Hard delete leaves no recovery. A 24h `status='pending_delete'` buffer would catch mistakes. Out of scope for 1.6 — single-user, low-stakes, `pg_dump` exists. Revisit if multi-user.

## Out of scope (for 1.6)

- `PATCH /api/sessions/:id` (rename) — separate phase
- Bulk delete — wait for the actual use case
- Per-token read scoping — Phase 3 hardening
- Session token rotation — separate concern; `AUTH_SECRET` rotation handles admin
- Reassign-orphan-to-existing-session UI — Phase 2 candidate

## Acceptance (seal)

1. `drizzle-kit push` applies FK predicate change cleanly
2. Test suite green and expanded by ≥ 5 new tests
3. Manual: delete a test session via dashboard with each option; verify cascade and orphan paths
4. `/orphaned` renders correctly when at least one orphan exists
5. APP_MAP.md updated with Phase 1.6 wires
6. O1 resolved — auth model documented in commit message and APP_MAP

## Where this gets implemented when O1 unblocks

- Schema: `app/db/schema.ts` — change `.references(..., { onDelete: "set null" })`
- Migration: `drizzle-kit push` (Phase 1's strategy holds until Phase 3)
- Route: `app/app/api/sessions/[id]/route.ts` (new, dynamic param)
- UI: `app/app/page.tsx` (trash button + modal — modal as a client component)
- Orphan view: `app/app/orphaned/page.tsx` (new, RSC)
- Tests: `app/__tests__/sessions-delete.test.ts`, `app/__tests__/orphaned.test.ts`
