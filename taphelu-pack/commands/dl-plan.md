# Taphelu Plan

Create implementation-ready task contracts.

1. Load compact context with `dl_context`.
2. Split FE/BE, infra/business, and contract/implementation where possible.
3. Maximize independent parallel groups.
4. Assign owner role, boundary, dependencies, required evidence, and testability per task.
5. Route the plan through `taphelu-qa` before implementation.

Planner writes contracts, not duplicated implementation.

Runtime-specific note:

- Gemini: `/dl-plan` should use `mcp_taphelu_dl_context` first, then produce the plan. Do not use nonexistent shell/file/skill tools as a substitute for Taphelu context.
