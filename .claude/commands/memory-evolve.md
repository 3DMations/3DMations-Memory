---
description: Self-improvement loop — analyzes accumulated learnings and traces, proposes concrete rule/skill changes
---

This command implements the core Meta-Harness insight: use accumulated
execution traces and learnings to propose concrete improvements to the
system's own rules, summaries, and operating procedures.

Present to user: "Running self-improvement analysis. This reads across all
learnings and traces to identify patterns, then proposes specific changes to
CLAUDE.md, rules, summaries, or taxonomy. All proposals require your approval."

## Prerequisites
Read .claude/memory/index.json. Check:
- stats.active >= evolve_min_entries (from taxonomy.yaml, default 20)
- stats.traces >= evolve_min_traces (from taxonomy.yaml, default 10)
If either threshold is not met, report:
"Not enough data for self-improvement analysis yet.
Need [X] more entries / [Y] more traces. Keep working and logging."

## Phase 1: Pattern Mining (read-only)

1. Read ALL active entries from index.json. Group by category and type.

2. Identify RECURRING FAILURES:
   - Entries with recurrence_count >= evolve_recurrence_threshold (default 3)
     that do NOT already have a corresponding rule in CLAUDE.md or rules/
   - These represent gaps in the rule system — mistakes that keep happening
     because no rule prevents them.

3. Identify CONFOUNDED PATTERNS (the Meta-Harness A.2 insight):
   - Look for entries where the root_cause changed between recurrences
   - Look for pairs of entries that occurred in the same session and might
     have confounding causes
   - Read the associated trace files to distinguish correlation from causation

4. Identify RULE EFFECTIVENESS:
   - Read .claude/memory/rule-versions/ to list all rule changes made
   - For each rule change, count entries created BEFORE vs AFTER that change
     in the same category/subcategory
   - Flag rules that did NOT reduce error frequency (ineffective rules)
   - Flag rules that correlate with reduced errors (effective rules)

5. Identify TAXONOMY GAPS:
   - Entries whose category/subcategory feels forced
   - Entries that don't fit any existing category well

6. Identify TRACE PATTERNS:
   - Grep across all trace files for recurring error messages or command patterns
   - Cluster traces by error signature
   - Look for traces that share failure patterns but are logged under different
     entries (suggesting a single underlying cause was logged as multiple issues)

## Phase 2: Proposal Generation

### A. New Rules
For each recurring failure without a corresponding rule:
- Draft a specific, imperative rule for CLAUDE.md or the appropriate rules/ file
- Reference the entries that motivate it
- Predict: "This rule should prevent entries like [ID1, ID2, ID3] from recurring"

### B. Rule Modifications
For rules that appear ineffective:
- Propose revision or removal
- Show the before/after error frequency data

### C. Summary Improvements
For trace patterns that aren't captured in summaries:
- Propose adding specific error signatures to the relevant summary file

### D. Taxonomy Changes
For taxonomy gaps:
- Propose new subcategories or category splits
- Show which entries would be reclassified

### E. Confound Alerts
For confounded patterns:
- Present the conflicting root causes
- Propose which cause is more likely based on trace evidence

## Phase 3: Present and Confirm

Present ALL proposals in a numbered list:
```
╔══════════════════════════════════════════════════════════╗
║  SELF-IMPROVEMENT PROPOSALS                              ║
╠══════════════════════════════════════════════════════════╣
║  1. [NEW RULE] Prevent X — motivated by entries E1,E2,E3 ║
║  2. [REVISE RULE] Update Y — ineffective since 2026-03   ║
║  3. [SUMMARY] Add error sig to code-patterns.md          ║
║  4. [TAXONOMY] Split code/api into code/api-rest,graphql  ║
║  5. [CONFOUND] Entries E7,E8 may share root cause         ║
╠══════════════════════════════════════════════════════════╣
║  Impact estimate: [N] recurring errors could be prevented ║
╚══════════════════════════════════════════════════════════╝
Apply which? (all / none / specific numbers / modify)
```

## Phase 4: Execute Approved Changes

For each approved proposal:
1. Snapshot current files to rule-versions/ FIRST (Rule 6 / MH6)
2. Apply the change
3. Log the proposal, approval status, and change details to evolve-log.md
4. Update last_evolve in index.json to current timestamp
5. Increment evolve_count in index.json

## Phase 5: Report

"Self-improvement analysis complete:
- Entries analyzed: [X]
- Traces analyzed: [Y]
- Proposals generated: [N]
- Proposals accepted: [M]
- Rules added/modified: [R]
- Summaries updated: [S]
- Taxonomy changes: [T]
- Confounds identified: [C]
- Estimated recurring errors addressable: [E]
- Next recommended evolve: [date — suggest 30 days or after 20 new entries]"
