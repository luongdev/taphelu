# Taphelu Plan

Create implementation-ready Markdown task contracts. `PLAN.md` is only a generated human view; the source of truth is `.projects/plans/**/*.md`. `index.json` is only a generated cache.

1. Load compact context with `dl_context`.
2. Split FE/BE, infra/business, and contract/implementation where possible.
3. Maximize independent parallel groups.
4. Assign owner role, boundary, dependencies, acceptance criteria, required evidence, and testability per task.
5. Write or request structured artifacts with `dl_task_store action=plan_create` or `dl plan create --write`.
6. Route the plan through `taphelu-qa` before implementation.

Planner writes contracts, not duplicated implementation.

Runtime entrypoint note:

- `/dl-plan` should load compact context first with the visible Taphelu context tool: `dl_context`, `taphelu:dl_context`, or Gemini-style `mcp_taphelu_dl_context`.
- Do not use nonexistent shell/file/skill tools as a substitute for Taphelu context.
- Do not tell dev/QA/UX to execute from raw `.projects/PLAN.md`; give them task ids such as `M32-S01-T01`.
- Dev must use `dl dev implement <task-id>` or `dl_task_store action=dev_packet`.
- QA must use `dl qa review <task-id>` or `dl_task_store action=qa_packet`.
- UX/visual QA must use `dl ux verify <task-id>` when user-visible checks exist.
