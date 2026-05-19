# Usage Guide

This guide shows how to use Taphelu in a real repository after installation.

## Mental Model

Taphelu is a local workflow substrate for AI-agent work.

- `dl` is the human-facing CLI.
- `taphelu-mcp` is the agent-facing MCP server.
- `.projects/` is project-local context for the current repository.
- `~/.taphelu/` stores user-local long-term SQLite memory.
- `taphelu-pack/` is the canonical source for generated runtime skills, agents, commands, hooks, and MCP config.

The primary path is agent-native: install Taphelu into Codex, Claude, Gemini, or Kiro, then tell the agent what you want. The agent should call Taphelu MCP tools to scan, ask follow-up questions, save context, plan, verify, and close.

The CLI exists for preview, fallback, scripts, CI, and debugging. Do not treat long CLI flag examples as the normal human UX.

## First Check

```bash
dl commands
dl doctor --runtime all --scope global --live
```

If `dl` is not found:

```bash
pnpm bin -g
command -v dl
```

If `taphelu-mcp` is run directly, it waits silently for JSON-RPC input. That is normal for a stdio MCP server.

## Recommended Agent-Native Start

Install Taphelu into the runtime first:

```bash
dl install --runtime claude --scope global --write
dl doctor --runtime claude --scope global --live
```

Then open that runtime in the target repository and say something like:

```text
Use Taphelu to onboard this repo. Scan it first, ask me only the missing domain/business questions, then create a scan plan. Do not write files until you show me the preview.
```

Expected agent behavior:

1. Call `dl_start`.
2. Call `dl_scan_project` with `action=scan`, `write=false`.
3. Call `dl_scan_project` with `action=interview`, `write=false`.
4. Ask the user the 3-7 generated questions in natural language.
5. Call `dl_scan_project` with `action=interview`, user answers, and `write=true` after approval.
6. Call `dl_scan_project` with `action=plan`, `write=false`.
7. Ask before writing `.projects/SCAN-PLAN.md`.

The human should not have to type `--domain`, `--user`, or `--core-flow` manually in ordinary use.

## CLI Fallback For Existing Projects

Run these from the project you want Taphelu to understand:

```bash
dl scan --path . --mode quick
dl scan interview --path .
dl scan plan --path .
```

The first command inspects structure, package files, scripts, docs, likely stack, and test commands. It respects `.gitignore` and `.agentignore`.

This CLI flow prints reports. It is useful when no AI runtime is available yet, or when debugging what the agent would call.

For non-interactive scripts, CI, or demos, answers can be passed as flags:

```bash
dl scan interview \
  --domain "billing automation" \
  --user "finance operator" \
  --core-flow "import invoice, validate, approve, export" \
  --objective "prepare agents to safely continue implementation" \
  --write
```

This writes `.projects/DOMAIN.md`, but it is not the recommended human workflow. In normal use, the agent should ask these questions conversationally and then call the MCP tool or CLI write path itself.

Create a deep scan plan:

```bash
dl scan plan --path . --mode standard --write
```

This writes `.projects/SCAN-PLAN.md` and updates `.projects/STATE.md`.

For monorepos or service repos:

```bash
dl scan map --path . --mode standard --focus all
dl scan map --path . --mode standard --focus all --write
```

`--write` refreshes:

- `.projects/SERVICE-MAP.md`
- `.projects/API-CONTRACTS.md`
- `.projects/graphs/service-graph.json`
- `.projects/graphs/service-graph.mmd`

For polyrepo systems, keep shared service interactions in a registry repo under `.projects/contracts`:

```bash
dl contracts init --path .projects/contracts --remote git@github.com:org/contracts.git
dl contracts init --path .projects/contracts --remote git@github.com:org/contracts.git --write
dl contracts scan --path . --mode standard
dl contracts scan --path . --mode standard --write
dl contracts check --strict
dl contracts current --path .
dl contracts deps --direction all
dl contracts map --write
```

The registry stores service metadata, API contracts, Kafka/queue/topic/pubsub/Redis interaction metadata, and graph artifacts under `.projects/contracts`. It is the source of truth for cross-service planning when `dl contracts check --strict` passes. If service implementation and registry disagree, stop and resolve the conflict before planning.

## Project Context Files

Common `.projects` files:

- `PROJECT.md`: durable project description.
- `STATE.md`: current goal, phase, blockers, next action.
- `MEMORY.md`: compact L3 memory snapshot for humans and agents.
- `RUNS.md`: compact run history.
- `DOMAIN.md`: business/domain context captured from scan interview.
- `CODEBASE.md`: structural scan summary.
- `SCAN-PLAN.md`: bounded deep-scan task packets.
- `CONTEXT.md`: compact default entrypoint for agents.
- `index.json`: searchable artifact index.

Do not put raw logs, raw browser content, secrets, or PII into these files.

## Daily Workflow

Start with status:

```bash
dl status
```

Clarify a goal:

```bash
dl ask "Add account deletion flow"
```

