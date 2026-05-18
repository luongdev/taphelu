# Taphelu Plan

Create implementation-ready task contracts.

1. Load compact context with `dl_context`.
2. Split FE/BE, infra/business, and contract/implementation where possible.
3. Maximize independent parallel groups.
4. Assign owner role, boundary, dependencies, required evidence, and testability per task.
5. Route the plan through `taphelu-qa` before implementation.

Planner writes contracts, not duplicated implementation.

Runtime entrypoint note:

- `/dl-plan` should load compact context first with the visible Taphelu context tool: `dl_context`, `taphelu:dl_context`, or Gemini-style `mcp_taphelu_dl_context`.
- Do not use nonexistent shell/file/skill tools as a substitute for Taphelu context.
