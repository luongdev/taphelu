---
name: taphelu-memory
description: Use when capturing, recalling, searching, or promoting Taphelu layered memory.
---

# Taphelu Memory

Memory layers:

- L0: sanitized raw observations and checkpoints.
- L1: atomic facts, preferences, decisions.
- L2: workflow scenes.
- L3: compact profile mirrored to `.projects/MEMORY.md`.

Use `dl_observe` for capture, `dl_recall` for relevant L1/L2/L3, `dl_memory_search` for structured memory, and `dl_conversation_search` for L0 drill-down.

Promote with `dl_memory_promote` only when source IDs exist.

Do not promote secrets, PII, raw browser content, or raw logs to L1/L2/L3.
