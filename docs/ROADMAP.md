# Taphelu Roadmap

Taphelu is a local-first workflow substrate for long-running AI-agent work. It provides a CLI, MCP server, canonical agent pack, layered memory, review gates, context cleanup, and project onboarding tools.

## Status

- Implemented: CLI workflow primitives, MCP lifecycle tools, SQLite memory v1, canonical agent pack, Codex/Claude/Gemini adapter generation, team roles, QA testability gate, project config, cross-AI review policy, context cleanup, instruction hygiene, release readiness docs, generic project scan/import v1, scan v2 domain interview/scan planning, microservice topology/API contract mapping, context store v2 with milestone compaction, runtime install E2E, and pre-publish release guard.
- Next: v0.1 npm release execution after manual approval.
- Later: richer graph/index features.

## v0.1 - npm-ready Local CLI/MCP Package

Goal: make Taphelu installable and usable by another local repo without publishing surprises.

Includes:

- npm package metadata for `@luongdev/taphelu`.
- Global CLI entrypoints: `dl` and `taphelu-mcp`.
- Pack whitelist that includes `bin`, `src`, `scripts`, `taphelu-pack`, and `docs`.
- README, LICENSE, install docs, and publish checklist.
- Smoke tests for `npm pack`, temp global install, `dl commands`, `dl scan`, MCP syntax, and runtime adapters.

Done when:

- A user can install from a packed tarball and run the CLI/MCP entrypoints.
- The npm tarball excludes `.projects`, `.samples`, tests, caches, and local runtime files.
- Publish remains an explicit manual step guarded by `npm run release:check`.

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
- Runtime install E2E for Codex, Claude, and Gemini using temp homes/config dirs.
- `dl doctor` validation for MCP config, generated adapter files, instruction hygiene, and package install health.

Done when:

- Taphelu can explain service relationships and contract sources without guessing.
- Codex, Claude, and Gemini can be configured from the same canonical pack.
- Runtime-specific generated files remain managed artifacts, not hand-maintained copies.

## Later

- Multi-project dashboard.
- Team sync features.
- Cloud or remote execution.
- Rich web UI.
- Autonomous implementation loops.
- Advanced browser session management.
- Cross-repo knowledge graph.
