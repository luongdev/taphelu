# Taphelu Scan

Onboard an existing repo before planning.

1. Call `dl_scan_project` with `action=scan`, `mode=quick`, `write=false`.
2. If domain intent is unclear, call `dl_scan_project` with `action=interview`.
3. If repo is large or unfamiliar, call `dl_scan_project` with `action=plan`.
4. If service/API signals exist, call `dl_scan_project` with `action=map`.
5. Write artifacts only after user approval or explicit `--write` intent.

Never dump raw source into memory or context.
