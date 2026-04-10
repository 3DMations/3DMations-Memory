---
description: Synchronize memory — deduplicate, regenerate summaries, archive low-value entries, reconcile index
---

Present to user: "Running memory sync. This will: check for duplicates, regenerate
all summary files, propose archival of low-value entries (if capacity warrants),
and reconcile the index. All changes shown before applying."

1. DEDUP — Read all active entries from .claude/memory/learnings/.
   Compare title + trigger_context + tags pairwise using Jaccard similarity
   (threshold from taxonomy.yaml, default 0.6).
   For each duplicate pair found:
   - Show both entries side by side
   - Propose: merge into one (keep higher recurrence, combine context),
     or keep both with a note
   - Wait for user decision per pair

2. REGENERATE SUMMARIES — For each of the 8 summary files:
   PASS A (6 category-mapped files): read all active entries for that category,
   synthesize into the summary file.
   PASS B (2 cross-cutting files):
   - gotchas.md: all active entries with recurrence_count >= 3
   - decisions.md: all active entries with type = "decision"

3. TRACE-INFORMED REGENERATION [MH2] — When regenerating summaries,
   for entries that have execution_trace files, read the first 20 lines of
   each trace to extract concrete error signatures. Include specific error
   patterns (e.g., exact error messages, command sequences that fail) in
   summary files alongside the generalized prevention rules. This makes
   summaries more grep-friendly for Rule 3 trace searches.

4. ARCHIVE (capacity-driven) — If stats.active >= 400:
   Rank entries by value_score:
   value_score = (recurrence_count * 2) + (successful_applications * 3) - (days_since_last_seen / 30)
   Propose archiving the lowest-scored entries to bring active count below 400.
   For each proposed archival:
   - Verify the entry's insight is captured in a summary file
   - Set preserved_in_summary to the relevant summary filename
   - Move file from learnings/ to archive/
   - If entry has an execution_trace, move the trace to archive/ too
   - Update index.json (decrement stats.active, increment stats.archived)

   If stats.active < 400, skip this step entirely and report:
   "Capacity at [active]/500 — archival not needed."

5. RECONCILE INDEX — Count actual files in learnings/, archive/, and traces/.
   Recalculate stats.total, stats.active, stats.archived, stats.traces from disk.
   Update last_sync to current timestamp.
   Update total_at_last_sync to current stats.total.
   If counts differ from what was in index.json, note the correction.

6. LOG — Append a dated entry to .claude/memory/audit-log.md recording
   what was done.

7. REPORT — Show the user a summary:
   "Memory sync complete:
   - Entries scanned: X
   - Duplicates merged: Y
   - Summary files regenerated: 8 (6 category + gotchas + decisions)
   - Entries archived: Z
   - Traces archived: T
   - Structural issues found: N (fixed: M, remaining: K)
   - Index reconciled: [yes if counts changed / no drift detected]
   - Capacity: [active]/500 ([percent]% remaining)
   - Next recommended sync: [date based on entry velocity]"
