# Config

Project-local config lives at `.projects/config.json`.

Default:

```json
{
  "testing": {
    "strictness": "medium"
  },
  "review": {
    "cross_ai": {
      "level": "medium-plus"
    }
  },
  "instructions": {
    "max_lines": 80,
    "max_chars": 6000
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
dl config set review.cross_ai.level medium-plus
dl config set review.cross_ai.reviewers.gemini.enabled true
dl config set instructions.max_lines 80
```

Testing strictness:

- `low`: smoke, artifact, manual, or main-flow evidence; unit tests only for critical risk.
- `medium`: focused coverage for main flows, command/API contracts, critical infra, memory/state writes, and regressions.
- `deep`: changed logic needs unit or integration evidence; bugfixes need regression coverage.

`dl plan`, `dl run`, and `dl verify` read this value unless `--testing-strictness` overrides it for one invocation.

Cross-AI review levels:

- `off`: disabled entirely.
- `requested-only`: only when a review trigger is supplied.
- `medium-plus`: default; medium/high risk, several files/commits, MCP, config, state, security, schema, memory, or installer changes.
- `large-only`: only story/phase-sized or broad changes.
- `always`: every closeout needs review evidence.

Instruction budgets are warnings for `dl doctor instructions`; they keep `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, and generated adapter files lean.
