# Taphelu Status

Show compact runtime status.

1. Prefer `dl_context` for agent-readable status.
2. Use `dl context search` for specific artifacts.
3. Use `dl doctor --runtime <runtime> --live` for runtime integration health.
4. Report current goal, phase, verification gate, review gate, and context load policy.

Runtime entrypoint note:

- `/dl-status` should call the visible Taphelu context tool: `dl_context`, `taphelu:dl_context`, or Gemini-style `mcp_taphelu_dl_context`.
- Do not try guessed host tools such as `run_shell_command`, `activate_skill`, `write_file`, or runtime-specific equivalents for status.

Keep status short.