Record research:

```bash
dl research \
  --source "docs/api.md" \
  --finding "Deletion must call the audit endpoint before removing user data." \
  --confidence medium \
  "What constraints affect account deletion?"
```

Create a plan:

```bash
dl plan \
  --task "Add account deletion endpoint" \
  --verification "Endpoint rejects unauthorized callers and writes audit event" \
  "Implement account deletion"
```

Run an end-to-end packet:

```bash
dl run \
  --source "docs/api.md" \
  --finding "Audit endpoint exists and is required" \
  --task "Implement account deletion endpoint" \
  --verification "Tests cover success, unauthorized, and audit failure" \
  "Implement account deletion"
```

Verify work:

```bash
dl verify \
  --artifact src/accounts/delete.js \
  --test "pnpm test" \
  --reviewed \
  "Account deletion implementation"
```

Write state only when the report is acceptable:

```bash
dl verify --write \
  --artifact src/accounts/delete.js \
  --test "pnpm test" \
  --reviewed \
  --next-action "Ship after reviewer approves account deletion behavior" \
  "Account deletion implementation"
```

## Context Index And Compaction

Build or refresh the compact context index:

```bash
dl context index
dl context index --write
```

Search without loading large files:

```bash
dl context search "auth"
dl context get artifact-id
dl context get artifact-id --full
```

After a completed milestone/story/flow:

```bash
dl compact milestone --id M28
dl compact milestone --id M28 --write
dl compact runs --keep 5 --write
dl compact plan --write
```

Use `dl cleanup context --dry-run` only as a light legacy cleanup. The main lifecycle path is `dl compact ...`.

## Memory

Curated human-readable memory:

```bash
dl memory
dl memory --category repo_facts
dl remember --category reusable_lessons "Keep generated runtime files managed and reproducible."
dl forget --category reusable_lessons --pattern generated
```

Agent memory uses SQLite under `~/.taphelu/`. MCP tools write L0/L1/L2 records and keep `.projects/MEMORY.md` as a compact L3 snapshot.

Unsafe content rules:

- Raw logs stay out of L1/L2/L3 by default.
- Raw browser content stays out of durable memory by default.
- Secrets and PII must not be promoted by default.
- Every promoted memory should have source traceability.

## Runtime Adapters

Use dry-run first:

```bash
dl install --runtime all --scope global --profile full-auto --hooks strict --statusline on --dry-run
```

Apply:

```bash
dl install --runtime all --scope global --profile full-auto --hooks strict --statusline on --write
dl doctor --runtime all --scope global --live
```

### Scope

`--scope global` writes to runtime user config directories:

- Codex: `~/.codex`
- Claude: `~/.claude` plus `~/.claude.json` for user-scope MCP
- Gemini: `~/.gemini`
- Kiro: `~/.kiro`

`--scope local` writes into the current project:

- Codex: `.codex/`
- Claude: `.claude/` plus `.mcp.json`
- Gemini: `.gemini/`
- Kiro: `.kiro/`

Local install is useful for workspace-specific runtime behavior. Global install is useful for reusable personal setup.

### Claude

```bash
dl install --runtime claude --scope global --write
dl doctor --runtime claude --scope global --live
```

Generated surfaces:

- Skills in `~/.claude/skills`
- Specialist agents in `~/.claude/agents`
- Slash commands in `~/.claude/commands`
- Hooks and statusline script in `~/.claude/hooks`
- MCP config in `~/.claude.json`
- Settings in `~/.claude/settings.json`

`taphelu-lead` is not a spawned sub-agent. It is main-session guidance. Spawn only specialist roles such as planner, dev, QA, UX, visual QA, memory curator, context curator, or workflow adapter.

If Claude shows `connecting...`:

```bash
dl doctor --runtime claude --scope global --live
```

Common causes:

- stale MCP command path
- non-absolute `node`
- local `.mcp.json` shadowing global config
- Claude app needs restart after config changes

### Kiro

Global Kiro install:

```bash
dl install --runtime kiro --scope global --write
dl doctor --runtime kiro --scope global --live
```

This configures:

- Kiro CLI agents in `~/.kiro/agents`
- Kiro skills in `~/.kiro/skills`
- global MCP config in `~/.kiro/settings/mcp.json`
- Kiro CLI hook script in `~/.kiro/hooks/taphelu-runtime-hook.mjs`
- steering in `~/.kiro/steering/taphelu-runtime.md`

Kiro IDE Agent Hooks are workspace-local. To show Taphelu hooks in the Kiro panel, run this inside the repo:

```bash
dl install --runtime kiro --scope local --write
dl doctor --runtime kiro --scope local --live
```

This writes `.kiro/hooks/*.kiro.hook`.

If the Kiro panel still does not refresh, reload/restart the Kiro window after local install.

Use Kiro CLI as `kiro-cli`, not `kiro`:

```bash
kiro-cli agent list
kiro-cli chat --model qwen3-coder-next --require-mcp-startup
```

