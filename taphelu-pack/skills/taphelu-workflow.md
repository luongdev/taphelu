---
name: taphelu-workflow
description: Use for Taphelu requirement gathering, research, planning, and workflow run packets.
---

# Taphelu Workflow

Use the CLI primitives when MCP is unavailable or when a human-readable packet is needed:

- `dl ask` for requirement packets.
- `dl research` for sourced findings.
- `dl plan` for executable plans.
- `dl run` for end-to-end packet assembly.
- `dl config get testing.strictness` to load project test strictness.
- `dl scan --mode quick` before planning inside an existing un-mapped repo.
- `dl_scan_project action=interview` before asking broad domain questions; ask the generated questions in chat instead of making the user type long CLI flags.
- `dl scan plan` before deep analysis of large or unfamiliar codebases.
- `dl scan map` after `dl scan plan` when service/API signals exist.

Keep packets concise. State assumptions, evidence, blockers, and next route.

Planner output should be task contracts, not implementation. Maximize parallelism, split FE/BE and infra/business boundaries when possible, then route tasks through QA testability review before dev work.

Record durable observations through MCP memory tools instead of duplicating raw context in Markdown.
