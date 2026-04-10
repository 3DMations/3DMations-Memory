---
name: meta-harness
description: Deep cross-trace analysis for system self-improvement — identifies confounded patterns, measures rule effectiveness, proposes structural changes
---

# Meta-Harness Analysis

This skill performs the deep analytical work that powers /project:memory-evolve.
It can also be invoked directly for ad-hoc analysis. The core principle comes from
the Meta-Harness paper (Lee et al., 2026): access to raw execution traces enables
qualitatively better diagnosis than operating on scores or summaries alone.

## When to Use

- Automatically invoked by /project:memory-evolve
- Manually invoked when you want deep analysis of a specific failure pattern
- Useful after a particularly bad session with multiple related failures
- Useful when the same type of error keeps recurring despite existing rules

## Analysis Modes

### Mode 1: Cross-Trace Clustering
Read all trace files in .claude/memory/traces/. For each trace:
1. Extract the error signature (error type + message + first unique stack frame)
2. Extract the command sequence that led to the error
3. Cluster traces by error signature similarity

Output: groups of traces that share the same underlying failure pattern,
even if they were logged as separate entries with different titles.

### Mode 2: Confound Detection
For entries with recurrence_count >= 2 that occurred in the same session:
1. Read both entries AND their traces
2. Identify whether the entries share a common trigger (same file, same command
   sequence, same environment state)
3. If they share a trigger, flag as potentially confounded — one root cause
   may be logged as two separate issues

### Mode 3: Rule Impact Analysis
For each file in .claude/memory/rule-versions/:
1. Parse the date from the filename
2. Identify what changed (diff the snapshot against the next snapshot or current)
3. Count entries in the same category created BEFORE vs AFTER the change
4. Calculate: did error frequency in that category decrease after the rule?
5. Flag rules with no measurable impact as candidates for revision

Output: effectiveness scorecard for each rule change.

### Mode 4: Prevention Gap Analysis
1. List all entries with recurrence_count >= 3
2. For each, check: does a corresponding prevention rule exist in CLAUDE.md
   or .claude/rules/?
3. If not, this is a "prevention gap" — a known recurring problem without
   a rule to prevent it
4. Draft a candidate rule based on the entry's Prevention Rule field and
   the associated traces

Output: list of prevention gaps with draft rules.

### Mode 5: Trace-Informed Summary Enhancement
1. Read all summary files in .claude/memory/summaries/
2. Read all trace files linked from entries in each category
3. Identify concrete error signatures from traces that are NOT in summaries
4. Propose adding these signatures to make summaries more useful for
   pre-task searching (Rule 3 / MH5)

Output: proposed additions to summary files with specific error patterns.

## Output Format

All analysis modes produce:
- A findings section (what was discovered)
- A confidence level (HIGH / MEDIUM / LOW based on trace evidence quality)
- Proposed actions (each requiring user confirmation)
- Impact estimates (how many recurring entries could be prevented)

The skill NEVER modifies files directly — it produces proposals for
/project:memory-evolve or the user to act on.
