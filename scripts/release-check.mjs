#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

const requiredPackFiles = [
  "README.md",
  "LICENSE",
  "package.json",
  "bin/dl.mjs",
  "bin/taphelu-mcp.mjs",
  "docs/ROADMAP.md",
  "docs/RELEASE.md",
  "taphelu-pack/manifest.json",
  "scripts/release-check.mjs",
];

const forbiddenPackPrefixes = [
  ".projects/",
  ".samples/",
  ".codex/",
  ".claude/",
  ".gemini/",
  "test/",
];

function main() {
  assertCleanGit();
  assertVersionIsPublishable();
  assertNpmAuth();
  run("npm run check", "npm", ["run", "check"]);
  run("npm test", "npm", ["test"]);
  run("npm run test:cli", "npm", ["run", "test:cli"]);
  run("npm run test:runtime-install", "npm", ["run", "test:runtime-install"]);
  assertPackDryRun();
  console.log(`release:check PASS for ${pkg.name}@${pkg.version}`);
  console.log("Manual publish command: npm publish --access public");
}

function assertCleanGit() {
  const result = capture("git", ["status", "--short"]);
  if (result.status !== 0) fail("git status --short failed", result);
  if (result.stdout.trim()) {
    fail(`Working tree is not clean. Commit or stash changes first.\n${result.stdout.trim()}`);
  }
  console.log("git status: clean");
}

function assertVersionIsPublishable() {
  const spec = `${pkg.name}@${pkg.version}`;
  const result = capture("npm", ["view", spec, "version", "--json"]);
  if (result.status === 0) {
    fail(`${spec} already exists on npm. Bump package.json version before publishing.`);
  }
  if (!isNpmNotFound(result)) {
    fail(`Unable to verify npm package version for ${spec}`, result);
  }
  console.log(`npm version: ${spec} is not published yet`);
}

function assertNpmAuth() {
  const result = capture("npm", ["whoami"]);
  if (result.status !== 0) {
    fail("npm auth: not logged in. Run `npm login`, then rerun `npm run release:check`.", result);
  }
  console.log(`npm auth: logged in as ${result.stdout.trim()}`);
}

function assertPackDryRun() {
  const result = capture("npm", ["pack", "--dry-run", "--json"]);
  if (result.status !== 0) fail("npm pack --dry-run --json failed", result);

  let packed;
  try {
    packed = JSON.parse(result.stdout)[0];
  } catch (error) {
    fail(`Unable to parse npm pack dry-run JSON: ${error.message}`);
  }

  const paths = new Set((packed.files ?? []).map((file) => file.path));
  for (const file of requiredPackFiles) {
    if (!paths.has(file)) fail(`npm pack missing required file: ${file}`);
  }

  for (const path of paths) {
    for (const prefix of forbiddenPackPrefixes) {
      if (path === prefix.slice(0, -1) || path.startsWith(prefix)) {
        fail(`npm pack includes forbidden local file: ${path}`);
      }
    }
  }

  console.log(`npm pack: ${packed.files.length} files, ${packed.unpackedSize} bytes unpacked`);
}

function run(label, command, args) {
  console.log(`\n> ${label}`);
  const result = spawnSync(command, args, { cwd: repoRoot, stdio: "inherit" });
  if (result.status !== 0) fail(`${label} failed with exit code ${result.status ?? "unknown"}`);
}

function capture(command, args) {
  return spawnSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
  });
}

function isNpmNotFound(result) {
  const output = `${result.stdout}\n${result.stderr}`;
  return /\bE404\b|Not Found/i.test(output);
}

function fail(message, result) {
  console.error(`release:check FAIL: ${message}`);
  if (result?.stdout?.trim()) console.error(result.stdout.trim());
  if (result?.stderr?.trim()) console.error(result.stderr.trim());
  process.exit(1);
}

main();
