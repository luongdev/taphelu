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

## Automatic Batch Scan Plan

`dl scan` must stay bounded. If the repo is large, multi-package, or the scan is truncated by mode limits, the scan report includes `## Auto Batch Scan Plan` with per-batch task packets and parallel groups.

With `--write`, Taphelu writes `.projects/CODEBASE.md`, `.projects/SCAN-PLAN.md`, and structured task artifacts under `.projects/plans/**` for the generated batch plan. Agents should execute those task ids by parallel group and merge compact summaries instead of reading the whole repo in one pass.

## Deep Scan Plan

Create bounded work packets before broad analysis:

```bash
dl scan plan --path . --mode standard
```

The plan creates task packets for stack, architecture, testing, infra, domain, and concerns.
When API/service signals exist, it adds `services-contracts`. With `--write`, Taphelu writes `.projects/SCAN-PLAN.md`, creates structured task artifacts under `.projects/plans/**`, updates `.projects/STATE.md`, and appends `scan_plan_created`.

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

## Polyrepo Service Interaction Registry

Use `dl scan map` for one repo. Use `dl contracts` when service communication spans many repos and needs one shared source of truth. In this context, "contracts" means service communication contracts: APIs, event streams, queues, topics, pub/sub, Redis channels/streams, and service metadata.

Default registry path:

```text
.projects/contracts/
  registry.json
  services/
  interactions/
  proto/
  openapi/
  asyncapi/
  graphql/
  schemas/
  channels/
    kafka/
    redis-pubsub/
    redis-stream/
    queues/
    topics/
  graphs/
```

Initialize or link a shared registry:

```bash
dl contracts init --path .projects/contracts --remote git@github.com:org/contracts.git
dl contracts init --path .projects/contracts --remote git@github.com:org/contracts.git --write
dl contracts link --path .projects/contracts --write
```

Preview-first service import:

```bash
dl contracts scan --path . --mode standard
dl contracts scan --path . --mode standard --write
```

The scan imports compact service metadata, API/spec files, and communication surfaces. High-confidence sources are explicit metadata and AsyncAPI. Medium-confidence sources are package/config signals such as KafkaJS, sarama, confluent clients, amqplib, ioredis, Redis clients, BullMQ, Celery, SQS, and SNS. Low-confidence constants or env names are labeled inferred and must not become source of truth without review.

Build cross-repo topology:

```bash
dl contracts map
dl contracts map --write
dl contracts check
dl contracts check --strict
```

`dl contracts check` blocks on stale/missing contract paths and registry-vs-service conflicts. `--strict` fails unknown `depends_on`, unknown consumed providers, and unknown consumer services. Without `--strict`, these remain warnings and unresolved graph nodes.

For polyrepo planning, agents should run:

```bash
dl contracts check --strict
dl contracts current --path .
dl contracts deps --direction all
```

The planning context should include current service id, outbound dependencies, inbound dependents, API contracts, topics, queues, channels, streams, and unresolved or inferred interactions. If the registry check passes, the registry wins over implementation guessing. If it fails, stop and ask for resolution.

Current service and dependency slice:

```bash
dl contracts current --path .
dl contracts deps --service billing-api --direction outbound
dl contracts deps --service billing-api --direction inbound
dl contracts deps --service billing-api --direction all
```

The registry stores `services/<service-id>.yaml` for service metadata and `interactions/<service-id>.yaml` for the service's `provides` and `consumes` surfaces. `depends_on` is retained for readability, but Taphelu also derives it from consumed interactions when the provider service is known.

Git operations are gated:

```bash
dl contracts sync
dl contracts sync --commit
dl contracts sync --commit --push
```

`sync` previews by default. It never commits without `--commit` and never pushes without `--push`.
