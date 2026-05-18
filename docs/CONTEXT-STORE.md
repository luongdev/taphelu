# Context Store

Taphelu keeps always-loaded agent context small. Large project context is stored as indexed artifacts and loaded only on demand.

Default layout:

```text
.projects/
  CONTEXT.md
  index.json
  active/PLAN.md
  milestones/<id>/SUMMARY.md
  runs/INDEX.md
  runs/run-*.md
  scans/
  archive/
```

Core commands:

```bash
dl context index
dl context index --write
dl context search "service topology"
dl context get milestone:M24

dl compact milestone --id M24
dl compact milestone --id M24 --write
dl compact runs --keep 5 --write
dl compact plan --write
```

Storage config:

```bash
dl config set context.store.kind project
dl config set context.store.path .projects
dl config set context.compaction.after_close suggest
dl config set context.compaction.keep_recent_runs 5
dl config set context.compaction.max_always_load_chars 12000
```

`context.store.kind` values:

- `project`: default; artifacts live under `.projects`.
- `external-dir`: heavy artifacts live outside the repo; `.projects/CONTEXT.md` keeps pointers.
- `git-submodule`: external artifact path must already be a git worktree/submodule. Taphelu validates it but does not create it.

Rules:

- Run compaction only after verified closeout.
- Preview first; write only with permission or `--write`.
- Keep `CONTEXT.md`, `STATE.md`, and `MEMORY.md` compact.
- Do not write raw logs, raw browser content, secrets, PII, or source dumps into always-loaded context.
