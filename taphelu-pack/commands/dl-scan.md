# Taphelu Scan

Onboard an existing repo before planning.

1. Call `dl_scan_project` with `action=scan`, `mode=quick`, `write=false`.
2. If domain intent is unclear, call `dl_scan_project` with `action=interview`, then ask the generated questions in chat.
3. After the user answers, call `dl_scan_project` with `action=interview`, answer fields, and `write=true` only after approval.
4. If repo is large or unfamiliar, call `dl_scan_project` with `action=plan`.
5. If service/API signals exist, call `dl_scan_project` with `action=map`.
6. Write artifacts only after user approval or explicit write intent.

Never dump raw source into memory or context.
