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
  },
  "context": {
    "store": {
      "kind": "project",
      "path": ".projects"
    },
    "compaction": {
      "after_close": "suggest",
      "keep_recent_runs": 5,
      "max_always_load_chars": 12000
    }
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
dl config set context.store.kind external-dir
dl config set context.store.path ../taphelu-context
dl config set context.compaction.after_close suggest
dl config set context.compaction.keep_recent_runs 5
dl config set context.compaction.keep_recent_runs 0
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

Context store:

- `project`: default; context artifacts live under `.projects`.
- `external-dir`: heavy context artifacts live outside the repo.
- `git-submodule`: path must already be a git worktree/submodule; Taphelu validates but does not create it.

Context compaction:

- `suggest`: default; after closeout, Taphelu recommends compaction.
- `off`: no compaction recommendation.
- `auto`: reserved for explicit automation; CLI still previews unless `--write` is passed.
