# Install

Install the published package:

```bash
pnpm add -g @luongdev/taphelu
```

Current stable release:

```bash
0.1.1
```

For source checkout testing, install from a local tarball:

```bash
pnpm pack
pnpm add -g ./luongdev-taphelu-*.tgz
```

Validate the binaries:

```bash
dl commands
taphelu-mcp
```

`taphelu-mcp` is a stdio server. It waits silently for JSON-RPC input when run directly; press `Ctrl+C` to exit.

Beta testing:

- See [Beta Test Guide](BETA-TEST.md) for the recommended real-project smoke path and feedback template.
- See [Usage Guide](USAGE.md) for detailed CLI, MCP, runtime adapter, memory, context, and troubleshooting workflows.

Taphelu install is generated from `taphelu-pack`.

Default install profile is `full-auto`: MCP, skills, agents/role fallbacks, slash/init commands, guarded hooks, and runtime-appropriate status. Claude gets a native `statusLine`; Gemini keeps native footer model/context visible; Kiro uses its native TUI status plus `/dl-status`; Codex uses `/dl-status` fallback.

Dry run first:

```bash
dl install --runtime all --scope local --profile full-auto --hooks strict --statusline on --dry-run
```

Apply:

```bash
dl install --runtime all --scope local --write
```

Global install, recommended order:

```bash
dl install --runtime claude --scope global --write
dl install --runtime kiro --scope global --write
dl install --runtime codex --scope global --write
dl install --runtime gemini --scope global --write
```

Kiro IDE Agent Hooks are workspace-local. A global Kiro install configures `kiro-cli` agents/hooks, MCP, skills, and steering, but the Kiro panel only discovers hook files in the current repo's `.kiro/hooks` directory. To make Taphelu hooks visible in a Kiro IDE workspace, run this from that repo:

```bash
dl install --runtime kiro --scope local --profile full-auto --hooks strict --statusline on --write
```

Config roots:

- Codex: `CODEX_HOME` or `~/.codex`
- Claude skills: `CLAUDE_CONFIG_DIR` or `~/.claude`
- Gemini: `GEMINI_CONFIG_DIR` or `~/.gemini`
- Kiro: `KIRO_CONFIG_DIR` or `~/.kiro`

Claude Code can also register the MCP server through its own CLI:

```bash
NODE_BIN="$(command -v node)"
MCP_BIN="$(pnpm root -g)/@luongdev/taphelu/bin/taphelu-mcp.mjs"
claude mcp add -e TAPHELU_MANAGED=1 --transport stdio --scope user taphelu -- "$NODE_BIN" "$MCP_BIN"
dl doctor --runtime claude --scope global --live
```

Restart Claude Code after changing user-scope MCP config if it was already running.
If Claude stays `connecting...`, run `dl doctor --runtime claude --scope global --live`. It checks stale MCP paths, non-absolute `node` commands, local config shadowing, and a live MCP handshake.
Claude MCP config is separate from Claude settings: MCP entries use `.mcp.json` or `~/.claude.json`; hooks and `statusLine` use Claude `settings.json`.

Kiro can also register the MCP server through `kiro-cli`:

```bash
NODE_BIN="$(command -v node)"
MCP_BIN="$(pnpm root -g)/@luongdev/taphelu/bin/taphelu-mcp.mjs"
kiro-cli mcp add --scope global --name taphelu --command "$NODE_BIN" --args "$MCP_BIN" --env TAPHELU_MANAGED=1 --force
```

For tests or custom config roots:

```bash
dl install --runtime all --scope global --config-dir /tmp/taphelu-runtime --write
dl doctor --runtime all --scope global --config-dir /tmp/taphelu-runtime --live
```

Generated runtime paths under a custom config dir:

- `--runtime codex`: `config.toml`, `skills/`, `commands/`, `AGENTS.md`, and `/dl-status` fallback metadata.
- `--runtime claude`: `.mcp.json`, `skills/`, `agents/`, `commands/`, `hooks/`, and `settings.json` with hooks/statusLine.
- `--runtime gemini`: `settings.json`, `skills/`, and `extensions/taphelu/` with `gemini-extension.json`, commands, context, and footer settings for model/context display.
- `--runtime kiro`: `settings/mcp.json`, `skills/`, specialist CLI `agents/*.json` with hooks, native-TUI status metadata, Kiro steering, and skill-based `/dl-*` commands. Local-scope install also writes IDE `.kiro.hook` files under the workspace `.kiro/hooks`. `taphelu-lead` is installed as main-session skill/steering, not as a spawned agent.
- `--runtime all`: `/tmp/taphelu-runtime/claude`, `/tmp/taphelu-runtime/kiro`, `/tmp/taphelu-runtime/codex`, and `/tmp/taphelu-runtime/gemini`

`dl doctor` validates managed markers, hooks/status files or fallback metadata, local/global shadowing, and the generated MCP command/path. It reports `FAIL` when a stale config points to a missing `taphelu-mcp.mjs` or uses non-absolute `node`.

Runtime status:

```bash
dl runtime status --runtime claude --scope global --live
```

Package runtime E2E:

```bash
pnpm run test:runtime-install
```

Pre-publish guard:

```bash
pnpm run release:check
```

This command never publishes. It requires a clean git tree and npm registry login before running the release test gate.

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
