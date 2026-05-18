# Taphelu Agent Pack

Taphelu uses one canonical pack and generates runtime adapters from it.

Supported adapter targets: Codex, Claude, Gemini, and Kiro.

Canonical source:

- `taphelu-pack/skills/*.md`
- `taphelu-pack/agents/*.md`
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

## Agent Roles

- `taphelu-lead`
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

`taphelu-lead` asks for sub-agent permission at session start. `taphelu-planner` creates parallelizable task contracts; `taphelu-qa` reviews task testability before `taphelu-dev` executes. UI-visible work requires both UX analysis and visual QA evidence before closeout.

Cross-AI review is permission-gated. The lead asks before invoking another runtime and records skipped/requested/completed/blocked review status.

The context curator runs after verified closeout to compact completed work into indexed artifacts. Default flow: `dl context index`, `dl compact milestone --id <id>`, `dl compact runs`, then resume future sessions from `CONTEXT.md` plus targeted `dl context search/get`.

## Testing Policy

Project test strictness is read from `.projects/config.json`.

- `low`: smoke, artifact, manual, or main-flow evidence.
- `medium`: main flows, command/API contracts, critical infra, memory/state writes, and regressions.
- `deep`: unit or integration evidence for changed logic.

Planner tasks include testability and required evidence. Closeout records the strictness used, QA review, required evidence, and skipped-test rationale.
