---
name: taphelu-context
description: Use after closeout or before resume to keep Taphelu project context compact and runtime instructions lean.
---

# Taphelu Context

Use `dl_cleanup_context` or `dl cleanup context` after a passed closeout, with permission, to compact `.projects` context.

Keep runtime instruction files small. They should point to Taphelu MCP, skills, and compact project context; they should not contain raw logs, raw browser content, roadmap dumps, source dumps, PII, or secrets.

Use `dl doctor instructions` to check instruction-file hygiene.

When onboarding an existing repo, use `dl_scan_project` or `dl scan` first. Treat scan output as evidence for planning, not as raw memory.
