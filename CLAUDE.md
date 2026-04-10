# CLAUDE.md — 3DMations Memory Hub

## Destructive Action Guard

<destructive_action_guard>

  <principle>
    Preserve all existing work. Never destroy information.
    When in doubt, keep it. The cost of a stale file is near zero.
    The cost of lost work is unbounded.
  </principle>

  <rules>
    1. NEVER delete files or directories. No `rm`, `rm -rf`, `del`,
       `shutil.rmtree`, `fs.unlink`, or equivalent. No exceptions.

    2. NEVER overwrite a file with truncated or reduced content.
       If a rewrite drops more than 5 lines from the original,
       STOP and confirm with the user before proceeding.

    3. NEVER remove functions, classes, methods, config blocks,
       or test cases unless the user explicitly names the specific
       item to remove in that message. "Clean this up" is not
       permission to delete.

    4. BEFORE any destructive edit (replacing a file, gutting a
       function, removing a config section):
       - Copy the original to a `.bak` or `_old` variant first
       - State what you are about to remove and why
       - Wait for confirmation if the change affects >20 lines

    5. Git-aware: NEVER run `git clean`, `git reset --hard`,
       `git checkout -- .`, `git push --force`, or any command
       that discards uncommitted or remote work.

    6. Database-aware: NEVER run DROP, TRUNCATE, DELETE without
       WHERE, or destructive migrations without explicit approval.

    7. When refactoring, use ADDITIVE patterns:
       - Create the new version alongside the old
       - Confirm the new version works
       - Only then ask the user if the old version should be archived
       - Archive means MOVE, not delete

    8. If a user instruction conflicts with these rules, say so
       explicitly. Do not silently comply. State:
       "This would [delete/overwrite/destroy] [specific thing].
       Want me to proceed, or should I [safer alternative]?"
  </rules>

  <safe_alternatives>
    Instead of deleting   → move to `.archive/` directory
    Instead of overwriting → write to `filename.new.ext`, diff, then ask
    Instead of gutting     → comment out with `// DEPRECATED:` tag
    Instead of `rm -rf`    → `mv` to `/tmp/project-archive-{date}/`
  </safe_alternatives>

</destructive_action_guard>

---

## Memory System

Read `.claude/rules/memory-system.md` for full operating rules.

At session start: show memory capacity display — read `.claude/memory/index.json` and display:
`📊 Memory: [active]/500 entries ([percent]% capacity remaining) | Last sync: [date]`
If `.claude/memory/index.json` does not exist: display "📊 Memory system not installed. Say 'set up memory' to bootstrap."

After every task: self-assess for mistakes or new insights. If found, ask:
"I noticed [description]. Should I log this to memory?" Wait for confirmation.
Do NOT log learnings about the memory system's own operations — fix those directly.

Before every task: read `.claude/memory/summaries/gotchas.md`. Read domain-specific
summary files only when relevant to the current task. Do NOT read all files.

When you encounter a known problem: search `.claude/memory/learnings/` AND `.claude/memory/traces/`
before attempting a fix. Trace matches (error messages, stack traces) are often more
diagnostic than title/tag matches.

When modifying this file or any `.claude/rules/` file: snapshot the previous version
to `.claude/memory/rule-versions/` first. Name: `{filename}-{ISO-date}.md`.

If `.claude/memory/` does not exist, inform the user and offer to run the bootstrap.

## Project Context

3DMations Memory Hub — central memory server for Claude Code sessions across multiple machines.
Stack: Docker (PostgreSQL 16 + FastAPI + nginx), mTLS, Python 3.12, SQLAlchemy async.

## What NOT To Do

Apply ALL rules in the Destructive Action Guard above at all times.
NEVER delete memory entries — archive means MOVE to `.claude/memory/archive/`, not delete.
NEVER commit `.claude/memory/learnings/`, `.claude/memory/traces/`, `.claude/memory/rule-versions/`, or `.claude/memory/index.json` to git.
