# Project Scan

Use project scan when a repo has no BMAD/GSD/Superpower context.

## Structural Scan

Preview:

```bash
dl scan --path . --mode standard
```

Persist:

```bash
dl scan --path . --mode standard --write
```

Alias:

```bash
dl import project --path . --mode standard --write
```

Known workflow imports:

```bash
dl import bmad --path _bmad-output --write
dl import gsd --path .planning --write
dl import superpower --path superpowers --write
```

Scan records compact evidence only:

- package/build files
- stack and service/API signals
- scripts and inferred test commands
- entrypoints
- docs
- open questions

Scan ignores heavy/generated directories, `.gitignore`, and `.agentignore`.
It does not store raw source dumps in memory.

## Domain Interview

Preferred path: let the AI agent run scan/interview through MCP, then ask the user the generated questions conversationally.

Prompt example:

```text
Use Taphelu to onboard this repo. Run a quick scan, ask only missing domain/business questions, then save the domain context after I answer.
```

Expected agent calls:

- `dl_scan_project` with `action=scan`, `write=false`
- `dl_scan_project` with `action=interview`, `write=false`
- ask the generated questions in chat
- `dl_scan_project` with `action=interview`, answer fields, `write=true` after approval

CLI preview fallback:

```bash
dl scan interview --path . --mode quick
```

The interview prints 3-7 questions tied to missing repo evidence.

Non-interactive scripting form:

```bash
dl scan interview \
  --domain "Local-first AI workflow tooling" \
  --user "AI-assisted developer" \
  --core-flow "Resume long-running implementation work" \
  --objective "onboarding" \
  --write
```

With `--write`, Taphelu writes `.projects/DOMAIN.md` and appends `domain_context_recorded`. This flag-heavy form is for scripts and tests, not the normal human UX.

## Deep Scan Plan

Create bounded work packets before broad analysis:

```bash
dl scan plan --path . --mode standard
```

The plan creates task packets for stack, architecture, testing, infra, domain, and concerns.
When API/service signals exist, it adds `services-contracts`. With `--write`, Taphelu writes `.projects/SCAN-PLAN.md`, updates `.projects/STATE.md`, and appends `scan_plan_created`.

## Service Topology Map

Map services, contracts, and relationships after scan planning shows service/API signals:

```bash
dl scan map --path . --mode standard
dl scan --focus services --path . --mode standard
dl scan --focus contracts --path . --mode standard
dl scan --focus topology --path . --mode standard
```

With `--write`, Taphelu refreshes the full topology bundle:

- `.projects/SERVICE-MAP.md`
- `.projects/API-CONTRACTS.md`
- `.projects/graphs/service-graph.json`
- `.projects/graphs/service-graph.mmd`

The mapper detects package/workspace roots, Docker Compose, Kubernetes/Helm, Terraform/CI signals, OpenAPI, GraphQL, protobuf/gRPC, AsyncAPI, route/controller files, and API docs. Low-confidence edges are marked as inferred.
