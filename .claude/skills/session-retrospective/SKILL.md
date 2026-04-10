---
name: session-retrospective
description: Extract learnings from a completed work session by analyzing what went well, what went wrong, and what should be remembered
---

# Session Retrospective

Run this skill at the end of a significant work session to extract and
log learnings systematically.

## Important: Compaction Awareness

After a /compact command, earlier conversation turns are no longer in the
context window. If the session has been compacted, this skill can only analyze
what remains in the current context. For a complete retrospective of the full
session, either:
  (a) Run this skill BEFORE compacting, or
  (b) After compacting, read the session JSONL logs from disk at
      ~/.claude/projects/ for this project to recover full history.

If neither option is available, analyze only what is currently visible in
the conversation and note: "This retrospective covers the post-compaction
portion of the session only."

## Process

1. Check capacity first: read index.json stats.active. If at 500, warn the
   user that new entries cannot be logged until space is freed.

2. Review the conversation history available in this session.

3. Identify each of these categories:
   a. MISTAKES — things that went wrong, commands that failed, approaches
      that had to be revised
   b. CORRECTIONS — times the user corrected you or you corrected yourself
   c. SURPRISES — unexpected behaviors, edge cases, things that worked
      differently than expected
   d. DECISIONS — architectural or design choices made, with rationale
   e. DISCOVERIES — new techniques, tools, or approaches learned

4. For each item identified, draft a memory entry using the template.
   Do NOT draft entries about the memory system itself (meta-learning exclusion).

5. [MH7] TRACE CAPTURE: For each MISTAKE and CORRECTION identified, also
   capture the execution trace:
   - Find the exact commands that were run and their output in the session
   - Extract the error messages, stack traces, or unexpected outputs
   - Truncate to 200 lines per trace (first 50 + last 100 + marker)
   - Apply security scrubbing (audit-rules X1-X4)
   - Pair each trace with its learning entry

6. Present ALL drafted entries to the user in a numbered list:
   "I identified [N] learnings from this session:
   1. [MISTAKE] [title] — [one-line summary] [TRACE: captured]
   2. [CORRECTION] [title] — [one-line summary] [TRACE: captured]
   3. [DECISION] [title] — [one-line summary] [no trace needed]
   ...
   Capacity: [active + N proposed]/500 after logging all."

7. Ask: "Which of these should I log to memory? (all / none / specific numbers)"

8. Log approved entries using the standard confirmation gate protocol.
   Write trace files alongside entries where indicated.