### Codex

```bash
dl install --runtime codex --scope global --write
dl doctor --runtime codex --scope global --live
```

Generated surfaces:

- Skills in `~/.codex/skills`
- Commands in `~/.codex/commands`
- MCP config block in `~/.codex/config.toml`
- Compact instruction pointer in `~/.codex/AGENTS.md`
- `/dl-status` fallback metadata

Codex currently has no verified native statusline surface, so Taphelu uses `/dl-status` and MCP context tools.

### Gemini

```bash
dl install --runtime gemini --scope global --write
dl doctor --runtime gemini --scope global --live
```

Generated surfaces:

- Skills in `~/.gemini/skills`
- Extension in `~/.gemini/extensions/taphelu`
- Commands in `~/.gemini/extensions/taphelu/commands`
- MCP config in `gemini-extension.json`
- Native footer settings keep model and context percentage visible

Gemini-specific MCP names may appear as `mcp_taphelu_dl_context`, `mcp_taphelu_dl_start`, and similar names.

## Generated Commands

Generated runtime commands use `/dl-*`:

- `/dl-init`
- `/dl-resume`
- `/dl-scan`
- `/dl-contracts`
- `/dl-plan`
- `/dl-close`
- `/dl-status`

Do not use `$dl` wording.

## MCP Tools

Primary tool names use `dl_*`:

- `dl_start`
- `dl_context`
- `dl_observe`
- `dl_recall`
- `dl_checkpoint`
- `dl_close`
- `dl_memory_search`
- `dl_conversation_search`
- `dl_scan_project`
- `dl_contracts`
- `dl_context_store`
- `dl_cleanup_context`

Legacy `taphelu_*` aliases may exist for compatibility, but new guidance should use `dl_*`.

Normal agent lifecycle:

1. Call `dl_start`.
2. Load compact context with `dl_context`.
3. Record meaningful observations with `dl_observe`.
4. Recall relevant memory with `dl_recall` or `dl_memory_search`.
5. Save progress with `dl_checkpoint`.
6. Verify work.
7. Close with `dl_close`.
8. Suggest context compaction after pass.

## Review Policy

Check review policy:

```bash
dl review status
dl review plan --runtime codex --files 5 --commits 3
```

Cross-AI review is permission-gated. Taphelu should ask before invoking another runtime reviewer.

Default level is `medium-plus`, meaning review is recommended for medium or larger changes, not every trivial edit.

## Config

Read config:

```bash
dl config get
dl config get testing.strictness
```

Set common values:

```bash
dl config set testing.strictness medium
dl config set review.cross_ai.level medium-plus
dl config set context.compaction.after_close suggest
```

Testing strictness:

- `low`: smoke/main-flow evidence unless risk is high.
- `medium`: main flows, contracts, critical state/memory writes, and regression-prone logic.
- `deep`: new or changed logic needs unit/integration coverage; bugfixes need regression tests.

## Browser Work

Browser research and E2E checks require explicit permission:

```bash
dl browser research \
  --approval-scope "research local docs in browser for this session" \
  --url http://localhost:3000 \
  --purpose "Inspect visible behavior" \
  --action "Open dashboard" \
  --observation "Dashboard shell rendered" \
  "Does the dashboard render?"
```

```bash
dl browser verify \
  --approval-scope "browser E2E on local app for this session" \
  --url http://localhost:3000 \
  --step "Open dashboard" \
  --expected "Dashboard shell visible" \
  --actual "Dashboard shell visible" \
  --result pass \
  "Dashboard smoke flow"
```

Do not store raw page content by default.

## Import Existing Workflow Context

BMAD:

```bash
dl import bmad --path .
dl import bmad --path . --write
```

GSD:

```bash
dl import gsd --path .
dl import gsd --path . --write
```

Superpower:

```bash
dl import superpower --path .
dl import superpower --path . --write
```

Generic project import reuses scan:

```bash
dl import project --path .
dl import project --path . --write
```

## Troubleshooting

Doctor:

```bash
dl doctor --runtime all --scope global --live
dl doctor --runtime all --scope local --live
dl doctor instructions
```

Runtime status:

```bash
dl runtime status --runtime all --scope global --live
```

If install is blocked by unmanaged files, inspect the path. Taphelu overwrites only managed files/blocks.

If a runtime does not see new generated files, restart or reload that runtime after install.

If Kiro IDE hooks do not appear, make sure `.kiro/hooks/*.kiro.hook` exists in the current workspace and reload Kiro.

If Claude MCP is stuck connecting, run doctor with `--live` and check for local config shadowing.

## Cleanup

Uninstall package:

```bash
pnpm remove -g @luongdev/taphelu
```

Project-local context:

```bash
rm -rf .projects
```

Generated local runtime adapters:

```bash
rm -rf .codex .claude .gemini .kiro .mcp.json
```

Generated global runtime adapters are under the runtime config roots. Prefer reinstalling with `--hooks off` or removing only Taphelu-managed files when possible.
