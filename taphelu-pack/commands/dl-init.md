# Taphelu Init

Start or resume Taphelu before non-trivial work.

1. Call `dl_start` with the current goal and runtime id.
2. If `.projects` is missing, call `dl_scan_project` with `action=scan`, `mode=quick`, `write=false`.
3. Ask for sub-agent permission: `off`, `session`, or `project`.
4. Load compact context with `dl_context`.
5. Continue through `taphelu-lead` in the main session. Do not spawn `taphelu-lead` as a sub-agent.

Do not read raw logs or full history during init.
