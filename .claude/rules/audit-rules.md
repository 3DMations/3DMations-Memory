---
description: Rules enforced by the memory audit system
globs: [".claude/memory/**"]
---

# Memory Audit Rules

The /project:memory-audit command enforces these rules. Every violation is
reported to the user before any corrective action is taken.

## Structural Rules (auto-fixable with confirmation)
- S1: Every entry in learnings/ MUST have valid YAML frontmatter with ALL
  required fields from TEMPLATE.md (including successful_applications,
  preserved_in_summary, and execution_trace). Missing fields → propose
  addition with defaults.
- S2: Every entry in learnings/ MUST appear in index.json. Orphans → propose
  adding to index or archiving.
- S3: index.json MUST NOT reference entries that don't exist on disk.
  Dangling refs → propose removal from index.
- S4: Every entry MUST have a non-empty title, category, and trigger_context.
  Empty required fields → flag for user to fill in.
- S5: Entry IDs MUST follow the pattern: learn-YYYY-MMDD-NNN.
  Non-conforming IDs → propose rename.
- S6: Dates in frontmatter MUST be valid ISO 8601. Invalid dates → flag.
- S7: index.json stats (total, active, archived, traces) MUST match actual file
  counts on disk. Mismatch → recalculate from disk and propose correction.
- S8: [MH2] If an entry has execution_trace set to a path, that trace file MUST
  exist on disk. Missing trace file → clear the execution_trace field.
- S9: [MH6] Every file in rule-versions/ MUST have a corresponding current file
  in the project (CLAUDE.md or .claude/rules/). Orphaned snapshots of deleted
  rule files → flag for user review.

## Content Quality Rules (require user decision)
- Q1: Duplicate detection — entries with Jaccard similarity exceeding
  dedup_jaccard_threshold (from taxonomy.yaml, default 0.6) on title +
  trigger_context + tags are flagged as potential duplicates. Propose merge.
- Q2: Entries with recurrence_count >= 3 but no corresponding line in
  gotchas.md → propose adding to gotchas.
- Q3: Entries with confidence_score >= 0.9 AND successful_applications >= 4
  AND stats.active >= 400 → propose archival with summary preservation.
  (Below 400 active entries, do not propose archival — keep everything.)
- Q4: Entries referencing files that no longer exist in the project →
  flag for relevance review (do NOT auto-archive).
- Q5: Summary files that haven't been regenerated since last sync, AND
  10+ new entries exist since last sync → flag for regeneration.
- Q6: Analyze entry distribution across categories. If > 70% of entries from
  the last 30 days fall in a single category, suggest adding more granular
  subcategories for that domain in taxonomy.yaml.
- Q7: [MH4] If stats.active >= evolve_min_entries (default 20) AND
  last_evolve is "never" or > 30 days ago → suggest running
  /project:memory-evolve for self-improvement analysis.

## Size & Performance Rules
- P1: Total active entries SHOULD stay under 500. Above 450 → warn user.
  Above 500 → new entries blocked until space is freed.
- P2: No single summary file should exceed 80 lines. Longer → split by
  subcategory or compress low-value items.
- P3: CLAUDE.md total line count MUST stay under 200. If memory system
  additions push it over → move content to .claude/rules/ files.
- P4: Individual entry files should not exceed 50 lines. Longer entries →
  flag for compression.
- P5: [MH2] Total traces/ directory size should be monitored. If > 100 trace
  files exist, propose archiving traces whose parent entries have already
  been archived or have confidence_score >= 0.9.

## Security Rules (block and alert)
- X1: NEVER store API keys, tokens, passwords, or connection strings in
  any memory file. Scan entry content for these patterns:
  [A-Za-z0-9_\-]{64,}            (catch-all for long tokens — 64+ chars)
  sk-[a-zA-Z0-9]{20,}            (OpenAI-style keys)
  ghp_[a-zA-Z0-9]{36,}           (GitHub PATs)
  AKIA[0-9A-Z]{16}               (AWS access keys)
  xox[bps]-[a-zA-Z0-9\-]+        (Slack tokens)
  password\s*[:=]\s*\S+           (password assignments)
  secret\s*[:=]\s*\S+             (secret assignments)
  Bearer\s+[a-zA-Z0-9\-._~+/]+   (Bearer tokens)
  If found → REFUSE to write. Alert user.
  NOTE: The 64-char threshold avoids flagging git SHAs (40 chars),
  UUIDs (32-36 chars), and typical base64 hashes (44 chars). Only
  unusually long unbroken alphanumeric strings are caught.
- X2: Entries referencing .env files, ~/.ssh/, ~/.aws/, or ~/.kube/ MUST
  use [REDACTED] placeholders for any values. Store the pattern, not the secret.
- X3: Memory files that would be committed to git MUST NOT contain
  project-internal IP addresses, hostnames, or personally identifiable data
  unless the user explicitly confirms.
- X4: [MH2] Trace files are especially likely to contain credentials or secrets
  from command output. Apply ALL X1-X3 rules to trace content. Additionally,
  scrub environment variable dumps and config file contents from traces.
