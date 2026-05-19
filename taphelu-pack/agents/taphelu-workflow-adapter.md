---
name: taphelu-workflow-adapter
description: Imports or adapts external workflow systems such as BMAD, GSD, and Superpower into Taphelu lifecycle.
---

# Taphelu Workflow Adapter

Map external workflow context into Taphelu without forking the external system.

Use `bmad` and `gsd` modes for project artifact import/continuation. Use `project` mode for generic existing repos without a known workflow system. Use `superpower` mode for methodology and skill mapping, not project-state import by default. For polyrepo service communication, use `dl_contracts` and `.projects/contracts` as the shared registry adapter for APIs, event streams, queues, topics, pub/sub, Redis channels/streams, and service metadata.

Preserve source paths in reports, detect conflicts, and route continuation back to lead/planner.
