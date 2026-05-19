# Beta Test Guide

Use this guide to test `@luongdev/taphelu` in a real repository.

Current registry release:

```bash
@luongdev/taphelu@0.1.0-build.3
```

## Prerequisites

- Node.js `>=22.16.0`
- pnpm
- A separate test repository
- Optional: Codex, Claude, Gemini, or Kiro runtime config access

Check local versions:

```bash
node -v
pnpm -v
```

## Install

Install the latest published release:

```bash
pnpm add -g @luongdev/taphelu@0.1.0-build.3
dl commands
```

If `dl` is not found, check the pnpm global bin path:

```bash
pnpm bin -g
command -v dl
```

## Basic Project Onboarding

Manual CLI smoke path:

```bash
cd <repo-can-test>
dl scan --path . --mode quick
dl scan interview --path .
dl scan plan --path .
```

These commands should print reports and should not write project files unless you pass `--write`.

Agent-native path after runtime install:

```text
Use Taphelu to onboard this repo. Run a quick scan, ask only missing domain/business questions, then create a scan plan. Preview first; ask before writing .projects.
```

The expected result is that the agent uses Taphelu MCP tools, asks the domain questions in chat, and writes only after approval.

## Runtime Adapter Test

Claude is the recommended first runtime path:

```bash
dl install --runtime claude --scope global --dry-run
dl install --runtime claude --scope global --write
dl doctor --runtime claude --scope global --live
dl runtime status --runtime claude --scope global --live
```

If Claude shows `connecting...`, include the `dl doctor --runtime claude --scope global --live` output in feedback. It should identify stale paths, local config shadowing, or non-absolute `node` commands.

Kiro:

```bash
dl install --runtime kiro --scope global --dry-run
dl install --runtime kiro --scope global --write
dl doctor --runtime kiro --scope global --live
```

Kiro IDE Agent Hooks are per workspace. To see Taphelu hooks in the Kiro panel for a test repo, also run this inside that repo:

```bash
dl install --runtime kiro --scope local --write
dl doctor --runtime kiro --scope local --live
```

Codex:

```bash
dl install --runtime codex --scope global --dry-run
dl install --runtime codex --scope global --write
dl doctor --runtime codex --scope global --live
```

Gemini:

```bash
dl install --runtime gemini --scope global --dry-run
dl install --runtime gemini --scope global --write
dl doctor --runtime gemini --scope global --live
```

If install is blocked by unmanaged files, do not overwrite them manually. Save the `dl doctor` output and include it in feedback.

## Optional Deeper Tests

Use these when testing a larger repo, monorepo, or service-oriented codebase:

```bash
dl scan map --path . --focus all
dl context index --write
dl context search "test"
```

Only use `--write` in a repo where `.projects/` is allowed to be created locally.

## Cleanup

Uninstall the package:

```bash
pnpm remove -g @luongdev/taphelu
```

Project-local Taphelu context, if written, lives under `.projects/`.

Generated runtime adapters live under the runtime config directory:

- Codex: `~/.codex`
- Claude: `~/.claude`
- Gemini: `~/.gemini`
- Kiro: `~/.kiro`

## Feedback Template

```text
OS:
Node version:
pnpm version:
Taphelu version:
AI runtime tested: Codex / Claude / Gemini / Kiro / manual CLI
Repo type: small app / monorepo / microservice / library / unknown

Commands run:

Expected:

Actual:

Output or error snippet:

Did dl doctor pass? yes / no / not run

Biggest confusion:

Would this help resume agent work later? yes / no
Why:
```

Useful command for version evidence:

```bash
pnpm view @luongdev/taphelu version
dl commands | head -20
```

For fuller usage examples, see [Usage Guide](USAGE.md).
