# Taphelu

Taphelu is a local-first workflow substrate for long-running AI-agent work.

It gives AI agents and humans a shared project workflow through:

- `dl`, a local CLI for workflow state, planning, verification, memory, scan, install, and review helpers.
- `taphelu-mcp`, a stdio MCP server for agent-native lifecycle tools.
- A canonical agent pack that generates Codex, Claude, Gemini, and Kiro adapters from one source.
- Layered local memory using SQLite plus compact `.projects` context files.

## Status

Taphelu is early v0.1 software. The current test build is `0.1.0-build.2`. The current focus is local CLI/MCP usage and beta feedback. Do not expect cloud sync, hosted execution, or a web UI yet.

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

Read the detailed workflow guide:

```bash
open docs/USAGE.md
```

Recommended agent-native start after runtime install:

```text
Use Taphelu to onboard this repo. Scan it first, ask me only missing domain/business questions, then create a scan plan. Preview first; ask before writing .projects.
```

CLI fallback for inspecting what the agent would call:

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
dl doctor --runtime all --scope local --live
```

Runtime adapters target Claude, Kiro, Codex, and Gemini from the same canonical pack. `full-auto` install generates MCP config, skills, specialist agents or role fallbacks, slash commands, hooks, and runtime-appropriate status integration. `taphelu-lead` stays in the main session, while specialist roles are delegated. Claude gets native `statusLine`; Gemini keeps native footer model/context visible; Kiro gets CLI agent hooks globally and workspace-local IDE `.kiro.hook` files with local install, then uses `/dl-status` for Taphelu-specific state where custom statusline support is not available.

## Beta Testing

For real-project test instructions and feedback format, see [Beta Test Guide](docs/BETA-TEST.md).

Recommended first pass:

```bash
npm install -g @luongdev/taphelu@0.1.0-build.2
cd <repo-can-test>
dl scan --path . --mode quick
dl scan interview --path .
dl scan plan --path .
dl install --runtime claude --scope global --dry-run
dl doctor --runtime claude --scope global --live
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
- `dl import bmad|gsd|superpower|project`: import known workflow artifacts or generic repo context.
- `dl context`: index, search, and fetch project context artifacts.
- `dl compact`: archive completed milestone, run, and plan context.
- `dl cleanup context`: legacy/light cleanup for always-loaded files.
- `dl install`: generate runtime adapters.
- `dl doctor`: validate generated adapters, live MCP startup, and instruction hygiene.
- `dl runtime status`: show runtime adapter and MCP health.

## Documentation

- [Install](docs/INSTALL.md)
- [Usage Guide](docs/USAGE.md)
- [Beta Test Guide](docs/BETA-TEST.md)
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
