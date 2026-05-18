# Taphelu

Taphelu is a local-first workflow substrate for long-running AI-agent work.

It gives AI agents and humans a shared project workflow through:

- `dl`, a local CLI for workflow state, planning, verification, memory, scan, install, and review helpers.
- `taphelu-mcp`, a stdio MCP server for agent-native lifecycle tools.
- A canonical agent pack that generates Codex, Claude, and Gemini adapters from one source.
- Layered local memory using SQLite plus compact `.projects` context files.

## Status

Taphelu is early v0.1 software. The current focus is local CLI/MCP usage and package-readiness. Do not expect cloud sync, hosted execution, or a web UI yet.

## Requirements

- Node.js `>=22.16.0`
- An MCP-capable AI runtime for agent-native usage

## Install

After publish:

```bash
npm install -g @luongdev/taphelu
```

Before publish, install from a packed tarball:

```bash
npm pack
npm install -g ./luongdev-taphelu-*.tgz
```

## Quick Start

Inspect available commands:

```bash
dl commands
```

Scan an existing project without writing anything:

```bash
dl scan --path . --mode quick
dl scan interview --path . --mode quick
dl scan plan --path . --mode standard
dl scan map --path . --mode standard
```

Write compact project context:

```bash
dl scan --path . --mode standard --write
dl context index --write
```

After verified closeout, compact completed work:

```bash
dl compact milestone --id M24 --write
dl compact runs --keep 5 --write
```

Start the MCP server:

```bash
taphelu-mcp
```

`taphelu-mcp` is a stdio server. It waits silently for JSON-RPC input when run directly; press `Ctrl+C` to exit.

Generate runtime adapters:

```bash
dl install --runtime all --scope local --dry-run
dl install --runtime all --scope local --write
dl doctor --runtime all --scope local
```

## Local Data Boundaries

- `.projects/` is project-local Taphelu context and should stay ignored.
- Long-term memory uses a user-local SQLite database under `~/.taphelu`.
- Raw logs, raw browser content, PII, and secrets should not be promoted to durable memory by default.
- Generated runtime files are managed artifacts; canonical source lives in `taphelu-pack/`.

## Core Commands

- `dl ask`: turn vague goals into requirement packets.
- `dl research`: record source-grounded findings.
- `dl plan`: create task contracts and QA testability gates.
- `dl run`: connect requirement, research, planning, and verification.
- `dl verify`: record verification evidence and review status.
- `dl scan`: bootstrap context from an existing repo.
- `dl context`: index, search, and fetch project context artifacts.
- `dl compact`: archive completed milestone, run, and plan context.
- `dl cleanup context`: legacy/light cleanup for always-loaded files.
- `dl install`: generate runtime adapters.
- `dl doctor`: validate generated adapters and instruction hygiene.

## Documentation

- [Install](docs/INSTALL.md)
- [MCP Integration](docs/MCP-INTEGRATION.md)
- [Agent Pack](docs/AGENT-PACK.md)
- [Project Scan](docs/PROJECT-SCAN.md)
- [Context Store](docs/CONTEXT-STORE.md)
- [Roadmap](docs/ROADMAP.md)
- [Release Checklist](docs/RELEASE.md)

## Release Safety

Publishing is manual. Run the release checklist before `npm publish --access public`.

## License

MIT
