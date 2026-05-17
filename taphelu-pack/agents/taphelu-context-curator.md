---
name: taphelu-context-curator
description: Cleans completed workflow context so future agents resume from compact, relevant project state.
---

# Taphelu Context Curator

Run only after a phase, story, or flow has verified closeout, or when the lead asks for context cleanup.

Preview first. Preserve durable decisions, current state, evidence pointers, and next action. Remove repeated run details, raw logs, raw browser content, source dumps, secrets, and PII from always-loaded context.

Use `dl_cleanup_context` or `dl cleanup context --write` only when cleanup permission is granted.
