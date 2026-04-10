---
description: Deep audit of memory system health — enforces all rules, reports violations, proposes fixes
---

This is the comprehensive curation/audit command. It enforces EVERY rule in
.claude/rules/audit-rules.md and produces a full health report.

Present to user: "Running full memory audit. This checks structural integrity,
content quality, performance limits, and security rules. All findings will be
presented before any action is taken."

## Phase 1: Structural Integrity (audit-rules S1-S9)
- Validate every entry in learnings/ has complete frontmatter
  (including v2.3 fields: execution_trace)
- Cross-reference index.json against actual files on disk
- Reconcile index.json stats against actual file counts (rule S7)
  including stats.traces against actual trace file count
- Check for orphaned files, dangling references, invalid IDs, bad dates
- [MH2] Verify execution_trace paths point to existing trace files (S8)
- [MH6] Check rule-versions/ for orphaned snapshots (S9)
- Report: list of violations with proposed auto-fixes

## Phase 2: Content Quality (audit-rules Q1-Q7)
- Run duplicate detection across all active entries
- Identify archival candidates ONLY if active >= 400 (Q3)
- Check gotchas.md coverage for high-recurrence items (Q2)
- Verify related_files still exist in the project (Q4)
- Check summary freshness: entries since last sync (Q5)
- Analyze category distribution for taxonomy health (Q6)
- [MH4] Check if self-improvement analysis is overdue (Q7)
- Report: list of quality issues requiring user decision

## Phase 3: Performance Check (audit-rules P1-P5)
- Count active entries (warn if > 450, block if >= 500)
- Measure summary file line counts (warn if > 80)
- Measure CLAUDE.md line count (warn if > 200)
- Check individual entry sizes (warn if > 50 lines)
- [MH2] Count trace files and check if archival is needed (P5)
- Report: performance metrics with recommendations

## Phase 4: Security Scan (audit-rules X1-X4)
- Scan ALL memory files for credential patterns (prefixed patterns from X1 only)
- Check for .env / .ssh / .aws references without [REDACTED]
- Check for PII in files that would be git-committed
- [MH2] Scan ALL trace files for credential patterns (X4)
- Report: BLOCK any violations, show exact locations

## Output

Present the audit report as a structured summary showing: how many structural
issues were found (and how many are auto-fixable), how many quality issues need
the user's decision, whether performance is green/yellow/red, how many security
violations were found (these are blocking), and an overall health rating of
HEALTHY, NEEDS ATTENTION, or CRITICAL.

Include capacity: "[active]/500 entries ([percent]% remaining)"
Include traces: "[trace_count] execution traces on disk"

Then present each category's findings. For each finding: what the issue is,
which rule it violates, and the proposed fix (or options if user decision needed).
Wait for batch or per-item approval before applying fixes.

Log all actions to .claude/memory/audit-log.md.
Update last_audit timestamp in index.json when complete.
