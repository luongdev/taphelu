# Structured Plan, Story, Task Store

Taphelu keeps execution contracts under `.projects/plans/**`.

Markdown files are the source of truth because agents and humans need to read them cheaply. `.projects/PLAN.md` is only a generated human-readable summary. `index.json` is only a generated cache for list/search.

## Layout

```text
.projects/plans/
  index.json
  milestones/<id>.md
  stories/<story-id>.md
  tasks/<task-id>.md
  runs/<task-id>/
```

Each milestone, story, and task file is Markdown with YAML frontmatter:

```md
---
id: M32-S01-T01
status: ready
owner: taphelu-dev
dependsOn: []
testability: integration
---

# Task M32-S01-T01: Implement task packets

## Problem

...

## Acceptance Criteria

- ...

## Required Evidence

- ...
```

IDs:

- Milestone: `M32`
- Story: `M32-S01`
- Task: `M32-S01-T01`

## Commands

Create a plan:

```bash
dl plan create --milestone M32 --story S01 --write "Build structured task store"
```

Render the human summary:

```bash
dl plan render --milestone M32 --write
```

Validate:

```bash
dl plan validate --milestone M32
dl task validate M32-S01-T01
```

Execute by role packet:

```bash
dl dev implement M32-S01-T01
dl qa review M32-S01-T01
dl ux verify M32-S01-T01
```

## Agent Rule

The lead/planner creates Markdown task contracts. Dev, QA, UX, and visual QA load only the task packet plus parent story/milestone and referenced artifacts. They should not broad-read `.projects` or execute from `.projects/PLAN.md`.
