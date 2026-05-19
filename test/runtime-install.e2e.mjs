import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tempRoots = new Set();

test.afterEach(() => {
  for (const root of tempRoots) rmSync(root, { recursive: true, force: true });
  tempRoots.clear();
});

test("package tarball installs runtime adapters and validates MCP from installed binaries", () => {
  const root = mkdtempSync(join(tmpdir(), "taphelu-runtime-install-"));
  tempRoots.add(root);
  const packDir = join(root, "pack");
  const prefix = join(root, "prefix");
  const runtimeHome = join(root, "runtime-home");
  const workspace = makeWorkspace(root);
  const fixture = makeScanFixture(workspace);

  mkdirSync(packDir, { recursive: true });
  const packed = run("npm", ["pack", "--pack-destination", packDir], { cwd: repoRoot, env: npmEnv(root) });
  const tarball = join(packDir, packed.stdout.trim().split(/\r?\n/).at(-1));
  assert.equal(existsSync(tarball), true);

  run("npm", ["install", "-g", "--prefix", prefix, tarball], { cwd: root, env: npmEnv(root) });
  const dl = binPath(prefix, "dl");
  const tapheluMcp = binPath(prefix, "taphelu-mcp");

  assert.match(run(dl, ["commands"], { cwd: workspace }).stdout, /# Command Manifest/);
  assert.match(run(dl, ["scan", "--path", fixture, "--mode", "quick"], { cwd: workspace }).stdout, /# Project Scan Report/);
  assertMcpServerWorks(tapheluMcp, workspace);

  run(dl, ["install", "--runtime", "all", "--scope", "global", "--config-dir", runtimeHome, "--write"], { cwd: workspace });
  const doctor = run(dl, ["doctor", "--runtime", "all", "--scope", "global", "--config-dir", runtimeHome, "--live"], { cwd: workspace });

  assert.match(doctor.stdout, /`PASS`/);
  assert.match(doctor.stdout, /Live MCP handshake and tools\/list passed/);
  assert.match(readFileSync(join(runtimeHome, "codex", "config.toml"), "utf8"), new RegExp(escapeRegExp("taphelu-mcp.mjs")));
  assert.match(readFileSync(join(runtimeHome, "claude", "commands", "dl-init.md"), "utf8"), /# Taphelu Init/);
  assert.equal(JSON.parse(readFileSync(join(runtimeHome, "claude", "settings.json"), "utf8")).statusLine.tapheluManaged, "1");
  assert.equal(existsSync(join(runtimeHome, "codex", "hooks", "taphelu-statusline.mjs")), false);
  assert.equal(JSON.parse(readFileSync(join(runtimeHome, "codex", "taphelu-runtime.json"), "utf8")).taphelu.statusline.mode, "fallback");
  const geminiSettingsPath = join(runtimeHome, "gemini", "settings.json");
  const geminiSettings = existsSync(geminiSettingsPath)
    ? JSON.parse(readFileSync(geminiSettingsPath, "utf8"))
    : {};
  assert.equal(geminiSettings.mcpServers?.taphelu, undefined);
  assert.equal(existsSync(join(runtimeHome, "gemini", "hooks", "taphelu-statusline.mjs")), false);
  const geminiRuntimeSettings = JSON.parse(readFileSync(join(runtimeHome, "gemini", "extensions", "taphelu", "taphelu-runtime.json"), "utf8"));
  assert.equal(geminiRuntimeSettings.ui.footer.hideModelInfo, false);
  assert.equal(geminiRuntimeSettings.ui.footer.hideContextPercentage, false);
  assert.equal(geminiRuntimeSettings.taphelu.statusline.mode, "native-footer");
  assert.equal(JSON.parse(readFileSync(join(runtimeHome, "gemini", "extensions", "taphelu", "gemini-extension.json"), "utf8")).mcpServers.taphelu.env.TAPHELU_MANAGED, "1");
  assert.equal(JSON.parse(readFileSync(join(runtimeHome, "kiro", "settings", "mcp.json"), "utf8")).mcpServers.taphelu.env.TAPHELU_MANAGED, "1");
  assert.equal(existsSync(join(runtimeHome, "kiro", "hooks", "taphelu-statusline.mjs")), false);
  assert.equal(JSON.parse(readFileSync(join(runtimeHome, "kiro", "settings", "taphelu.json"), "utf8")).taphelu.statusline.mode, "native-tui");
  const kiroAgent = JSON.parse(readFileSync(join(runtimeHome, "kiro", "agents", "taphelu-dev.json"), "utf8"));
  const kiroLeadSkill = readFileSync(join(runtimeHome, "kiro", "skills", "taphelu-lead", "SKILL.md"), "utf8");
  const kiroIdeHook = JSON.parse(readFileSync(join(runtimeHome, "kiro", "hooks", "taphelu-prompt-context.kiro.hook"), "utf8"));
  assert.equal(existsSync(join(runtimeHome, "kiro", "agents", "taphelu-lead.json")), false);
  assert.match(kiroLeadSkill, /main-session taphelu-lead role contract/);
  assert.equal(kiroAgent.includeMcpJson, true);
  assert.equal(kiroAgent.hooks.userPromptSubmit[0].command.includes("--runtime kiro"), true);
  assert.equal(kiroIdeHook.when.type, "promptSubmit");
  assert.match(readFileSync(join(runtimeHome, "kiro", "skills", "dl-init", "SKILL.md"), "utf8"), /Invoke with \/dl-init/);
});

function makeWorkspace(root) {
  const workspace = join(root, "workspace");
  const projects = join(workspace, ".projects");
  mkdirSync(projects, { recursive: true });
  writeFileSync(join(projects, "PROJECT.md"), "# Runtime Install Test\n");
  writeFileSync(join(projects, "STATE.md"), "# State\n");
  writeFileSync(join(projects, "MEMORY.md"), "# Memory\n");
  writeFileSync(join(projects, "RUNS.md"), "# Runs\n");
  writeFileSync(join(projects, "events.jsonl"), "");
  return workspace;
}

function makeScanFixture(workspace) {
  const fixture = join(workspace, "fixture-app");
  mkdirSync(join(fixture, "src"), { recursive: true });
  writeFileSync(join(fixture, "package.json"), `${JSON.stringify({
    scripts: { test: "node --test" },
    dependencies: {},
  }, null, 2)}\n`);
  writeFileSync(join(fixture, "README.md"), "# Fixture App\n");
  writeFileSync(join(fixture, "src", "index.js"), "export const ok = true;\n");
  return "fixture-app";
}

function assertMcpServerWorks(tapheluMcp, cwd) {
  const input = [
    mcpFrame({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05" } }),
    mcpFrame({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
  ].join("");
  const result = run(tapheluMcp, [], { cwd, input });
  const messages = parseMcpFrames(result.stdout);
  assert.equal(messages[0].result.serverInfo.name, "taphelu");
  assert.equal(result.stderr, "");
  assert.ok(messages[1].result.tools.some((tool) => tool.name === "dl_start"));
}

function mcpFrame(message) {
  const json = JSON.stringify(message);
  return `Content-Length: ${Buffer.byteLength(json, "utf8")}\r\n\r\n${json}`;
}

function parseMcpFrames(output) {
  const messages = [];
  let cursor = 0;
  while (cursor < output.length) {
    const headerEnd = output.indexOf("\r\n\r\n", cursor);
    if (headerEnd === -1) break;
    const match = /Content-Length:\s*(\d+)/i.exec(output.slice(cursor, headerEnd));
    assert.ok(match, "Missing Content-Length in MCP output.");
    const start = headerEnd + 4;
    const end = start + Number.parseInt(match[1], 10);
    messages.push(JSON.parse(output.slice(start, end)));
    cursor = end;
  }
  return messages;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || repoRoot,
    env: options.env || process.env,
    input: options.input,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, `${command} ${args.join(" ")}\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`);
  return result;
}

function npmEnv(root) {
  return { ...process.env, npm_config_cache: join(root, "npm-cache") };
}

function binPath(prefix, name) {
  return join(prefix, process.platform === "win32" ? "" : "bin", process.platform === "win32" ? `${name}.cmd` : name);
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
