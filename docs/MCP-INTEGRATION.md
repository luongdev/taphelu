# Taphelu MCP Integration

Taphelu exposes a stdio MCP server:

```bash
node /path/to/taphelu/bin/taphelu-mcp.mjs
```

When installed from npm, `dl install` generates MCP entries that point to the installed package's `bin/taphelu-mcp.mjs`. Run `dl doctor --runtime all --scope global --config-dir <tmp-or-runtime-dir> --live` to verify managed adapter files, stale MCP paths, non-absolute `node` commands, local config shadowing, and a live MCP handshake.

Primary tools:

- `dl_start`
- `dl_context`
- `dl_observe`
- `dl_recall`
- `dl_checkpoint`
- `dl_close`
- `dl_cleanup_context`
- `dl_context_store`
- `dl_review_status`
- `dl_scan_project`
- `dl_memory_search`
- `dl_conversation_search`
- `dl_memory_promote`

When a host requires qualified tool names, use `taphelu:dl_start` style names.

`dl_close` accepts testing policy evidence:

- `testing_strictness`
- `testability`
- `required_evidence`
- `skipped_test_rationale`

Use these fields to carry the QA testability gate into closeout.

`dl_close` also returns cleanup and milestone compaction recommendations after a passing closeout. Use `dl_cleanup_context` for legacy/light cleanup or `dl_context_store action=compact` for indexed compaction; preview is the default.

`dl_context` returns compact state, durable L3 memory sections, recall results, `CONTEXT.md`, and selected index entries. It must not return raw run history.

`dl_context_store` actions:

- `index`: preview or write `.projects/CONTEXT.md` and `.projects/index.json`.
- `search`: search indexed artifacts by title, summary, tags, and path.
- `get`: fetch one selected artifact by id; use `start_line` and `end_line` for targeted reads.
- `compact`: preview or write milestone, runs, or plan compaction.

`dl_scan_project` maps an existing repo into compact project context. It reports structure, stack signals, service/API signals, docs, entrypoints, and inferred test commands without storing raw source dumps. It respects `.gitignore` and `.agentignore`.

Use its `action` field for onboarding flow:

- `scan` for structural scan. This is the default.
- `interview` for targeted domain/business questions after scan evidence.
- `plan` for bounded deep-scan work packets before broad source analysis.
- `map` for service topology and API contract mapping. Use `focus=services|contracts|topology|all`.

## Runtime Install

Generate runtime adapters:

```bash
dl install --runtime claude --scope local --write
dl install --runtime kiro --scope local --write
dl install --runtime codex --scope local --write
dl install --runtime gemini --scope local --write
dl install --runtime all --scope local --write
```

Validate:

```bash
dl doctor --runtime all --scope local --live
dl runtime status --runtime all --scope local
```

`full-auto` install generates MCP config, skills, agents or role-as-skill fallbacks, `/dl-*` commands, hooks, and runtime-appropriate status integration. Claude uses native `statusLine`; Gemini uses native footer model/context settings; Kiro keeps native TUI status with `/dl-status` for Taphelu state; Codex uses `/dl-status` fallback. Claude should be hardened first; Kiro, Codex, and Gemini follow with their supported surfaces.

Kiro has two hook surfaces. `dl install --runtime kiro --scope global` generates specialist CLI agent JSON files with embedded hooks for `kiro-cli`. Kiro IDE Agent Hooks are workspace-local; run `dl install --runtime kiro --scope local --write` inside a repo to write `.kiro/hooks/*.kiro.hook` files that the Kiro panel can discover. `taphelu-lead` is installed as main-session steering/skill guidance, not as a spawned specialist agent.

## Direct Client Commands

Codex:

```bash
codex mcp add taphelu -- node /path/to/taphelu/bin/taphelu-mcp.mjs
```

Claude:

```bash
claude mcp add -e TAPHELU_MANAGED=1 --transport stdio --scope local taphelu -- node /path/to/taphelu/bin/taphelu-mcp.mjs
```

Gemini:

```bash
gemini mcp add taphelu node /path/to/taphelu/bin/taphelu-mcp.mjs
```

Kiro:

```bash
kiro-cli mcp add --scope global --name taphelu --command /absolute/path/to/node --args /path/to/taphelu/bin/taphelu-mcp.mjs --env TAPHELU_MANAGED=1 --force
```
