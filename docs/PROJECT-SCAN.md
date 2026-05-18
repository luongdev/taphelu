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

Run a quick scan before asking business questions:

```bash
dl scan interview --path . --mode quick
```

The interview prints 3-7 questions tied to missing repo evidence. Record answers non-interactively:

```bash
dl scan interview \
  --domain "Local-first AI workflow tooling" \
  --user "AI-assisted developer" \
  --core-flow "Resume long-running implementation work" \
  --objective "onboarding" \
  --write
```

With `--write`, Taphelu writes `.projects/DOMAIN.md` and appends `domain_context_recorded`.

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
