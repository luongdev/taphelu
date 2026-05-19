# Taphelu Contracts

Use for polyrepo services where cross-service communication lives in a shared registry.

The registry covers API contracts, event streams, queues, topics, pub/sub, Redis channels/streams, and compact service metadata.

Default flow:

1. Call `dl_contracts` with `action=check`, `strict=true`.
2. If strict check fails, stop and ask for conflict resolution before planning.
3. Call `dl_contracts` with `action=current` to identify the current service.
4. Call `dl_contracts` with `action=deps`, `direction=all` to load outbound dependencies and inbound dependents.
5. If no registry exists, propose `dl contracts init --path .taphelu/contracts --remote <url>` and ask before `--write`.
6. To import this repo, call `dl_contracts` with `action=scan`, `path="."`, `write=false`.
7. Only after approval, call `dl_contracts` with `action=scan`, `write=true`.
8. Use `action=map` to refresh cross-repo topology.

Rules:

- Contract registry wins over implementation inference only when strict `check` passes.
- Do not infer cross-service APIs, topics, queues, pub/sub channels, or streams from implementation when registry records exist.
- Low-confidence interactions are inferred evidence, not source of truth.
- Git sync is preview-first. Never commit without `commit=true`; never push without `push=true`.
- Keep context compact: read registry summaries and graph metadata before loading full contract files.
