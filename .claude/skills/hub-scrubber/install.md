# Installing hub-scrubber on a client machine

The 3DMations Memory Hub does NOT scrub server-side. Each client machine
that writes memories must run the scrubber before POST.

## One-time install per machine

```bash
# From the hub repo on the hub host:
cd /home/aiwork/Documents/Projects/3DMations-Memory

# Copy this skill to the user's global Claude skills directory:
cp -r .claude/skills/hub-scrubber/ ~/.claude/skills/hub-scrubber/

# Or, on a remote client machine, fetch it:
scp -r aiwork@<hub-host>:~/Documents/Projects/3DMations-Memory/.claude/skills/hub-scrubber/ \
        ~/.claude/skills/
```

## Verify install

```bash
ls ~/.claude/skills/hub-scrubber/
# Expect: SKILL.md  install.md  patterns.ts  scrubber.ts
```

In a Claude Code session on the client machine, the skill should appear in
the available-skills list as `hub-scrubber`.

## Updating

When patterns are added/changed in the hub repo, re-run the copy step on each
machine. There is no auto-update mechanism today (deferred — single-user, 5
machines, infrequent changes). If pattern churn becomes high, revisit.

## Why per-machine instead of central

The scrubber must run BEFORE the network request, so it has to live where the
caller lives. Central enforcement on the hub was the v3.3 approach; v4.3
deliberately moved it to the edge ("shift left"). See plan-v4.3.md §Phase 3.
