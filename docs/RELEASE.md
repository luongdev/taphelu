# Release Checklist

Use this checklist before publishing `@luongdev/taphelu`.

Publishing is manual. Do not run `npm publish` until the release has been reviewed and approved.

## Pre-Publish Checks

```bash
git status --short
npm run check
npm test
npm run test:cli
npm run test:runtime-install
npm pack --dry-run --json
```

Confirm the dry-run tarball includes:

- `README.md`
- `LICENSE`
- `package.json`
- `bin/`
- `src/`
- `taphelu-pack/`
- `docs/`

Confirm the dry-run tarball excludes:

- `.projects/`
- `.samples/`
- `test/`
- local runtime files such as `.codex/`, `.claude/`, `.gemini/`
- caches, build outputs, and local temp files

## Temp Install Smoke

```bash
TMP="$(mktemp -d)"
npm pack --pack-destination "$TMP" >"$TMP/pack-name.txt"
PKG="$TMP/$(cat "$TMP/pack-name.txt")"
npm install -g --prefix "$TMP/prefix" "$PKG"
"$TMP/prefix/bin/dl" commands
"$TMP/prefix/bin/dl" scan --path . --mode quick
INSTALLED_ROOT="$(npm root -g --prefix "$TMP/prefix")/@luongdev/taphelu"
node --check "$INSTALLED_ROOT/bin/taphelu-mcp.mjs"
```

## Runtime Adapter Smoke

Use temp config roots so local runtime settings are not mutated:

```bash
TMP="$(mktemp -d)"
npm pack --pack-destination "$TMP" >"$TMP/pack-name.txt"
PKG="$TMP/$(cat "$TMP/pack-name.txt")"
npm install -g --prefix "$TMP/prefix" "$PKG"
DL="$TMP/prefix/bin/dl"
"$DL" install --runtime all --scope global --config-dir "$TMP/runtime" --dry-run
"$DL" install --runtime all --scope global --config-dir "$TMP/runtime" --write
"$DL" doctor --runtime all --scope global --config-dir "$TMP/runtime"
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
npm whoami
npm publish --access public
```

After publishing:

```bash
npm view @luongdev/taphelu version
npm install -g @luongdev/taphelu
dl commands
```
