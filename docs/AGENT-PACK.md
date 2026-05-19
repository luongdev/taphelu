# Taphelu Agent Pack

Taphelu uses one canonical pack and generates runtime adapters from it.

Supported adapter targets: Codex, Claude, Gemini, and Kiro.

Canonical source:

- `taphelu-pack/skills/*.md`
- `taphelu-pack/agents/*.md`
- `taphelu-pack/commands/*.md`
- `taphelu-pack/hooks/*.mjs`
- `taphelu-pack/mcp.json`
- `taphelu-pack/manifest.json`

Generated runtime files are not source of truth. They include a Taphelu managed marker and should be regenerated with `dl install`.

## Skills

- `taphelu-core`: lifecycle start, context, checkpoint, close.
- `taphelu-workflow`: ask, research, plan, run.
- `taphelu-memory`: observe, recall, promote, search.
- `taphelu-verify`: verification and closeout.
- `taphelu-context`: cleanup, instruction hygiene, and project scan usage.
- `taphelu-browser`: permission-gated browser research/E2E.
- `taphelu-bmad`: BMAD import and continuation.
- `taphelu-adapters`: BMAD, GSD, Superpower, and generic project import routing.

## Agent Roles

- `taphelu-lead` (main-session role, not a spawned sub-agent)
- `taphelu-analyst`
- `taphelu-planner`
- `taphelu-architect`
- `taphelu-dev`
- `taphelu-qa`
- `taphelu-ux-analyst`
- `taphelu-visual-qa`
- `taphelu-memory-curator`
- `taphelu-context-curator`
- `taphelu-workflow-adapter`

If a runtime supports native agents, Taphelu generates native agent files. Otherwise, agent role contracts are generated as skills.

`taphelu-lead` asks for sub-agent permission at session start and coordinates from the main session. Runtime adapters must not expose `taphelu-lead` as a native spawned sub-agent; specialist roles such as `taphelu-planner`, `taphelu-dev`, and `taphelu-qa` are the delegated roles. `taphelu-planner` creates parallelizable task contracts; `taphelu-qa` reviews task testability before `taphelu-dev` executes. UI-visible work requires both UX analysis and visual QA evidence before closeout.

## Runtime Orchestration

Generated commands expose the same lifecycle in every runtime:

- `/dl-init`
- `/dl-resume`
- `/dl-scan`
- `/dl-plan`
- `/dl-close`
- `/dl-status`

Claude gets native commands, agents with `skills` frontmatter, hooks, and `statusLine`. The Claude statusline keeps live runtime facts first: model, effort when available, and `context_window.used_percentage`, then compact Taphelu state.

Runtime status surfaces are capability-based:

- Claude: native `statusLine` command script, including model, effort, context percentage, Taphelu phase/status, memory/index counts, and git dirty state.
- Gemini: native CLI footer is configured to keep model info and context percentage visible; Taphelu-specific state remains available through `/dl-status`.
- Kiro: native TUI status/progress remains runtime-owned; Taphelu-specific state is exposed through `/dl-status`, generated CLI agent JSON, IDE `.kiro.hook` files, and generated skill context.
- Codex: no verified custom statusline config surface in the installed CLI; Taphelu installs `/dl-status`, MCP, skills, and compact `AGENTS.md` pointer only.

Kiro uses skill-based slash commands, generated CLI agents, and IDE hook files. Gemini gets an extension under `extensions/taphelu` plus generated commands. Codex gets skills, MCP config, and compact instruction/status fallback files.

Hooks are generated from one canonical script and must summarize only meaningful events. They must not write raw logs, browser content, source dumps, PII, or secrets into always-loaded context.

Cross-AI review is permission-gated. The lead asks before invoking another runtime and records skipped/requested/completed/blocked review status.

The context curator runs after verified closeout to compact completed work into indexed artifacts. Default flow: `dl context index`, `dl compact milestone --id <id>`, `dl compact runs`, then resume future sessions from `CONTEXT.md` plus targeted `dl context search/get`.

## Testing Policy

Project test strictness is read from `.projects/config.json`.

- `low`: smoke, artifact, manual, or main-flow evidence.
- `medium`: main flows, command/API contracts, critical infra, memory/state writes, and regressions.
- `deep`: unit or integration evidence for changed logic.

Planner tasks include testability and required evidence. Closeout records the strictness used, QA review, required evidence, and skipped-test rationale.
