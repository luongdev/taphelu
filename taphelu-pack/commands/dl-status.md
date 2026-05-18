# Taphelu Status

Show compact runtime status.

1. Prefer `dl_context` for agent-readable status.
2. Use `dl context search` for specific artifacts.
3. Use `dl doctor --runtime <runtime> --live` for runtime integration health.
4. Report current goal, phase, verification gate, review gate, and context load policy.

Runtime-specific note:

- Gemini: `/dl-status` should call `mcp_taphelu_dl_context` or the visible Taphelu `dl_context` MCP tool. Do not try `run_shell_command`, `activate_skill`, or `write_file` for status.

Keep status short.
