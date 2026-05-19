# Taphelu Roadmap

Taphelu is a local-first workflow substrate for long-running AI-agent work. It provides a CLI, MCP server, canonical agent pack, layered memory, review gates, context cleanup, and project onboarding tools.

## Status

- Implemented: CLI workflow primitives, MCP lifecycle tools, SQLite memory v1, canonical agent pack, Claude/Codex/Gemini/Kiro adapter generation, team roles, QA testability gate, project config, cross-AI review policy, context cleanup, instruction hygiene, release readiness docs, generic project scan/import v1, scan v2 domain interview/scan planning, microservice topology/API contract mapping, context store v2 with milestone compaction, runtime install E2E, pre-publish release guard, runtime orchestration kit, polyrepo contract registry v1, service interaction registry, and stable release `0.1.2`.
- Current: stable `0.1.2` release validation, dogfood fixes, and validation of shared contract registries on real polyrepo systems.
- Next: choose the next implementation milestone from repeated tester friction.
- Later: richer graph/index features.

## v0.1 - Registry-ready Local CLI/MCP Package

Goal: make Taphelu installable and usable by another local repo without publishing surprises.

Includes:

- Package metadata for `@luongdev/taphelu`.
- License: `AGPL-3.0-or-later` copyleft.
- Global CLI entrypoints: `dl` and `taphelu-mcp`.
- Pack whitelist that includes `bin`, `src`, `scripts`, `taphelu-pack`, and `docs`.
- README, LICENSE, install docs, and publish checklist.
- Smoke tests for package pack, temp global install, `dl commands`, `dl scan`, MCP syntax, and runtime adapters.
- Current stable target: `@luongdev/taphelu@0.1.2`.

Done when:

- A user can install from a packed tarball and run the CLI/MCP entrypoints.
- The package tarball excludes `.projects`, `.samples`, tests, caches, and local runtime files.
- Publish remains an explicit manual step guarded by `pnpm run release:check`.

## v0.1 Beta - Onboarding and Feedback

Goal: help beta testers try Taphelu on real repositories and report actionable feedback.

Includes:

- `docs/BETA-TEST.md` with install, scan, runtime adapter, cleanup, and feedback steps.
- Claude-first runtime adapter smoke path, with Kiro, Codex, and Gemini variants.
- Feedback template covering environment, repo type, commands, expected/actual result, and `dl doctor` status.

Done when:

- A tester can run a first Taphelu session without reading the full docs.
- Feedback includes enough data to reproduce install, scan, or runtime adapter failures.
- Next implementation work is chosen from real beta friction.

## v0.2 - Deep Project Import and Scan Planning

Goal: let Taphelu onboard an existing repo without forcing an agent to read the whole codebase.

Includes:

- `dl scan interview` for domain/business questions after quick scan.
- `dl scan plan` for large-repo and deep-scan planning before expensive analysis.
- Domain summary artifacts that capture users, actors, core flows, constraints, and open questions.
- Large-repo scan strategy with parallel focus areas: stack, architecture, tests, infra, business flows, and concerns.
- Safer ignore handling for `.gitignore`, `.agentignore`, generated folders, vendored code, and heavy assets.

Done when:

- A quick scan can propose the right deep-scan plan.
- Domain questions are few, targeted, and not answerable from repo evidence.
- Deep scan writes compact artifacts, not raw source dumps.

## v0.3 - Microservice Mapping and Runtime Onboarding

Goal: make Taphelu useful for multi-service systems and real AI runtime installation.

Includes:

- Service discovery for monorepos and microservices.
- API contract detection for OpenAPI, GraphQL, protobuf/gRPC, and AsyncAPI.
- Service topology artifacts in Markdown, JSON, and Mermaid.
- Context store v2 with `.projects/CONTEXT.md`, `.projects/index.json`, artifact search/get, and milestone/run/plan compaction.
- Runtime install E2E for Codex, Claude, Gemini, and Kiro using temp homes/config dirs.
- `dl doctor` validation for MCP config, generated adapter files, instruction hygiene, and package install health.
- Runtime orchestration kit: skills, agents or role fallbacks, `/dl-*` commands, hooks, capability-based status surfaces, and live doctor.
- Polyrepo service interaction registry: `.projects/contracts` layout, service metadata, protobuf/OpenAPI/AsyncAPI/GraphQL/schema support, Kafka/queue/topic/pubsub/Redis interaction metadata, graph artifacts, and gated git sync.

Done when:

- Taphelu can explain service relationships and contract sources without guessing.
- Codex, Claude, Gemini, and Kiro can be configured from the same canonical pack.
- Runtime-specific generated files remain managed artifacts, not hand-maintained copies.
- Polyrepo agents can run `dl contracts check --strict`, identify current service, load inbound/outbound dependencies, and resolve interaction conflicts instead of guessing from implementation.

## Later

- Multi-project dashboard.
- Team sync features.
- Cloud or remote execution.
- Rich web UI.
- Autonomous implementation loops.
- Advanced browser session management.
- Cross-repo knowledge graph.
