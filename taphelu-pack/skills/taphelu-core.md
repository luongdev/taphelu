---
name: taphelu-core
description: Use when starting, resuming, checkpointing, or closing Taphelu-backed agent work through MCP lifecycle tools.
---

# Taphelu Core Lifecycle

Use Taphelu as the session substrate before doing non-trivial project work.

Required flow:

1. Start or resume with `dl_start`.
2. Ask for sub-agent permission at session start: `off`, `session`, or `project`.
3. Load compact context with `dl_context` when context is stale.
4. Route decomposable work through team roles after permission.
5. Record meaningful observations with `dl_observe`.
6. Save resumable progress with `dl_checkpoint`.
7. Close with `dl_close` only after verification evidence exists.
8. After a passed closeout, ask whether to run `dl_context_store action=compact` or `dl compact milestone --id <id>`.

When the host requires qualified MCP names, use `taphelu:dl_start` style names.
Across Codex, Claude, Gemini, Kiro, and other runtimes, prefer generated Taphelu entrypoints over guessed host tools:

- `/dl-status`, `/dl-init`, `/dl-resume`, `/dl-scan`, `/dl-plan`, `/dl-close`
- `dl_context`, `dl_start`, `dl_observe`, `dl_checkpoint`, `dl_close`
- Gemini-style MCP names when exposed: `mcp_taphelu_dl_context`, `mcp_taphelu_dl_start`, `mcp_taphelu_dl_observe`, `mcp_taphelu_dl_checkpoint`, `mcp_taphelu_dl_close`

Do not invent host tools such as `activate_skill`, `run_shell_command`, `write_file`, or runtime-specific equivalents as Taphelu entrypoints. If a Taphelu tool is not visibly available, use a `/dl-*` command or say the Taphelu tool is unavailable.

Do not load raw L0 history unless explicitly drilling down with conversation search.

Think before acting, keep changes simple and surgical, and define success criteria before execution.
