# Install

Install the published package:

```bash
npm install -g @luongdev/taphelu
```

Current npm test build:

```bash
0.1.0-build.1
```

Before publish, install from a local tarball:

```bash
npm pack
npm install -g ./luongdev-taphelu-*.tgz
```

Validate the binaries:

```bash
dl commands
taphelu-mcp
```

`taphelu-mcp` is a stdio server. It waits silently for JSON-RPC input when run directly; press `Ctrl+C` to exit.

Beta testing:

- See [Beta Test Guide](BETA-TEST.md) for the recommended real-project smoke path and feedback template.

Taphelu install is generated from `taphelu-pack`.

Dry run first:

```bash
dl install --runtime all --scope local --dry-run
```

Apply:

```bash
dl install --runtime all --scope local --write
```

Global install:

```bash
dl install --runtime codex --scope global --write
dl install --runtime claude --scope global --write
dl install --runtime gemini --scope global --write
dl install --runtime kiro --scope global --write
```

Config roots:

- Codex: `CODEX_HOME` or `~/.codex`
- Claude skills: `CLAUDE_CONFIG_DIR` or `~/.claude`
- Gemini: `GEMINI_CONFIG_DIR` or `~/.gemini`
- Kiro: `KIRO_CONFIG_DIR` or `~/.kiro`

Claude Code can also register the MCP server through its own CLI:

```bash
NODE_BIN="$(command -v node)"
MCP_BIN="$(npm root -g)/@luongdev/taphelu/bin/taphelu-mcp.mjs"
claude mcp add -e TAPHELU_MANAGED=1 --transport stdio --scope user taphelu -- "$NODE_BIN" "$MCP_BIN"
dl doctor --runtime claude --scope global
```

Restart Claude Code after changing user-scope MCP config if it was already running.

Kiro can also register the MCP server through its CLI:

```bash
NODE_BIN="$(command -v node)"
MCP_BIN="$(npm root -g)/@luongdev/taphelu/bin/taphelu-mcp.mjs"
kiro --add-mcp '{"name":"taphelu","command":"'"$NODE_BIN"'","args":["'"$MCP_BIN"'"],"env":{"TAPHELU_MANAGED":"1"}}'
```

For tests or custom config roots:

```bash
dl install --runtime all --scope global --config-dir /tmp/taphelu-runtime --write
dl doctor --runtime all --scope global --config-dir /tmp/taphelu-runtime
```

Generated runtime paths under a custom config dir:

- `--runtime codex`: `/tmp/taphelu-runtime/config.toml` and `/tmp/taphelu-runtime/skills/`
- `--runtime claude`: `/tmp/taphelu-runtime/.mcp.json`, `/tmp/taphelu-runtime/skills/`, and `/tmp/taphelu-runtime/agents/`
- `--runtime gemini`: `/tmp/taphelu-runtime/settings.json` and `/tmp/taphelu-runtime/skills/`
- `--runtime kiro`: `/tmp/taphelu-runtime/settings/mcp.json`, `/tmp/taphelu-runtime/skills/`, and `/tmp/taphelu-runtime/agents/`
- `--runtime all`: `/tmp/taphelu-runtime/codex`, `/tmp/taphelu-runtime/claude`, `/tmp/taphelu-runtime/gemini`, and `/tmp/taphelu-runtime/kiro`

`dl doctor` validates managed markers and the generated MCP command/path. It reports `FAIL` when a stale config points to a missing `taphelu-mcp.mjs`.

Package runtime E2E:

```bash
npm run test:runtime-install
```

Pre-publish guard:

```bash
npm run release:check
```

This command never publishes. It requires a clean git tree and npm login before running the release test gate.

Existing unmanaged adapter files block installation. Remove them or migrate them before reinstalling.

Instruction hygiene:

```bash
dl doctor instructions
```

This warns when runtime instruction files become too large or contain raw run history, roadmap dumps, logs, browser content, PII, or secrets.

Project test policy:

```bash
dl config get testing.strictness
dl config set testing.strictness medium
```

The default is `medium`. `dl plan`, `dl run`, and `dl verify` use this value when deciding evidence depth.

Release checklist:

- See [Release Checklist](RELEASE.md).
