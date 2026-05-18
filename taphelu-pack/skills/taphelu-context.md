---
name: taphelu-context
description: Use after closeout or before resume to keep Taphelu project context compact and runtime instructions lean.
---

# Taphelu Context

Use `dl_context_store` or `dl context` to index, search, and fetch project context artifacts. Load `CONTEXT.md` first, then drill down with `dl context search` and `dl context get`.

After a passed closeout, ask permission to run `dl compact milestone --id <id>` and `dl compact runs`. Preview first unless permission or `--write` is explicit.

`dl_cleanup_context` and `dl cleanup context` remain legacy/light cleanup for always-loaded files.

Keep runtime instruction files small. They should point to Taphelu MCP, skills, and compact project context; they should not contain raw logs, raw browser content, roadmap dumps, source dumps, PII, or secrets.

Use `dl doctor instructions` to check instruction-file hygiene.

When onboarding an existing repo, use `dl_scan_project` action `scan` or `dl scan` first. Then use `interview` to ask only missing domain/business questions and `plan` to create bounded deep-scan packets before broad analysis. If service/API signals exist, use action `map` or `dl scan map` to generate compact service and contract topology artifacts.
