---
description: Operating rules for the persistent memory and learning system
globs: ["**/*"]
---

# Memory System Operating Rules

## Capacity
Maximum active entries: 500 (read from taxonomy.yaml max_active_entries).
All entries stay active until this limit is reached. There is no time-based
auto-archival. When the limit is approached, /memory-sync proposes archival
of the lowest-value entries (lowest confidence + lowest recurrence + oldest).

## Session Start
1. At session start, check if .claude/memory/index.json exists.
   If it does NOT exist: display "Memory system not installed. Say 'set up memory'
   to bootstrap." Then proceed with whatever the user asked — do not block.
   If it DOES exist: read it and display the capacity summary.
2. Read .claude/memory/summaries/gotchas.md (if it exists).
3. If stats.active >= 400 (80% of capacity), append to the capacity display:
   "Consider running /project:memory-sync to free capacity."

## Reading Memory
4. Before any task, check if a domain-specific summary in .claude/memory/summaries/
   matches the task. Read it if so. Do NOT read all summaries.
5. When you hit an error or unexpected behavior, search .claude/memory/learnings/
   for entries with matching tags or trigger_context BEFORE attempting your own fix.
   ALSO grep .claude/memory/traces/ for the exact error message or command pattern.
   Trace-level matches often reveal root causes that entry titles miss. [MH5]

## Writing Memory
6. After every completed task, self-assess: was there a mistake, a correction,
   a surprising behavior, or a new insight?
7. If yes, present a one-line summary to the user and ask for confirmation.
8. On confirmation, create a new entry in .claude/memory/learnings/ using
   the template at .claude/memory/TEMPLATE.md.
9. Generate the entry ID as: learn-{YYYY}-{MMDD}-{NNN} where NNN is a
   zero-padded sequence number for that day.
10. Update .claude/memory/index.json with the new entry metadata.
    Increment stats.total and stats.active.

## Execution Trace Capture [MH1/MH2] — experimental
11. Check taxonomy.yaml field trace_capture_enabled before capturing any trace.
    If trace_capture_enabled is false (the default): skip rules 12-15 entirely.
    Only capture traces when trace_capture_enabled: true.
12. When trace_capture_enabled is true AND logging a mistake/failed command/unexpected
    behavior, capture the raw execution trace: exact commands run, stdout/stderr output,
    error messages or stack traces, and state of relevant files at the time of the error.
13. Write the trace to .claude/memory/traces/trace-{same-ID-suffix}.md
    (e.g., if the entry is learn-2026-0330-001, the trace is trace-2026-0330-001.md).
14. Truncate traces to 200 lines. If longer, keep the first 50 lines (setup/context),
    the last 100 lines (the actual failure), and a "[... N lines truncated ...]"
    marker in between.
15. Set the execution_trace field in the entry's frontmatter to the trace file path.
    Increment stats.traces in index.json when a trace is created.
16. Not every entry needs a trace. Traces are most valuable for: mistakes, anti-patterns,
    and any entry where "what happened" involves specific commands or outputs.
    Insights, decisions, and patterns usually do NOT need traces.
    NOTE: trace_capture_enabled is currently false (experimental). The hypothesis that
    execution traces improve retrieval outcomes is under internal validation — see
    evolve-log.md for results. Enable after a 60-task validation study confirms value.

## Duplicate Prevention on Write
17. Before creating a new entry, compare the proposed title + trigger_context + tags
    against ALL existing active entries in index.json using Jaccard similarity.
    Read the threshold from taxonomy.yaml field dedup_jaccard_threshold (default 0.6).
    If similarity exceeds the threshold:
    - Show the existing entry to the user.
    - Ask: "This matches an existing entry. Update that one instead?"
    - If yes: increment recurrence_count and last_seen on the existing entry.
    - If no: create the new entry as usual.

## Meta-Learning Exclusion
18. Do NOT create memory entries about the memory system's own operations.
    Examples of things to NOT log: a malformed entry you just created, a failed
    sync, an audit error, a broken index.json. Fix these issues directly.
    The memory system records learnings about the USER'S work, not about itself.

## Recurrence Escalation
19. If any entry reaches recurrence_count >= 3 AND confidence_score < 0.5,
    propose adding its Prevention Rule as a permanent line in CLAUDE.md.
    Show the proposed line. Wait for user confirmation.
    If confirmed, snapshot the current CLAUDE.md to rule-versions/ FIRST (Rule 6),
    then append the new rule.

## Rule Version Tracking [MH6]
20. Before ANY modification to CLAUDE.md or any file in .claude/rules/:
    a. Copy the current version to .claude/memory/rule-versions/{filename}-{ISO-date}.md
    b. If a snapshot already exists for today, append a sequence number: -001, -002, etc.
    c. This creates an audit trail that /project:memory-evolve uses to measure
       whether rule changes actually reduced error recurrence.

## Summary Regeneration
21. After every 10 new entries (check: stats.total - total_at_last_sync >= 10),
    or when the user runs /project:memory-sync, regenerate summary files.
22. Regeneration has two passes:
    PASS A (category-mapped): For each category in taxonomy.yaml, read all active
    entries matching that category. Synthesize into the corresponding summary_file.
    PASS B (cross-cutting): For gotchas.md: read ALL active entries with
    recurrence_count >= 3 regardless of category — synthesize into gotchas.md.
    For decisions.md: read ALL active entries with type = "decision" regardless
    of category — synthesize into decisions.md.
23. During regeneration: extract generalizable principles, resolve contradictions
    between entries, remove superseded advice, compress into concise imperative
    statements. NEVER rewrite original entry prose — only synthesize into summaries.

## Confidence Scoring
24. New entries start at confidence_score: 0.1
25. Each time you successfully apply a learning without error:
    confidence_score = min(confidence_score + 0.2, 1.0)
    Also increment successful_applications by 1.
26. Each time the learning fails or is contradicted: reset confidence_score to 0.1
    and reset successful_applications to 0.

## Archival (capacity-driven, not time-driven)
27. Entries are NOT automatically archived based on age. All entries remain active
    and searchable until the 500-entry capacity limit is reached.
28. When stats.active >= 450 (90% capacity), recommend running /project:memory-sync
    at the next session start.
29. When stats.active >= 500, new entries CANNOT be created until space is freed.
    Propose archival of the lowest-value entries, scored by:
    value_score = (recurrence_count * 2) + (successful_applications * 3) - (days_since_last_seen / 30)
    Entries with the lowest value_score are archival candidates.
30. Before archiving any entry, verify its key insight is captured in the relevant
    summary file. Set preserved_in_summary to the filename that absorbed it.
31. When archiving an entry that has an associated trace file: move the trace to
    archive/ alongside the entry. Traces are never deleted, only archived.
32. When a related_file is deleted from the project: flag entry for relevance review
    at the next audit, but do NOT auto-archive.
