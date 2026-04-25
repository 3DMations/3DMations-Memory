---
name: hub-scrubber
description: Pre-flight credential scanner for memories before they hit the 3DMations Memory Hub. Fail-closed — throws on any detected credential shape so the caller surfaces the mistake rather than silently writing it.
---

# hub-scrubber

Client-side credential scrubber, run before any `POST /api/memories` or
`POST /api/sessions` payload reaches the network. The hub itself does NOT
scrub — per plan-v4.3 §Phase 3, scrubbing was deliberately shifted left.
This skill is the safety net.

## When to use

- Before constructing a `fetch()` to the hub from any Claude Code skill
  that creates or updates a memory
- In any tool wrapper that auto-saves session output to the hub
- During tests, to verify the patterns still match expected shapes

## Behavior

`scrub(text: string): void` — throws `ScrubberError` on any match. Does NOT
return a redacted string. Silent redaction would hide the user mistake;
fail-closed forces them to re-type the safe version.

## Patterns (12)

See `patterns.ts`. Original 8 came from `.archive/api/scrubber.py` (v3.3 hub,
retired April 2026). 4 added in Phase 3b (2026-04-25): Anthropic, Google,
SSH/TLS PEM marker, Tailscale auth keys.

False-negative tradeoffs: Stripe `sk_live_…` and JWT `eyJ…` are deliberately
NOT included — Stripe isn't in this stack, JWT shape collides with hash-like
strings.

## Distribution

Source-of-truth lives here. Each of the 5 client machines copies this directory
to `~/.claude/skills/hub-scrubber/`. See `install.md`.
