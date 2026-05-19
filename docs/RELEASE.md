# Release Checklist

Use this checklist before publishing `@luongdev/taphelu`.

Publishing is manual. Runtime install docs and release commands use `pnpm`.

## Pre-Publish Checks

Run the full guard from a clean checkout:

```bash
pnpm run release:check
```

`release:check` does not publish. It verifies the working tree is clean, the exact `package.json` version is not already published, npm registry auth is available, baseline tests pass, runtime install E2E passes, and the dry-run tarball has the expected contents.

For future test publishes, use prerelease build versions such as `0.1.1-build.1`. Keep stable versions for builds that have passed the release gate.

The expanded command sequence is:

```bash
git status --short
pnpm run check
pnpm test
pnpm run test:cli
pnpm run test:runtime-install
pnpm pack --dry-run --json
```

Confirm the dry-run tarball includes:

- `README.md`
- `LICENSE`
- `package.json`
- `bin/`
- `src/`
- `scripts/`
- `taphelu-pack/`
- `docs/`
- `docs/USAGE.md`

Confirm the dry-run tarball excludes:

- `.projects/`
- `.samples/`
- `test/`
- local runtime files such as `.codex/`, `.claude/`, `.gemini/`, `.kiro/`
- caches, build outputs, and local temp files

## Temp Install Smoke

```bash
TMP="$(mktemp -d)"
PNPM_HOME="$TMP/pnpm-home"
export PNPM_HOME
PATH="$PNPM_HOME:$PATH"
export PATH
pnpm pack --pack-destination "$TMP" >/dev/null
PKG="$(find "$TMP" -name '*.tgz' -print -quit)"
pnpm add -g "$PKG"
"$PNPM_HOME/dl" commands
"$PNPM_HOME/dl" scan --path . --mode quick
INSTALLED_ROOT="$(pnpm root -g)/@luongdev/taphelu"
node --check "$INSTALLED_ROOT/bin/taphelu-mcp.mjs"
```

## Runtime Adapter Smoke

Use temp config roots so local runtime settings are not mutated:

```bash
TMP="$(mktemp -d)"
PNPM_HOME="$TMP/pnpm-home"
export PNPM_HOME
PATH="$PNPM_HOME:$PATH"
export PATH
pnpm pack --pack-destination "$TMP" >/dev/null
PKG="$(find "$TMP" -name '*.tgz' -print -quit)"
pnpm add -g "$PKG"
DL="$PNPM_HOME/dl"
"$DL" install --runtime all --scope global --config-dir "$TMP/runtime" --dry-run
"$DL" install --runtime all --scope global --config-dir "$TMP/runtime" --write
"$DL" doctor --runtime all --scope global --config-dir "$TMP/runtime" --live
"$DL" doctor instructions
```

## Review Gate

For non-trivial release diffs, run cross-AI review before declaring the release ready.

Record:

- reviewer runtime and model
- verdict
- HIGH concerns
- fixes or skipped rationale

## Publish

Only after manual approval:

```bash
pnpm login
pnpm whoami
pnpm publish --access public --otp <code>
```

## Post-Publish Smoke

Use a temp prefix so the smoke test does not mutate the user's global install or runtime config:

```bash
pnpm view @luongdev/taphelu version
TMP="$(mktemp -d)"
PNPM_HOME="$TMP/pnpm-home"
export PNPM_HOME
PATH="$PNPM_HOME:$PATH"
export PATH
pnpm add -g @luongdev/taphelu
DL="$PNPM_HOME/dl"
"$DL" commands
"$DL" scan --path . --mode quick
INSTALLED_ROOT="$(pnpm root -g)/@luongdev/taphelu"
node --check "$INSTALLED_ROOT/bin/taphelu-mcp.mjs"
"$DL" install --runtime all --scope global --config-dir "$TMP/runtime" --write
"$DL" doctor --runtime all --scope global --config-dir "$TMP/runtime" --live
```
