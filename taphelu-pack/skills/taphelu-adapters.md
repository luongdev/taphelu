---
name: taphelu-adapters
description: Use when importing BMAD, GSD, Superpower, or generic project context into Taphelu lifecycle.
---

# Taphelu Adapters

Use external workflow artifacts as upstream context without copying raw history into always-loaded prompts.

Supported imports:

- `dl import bmad`: planning artifacts, epics, stories, sprint status.
- `dl import gsd`: `.planning` project state, roadmap, plans, phases, milestones, threads.
- `dl import superpower`: methodology, skills, and agent guidance.
- `dl import project`: generic existing repo scan.

If import reports blockers, stop and surface them before planning.

After import succeeds, continue through Taphelu lifecycle: start, recall, observe, checkpoint, verify, close.
