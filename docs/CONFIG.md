# Config

Project-local config lives at `.projects/config.json`.

Default:

```json
{
  "testing": {
    "strictness": "medium"
  }
}
```

Commands:

```bash
dl config get
dl config get testing.strictness
dl config set testing.strictness low
dl config set testing.strictness medium
dl config set testing.strictness deep
```

Testing strictness:

- `low`: smoke, artifact, manual, or main-flow evidence; unit tests only for critical risk.
- `medium`: focused coverage for main flows, command/API contracts, critical infra, memory/state writes, and regressions.
- `deep`: changed logic needs unit or integration evidence; bugfixes need regression coverage.

`dl plan`, `dl run`, and `dl verify` read this value unless `--testing-strictness` overrides it for one invocation.
