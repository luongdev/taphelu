# Project Scan

Use project scan when a repo has no BMAD/GSD/Superpower context.

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

Scan records compact evidence only:

- package/build files
- stack signals
- scripts and inferred test commands
- entrypoints
- docs
- open questions

Scan ignores heavy/generated directories, `.gitignore`, and `.agentignore`.
It does not store raw source dumps in memory.
