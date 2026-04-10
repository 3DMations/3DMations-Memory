---
description: Quick health check — shows memory system stats without making changes
---

Read .claude/memory/index.json and present a status report showing:

- Capacity bar: [active]/500 entries ([percent]% remaining)
- Trace count: [traces] execution traces on disk
- Entries since last sync: stats.total - total_at_last_sync
- Last audit date, last sync date, last evolve date
- Counts broken down by category (from the entries array)
- Number of high-recurrence entries (recurrence_count >= 3)
- Number of decision entries (type = "decision")
- Number of entries with execution traces
- Archival candidates: entries with the lowest value_score
  (only show if active >= 400)
- Last modified date of each summary file in .claude/memory/summaries/
- [MH6] Number of rule version snapshots in rule-versions/
- Overall system health:
  HEALTHY if active < 400 and entries_since_sync < 10
  NEEDS SYNC if entries_since_sync >= 10
  NEEDS ATTENTION if active >= 400
  AT CAPACITY if active >= 500
  EVOLVE SUGGESTED if active >= 20 and last_evolve is "never" or > 30 days ago

Also do a quick reconciliation: count actual files in learnings/, archive/,
and traces/, compare to index.json stats. If they differ, note: "Index drift
detected — run /project:memory-audit to reconcile."

Recommend /project:memory-sync if entries_since_sync >= 10.
Recommend /project:memory-audit if last_audit was > 30 days ago or "never".
Recommend /project:memory-evolve if active >= 20 and last_evolve > 30 days ago.
