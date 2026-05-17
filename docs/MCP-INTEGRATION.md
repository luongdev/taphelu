# Taphelu MCP Integration

Taphelu exposes a stdio MCP server:

```bash
node /path/to/taphelu/bin/taphelu-mcp.mjs
```

Primary tools:

- `dl_start`
- `dl_context`
- `dl_observe`
- `dl_recall`
- `dl_checkpoint`
- `dl_close`
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

## Runtime Install

Generate runtime adapters:

```bash
dl install --runtime codex --scope local --write
dl install --runtime claude --scope local --write
dl install --runtime gemini --scope local --write
dl install --runtime all --scope local --write
```

Validate:

```bash
dl doctor --runtime all --scope local
```

## Direct Client Commands

Codex:

```bash
codex mcp add taphelu -- node /path/to/taphelu/bin/taphelu-mcp.mjs
```

Claude:

```bash
claude mcp add --transport stdio --scope local taphelu -- node /path/to/taphelu/bin/taphelu-mcp.mjs
```

Gemini:

```bash
gemini mcp add taphelu node /path/to/taphelu/bin/taphelu-mcp.mjs
```
