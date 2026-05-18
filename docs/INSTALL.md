# Install

Install the published package:

```bash
npm install -g @luongdev/taphelu
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
```

Config roots:

- Codex: `CODEX_HOME` or `~/.codex`
- Claude skills: `CLAUDE_CONFIG_DIR` or `~/.claude`
- Gemini: `GEMINI_CONFIG_DIR` or `~/.gemini`

For tests or custom config roots:

```bash
dl install --runtime all --scope global --config-dir /tmp/taphelu-runtime --write
dl doctor --runtime all --scope global --config-dir /tmp/taphelu-runtime
```

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
