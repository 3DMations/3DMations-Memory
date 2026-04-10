---
description: Review logged mistakes and learnings, optionally filtered by category
argument-hint: [category] (optional — code, devops, infrastructure, research, writing, conversation)
---

1. Read .claude/memory/index.json for the full entry list.

2. If $ARGUMENTS is provided, filter to entries matching that category.
   If not, show all active entries.

3. Sort entries by priority:
   - First: entries with recurrence_count >= 3 (systemic problems)
   - Second: entries with confidence_score < 0.3 (poorly internalized)
   - Third: entries with type = "decision" (architecture decisions)
   - Fourth: all remaining active entries sorted by last_seen descending

4. Present a summary table:
   | # | ID | Title | Category | Type | Recurrence | Confidence | Apps | Trace? | Last Seen |

   The Trace? column shows ✓ if the entry has an execution_trace file, blank otherwise.

5. Ask: "Enter a number to see the full entry (and its trace if available),
   or 'back' to return."

6. When showing a full entry with an execution_trace, also display a summary
   of the trace file (first 20 lines) and offer: "Show full trace? (yes/no)"
