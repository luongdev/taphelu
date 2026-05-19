import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { appendFileSync, existsSync, mkdtempSync, mkdirSync, readdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { recoverProjectTransactions, withProjectFilesTransaction } from "../src/project.mjs";
import { appendEvent } from "../src/events.mjs";
import { callTapheluTool, listTapheluTools } from "../src/mcp/tools.mjs";
import { handleMcpMessage } from "../src/mcp/server.mjs";
import { applyInstallPlan, buildInstallPlan, loadPack } from "../src/pack/adapter.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = join(repoRoot, "bin", "dl.mjs");
const mcpPath = join(repoRoot, "bin", "taphelu-mcp.mjs");
const tempRoots = new Set();
const originalTapheluHome = process.env.TAPHELU_HOME;
const originalTapheluMemoryDb = process.env.TAPHELU_MEMORY_DB;

afterEach(() => {
  for (const root of tempRoots) {
    rmSync(root, { recursive: true, force: true });
  }
  tempRoots.clear();
  restoreEnv("TAPHELU_HOME", originalTapheluHome);
  restoreEnv("TAPHELU_MEMORY_DB", originalTapheluMemoryDb);
});

function makeProject() {
  const root = mkdtempSync(join(tmpdir(), "taphelu-test-"));
  tempRoots.add(root);
  process.env.TAPHELU_HOME = join(root, ".taphelu-test-home");
  delete process.env.TAPHELU_MEMORY_DB;
  const projects = join(root, ".projects");
  mkdirSync(projects);
  writeFileSync(join(projects, "PROJECT.md"), "# Test Project\n");
  writeFileSync(join(projects, "STATE.md"), `# State

## Current Goal

Test goal.

## Current Milestone

Milestone Test.

## Current Phase

Testing.

## Next Action

Run CLI tests.

## Blockers

None.

## Last Verification

Pending.
`);
  writeFileSync(join(projects, "MEMORY.md"), `# Memory

## Product Decisions

- Test decision.

## Repo Facts

- Existing repo fact.

## Reusable Lessons

- Duplicate lesson.
- Duplicate lesson.
`);
  writeFileSync(join(projects, "RUNS.md"), `# Runs

## Run Index

| Run ID | Date | Goal | Outcome |
|---|---|---|---|
`);
  writeFileSync(join(projects, "events.jsonl"), "");
  return root;
}

function makePlainRepo() {
  const root = mkdtempSync(join(tmpdir(), "taphelu-plain-"));
  tempRoots.add(root);
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "package.json"), JSON.stringify({
    scripts: {
      test: "node --test",
      build: "node --check src/index.js",
    },
    dependencies: {
      vite: "^5.0.0",
    },
  }, null, 2));
  writeFileSync(join(root, "README.md"), "# Plain Repo\n");
  writeFileSync(join(root, "src", "index.js"), "export const value = 1;\n");
  return root;
}

function restoreEnv(name, value) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

function run(root, args) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd: root,
    encoding: "utf8",
  });
}

function mcpFrame(message) {
  const json = JSON.stringify(message);
  return `Content-Length: ${Buffer.byteLength(json, "utf8")}\r\n\r\n${json}`;
}

function mcpLfFrame(message) {
  const json = JSON.stringify(message);
  return `Content-Length: ${Buffer.byteLength(json, "utf8")}\n\n${json}`;
}

function mcpJsonLine(message) {
  return `${JSON.stringify(message)}\n`;
}

function parseMcpFrames(output) {
  const messages = [];
  let cursor = 0;
  while (cursor < output.length) {
    const headerEnd = output.indexOf("\r\n\r\n", cursor);
    if (headerEnd === -1) break;
    const header = output.slice(cursor, headerEnd);
    const match = /Content-Length:\s*(\d+)/i.exec(header);
    assert.ok(match, `Missing Content-Length in ${header}`);
    const start = headerEnd + 4;
    const end = start + Number.parseInt(match[1], 10);
    messages.push(JSON.parse(output.slice(start, end)));
    cursor = end;
  }
  return messages;
}

function parseMcpJsonLines(output) {
  return output.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
}

function makeBmadFixture(root, options = {}) {
  const base = join(root, "_bmad-output");
  mkdirSync(join(base, "planning-artifacts", "epics"), { recursive: true });
  mkdirSync(join(base, "implementation-artifacts", "stories"), { recursive: true });
  writeFileSync(join(base, "project-context.md"), "# Imported Product\n\nA compact imported product goal.\n");
  if (!options.minimal) {
    writeFileSync(join(base, "planning-artifacts", "PRD.md"), "# Imported PRD\n\n- Must continue imported planning.\n");
    writeFileSync(join(base, "planning-artifacts", "architecture.md"), "# Imported Architecture\n\n- Use local files.\n");
    writeFileSync(join(base, "planning-artifacts", "epics", "epic-1.md"), "# Epic 1\n\n- Build continuation.\n");
    writeFileSync(join(base, "implementation-artifacts", "sprint-status.yaml"), "status: active\nnext: implement story\n");
    writeFileSync(join(base, "implementation-artifacts", "stories", "story-1.md"), "# Story 1\n\n- First story.\n");
  }
  if (options.blocker) {
    writeFileSync(join(base, "planning-artifacts", "PRD.md"), "# Imported PRD\n\nBlocker: scope conflicts with current execution.\n");
  }
  return base;
}

function makeGsdFixture(root, options = {}) {
  const base = join(root, ".planning");
  mkdirSync(join(base, "plans"), { recursive: true });
  mkdirSync(join(base, "phases"), { recursive: true });
  writeFileSync(join(base, "PROJECT.md"), "# GSD Project\n\nA GSD imported project goal.\n");
  writeFileSync(join(base, "ROADMAP.md"), "# GSD Roadmap\n\n- Continue phase 1.\n");
  writeFileSync(join(base, "STATE.md"), "# GSD State\n\nCurrent phase active.\n");
  writeFileSync(join(base, "MEMORY.md"), "# GSD Memory\n\n- Durable GSD decision.\n");
  writeFileSync(join(base, "plans", "PLAN.md"), "# Plan\n\n- Execute task.\n");
  writeFileSync(join(base, "phases", "phase-1.md"), "# Phase 1\n\n- Build feature.\n");
  if (options.blocker) {
    writeFileSync(join(base, "ROADMAP.md"), "# GSD Roadmap\n\nBlocker: imported phase conflicts.\n");
  }
  return base;
}

function makeSuperpowerFixture(root) {
  const base = join(root, "superpowers");
  mkdirSync(join(base, "skills", "karpathy-guidelines"), { recursive: true });
  writeFileSync(join(base, "README.md"), "# Superpowers\n\nA methodology pack for agent work.\n");
  writeFileSync(join(base, "CLAUDE.md"), "# Claude Guidance\n\n- Keep plans simple.\n");
  writeFileSync(join(base, "CURSOR.md"), "# Cursor Guidance\n\n- Prefer compact context.\n");
  writeFileSync(join(base, "EXAMPLES.md"), "# Examples\n\n- Use testable workflows.\n");
  writeFileSync(join(base, "skills", "karpathy-guidelines", "SKILL.md"), "# Karpathy Guidelines\n\n- Verify with examples.\n");
  return base;
}

test("status reads project state", () => {
  const root = makeProject();
  const result = run(root, ["status"]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /# taphelu status/);
  assert.match(result.stdout, /Test goal/);
  assert.match(result.stdout, /Test decision/);
});

test("commands prints stable command manifest", () => {
  const root = makeProject();
  const result = run(root, ["commands"]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /# Command Manifest/);
  assert.match(result.stdout, /`status`/);
  assert.match(result.stdout, /`verify`/);
  assert.match(result.stdout, /`import`/);
  assert.match(result.stdout, /`scan`/);
  assert.match(result.stdout, /`contracts`/);
  assert.match(result.stdout, /`review`/);
  assert.match(result.stdout, /`cleanup`/);
  assert.match(result.stdout, /`context`/);
  assert.match(result.stdout, /`compact`/);
  assert.match(result.stdout, /`config`/);
});

test("commands and runtime install commands work without .projects", () => {
  const root = makePlainRepo();
  const globalConfigDir = join(root, "runtime-home");
  const commands = run(root, ["commands"]);
  const localInstall = run(root, ["install", "--runtime", "claude", "--scope", "local", "--write"]);
  const localDoctor = run(root, ["doctor", "--runtime", "claude", "--scope", "local"]);
  const globalInstall = run(root, ["install", "--runtime", "claude", "--scope", "global", "--config-dir", globalConfigDir, "--write"]);
  const globalDoctor = run(root, ["doctor", "--runtime", "claude", "--scope", "global", "--config-dir", globalConfigDir]);

  assert.equal(commands.status, 0, commands.stderr);
  assert.match(commands.stdout, /# Command Manifest/);
  assert.equal(localInstall.status, 0, localInstall.stderr);
  assert.equal(localDoctor.status, 0, localDoctor.stderr);
  assert.match(localDoctor.stdout, /`PASS`/);
  assert.equal(globalInstall.status, 0, globalInstall.stderr);
  assert.equal(globalDoctor.status, 0, globalDoctor.stderr);
  assert.match(globalDoctor.stdout, /`PASS`/);
});

test("mcp lists taphelu agent lifecycle tools", async () => {
  const root = makeProject();
  const direct = listTapheluTools().map((tool) => tool.name);
  const response = await handleMcpMessage({ jsonrpc: "2.0", id: 1, method: "tools/list" }, root);

  assert.ok(direct.includes("dl_start"));
  assert.ok(direct.includes("dl_recall"));
  assert.ok(direct.includes("dl_close"));
  assert.ok(direct.includes("dl_cleanup_context"));
  assert.ok(direct.includes("dl_context_store"));
  assert.ok(direct.includes("dl_scan_project"));
  assert.ok(direct.includes("dl_contracts"));
  assert.equal(direct.includes("taphelu_start"), false);
  assert.equal(response.result.tools.some((tool) => tool.name === "dl_observe"), true);
});

test("mcp accepts legacy taphelu tool aliases without listing them", () => {
  const root = makeProject();
  const result = callTapheluTool("taphelu_start", {
    cwd: root,
    agent_id: "legacy",
    goal: "Legacy alias.",
  });

  assert.equal(result.session.agentId, "legacy");
  assert.equal(result.session.goal, "Legacy alias.");
});

test("mcp tool schemas expose handler-supported fields", () => {
  const tools = Object.fromEntries(listTapheluTools().map((tool) => [tool.name, tool]));

  assert.ok(tools.dl_observe.inputSchema.properties.metadata);
  assert.ok(tools.dl_memory_promote.inputSchema.properties.metadata);
  for (const field of [
    "requirement",
    "constraint",
    "non_goal",
    "browser_check",
    "testing_strictness",
    "testability",
    "required_evidence",
    "skipped_test_rationale",
    "approval_gate",
    "evidence",
    "next_action",
    "reviewed",
    "current_runtime",
  ]) {
    assert.ok(tools.dl_close.inputSchema.properties[field], `dl_close missing ${field}`);
  }
  assert.ok(tools.dl_cleanup_context.inputSchema.properties.write);
  assert.ok(tools.dl_context_store.inputSchema.properties.action);
  assert.ok(tools.dl_context_store.inputSchema.properties.kind);
  assert.ok(tools.dl_scan_project.inputSchema.properties.mode);
  assert.ok(tools.dl_scan_project.inputSchema.properties.action);
  assert.ok(tools.dl_scan_project.inputSchema.properties.focus);
  assert.ok(tools.dl_scan_project.inputSchema.properties.core_flow);
  assert.ok(tools.dl_contracts.inputSchema.properties.action);
  assert.ok(tools.dl_contracts.inputSchema.properties.contracts_path);
  assert.ok(tools.dl_contracts.inputSchema.properties.service);
  assert.ok(tools.dl_contracts.inputSchema.properties.direction);
  assert.ok(tools.dl_contracts.inputSchema.properties.strict);
  assert.ok(tools.dl_contracts.inputSchema.properties.commit);
  assert.ok(tools.dl_contracts.inputSchema.properties.push);
});

test("project file transaction rolls back touched project files", () => {
  const root = makeProject();
  const memoryPath = join(root, ".projects", "MEMORY.md");
  const runsPath = join(root, ".projects", "RUNS.md");
  const beforeMemory = readFileSync(memoryPath, "utf8");
  const beforeRuns = readFileSync(runsPath, "utf8");

  assert.throws(() => withProjectFilesTransaction(root, ["MEMORY.md", "RUNS.md"], () => {
    writeFileSync(memoryPath, "# Broken\n");
    writeFileSync(runsPath, "# Broken\n");
    throw new Error("simulated failure");
  }), /simulated failure/);

  assert.equal(readFileSync(memoryPath, "utf8"), beforeMemory);
  assert.equal(readFileSync(runsPath, "utf8"), beforeRuns);
});

test("project file transaction recovers pending journal", () => {
  const root = makeProject();
  const statePath = join(root, ".projects", "STATE.md");
  const beforeState = readFileSync(statePath, "utf8");
  const journalPath = join(root, ".projects", ".tx-test.json");
  writeFileSync(journalPath, `${JSON.stringify({
    status: "pending",
    snapshots: [{ path: statePath, exists: true, content: beforeState }],
  })}\n`);
  writeFileSync(statePath, "interrupted write");

  recoverProjectTransactions(root);

  assert.equal(readFileSync(statePath, "utf8"), beforeState);
  assert.equal(existsSync(journalPath), false);
});

test("project file transaction leaves active journal untouched", () => {
  const root = makeProject();
  const statePath = join(root, ".projects", "STATE.md");
  const beforeState = readFileSync(statePath, "utf8");
  const journalPath = join(root, ".projects", ".tx-active.json");
  writeFileSync(journalPath, `${JSON.stringify({
    status: "pending",
    pid: process.pid,
    updatedAt: Date.now(),
    snapshots: [{ path: statePath, exists: true, content: beforeState }],
  })}\n`);
  writeFileSync(statePath, "active write");

  recoverProjectTransactions(root);

  assert.equal(readFileSync(statePath, "utf8"), "active write");
  assert.equal(existsSync(journalPath), true);
});

test("project file transaction rolls back own event append when isolated", () => {
  const root = makeProject();
  const eventsPath = join(root, ".projects", "events.jsonl");
  const beforeEvents = readFileSync(eventsPath, "utf8");

  assert.throws(() => withProjectFilesTransaction(root, ["events.jsonl"], () => {
    appendEvent(root, { ts: "2026-05-17T00:00:00.000Z", type: "test_event", run_id: "run-1", summary: "own append", data: {} });
    throw new Error("simulated failure");
  }), /simulated failure/);

  assert.equal(readFileSync(eventsPath, "utf8"), beforeEvents);
});

test("project file transaction preserves concurrent event append on rollback", () => {
  const root = makeProject();
  const eventsPath = join(root, ".projects", "events.jsonl");

  assert.throws(() => withProjectFilesTransaction(root, ["events.jsonl"], () => {
    appendEvent(root, { ts: "2026-05-17T00:00:00.000Z", type: "test_event", run_id: "run-1", summary: "own append", data: {} });
    appendFileSync(eventsPath, `${JSON.stringify({ ts: "2026-05-17T00:00:00.001Z", type: "parallel_event", run_id: "run-2", summary: "parallel append", data: {} })}\n`);
    throw new Error("simulated failure");
  }), /simulated failure/);

  const events = readFileSync(eventsPath, "utf8").trim().split("\n").map((line) => JSON.parse(line));
  assert.deepEqual(events.map((event) => event.type), ["parallel_event"]);
});

test("project file transaction recovers partial append chunks", () => {
  const root = makeProject();
  const eventsPath = join(root, ".projects", "events.jsonl");
  const ownFirst = `${JSON.stringify({ type: "own_first" })}\n`;
  const ownSecond = `${JSON.stringify({ type: "own_second" })}\n`;
  const parallel = `${JSON.stringify({ type: "parallel_event" })}\n`;
  const journalPath = join(root, ".projects", ".tx-partial.json");
  writeFileSync(journalPath, `${JSON.stringify({
    status: "pending",
    snapshots: [{
      path: eventsPath,
      exists: true,
      appendOnly: true,
      baseLength: 0,
      appendedChunks: [ownFirst, ownSecond],
    }],
  })}\n`);
  writeFileSync(eventsPath, `${ownFirst}${parallel}`);

  recoverProjectTransactions(root);

  const events = readFileSync(eventsPath, "utf8").trim().split("\n").map((line) => JSON.parse(line));
  assert.deepEqual(events.map((event) => event.type), ["parallel_event"]);
});

test("canonical agent pack validates one source for skills and agents", () => {
  const pack = loadPack();
  const plan = buildInstallPlan(makeProject(), { runtime: "all", scope: "local" });

  assert.equal(pack.manifest.name, "taphelu-agent-pack");
  assert.equal(pack.skills.length, 8);
  assert.equal(pack.agents.length, 11);
  assert.ok(pack.agents.some((agent) => agent.name === "taphelu-lead"));
  assert.ok(pack.agents.some((agent) => agent.name === "taphelu-qa"));
  assert.ok(pack.agents.some((agent) => agent.name === "taphelu-context-curator"));
  assert.equal(pack.agents.some((agent) => agent.name === "taphelu-orchestrator"), false);
  assert.equal(plan.runtimes.length, 4);
  assert.equal(plan.blockers.length, 0);
  assert.ok(plan.files.some((file) => file.path.includes(".codex")));
  assert.ok(plan.files.some((file) => file.path.includes(".claude")));
  assert.ok(plan.files.some((file) => file.path.includes(".gemini")));
  assert.ok(plan.files.some((file) => file.path.includes(".kiro")));
});

test("install plan rolls back generated files on write failure", () => {
  const root = makeProject();
  const generatedDir = join(root, "generated", "nested");
  const firstPath = join(generatedDir, "SKILL.md");
  const blockingPath = join(root, "blocking-file");
  writeFileSync(blockingPath, "not a directory");

  assert.throws(() => applyInstallPlan({
    blockers: [],
    files: [
      { path: firstPath, content: "generated", kind: "skill" },
      { path: join(blockingPath, "child.md"), content: "will fail", kind: "skill" },
    ],
  }));

  assert.equal(existsSync(firstPath), false);
  assert.equal(existsSync(generatedDir), false);
});

test("mcp stdio server handles initialize tools/list and tools/call", () => {
  const root = makeProject();
  const input = [
    mcpFrame({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05" } }),
    mcpFrame({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
    mcpFrame({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "dl_start",
        arguments: { cwd: root, goal: "Stdio smoke." },
      },
    }),
  ].join("");
  const result = spawnSync(process.execPath, [mcpPath], {
    cwd: root,
    input,
    encoding: "utf8",
  });
  const responses = parseMcpFrames(result.stdout);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.equal(responses[0].result.serverInfo.name, "taphelu");
  assert.ok(responses[1].result.tools.some((tool) => tool.name === "dl_start"));
  assert.equal(responses[2].result.structuredContent.session.goal, "Stdio smoke.");
});

test("mcp stdio server skips malformed headers and continues buffered messages", () => {
  const root = makeProject();
  const input = [
    "X-Invalid: 1\r\n\r\n",
    mcpFrame({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  ].join("");
  const result = spawnSync(process.execPath, [mcpPath], {
    cwd: root,
    input,
    encoding: "utf8",
  });
  const responses = parseMcpFrames(result.stdout);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.equal(responses.length, 1);
  assert.ok(responses[0].result.tools.some((tool) => tool.name === "dl_start"));
});

test("mcp stdio server accepts LF-only MCP headers", () => {
  const root = makeProject();
  const result = spawnSync(process.execPath, [mcpPath], {
    cwd: root,
    input: mcpLfFrame({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    encoding: "utf8",
  });
  const responses = parseMcpFrames(result.stdout);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(responses.length, 1);
  assert.ok(responses[0].result.tools.some((tool) => tool.name === "dl_start"));
});

test("mcp stdio server accepts Claude Code JSONL framing", () => {
  const root = makeProject();
  const input = [
    mcpJsonLine({
      jsonrpc: "2.0",
      id: 0,
      method: "initialize",
      params: {
        protocolVersion: "2025-11-25",
        capabilities: { roots: {}, elicitation: {} },
        clientInfo: { name: "claude-code", version: "2.1.143" },
      },
    }),
    mcpJsonLine({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    mcpJsonLine({ jsonrpc: "2.0", id: 2, method: "resources/list" }),
    mcpJsonLine({ jsonrpc: "2.0", id: 3, method: "prompts/list" }),
  ].join("");
  const result = spawnSync(process.execPath, [mcpPath], {
    cwd: root,
    input,
    encoding: "utf8",
  });
  const responses = parseMcpJsonLines(result.stdout);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.equal(responses[0].result.serverInfo.name, "taphelu");
  assert.ok(responses[1].result.tools.some((tool) => tool.name === "dl_scan_project"));
  assert.deepEqual(responses[2].result.resources, []);
  assert.deepEqual(responses[3].result.prompts, []);
});

test("mcp stdio server returns tool errors without exiting", () => {
  const root = makeProject();
  const input = [
    mcpFrame({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "dl_close",
        arguments: { cwd: root, testing_strictness: "strictest" },
      },
    }),
    mcpFrame({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
  ].join("");
  const result = spawnSync(process.execPath, [mcpPath], {
    cwd: root,
    input,
    encoding: "utf8",
  });
  const responses = parseMcpFrames(result.stdout);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(responses[0].result.isError, true);
  assert.match(responses[0].result.content[0].text, /Invalid testing\.strictness/);
  assert.ok(responses[1].result.tools.some((tool) => tool.name === "dl_start"));
});

test("install dry-run plans generated adapters without writing", () => {
  const root = makeProject();
  const result = run(root, ["install", "--runtime", "all", "--scope", "local", "--dry-run"]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /# Taphelu Install Plan/);
  assert.match(result.stdout, /`dry_run`/);
  assert.equal(existsSync(join(root, ".codex")), false);
  assert.equal(existsSync(join(root, ".kiro")), false);
  assert.equal(existsSync(join(root, ".mcp.json")), false);
});

test("install write creates local runtime adapters and doctor passes", () => {
  const root = makeProject();
  const install = run(root, ["install", "--runtime", "all", "--scope", "local", "--write"]);
  const doctor = run(root, ["doctor", "--runtime", "all", "--scope", "local"]);
  const codexSkill = readFileSync(join(root, ".codex", "skills", "taphelu-core", "SKILL.md"), "utf8");
  const claudeLeadSkill = readFileSync(join(root, ".claude", "skills", "taphelu-lead", "SKILL.md"), "utf8");
  const claudeDevAgent = readFileSync(join(root, ".claude", "agents", "taphelu-dev.md"), "utf8");
  const geminiAgentSkill = readFileSync(join(root, ".gemini", "skills", "taphelu-lead", "SKILL.md"), "utf8");
  const kiroLeadSkill = readFileSync(join(root, ".kiro", "skills", "taphelu-lead", "SKILL.md"), "utf8");
  const kiroAgent = JSON.parse(readFileSync(join(root, ".kiro", "agents", "taphelu-dev.json"), "utf8"));
  const kiroSteering = readFileSync(join(root, ".kiro", "steering", "taphelu-runtime.md"), "utf8");
  const claudeMcp = JSON.parse(readFileSync(join(root, ".mcp.json"), "utf8"));
  const claudeSettings = JSON.parse(readFileSync(join(root, ".claude", "settings.json"), "utf8"));
  const claudeCommand = readFileSync(join(root, ".claude", "commands", "dl-init.md"), "utf8");
  const claudeHookPath = join(root, ".claude", "hooks", "taphelu-runtime-hook.mjs");
  const claudeStatuslinePath = join(root, ".claude", "hooks", "taphelu-statusline.mjs");
  const codexPointer = readFileSync(join(root, ".codex", "AGENTS.md"), "utf8");
  const codexRuntimeSettings = JSON.parse(readFileSync(join(root, ".codex", "taphelu-runtime.json"), "utf8"));
  const geminiSettingsPath = join(root, ".gemini", "settings.json");
  const geminiSettings = existsSync(geminiSettingsPath)
    ? JSON.parse(readFileSync(geminiSettingsPath, "utf8"))
    : {};
  const geminiRuntimeSettings = JSON.parse(readFileSync(join(root, ".gemini", "extensions", "taphelu", "taphelu-runtime.json"), "utf8"));
  const geminiExtension = JSON.parse(readFileSync(join(root, ".gemini", "extensions", "taphelu", "gemini-extension.json"), "utf8"));
  const geminiContext = readFileSync(join(root, ".gemini", "extensions", "taphelu", "GEMINI.md"), "utf8");
  const geminiCommand = readFileSync(join(root, ".gemini", "extensions", "taphelu", "commands", "dl-init.toml"), "utf8");
  const kiroMcp = JSON.parse(readFileSync(join(root, ".kiro", "settings", "mcp.json"), "utf8"));
  const kiroRuntimeSettings = JSON.parse(readFileSync(join(root, ".kiro", "settings", "taphelu.json"), "utf8"));
  const kiroCommandSkill = readFileSync(join(root, ".kiro", "skills", "dl-init", "SKILL.md"), "utf8");
  const kiroIdeHook = JSON.parse(readFileSync(join(root, ".kiro", "hooks", "taphelu-prompt-context.kiro.hook"), "utf8"));
  const codexToml = readFileSync(join(root, ".codex", "config.toml"), "utf8");
  const claudeHookCheck = spawnSync(process.execPath, ["--check", claudeHookPath], { encoding: "utf8" });
  const claudeStatuslineCheck = spawnSync(process.execPath, ["--check", claudeStatuslinePath], { encoding: "utf8" });
  const claudeStatuslineRun = spawnSync(process.execPath, [claudeStatuslinePath], { encoding: "utf8", timeout: 1000, stdio: ["ignore", "pipe", "pipe"] });

  assert.equal(install.status, 0, install.stderr);
  assert.equal(doctor.status, 0, doctor.stderr);
  assert.match(codexSkill, /TAPHELU-GENERATED/);
  assert.match(codexSkill, /Across Codex, Claude, Gemini, Kiro/);
  assert.match(codexSkill, /Do not invent host tools/);
  assert.match(codexPointer, /Use Taphelu MCP tools/);
  assert.match(codexPointer, /Use only visible Taphelu entrypoints/);
  assert.equal(existsSync(join(root, ".claude", "agents", "taphelu-lead.md")), false);
  assert.match(claudeLeadSkill, /main-session taphelu-lead role contract/);
  assert.match(claudeDevAgent, /taphelu-dev/);
  assert.match(claudeCommand, /# Taphelu Init/);
  assert.equal(claudeSettings.statusLine.tapheluManaged, "1");
  assert.equal(claudeSettings.hooks.PreToolUse[0].hooks[0].command, process.execPath);
  assert.equal(codexRuntimeSettings.taphelu.statusline.mode, "fallback");
  assert.equal(existsSync(join(root, ".codex", "hooks", "taphelu-statusline.mjs")), false);
  assert.match(geminiAgentSkill, /main-session taphelu-lead role contract/);
  assert.equal(geminiExtension.mcpServers.taphelu.env.TAPHELU_MANAGED, "1");
  assert.match(geminiContext, /mcp_taphelu_dl_context/);
  assert.match(geminiContext, /Do not call `activate_skill`/);
  assert.match(geminiContext, /If no Taphelu tool is visible/);
  assert.equal(geminiSettings.mcpServers?.taphelu, undefined);
  assert.equal(geminiRuntimeSettings.ui.hideFooter, false);
  assert.equal(geminiRuntimeSettings.ui.footer.hideModelInfo, false);
  assert.equal(geminiRuntimeSettings.ui.footer.hideContextPercentage, false);
  assert.equal(geminiRuntimeSettings.taphelu.statusline.mode, "native-footer");
  assert.equal(existsSync(join(root, ".gemini", "hooks", "taphelu-statusline.mjs")), false);
  assert.match(geminiCommand, /prompt =/);
  assert.equal(existsSync(join(root, ".kiro", "agents", "taphelu-lead.json")), false);
  assert.match(kiroLeadSkill, /main-session taphelu-lead role contract/);
  assert.match(kiroSteering, /Do not spawn or delegate to `taphelu-lead`/);
  assert.equal(kiroAgent.name, "taphelu-dev");
  assert.match(kiroAgent.prompt, /taphelu-dev/);
  assert.equal(kiroAgent.includeMcpJson, true);
  assert.deepEqual(kiroAgent.tools, ["*"]);
  assert.equal(kiroAgent.hooks.userPromptSubmit[0].command.includes("--runtime kiro"), true);
  assert.equal(kiroAgent.hooks.preToolUse.some((hook) => hook.matcher === "execute_bash"), true);
  assert.equal(kiroRuntimeSettings.taphelu.statusline.mode, "native-tui");
  assert.equal(existsSync(join(root, ".kiro", "hooks", "taphelu-statusline.mjs")), false);
  assert.equal(kiroIdeHook.enabled, true);
  assert.equal(kiroIdeHook.when.type, "promptSubmit");
  assert.equal(kiroIdeHook.then.type, "shellCommand");
  assert.match(kiroCommandSkill, /Invoke with \/dl-init/);
  assert.match(codexToml, /\[mcp_servers\.taphelu\]/);
  assert.equal(claudeHookCheck.status, 0, claudeHookCheck.stderr);
  assert.equal(claudeStatuslineCheck.status, 0, claudeStatuslineCheck.stderr);
  assert.equal(claudeStatuslineRun.status, 0, claudeStatuslineRun.stderr);
  assert.equal(claudeMcp.mcpServers.taphelu.type, "stdio");
  assert.equal(claudeMcp.mcpServers.taphelu.env.TAPHELU_MANAGED, "1");
  assert.equal(geminiExtension.mcpServers.taphelu.args[0], mcpPath);
  assert.equal(kiroMcp.mcpServers.taphelu.args[0], mcpPath);
  assert.match(doctor.stdout, /`PASS`/);
});

test("install removes obsolete non-Claude statusline scripts", () => {
  const root = makeProject();
  for (const runtime of ["codex", "gemini", "kiro"]) {
    const stalePath = join(root, `.${runtime}`, "hooks", "taphelu-statusline.mjs");
    mkdirSync(dirname(stalePath), { recursive: true });
    writeFileSync(stalePath, "// TAPHELU-GENERATED\n");
  }

  const install = run(root, ["install", "--runtime", "all", "--scope", "local", "--write"]);
  const doctor = run(root, ["doctor", "--runtime", "all", "--scope", "local"]);

  assert.equal(install.status, 0, install.stderr);
  assert.equal(doctor.status, 0, doctor.stderr);
  assert.equal(existsSync(join(root, ".codex", "hooks", "taphelu-statusline.mjs")), false);
  assert.equal(existsSync(join(root, ".gemini", "hooks", "taphelu-statusline.mjs")), false);
  assert.equal(existsSync(join(root, ".kiro", "hooks", "taphelu-statusline.mjs")), false);
  assert.match(doctor.stdout, /`PASS`/);
});

test("install core profile filters optional skills and dependent agents", () => {
  const root = makeProject();
  const install = run(root, ["install", "--runtime", "claude", "--scope", "local", "--profile", "core", "--write"]);
  const doctor = run(root, ["doctor", "--runtime", "claude", "--scope", "local", "--profile", "core"]);

  assert.equal(install.status, 0, install.stderr);
  assert.equal(doctor.status, 0, doctor.stderr);
  assert.equal(existsSync(join(root, ".claude", "skills", "taphelu-core", "SKILL.md")), true);
  assert.equal(existsSync(join(root, ".claude", "skills", "taphelu-browser", "SKILL.md")), false);
  assert.equal(existsSync(join(root, ".claude", "skills", "taphelu-adapters", "SKILL.md")), false);
  assert.equal(existsSync(join(root, ".claude", "skills", "taphelu-lead", "SKILL.md")), true);
  assert.equal(existsSync(join(root, ".claude", "agents", "taphelu-lead.md")), false);
  assert.equal(existsSync(join(root, ".claude", "agents", "taphelu-visual-qa.md")), false);
  assert.equal(existsSync(join(root, ".claude", "agents", "taphelu-workflow-adapter.md")), false);
});

test("doctor live validates MCP and runtime status reports adapter health", () => {
  const root = makeProject();
  const configDir = join(root, "runtime-home");
  const install = run(root, ["install", "--runtime", "claude", "--scope", "global", "--config-dir", configDir, "--write"]);
  const doctor = run(root, ["doctor", "--runtime", "claude", "--scope", "global", "--config-dir", configDir, "--live"]);
  const status = run(root, ["runtime", "status", "--runtime", "claude", "--scope", "global", "--config-dir", configDir, "--live"]);

  assert.equal(install.status, 0, install.stderr);
  assert.equal(doctor.status, 0, doctor.stderr);
  assert.equal(status.status, 0, status.stderr);
  assert.match(doctor.stdout, /Live MCP handshake and tools\/list passed/);
  assert.match(status.stdout, /# Taphelu Runtime Status/);
  assert.match(status.stdout, /`PASS`/);
});

test("doctor detects non-absolute MCP commands and local shadowing", () => {
  const root = makeProject();
  const configDir = join(root, "runtime-home");
  const localInstall = run(root, ["install", "--runtime", "claude", "--scope", "local", "--write"]);
  const globalInstall = run(root, ["install", "--runtime", "codex", "--scope", "global", "--config-dir", configDir, "--write"]);
  const codexConfig = join(configDir, "config.toml");
  writeFileSync(codexConfig, readFileSync(codexConfig, "utf8").replace(`command = ${JSON.stringify(process.execPath)}`, `command = "node"`));
  const codexDoctor = run(root, ["doctor", "--runtime", "codex", "--scope", "global", "--config-dir", configDir]);
  const claudeDoctor = run(root, ["doctor", "--runtime", "claude", "--scope", "global", "--config-dir", join(root, "claude-home")]);

  assert.equal(localInstall.status, 0, localInstall.stderr);
  assert.equal(globalInstall.status, 0, globalInstall.stderr);
  assert.match(codexDoctor.stdout, /`FAIL`/);
  assert.match(codexDoctor.stdout, /absolute executable path/);
  assert.match(claudeDoctor.stdout, /Local claude Taphelu MCP config exists and may shadow global config/);
});

test("install off removes managed Claude hooks and statusline", () => {
  const root = makeProject();
  const configDir = join(root, "claude-home");
  const first = run(root, ["install", "--runtime", "claude", "--scope", "global", "--config-dir", configDir, "--write"]);
  const second = run(root, ["install", "--runtime", "claude", "--scope", "global", "--config-dir", configDir, "--hooks", "off", "--statusline", "off", "--write"]);
  const doctor = run(root, ["doctor", "--runtime", "claude", "--scope", "global", "--config-dir", configDir, "--hooks", "off", "--statusline", "off"]);
  const settings = readFileSync(join(configDir, "settings.json"), "utf8");

  assert.equal(first.status, 0, first.stderr);
  assert.equal(second.status, 0, second.stderr);
  assert.equal(doctor.status, 0, doctor.stderr);
  assert.match(doctor.stdout, /`PASS`/);
  assert.doesNotMatch(settings, /taphelu-runtime-hook\.mjs/);
  assert.doesNotMatch(settings, /taphelu-statusline\.mjs/);
  assert.match(settings, /"hooks": "off"/);
  assert.match(settings, /"statusline": "off"/);
});

test("runtime hook blocks destructive roots but allows ordinary relative cleanup", () => {
  const root = makeProject();
  const hookPath = join(repoRoot, "taphelu-pack", "hooks", "taphelu-runtime-hook.mjs");
  const noInput = spawnSync(process.execPath, [hookPath, "--policy", "strict"], {
    encoding: "utf8",
    timeout: 1000,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const blocked = spawnSync(process.execPath, [hookPath, "--policy", "strict"], {
    input: JSON.stringify({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "rm -rf /" } }),
    encoding: "utf8",
  });
  const blockedWildcard = spawnSync(process.execPath, [hookPath, "--policy", "strict"], {
    input: JSON.stringify({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "rm -rf /*" } }),
    encoding: "utf8",
  });
  const blockedSplitFlags = spawnSync(process.execPath, [hookPath, "--policy", "strict"], {
    input: JSON.stringify({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "rm -r -f /" } }),
    encoding: "utf8",
  });
  const blockedHomeDot = spawnSync(process.execPath, [hookPath, "--policy", "strict"], {
    input: JSON.stringify({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "rm -rf ~/." } }),
    encoding: "utf8",
  });
  const blockedSystemDir = spawnSync(process.execPath, [hookPath, "--policy", "strict"], {
    input: JSON.stringify({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "rm -rf /etc" } }),
    encoding: "utf8",
  });
  const blockedGitResetHard = spawnSync(process.execPath, [hookPath, "--policy", "strict"], {
    input: JSON.stringify({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "git reset HEAD --hard" } }),
    encoding: "utf8",
  });
  const blockedGitDirRemoval = spawnSync(process.execPath, [hookPath, "--policy", "strict"], {
    input: JSON.stringify({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "rm -rf .git" } }),
    encoding: "utf8",
  });
  const allowed = spawnSync(process.execPath, [hookPath, "--policy", "strict"], {
    input: JSON.stringify({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "rm -rf ./build" } }),
    encoding: "utf8",
  });
  const blockedMemory = spawnSync(process.execPath, [hookPath, "--policy", "strict"], {
    input: JSON.stringify({ hook_event_name: "PreToolUse", tool_name: "dl_memory_promote", tool_input: { content: "api_key=abc123" } }),
    encoding: "utf8",
  });
  const allowedMemory = spawnSync(process.execPath, [hookPath, "--policy", "strict"], {
    input: JSON.stringify({ hook_event_name: "PreToolUse", tool_name: "dl_memory_promote", tool_input: { content: "stable project decision" } }),
    encoding: "utf8",
  });
  const allowedMemoryArchitecture = spawnSync(process.execPath, [hookPath, "--policy", "strict"], {
    input: JSON.stringify({ hook_event_name: "PreToolUse", tool_name: "dl_memory_promote", tool_input: { content: "The system uses token-based auth." } }),
    encoding: "utf8",
  });
  const hookDbPath = join(root, "hook-memory.db");
  const capturedPrompt = spawnSync(process.execPath, [hookPath, "--policy", "strict"], {
    input: JSON.stringify({ hook_event_name: "UserPromptSubmit", session_id: "claude-session-1", cwd: root, prompt: "Use token-based auth, not api_key=abc123." }),
    encoding: "utf8",
    env: { ...process.env, TAPHELU_MEMORY_DB: hookDbPath },
  });
  const sqliteAvailable = spawnSync("sqlite3", ["--version"], { encoding: "utf8" }).status === 0;

  assert.equal(noInput.error, undefined);
  assert.equal(noInput.status, 0);
  assert.equal(blocked.status, 2);
  assert.equal(blockedWildcard.status, 2);
  assert.equal(blockedSplitFlags.status, 2);
  assert.equal(blockedHomeDot.status, 2);
  assert.equal(blockedSystemDir.status, 2);
  assert.equal(blockedGitResetHard.status, 2);
  assert.equal(blockedGitDirRemoval.status, 2);
  assert.match(blocked.stdout, /permissionDecision/);
  assert.equal(allowed.status, 0);
  assert.equal(blockedMemory.status, 2);
  assert.equal(allowedMemory.status, 0);
  assert.equal(allowedMemoryArchitecture.status, 0);
  assert.equal(capturedPrompt.status, 0, capturedPrompt.stderr);
  if (sqliteAvailable) {
    const stored = spawnSync("sqlite3", [hookDbPath, "SELECT role||'|'||source||'|'||content FROM l0_records ORDER BY created_at DESC LIMIT 1;"], { encoding: "utf8" });
    assert.equal(stored.status, 0, stored.stderr);
    assert.match(stored.stdout, /^user\|user_prompt\|Use token-based auth, not api_key=\[REDACTED\]/);
  }
});

test("statusline does not wait forever without piped stdin", () => {
  const statuslinePath = join(repoRoot, "taphelu-pack", "hooks", "taphelu-statusline.mjs");
  const result = spawnSync(process.execPath, [statuslinePath], {
    encoding: "utf8",
    timeout: 1000,
    stdio: ["ignore", "pipe", "pipe"],
  });

  assert.equal(result.error, undefined);
  assert.equal(result.status, 0);
  assert.doesNotMatch(result.stdout, /\$dl|ctx:0/);
  assert.doesNotMatch(result.stdout, /mem:/);
  assert.doesNotMatch(result.stdout, /proj:/);
  assert.match(result.stdout, /model:\?/);
  assert.match(result.stdout, /ctx:\?/);
});

test("statusline surfaces Claude model effort and context percentage from stdin", () => {
  const root = makeProject();
  const statuslinePath = join(repoRoot, "taphelu-pack", "hooks", "taphelu-statusline.mjs");
  const result = spawnSync(process.execPath, [statuslinePath], {
    input: JSON.stringify({
      cwd: root,
      workspace: { current_dir: root, project_dir: root },
      model: { id: "claude-sonnet-4-5-20250929", display_name: "Claude Sonnet 4.5" },
      effort: { level: "high" },
      context_window: { used_percentage: 42.6, remaining_percentage: 57.4, context_window_size: 200000 },
    }),
    encoding: "utf8",
    timeout: 1000,
    stdio: ["pipe", "pipe", "pipe"],
  });

  assert.equal(result.error, undefined);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /model:sonnet-4\.5/);
  assert.match(result.stdout, /effort:high/);
  assert.match(result.stdout, /ctx:43%/);
  assert.match(result.stdout, /phase:Testing/);
});

test("global install supports runtime config dir and is idempotent", () => {
  const root = makeProject();
  for (const runtime of ["codex", "claude", "gemini", "kiro"]) {
    const configDir = join(root, `${runtime}-home`);
    const first = run(root, ["install", "--runtime", runtime, "--scope", "global", "--config-dir", configDir, "--write"]);
    const second = run(root, ["install", "--runtime", runtime, "--scope", "global", "--config-dir", configDir, "--write"]);
    const doctor = run(root, ["doctor", "--runtime", runtime, "--scope", "global", "--config-dir", configDir]);

    assert.equal(first.status, 0, first.stderr);
    assert.equal(second.status, 0, second.stderr);
    assert.equal(doctor.status, 0, doctor.stderr);
    assert.match(doctor.stdout, /`PASS`/);
  }
});

test("global install all separates runtimes under shared config dir", () => {
  const root = makeProject();
  const configDir = join(root, "runtime-home");
  const install = run(root, ["install", "--runtime", "all", "--scope", "global", "--config-dir", configDir, "--write"]);
  const doctor = run(root, ["doctor", "--runtime", "all", "--scope", "global", "--config-dir", configDir]);
  const codexSkill = readFileSync(join(configDir, "codex", "skills", "taphelu-core", "SKILL.md"), "utf8");
  const geminiSkill = readFileSync(join(configDir, "gemini", "skills", "taphelu-core", "SKILL.md"), "utf8");
  const kiroAgent = JSON.parse(readFileSync(join(configDir, "kiro", "agents", "taphelu-dev.json"), "utf8"));
  const kiroLeadSkill = readFileSync(join(configDir, "kiro", "skills", "taphelu-lead", "SKILL.md"), "utf8");

  assert.equal(install.status, 0, install.stderr);
  assert.equal(doctor.status, 0, doctor.stderr);
  assert.match(install.stdout, /Kiro IDE Agent Hooks are workspace-local/);
  assert.match(doctor.stdout, /`PASS`/);
  assert.equal(existsSync(join(configDir, "codex", "config.toml")), true);
  assert.equal(existsSync(join(configDir, "claude", ".mcp.json")), true);
  assert.equal(existsSync(join(configDir, "gemini", "extensions", "taphelu", "gemini-extension.json")), true);
  assert.equal(existsSync(join(configDir, "kiro", "settings", "mcp.json")), true);
  assert.match(codexSkill, /taphelu_runtime: "codex"/);
  assert.match(geminiSkill, /taphelu_runtime: "gemini"/);
  assert.equal(existsSync(join(configDir, "kiro", "agents", "taphelu-lead.json")), false);
  assert.equal(existsSync(join(configDir, "kiro", "hooks", "taphelu-prompt-context.kiro.hook")), false);
  assert.match(kiroLeadSkill, /main-session taphelu-lead role contract/);
  assert.match(kiroAgent.prompt, /TAPHELU-GENERATED/);
  assert.equal(kiroAgent.includeMcpJson, true);
});

test("doctor reports stale managed MCP server paths", () => {
  const root = makeProject();
  const missingMcp = join(root, "missing", "taphelu-mcp.mjs");
  const configPaths = {
    codex: "config.toml",
    claude: ".mcp.json",
    gemini: join("extensions", "taphelu", "gemini-extension.json"),
    kiro: join("settings", "mcp.json"),
  };

  for (const runtime of ["codex", "claude", "gemini", "kiro"]) {
    const configDir = join(root, `${runtime}-stale-home`);
    const install = run(root, ["install", "--runtime", runtime, "--scope", "global", "--config-dir", configDir, "--write"]);
    const configPath = join(configDir, configPaths[runtime]);
    writeFileSync(configPath, staleMcpConfig(readFileSync(configPath, "utf8"), runtime, mcpPath, missingMcp));
    const doctor = run(root, ["doctor", "--runtime", runtime, "--scope", "global", "--config-dir", configDir]);

    assert.equal(install.status, 0, install.stderr);
    assert.equal(doctor.status, 0, doctor.stderr);
    assert.match(doctor.stdout, /`FAIL`/);
    assert.match(doctor.stdout, /MCP server path drift|MCP server path does not exist/);
  }
});

function staleMcpConfig(content, runtime, currentMcp, missingMcp) {
  if (runtime === "codex") return content.replace(JSON.stringify(currentMcp), JSON.stringify(missingMcp));
  const parsed = JSON.parse(content);
  parsed.mcpServers.taphelu.args[0] = missingMcp;
  return `${JSON.stringify(parsed, null, 2)}\n`;
}

test("install blocks unmanaged adapter files", () => {
  const root = makeProject();
  const target = join(root, ".codex", "skills", "taphelu-core");
  mkdirSync(target, { recursive: true });
  writeFileSync(join(target, "SKILL.md"), "# Unmanaged\n");
  const result = run(root, ["install", "--runtime", "codex", "--scope", "local", "--write"]);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /existing file is not Taphelu-managed/);
});

test("doctor instructions flags noisy runtime instruction files", () => {
  const root = makeProject();
  writeFileSync(join(root, "AGENTS.md"), `# Agents

${Array.from({ length: 100 }, (_, index) => `Line ${index}`).join("\n")}

## run-old
`);
  const result = run(root, ["doctor", "instructions"]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /# Taphelu Instruction Doctor/);
  assert.match(result.stdout, /`WARN`/);
  assert.match(result.stdout, /line budget exceeded/);
  assert.match(result.stdout, /contains run history/);
});

test("config get and set manage project testing strictness", () => {
  const root = makeProject();
  const initial = run(root, ["config", "get", "testing.strictness"]);
  const updated = run(root, ["config", "set", "testing.strictness", "deep"]);
  const final = run(root, ["config", "get", "testing.strictness"]);
  const config = JSON.parse(readFileSync(join(root, ".projects", "config.json"), "utf8"));

  assert.equal(initial.status, 0, initial.stderr);
  assert.match(initial.stdout, /`medium`/);
  assert.equal(updated.status, 0, updated.stderr);
  assert.equal(final.status, 0, final.stderr);
  assert.match(final.stdout, /`deep`/);
  assert.equal(config.testing.strictness, "deep");
});

test("config manages review policy and instruction budgets", () => {
  const root = makeProject();
  const level = run(root, ["config", "get", "review.cross_ai.level"]);
  const setLevel = run(root, ["config", "set", "review.cross_ai.level", "large-only"]);
  const setReviewer = run(root, ["config", "set", "review.cross_ai.reviewers.gemini.enabled", "false"]);
  const setBudget = run(root, ["config", "set", "instructions.max_lines", "40"]);
  const config = JSON.parse(readFileSync(join(root, ".projects", "config.json"), "utf8"));

  assert.equal(level.status, 0, level.stderr);
  assert.match(level.stdout, /`medium-plus`/);
  assert.equal(setLevel.status, 0, setLevel.stderr);
  assert.equal(setReviewer.status, 0, setReviewer.stderr);
  assert.equal(setBudget.status, 0, setBudget.stderr);
  assert.equal(config.review.cross_ai.level, "large-only");
  assert.equal(config.review.cross_ai.reviewers.gemini.enabled, false);
  assert.equal(config.instructions.max_lines, 40);
});

test("config manages context store and compaction settings", () => {
  const root = makeProject();
  const setKind = run(root, ["config", "set", "context.store.kind", "external-dir"]);
  const setPath = run(root, ["config", "set", "context.store.path", "../taphelu-context-store"]);
  const setAfterClose = run(root, ["config", "set", "context.compaction.after_close", "auto"]);
  const setKeep = run(root, ["config", "set", "context.compaction.keep_recent_runs", "2"]);
  const setKeepZero = run(root, ["config", "set", "context.compaction.keep_recent_runs", "0"]);
  const setBudget = run(root, ["config", "set", "context.compaction.max_always_load_chars", "9000"]);
  const config = JSON.parse(readFileSync(join(root, ".projects", "config.json"), "utf8"));

  assert.equal(setKind.status, 0, setKind.stderr);
  assert.equal(setPath.status, 0, setPath.stderr);
  assert.equal(setAfterClose.status, 0, setAfterClose.stderr);
  assert.equal(setKeep.status, 0, setKeep.stderr);
  assert.equal(setKeepZero.status, 0, setKeepZero.stderr);
  assert.equal(setBudget.status, 0, setBudget.stderr);
  assert.equal(config.context.store.kind, "external-dir");
  assert.equal(config.context.store.path, "../taphelu-context-store");
  assert.equal(config.context.compaction.after_close, "auto");
  assert.equal(config.context.compaction.keep_recent_runs, 0);
  assert.equal(config.context.compaction.max_always_load_chars, 9000);
});

test("review policy asks permission for medium-plus Codex review", () => {
  const root = makeProject();
  const result = run(root, [
    "review",
    "plan",
    "--runtime",
    "codex",
    "--files",
    "5",
    "--commits",
    "3",
  ]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /# Cross-AI Review Policy/);
  assert.match(result.stdout, /`requested`/);
  assert.match(result.stdout, /gemini/);
  assert.match(result.stdout, /claude/);
});

test("dl_start returns compact context without raw L0 history", () => {
  const root = makeProject();
  const result = callTapheluTool("dl_start", {
    cwd: root,
    agent_id: "codex",
    platform: "mcp",
    goal: "Implement lifecycle memory.",
  });

  assert.match(result.session.id, /^session_/);
  assert.equal(result.session.agentId, "codex");
  assert.equal(result.context.currentGoal, "Test goal.");
  assert.equal(result.context.recall.l1Memories.length, 0);
  assert.equal(result.memory.l0Records, 1);
  assert.equal(result.memory.dbPath.includes(join(root, ".projects")), false);
  assert.match(result.memory.dbPath, /\.taphelu-test-home[\/\\]memory[\/\\].*taphelu\.db$/);
  assert.equal(existsSync(result.memory.dbPath), true);
  assert.equal(existsSync(join(root, ".projects", "memory")), false);
});

test("mcp observe captures L0 and conversation search drills down", () => {
  const root = makeProject();
  const started = callTapheluTool("dl_start", { cwd: root, goal: "Search memory." });
  const observed = callTapheluTool("dl_observe", {
    cwd: root,
    session_id: started.session.id,
    role: "agent",
    source: "tool_result",
    content: "SQLite FTS should find this observation.",
  });
  const searched = callTapheluTool("dl_conversation_search", {
    cwd: root,
    query: "SQLite",
  });

  assert.match(observed.record.id, /^l0_/);
  assert.equal(searched.records.length, 1);
  assert.equal(searched.records[0].id, observed.record.id);
});

test("memory promotes source-traceable L1, L2, and L3 records", () => {
  const root = makeProject();
  const started = callTapheluTool("dl_start", { cwd: root, goal: "Layer memory." });
  const observed = callTapheluTool("dl_observe", {
    cwd: root,
    session_id: started.session.id,
    content: "Agent lifecycle should be MCP-first.",
  });
  const l1 = callTapheluTool("dl_memory_promote", {
    cwd: root,
    layer: "l1",
    type: "decision",
    confidence: "high",
    content: "Agent lifecycle is MCP-first.",
    source_ids: [observed.record.id],
  });
  const l2 = callTapheluTool("dl_memory_promote", {
    cwd: root,
    layer: "l2",
    title: "Lifecycle correction",
    content: "Workflow direction was corrected toward agent-native MCP lifecycle.",
    source_ids: [observed.record.id],
    memory_ids: [l1.memory.id],
  });
  const l3 = callTapheluTool("dl_memory_promote", {
    cwd: root,
    layer: "l3",
    key: "agent_direction",
    content: "Primary agent interface is MCP lifecycle tools.",
    source_ids: [l1.memory.id],
    mirror: true,
  });
  const recalled = callTapheluTool("dl_recall", { cwd: root, query: "MCP lifecycle" });
  const memory = readFileSync(join(root, ".projects", "MEMORY.md"), "utf8");

  assert.match(l1.memory.id, /^l1_/);
  assert.match(l2.scene.id, /^l2_/);
  assert.equal(l3.profile.key, "agent_direction");
  assert.equal(recalled.memory.l1Memories[0].sourceIds[0], observed.record.id);
  assert.match(memory, /## Layered Memory Profile/);
  assert.match(memory, /agent_direction/);
});

test("unsafe observation is redacted in L0 and blocked from promotion", () => {
  const root = makeProject();
  const observed = callTapheluTool("dl_observe", {
    cwd: root,
    content: "{\\\"api_key\\\":\\\"my secret value\\\", \"token\": \"sk-abcdefghijklmnopqrstuvwxyz123456\"}",
  });
  const searched = callTapheluTool("dl_conversation_search", {
    cwd: root,
    query: "api_key",
  });

  assert.equal(observed.record.unsafe, 1);
  assert.doesNotMatch(searched.records[0].content, /my secret value/);
  assert.doesNotMatch(searched.records[0].content, /abcdefghijklmnopqrstuvwxyz123456/);
  assert.throws(() => callTapheluTool("dl_memory_promote", {
    cwd: root,
    layer: "l1",
    content: "api_key=abc123",
    source_ids: [observed.record.id],
  }), /cannot be promoted/);
});

test("dl_close blocks without verification evidence", () => {
  const root = makeProject();
  const started = callTapheluTool("dl_start", { cwd: root, goal: "Close gate." });
  const closed = callTapheluTool("dl_close", {
    cwd: root,
    session_id: started.session.id,
    goal: "Close gate.",
  });

  assert.equal(closed.closed, false);
  assert.equal(closed.verification.verdict, "BLOCKED");
  assert.match(closed.record.source, /close_blocked/);
});

test("dl_close records passing verification and closes session", () => {
  const root = makeProject();
  const started = callTapheluTool("dl_start", { cwd: root, goal: "Close pass." });
  const closed = callTapheluTool("dl_close", {
    cwd: root,
    session_id: started.session.id,
    goal: "Close pass.",
    artifact: ["src/mcp/tools.mjs"],
    test: ["npm test"],
    review_trigger: ["runtime command behavior change"],
    review_evidence: ["Peer review ready."],
  });
  const events = readFileSync(join(root, ".projects", "events.jsonl"), "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));

  assert.equal(closed.closed, true);
  assert.equal(closed.verification.verdict, "PASS_WITH_NOTES");
  assert.ok(closed.cleanupRecommendation);
  assert.equal(events.at(-1).type, "verification_completed");
});

test("cleanup context previews and writes compact project files", () => {
  const root = makeProject();
  appendFileSync(join(root, ".projects", "STATE.md"), `
## Notes

First paragraph.

Second paragraph.
`);
  const runsPath = join(root, ".projects", "RUNS.md");
  appendFileSync(runsPath, `| run-old | 2026-01-01 | Old | done |
| run-mid | 2026-01-02 | Middle | done |
| run-new | 2026-01-03 | New | done |

## run-old

Goal: Old.

${Array.from({ length: 80 }, (_, index) => `Line ${index}`).join("\n")}

## run-mid

Goal: Middle.

## run-new

Goal: New.
`);
  writeFileSync(join(root, ".projects", "MEMORY.md"), `# Memory

## Product Decisions

${Array.from({ length: 25 }, (_, index) => `- Decision ${index + 1}`).join("\n")}
`);
  const preview = run(root, ["cleanup", "context", "--limit", "1"]);
  const before = readFileSync(runsPath, "utf8");
  const write = run(root, ["cleanup", "context", "--limit", "1", "--write"]);
  const state = readFileSync(join(root, ".projects", "STATE.md"), "utf8");
  const after = readFileSync(runsPath, "utf8");
  const memory = readFileSync(join(root, ".projects", "MEMORY.md"), "utf8");
  const events = readFileSync(join(root, ".projects", "events.jsonl"), "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));

  assert.equal(preview.status, 0, preview.stderr);
  assert.match(preview.stdout, /preview/);
  assert.match(preview.stdout, /Add `--write`/);
  assert.equal(before.includes("Line 79"), true);
  assert.equal(write.status, 0, write.stderr);
  assert.match(state, /## Notes/);
  assert.match(state, /First paragraph\.\n\nSecond paragraph\./);
  assert.equal(after.includes("Line 79"), false);
  assert.equal(after.includes("run-old"), false);
  assert.equal(after.includes("run-new"), true);
  assert.doesNotMatch(memory, /^- Decision 1$/m);
  assert.match(memory, /^- Decision 25$/m);
  assert.equal(events.at(-1).type, "context_cleaned");
});

test("mcp cleanup context previews without raw file contents", () => {
  const root = makeProject();
  const result = callTapheluTool("dl_cleanup_context", { cwd: root, limit: 2 });

  assert.equal(result.wrote, false);
  assert.ok(result.report.files.some((file) => file.name === "STATE.md"));
  assert.equal("after" in result.report.files[0], false);
});

test("context index previews and writes compact artifact index", () => {
  const root = makeProject();
  writeFileSync(join(root, ".projects", "ROADMAP.md"), "# Roadmap\n\nMilestone context store.\n");
  writeFileSync(join(root, ".projects", "RAW.md"), "# Raw\n\napi_key=should-not-index-value\n");
  mkdirSync(join(root, ".projects", "nested"));
  writeFileSync(join(root, ".projects", "nested", "config.json"), "{\n  \"title\": \"Nested config artifact\"\n}\n");
  const preview = run(root, ["context", "index"]);
  const previewWroteContext = existsSync(join(root, ".projects", "CONTEXT.md"));
  const write = run(root, ["context", "index", "--write"]);
  const context = readFileSync(join(root, ".projects", "CONTEXT.md"), "utf8");
  const index = JSON.parse(readFileSync(join(root, ".projects", "index.json"), "utf8"));
  const events = readFileSync(join(root, ".projects", "events.jsonl"), "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));

  assert.equal(preview.status, 0, preview.stderr);
  assert.match(preview.stdout, /# Context Index Report/);
  assert.equal(previewWroteContext, false);
  assert.equal(write.status, 0, write.stderr);
  assert.match(context, /## Load Policy/);
  assert.match(context, /dl context search/);
  assert.doesNotMatch(context, /## Current State/);
  assert.doesNotMatch(context, /Run CLI tests/);
  assert.match(context, /`roadmap:roadmap-md`: Roadmap/);
  assert.equal(index.schemaVersion, 1);
  const roadmap = index.artifacts.find((artifact) => artifact.id === "roadmap:roadmap-md");
  assert.equal(roadmap.lifecycle, "reference");
  assert.match(roadmap.fingerprint, /^[a-f0-9]{16}$/);
  assert.ok(index.artifacts.some((artifact) => artifact.id === "artifact:nested-config-json"));
  assert.doesNotMatch(JSON.stringify(index), /should-not-index-value/);
  assert.equal(events.at(-1).type, "context_indexed");
});

test("context search and get load only selected artifacts", () => {
  const root = makeProject();
  writeFileSync(join(root, ".projects", "ROADMAP.md"), "# Roadmap\n\nLine two.\nMilestone context store search target.\nLine four.\n");
  const indexed = run(root, ["context", "index", "--write"]);
  const search = run(root, ["context", "search", "context store"]);
  const get = run(root, ["context", "get", "roadmap:roadmap-md"]);
  const ranged = run(root, ["context", "get", "roadmap:roadmap-md", "--start-line", "4", "--end-line", "4"]);

  assert.equal(indexed.status, 0, indexed.stderr);
  assert.equal(search.status, 0, search.stderr);
  assert.match(search.stdout, /roadmap:roadmap-md/);
  assert.equal(get.status, 0, get.stderr);
  assert.match(get.stdout, /# Context Artifact/);
  assert.match(get.stdout, /Milestone context store search target/);
  assert.equal(ranged.status, 0, ranged.stderr);
  assert.match(ranged.stdout, /## Lines/);
  assert.match(ranged.stdout, /4-4/);
  assert.match(ranged.stdout, /Milestone context store search target/);
  const rangedContent = ranged.stdout.match(/```markdown\n([\s\S]*?)\n```/)?.[1];
  assert.equal(rangedContent, "Milestone context store search target.");
});

test("compact milestone writes summary and refreshes context index", () => {
  const root = makeProject();
  const result = run(root, ["compact", "milestone", "--id", "M24", "--write"]);
  const summary = readFileSync(join(root, ".projects", "milestones", "M24", "SUMMARY.md"), "utf8");
  const context = readFileSync(join(root, ".projects", "CONTEXT.md"), "utf8");
  const index = JSON.parse(readFileSync(join(root, ".projects", "index.json"), "utf8"));
  const events = readFileSync(join(root, ".projects", "events.jsonl"), "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));

  assert.equal(result.status, 0, result.stderr);
  assert.match(summary, /# Milestone M24 Summary/);
  assert.match(context, /milestone:M24/);
  assert.ok(index.artifacts.some((artifact) => artifact.id === "milestone:M24"));
  assert.equal(events.some((event) => event.type === "milestone_compacted"), true);
});

test("compact runs splits run history into indexed artifacts", () => {
  const root = makeProject();
  writeFileSync(join(root, ".projects", "RUNS.md"), `# Runs

Manual run preamble.

## Run Index

| Run ID | Date | Goal | Outcome |
|---|---|---|---|
| run-old | 2026-01-01 | Old | done |
| run-new | 2026-01-02 | New | done |

## run-old

Old detail line.

## run-new

New detail line.
`);
  const result = run(root, ["compact", "runs", "--keep", "1", "--write"]);
  const runs = readFileSync(join(root, ".projects", "RUNS.md"), "utf8");
  const runIndex = readFileSync(join(root, ".projects", "runs", "INDEX.md"), "utf8");
  const runOld = readFileSync(join(root, ".projects", "runs", "run-old.md"), "utf8");

  assert.equal(result.status, 0, result.stderr);
  assert.match(runs, /Manual run preamble/);
  assert.match(runs, /Run details are stored as indexed artifacts/);
  assert.doesNotMatch(runs, /Old detail line/);
  assert.match(runs, /run-new/);
  assert.doesNotMatch(runs, /run-old \| 2026/);
  assert.match(runIndex, /run-old/);
  assert.match(runOld, /Old detail line/);
});

test("compact runs can keep zero recent runs while preserving archived artifacts", () => {
  const root = makeProject();
  appendFileSync(join(root, ".projects", "RUNS.md"), `| run-old | 2026-01-01 | Old | done |

## run-old

Old detail line.
`);
  const result = run(root, ["compact", "runs", "--keep", "0", "--write"]);
  const runs = readFileSync(join(root, ".projects", "RUNS.md"), "utf8");
  const runOld = readFileSync(join(root, ".projects", "runs", "run-old.md"), "utf8");

  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(runs, /run-old \| 2026/);
  assert.match(runOld, /Old detail line/);
});

test("compact plan archives active plan artifact", () => {
  const root = makeProject();
  mkdirSync(join(root, ".projects", "active"), { recursive: true });
  writeFileSync(join(root, ".projects", "active", "PLAN.md"), "# Active Plan\n\nImplement context compaction.\n");
  const result = run(root, ["compact", "plan", "--write"]);
  const active = readFileSync(join(root, ".projects", "active", "PLAN.md"), "utf8");
  const archived = readdirSync(join(root, ".projects", "archive", "plans"));

  assert.equal(result.status, 0, result.stderr);
  assert.match(active, /No active plan/);
  assert.equal(archived.length, 1);
  assert.match(readFileSync(join(root, ".projects", "archive", "plans", archived[0]), "utf8"), /Implement context compaction/);
});

test("external-dir context store writes heavy artifacts outside .projects", () => {
  const root = makeProject();
  const external = join(root, "..", "taphelu-external-context");
  tempRoots.add(external);
  const setKind = run(root, ["config", "set", "context.store.kind", "external-dir"]);
  const setPath = run(root, ["config", "set", "context.store.path", external]);
  const result = run(root, ["compact", "milestone", "--id", "M25", "--write"]);
  const summaryPath = join(external, "milestones", "M25", "SUMMARY.md");
  const context = readFileSync(join(root, ".projects", "CONTEXT.md"), "utf8");

  assert.equal(setKind.status, 0, setKind.stderr);
  assert.equal(setPath.status, 0, setPath.stderr);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(existsSync(summaryPath), true);
  assert.match(context, /taphelu-external-context/);
});

test("git-submodule context store validates git path before writing", () => {
  const root = makeProject();
  const setKind = run(root, ["config", "set", "context.store.kind", "git-submodule"]);
  const setPath = run(root, ["config", "set", "context.store.path", "../missing-submodule"]);
  const result = run(root, ["context", "index", "--write"]);

  assert.equal(setKind.status, 0, setKind.stderr);
  assert.equal(setPath.status, 0, setPath.stderr);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Expected an existing git worktree or submodule path/);
});

test("mcp context store indexes, searches, gets, and previews compaction", () => {
  const root = makeProject();
  writeFileSync(join(root, ".projects", "ROADMAP.md"), "# Roadmap\n\nMCP context store artifact.\n");
  const indexed = callTapheluTool("dl_context_store", { cwd: root, action: "index", write: true });
  const searched = callTapheluTool("dl_context_store", { cwd: root, action: "search", query: "MCP context" });
  const got = callTapheluTool("dl_context_store", { cwd: root, action: "get", id: "roadmap:roadmap-md" });
  const ranged = callTapheluTool("dl_context_store", { cwd: root, action: "get", id: "roadmap:roadmap-md", start_line: 3, end_line: 3 });
  const compact = callTapheluTool("dl_context_store", { cwd: root, action: "compact", kind: "milestone", id: "M24" });
  const context = callTapheluTool("dl_context", { cwd: root });

  assert.equal(indexed.wrote, true);
  assert.ok(searched.report.results.some((artifact) => artifact.id === "roadmap:roadmap-md"));
  assert.match(got.report.content, /MCP context store artifact/);
  assert.equal(ranged.report.lineRange.start, 3);
  assert.equal(compact.wrote, false);
  assert.ok(context.contextArtifacts.some((artifact) => artifact.id === "roadmap:roadmap-md"));
  assert.doesNotMatch(JSON.stringify(context), /## run-/);
});

test("mcp tools/call wraps structured handler result", async () => {
  const root = makeProject();
  const response = await handleMcpMessage({
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: {
      name: "dl_start",
      arguments: { cwd: root, goal: "MCP call." },
    },
  }, root);

  assert.equal(response.result.isError, false);
  assert.equal(response.result.structuredContent.session.goal, "MCP call.");
  assert.match(response.result.content[0].text, /MCP call/);
});

test("ask routes specific artifact work to plan", () => {
  const root = makeProject();
  const result = run(root, [
    "ask",
    "Create STATE.md, MEMORY.md, RUNS.md, and events.jsonl from the roadmap.",
  ]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /# Requirement Packet/);
  assert.match(result.stdout, /Ambiguity level: low/);
  assert.match(result.stdout, /`plan`/);
});

test("ask blocks unsafe broad browser automation", () => {
  const root = makeProject();
  const result = run(root, ["ask", "Automate this website"]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Ambiguity level: high/);
  assert.match(result.stdout, /No safe assumptions/);
  assert.match(result.stdout, /`blocked`/);
});

test("ask does not block ordinary website content edits", () => {
  const root = makeProject();
  const result = run(root, ["ask", "Update the website footer text."]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /# Requirement Packet/);
  assert.doesNotMatch(result.stdout, /No safe assumptions/);
  assert.match(result.stdout, /`plan`/);
});

test("research blocks unsupported claims", () => {
  const root = makeProject();
  const result = run(root, ["research", "What is the current API behavior?"]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /No sources recorded/);
  assert.match(result.stdout, /No findings recorded/);
  assert.match(result.stdout, /`blocked`/);
});

test("research routes sourced findings to plan", () => {
  const root = makeProject();
  const result = run(root, [
    "research",
    "--source",
    ".projects/PROJECT.md",
    "--finding",
    "The project file exists.",
    "--confidence",
    "medium",
    "How should research be recorded?",
  ]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /# Research Packet/);
  assert.match(result.stdout, /The project file exists/);
  assert.match(result.stdout, /`plan`/);
});

test("plan includes task-level verification", () => {
  const root = makeProject();
  const result = run(root, [
    "plan",
    "--task",
    "Create PLANNING-WORKFLOW.md",
    "--verification",
    "File exists and includes command contract.",
    "--owner",
    "taphelu-dev",
    "--boundary",
    "contract",
    "--testability",
    "artifact-check",
    "Define the planning workflow.",
  ]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /# Plan Packet/);
  assert.match(result.stdout, /Create PLANNING-WORKFLOW\.md/);
  assert.match(result.stdout, /File exists and includes command contract/);
  assert.match(result.stdout, /## QA Testability Gate/);
  assert.match(result.stdout, /taphelu-dev/);
  assert.match(result.stdout, /artifact-check/);
  assert.match(result.stdout, /`execute`/);
});

test("flag values may start with dashes when supplied as values", () => {
  const root = makeProject();
  const result = run(root, [
    "plan",
    "--task",
    "--document flag-like input",
    "Plan flag-like task.",
  ]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /--document flag-like input/);
});

test("plan applies deep testing strictness to changed logic", () => {
  const root = makeProject();
  const set = run(root, ["config", "set", "testing.strictness", "deep"]);
  const result = run(root, [
    "plan",
    "--task",
    "Update MCP command parser.",
    "Plan parser change.",
  ]);

  assert.equal(set.status, 0, set.stderr);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /## Testing Strictness/);
  assert.match(result.stdout, /`deep`/);
  assert.match(result.stdout, /unit/);
  assert.match(result.stdout, /Deep strictness/);
});

test("verify reports a verdict from artifacts and tests", () => {
  const root = makeProject();
  const result = run(root, [
    "verify",
    "--artifact",
    "src/commands/verify.mjs",
    "--test",
    "npm test",
    "--testing-strictness",
    "medium",
    "--testability",
    "T1: integration",
    "--required-evidence",
    "T1: npm test",
    "--skipped-test-rationale",
    "No unit test because CLI smoke covers this glue path.",
    "Validate verification workflow.",
  ]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /# Verification Report/);
  assert.match(result.stdout, /## Verdict/);
  assert.match(result.stdout, /## Testing Policy/);
  assert.match(result.stdout, /T1: integration/);
  assert.match(result.stdout, /`PASS_WITH_NOTES`/);
  assert.match(result.stdout, /`done`/);
});

test("verify blocks review triggers without review evidence", () => {
  const root = makeProject();
  const result = run(root, [
    "verify",
    "--artifact",
    "src/commands/verify.mjs",
    "--test",
    "npm test",
    "--testing-strictness",
    "medium",
    "--testability",
    "T1: integration",
    "--required-evidence",
    "T1: npm test",
    "--review-trigger",
    "large diff",
    "Validate risky workflow.",
  ]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Review trigger is present/);
  assert.match(result.stdout, /`BLOCKED`/);
});

test("verify write records verdict in events, state, and runs", () => {
  const root = makeProject();
  const result = run(root, [
    "verify",
    "--write",
    "--artifact",
    "STATE.md",
    "--artifact",
    "RUNS.md",
    "--test",
    "npm test",
    "--testing-strictness",
    "medium",
    "--testability",
    "T1: integration",
    "--required-evidence",
    "T1: npm test",
    "--review-trigger",
    "large diff",
    "--reviewed",
    "Close Milestone 10.",
  ]);

  assert.equal(result.status, 0, result.stderr);

  const events = readFileSync(join(root, ".projects", "events.jsonl"), "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  const state = readFileSync(join(root, ".projects", "STATE.md"), "utf8");
  const runs = readFileSync(join(root, ".projects", "RUNS.md"), "utf8");

  assert.equal(events.at(-1).type, "verification_completed");
  assert.equal(events.at(-1).data.verdict, "PASS_WITH_NOTES");
  assert.equal(events.at(-1).data.testing_strictness, "medium");
  assert.deepEqual(events.at(-1).data.testability_review, ["T1: integration"]);
  assert.match(state, /dl verify/);
  assert.match(runs, /Close Milestone 10/);
});

test("verify write preserves useful next action unless explicitly overridden", () => {
  const root = makeProject();
  const preserved = run(root, [
    "verify",
    "--write",
    "--artifact",
    "STATE.md",
    "--test",
    "npm test",
    "Keep current follow-up.",
  ]);
  let state = readFileSync(join(root, ".projects", "STATE.md"), "utf8");

  assert.equal(preserved.status, 0, preserved.stderr);
  assert.match(state, /## Next Action\n\nRun CLI tests\./);

  const overridden = run(root, [
    "verify",
    "--write",
    "--artifact",
    "STATE.md",
    "--test",
    "npm test",
    "--next-action",
    "Recruit beta testers.",
    "Override follow-up.",
  ]);
  state = readFileSync(join(root, ".projects", "STATE.md"), "utf8");

  assert.equal(overridden.status, 0, overridden.stderr);
  assert.match(state, /## Next Action\n\nRecruit beta testers\./);
});

test("run completes an end-to-end packet from requirement to plan", () => {
  const root = makeProject();
  const result = run(root, [
    "run",
    "--source",
    ".projects/PROJECT.md",
    "--finding",
    "The project has a local context root.",
    "--task",
    "Execute a minimal workflow run.",
    "--verification",
    "Run packet reaches completed lifecycle.",
    "Run an end-to-end workflow check.",
  ]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /# Run Packet/);
  assert.match(result.stdout, /Lifecycle State/);
  assert.match(result.stdout, /`completed`/);
  assert.match(result.stdout, /Verification Verdict/);
  assert.match(result.stdout, /Run packet reaches completed lifecycle/);
});

test("run blocks research goals without source-grounded findings", () => {
  const root = makeProject();
  const result = run(root, ["run", "Research current API docs."]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /# Run Packet/);
  assert.match(result.stdout, /Research evidence is incomplete/);
  assert.match(result.stdout, /`blocked`/);
});

test("run blocks approval-sensitive plans without approval gate", () => {
  const root = makeProject();
  const result = run(root, [
    "run",
    "--approval-scope",
    "browser research on local app for this test",
    "--source",
    ".projects/PROJECT.md",
    "--finding",
    "The project has a local context root.",
    "Implement browser verification workflow.",
  ]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Plan is blocked by a missing approval gate/);
  assert.match(result.stdout, /`blocked`/);
});

test("run completes approval-sensitive plans with approval gate", () => {
  const root = makeProject();
  const result = run(root, [
    "run",
    "--approval-scope",
    "browser research on local app for this test",
    "--approval-gate",
    "Browser use approved for this test.",
    "--source",
    ".projects/PROJECT.md",
    "--finding",
    "The project has a local context root.",
    "Implement browser verification workflow.",
  ]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /# Run Packet/);
  assert.match(result.stdout, /`completed`/);
});

test("write flags append valid JSONL events", () => {
  const root = makeProject();
  const ask = run(root, ["ask", "--write", "Create a packet."]);
  const research = run(root, [
    "research",
    "--write",
    "--source",
    ".projects/PROJECT.md",
    "--finding",
    "The project file exists.",
    "Record evidence.",
  ]);
  const plan = run(root, ["plan", "--write", "Create a plan."]);

  assert.equal(ask.status, 0, ask.stderr);
  assert.equal(research.status, 0, research.stderr);
  assert.equal(plan.status, 0, plan.stderr);

  const lines = readFileSync(join(root, ".projects", "events.jsonl"), "utf8")
    .trim()
    .split("\n")
    .filter(Boolean);
  const events = lines.map((line) => JSON.parse(line));

  assert.equal(events.length, 4);
  assert.deepEqual(events.map((event) => event.type), [
    "goal_received",
    "requirement_packet_created",
    "research_recorded",
    "plan_created",
  ]);
});

test("write refuses secrets before appending events", () => {
  const root = makeProject();
  const result = run(root, ["ask", "--write", "Use api_key=abc123 to call a service."]);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Refusing to write event/);

  const events = readFileSync(join(root, ".projects", "events.jsonl"), "utf8");
  assert.equal(events.trim(), "");
});

test("run write records events and updates resumable files", () => {
  const root = makeProject();
  const result = run(root, [
    "run",
    "--write",
    "--task",
    "Create a resumable run packet.",
    "--verification",
    "STATE.md and RUNS.md capture the run.",
    "Create a resumable run.",
  ]);

  assert.equal(result.status, 0, result.stderr);

  const events = readFileSync(join(root, ".projects", "events.jsonl"), "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  assert.deepEqual(events.map((event) => event.type), [
    "run_started",
    "goal_received",
    "requirement_packet_created",
    "plan_created",
    "verification_completed",
    "run_closed",
  ]);

  const state = readFileSync(join(root, ".projects", "STATE.md"), "utf8");
  const runs = readFileSync(join(root, ".projects", "RUNS.md"), "utf8");
  assert.match(state, /Create a resumable run/);
  assert.match(state, /dl run/);
  assert.match(runs, /Create a resumable run packet/);
  assert.match(runs, /Completed/);
});

test("run write updates compact state headings and recreates missing sections", () => {
  const root = makeProject();
  writeFileSync(join(root, ".projects", "STATE.md"), `# State

## Current Goal
Old goal.

## Current Milestone
Old milestone.

## Next Action
Old next action.
`);

  const result = run(root, [
    "run",
    "--write",
    "--task",
    "Update flexible state sections.",
    "--verification",
    "STATE.md has refreshed sections.",
    "Refresh state from a run.",
  ]);

  assert.equal(result.status, 0, result.stderr);

  const state = readFileSync(join(root, ".projects", "STATE.md"), "utf8");
  assert.match(state, /## Current Goal\n\nRefresh state from a run\./);
  assert.match(state, /## Current Phase\n\n/);
  assert.match(state, /## Blockers\n\nNone\./);
  assert.match(state, /## Last Verification\n\n/);
});

test("run resume uses recorded project state", () => {
  const root = makeProject();
  const result = run(root, ["run", "--resume", "run-test"]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /# Resume Packet/);
  assert.match(result.stdout, /run-test/);
  assert.match(result.stdout, /Test goal/);
  assert.match(result.stdout, /`resume`/);
});

test("memory summarizes selected categories", () => {
  const root = makeProject();
  const result = run(root, ["memory", "--category", "repo_facts"]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /# Memory Overview/);
  assert.match(result.stdout, /`repo_facts`/);
  assert.match(result.stdout, /Existing repo fact/);
});

test("remember writes durable memory and event", () => {
  const root = makeProject();
  const result = run(root, [
    "remember",
    "--write",
    "--category",
    "reusable_lessons",
    "--source",
    ".projects/MEMORY-WORKFLOW.md",
    "Keep memory entries short and durable.",
  ]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /# Remember Packet/);
  assert.match(result.stdout, /`write`/);

  const memory = readFileSync(join(root, ".projects", "MEMORY.md"), "utf8");
  const events = readFileSync(join(root, ".projects", "events.jsonl"), "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));

  assert.match(memory, /Keep memory entries short and durable/);
  assert.equal(events.at(-1).type, "memory_recorded");
});

test("remember replaces conflicting memory", () => {
  const root = makeProject();
  const result = run(root, [
    "remember",
    "--write",
    "--category",
    "repo_facts",
    "--replace",
    "Existing repo fact.",
    "Updated repo fact.",
  ]);

  assert.equal(result.status, 0, result.stderr);

  const memory = readFileSync(join(root, ".projects", "MEMORY.md"), "utf8");
  assert.doesNotMatch(memory, /Existing repo fact/);
  assert.match(memory, /Updated repo fact/);
});

test("remember blocks sensitive memory", () => {
  const root = makeProject();
  const result = run(root, [
    "remember",
    "--write",
    "--category",
    "repo_facts",
    "api_key=abc123",
  ]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /`blocked`/);

  const memory = readFileSync(join(root, ".projects", "MEMORY.md"), "utf8");
  const events = readFileSync(join(root, ".projects", "events.jsonl"), "utf8");
  assert.doesNotMatch(memory, /abc123/);
  assert.equal(events.trim(), "");
});

test("forget removes memory by pattern", () => {
  const root = makeProject();
  const result = run(root, [
    "forget",
    "--write",
    "--category",
    "repo_facts",
    "--pattern",
    "Existing",
  ]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Existing repo fact/);

  const memory = readFileSync(join(root, ".projects", "MEMORY.md"), "utf8");
  assert.doesNotMatch(memory, /Existing repo fact/);
});

test("memory prune removes duplicate bullets", () => {
  const root = makeProject();
  const before = readFileSync(join(root, ".projects", "MEMORY.md"), "utf8").length;
  const result = run(root, ["memory", "--prune", "--write", "--category", "reusable_lessons"]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Removed: 1/);

  const memory = readFileSync(join(root, ".projects", "MEMORY.md"), "utf8");
  const after = memory.length;
  assert.ok(after < before);
  assert.equal((memory.match(/Duplicate lesson/g) ?? []).length, 1);
});

test("browser research blocks without permission", () => {
  const root = makeProject();
  const result = run(root, [
    "browser",
    "research",
    "--url",
    "http://localhost:3000",
    "--observation",
    "The page renders.",
    "Can the page render?",
  ]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /# Browser Research Packet/);
  assert.match(result.stdout, /requires explicit task or session permission/);
  assert.match(result.stdout, /`blocked`/);
});

test("browser research writes summarized observation events", () => {
  const root = makeProject();
  const result = run(root, [
    "browser",
    "research",
    "--write",
    "--approval-scope",
    "browser research on local app for this test",
    "--url",
    "http://localhost:3000",
    "--purpose",
    "Inspect visible shell",
    "--action",
    "Open page",
    "--observation",
    "The page renders the expected shell.",
    "--evidence",
    ".projects/artifacts/shell.png",
    "Can the page render?",
  ]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /`plan`/);

  const events = readFileSync(join(root, ".projects", "events.jsonl"), "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  assert.equal(events.at(-1).type, "browser_research_recorded");
  assert.equal(events.at(-1).data.evidence_path, ".projects/artifacts/shell.png");
});

test("browser research rejects raw page content", () => {
  const root = makeProject();
  const result = run(root, [
    "browser",
    "research",
    "--write",
    "--approval-scope",
    "browser research on local app for this test",
    "--url",
    "http://localhost:3000",
    "--observation",
    "<html><body>raw page</body></html>",
    "Can the page render?",
  ]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /raw browser content/);
  assert.match(result.stdout, /`blocked`/);

  const events = readFileSync(join(root, ".projects", "events.jsonl"), "utf8");
  assert.equal(events.trim(), "");
});

test("browser verify passes with permission and user-visible result", () => {
  const root = makeProject();
  const result = run(root, [
    "browser",
    "verify",
    "--write",
    "--approval-scope",
    "browser E2E on local app for this test",
    "--url",
    "http://localhost:3000",
    "--precondition",
    "Dev server is running.",
    "--step",
    "Open page",
    "--expected",
    "Expected shell is visible.",
    "--actual",
    "Expected shell is visible.",
    "--result",
    "pass",
    "--evidence",
    ".projects/artifacts/e2e.png",
    "Local smoke flow",
  ]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /# Browser Verification Report/);
  assert.match(result.stdout, /`done`/);

  const events = readFileSync(join(root, ".projects", "events.jsonl"), "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  assert.equal(events.at(-1).type, "browser_verification_recorded");
  assert.equal(events.at(-1).data.result, "pass");
});

test("browser verify failed result blocks done", () => {
  const root = makeProject();
  const result = run(root, [
    "browser",
    "verify",
    "--approval-scope",
    "browser E2E on local app for this test",
    "--url",
    "http://localhost:3000",
    "--step",
    "Open page",
    "--expected",
    "Expected shell is visible.",
    "--actual",
    "Blank page.",
    "--result",
    "fail",
    "Local smoke flow",
  ]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Failed browser verification blocks done/);
  assert.match(result.stdout, /`blocked`/);
});

test("import bmad handles missing optional files gracefully", () => {
  const root = makeProject();
  makeBmadFixture(root, { minimal: true });
  const result = run(root, ["import", "bmad"]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /# BMAD Import Report/);
  assert.match(result.stdout, /Imported Product/);
  assert.match(result.stdout, /No epic artifacts discovered/);
  assert.match(result.stdout, /`continue`/);
});

test("scan previews an existing project without requiring .projects", () => {
  const root = makePlainRepo();
  const result = run(root, ["scan", "--path", ".", "--mode", "quick"]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /# Project Scan Report/);
  assert.match(result.stdout, /preview/);
  assert.match(result.stdout, /package\.json/);
  assert.match(result.stdout, /npm test/);
  assert.equal(existsSync(join(root, ".projects")), false);
});

test("scan respects .gitignore and .agentignore", () => {
  const root = makePlainRepo();
  mkdirSync(join(root, "ignored-dir"), { recursive: true });
  writeFileSync(join(root, ".gitignore"), "ignored.js\nignored-dir/\n*.[oa]\n");
  writeFileSync(join(root, ".agentignore"), "agent-secret.md\n");
  writeFileSync(join(root, "ignored.js"), "console.log('ignored');\n");
  writeFileSync(join(root, "temp.o"), "ignored object\n");
  writeFileSync(join(root, "ignored-dir", "nested.js"), "console.log('ignored');\n");
  writeFileSync(join(root, "agent-secret.md"), "# should not scan\n");
  writeFileSync(join(root, "src", ".gitignore"), "nested/\n");
  mkdirSync(join(root, "src", "nested"), { recursive: true });
  writeFileSync(join(root, "src", "nested", "package.json"), JSON.stringify({ name: "ignored-nested" }));
  const result = run(root, ["scan", "--mode", "deep"]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Ignore files: \.gitignore, \.agentignore, src\/\.gitignore/);
  assert.doesNotMatch(result.stdout, /ignored\.js/);
  assert.doesNotMatch(result.stdout, /temp\.o/);
  assert.doesNotMatch(result.stdout, /ignored-dir/);
  assert.doesNotMatch(result.stdout, /agent-secret\.md/);
  assert.doesNotMatch(result.stdout, /src\/nested\/package\.json/);
});

test("scan write bootstraps project context only under .projects", () => {
  const root = makePlainRepo();
  const result = run(root, ["scan", "--path", ".", "--mode", "standard", "--write"]);
  const codebase = readFileSync(join(root, ".projects", "CODEBASE.md"), "utf8");
  const project = readFileSync(join(root, ".projects", "PROJECT.md"), "utf8");
  const state = readFileSync(join(root, ".projects", "STATE.md"), "utf8");
  const events = readFileSync(join(root, ".projects", "events.jsonl"), "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));

  assert.equal(result.status, 0, result.stderr);
  assert.match(codebase, /## Top-Level Directories/);
  assert.match(codebase, /src/);
  assert.match(codebase, /## Languages/);
  assert.match(codebase, /## Scripts/);
  assert.match(codebase, /build/);
  assert.match(codebase, /## Test Commands/);
  assert.match(project, /## Existing Project Scan/);
  assert.match(state, /Continue from existing project scan/);
  assert.equal(events.at(-1).type, "project_scanned");
  assert.equal(existsSync(join(root, "src", "index.js")), true);
  assert.equal(existsSync(join(root, "docs")), false);
});

test("scan interview works without .projects and asks targeted questions", () => {
  const root = makePlainRepo();
  const result = run(root, ["scan", "interview", "--path", ".", "--mode", "quick"]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /# Project Domain Interview/);
  assert.match(result.stdout, /What business\/domain does this project serve\?/);
  assert.match(result.stdout, /Who are the primary users/);
  assert.match(result.stdout, /Missing repo evidence/);
  assert.equal(existsSync(join(root, ".projects")), false);
});

test("scan interview records domain context with answer flags", () => {
  const root = makePlainRepo();
  const result = run(root, [
    "scan",
    "interview",
    "--domain",
    "Developer workflow tooling",
    "--user",
    "AI-assisted developer",
    "--core-flow",
    "Resume implementation work",
    "--objective",
    "onboarding",
    "--write",
  ]);
  const domain = readFileSync(join(root, ".projects", "DOMAIN.md"), "utf8");
  const events = readFileSync(join(root, ".projects", "events.jsonl"), "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /# Domain Context/);
  assert.match(domain, /Developer workflow tooling/);
  assert.match(domain, /AI-assisted developer/);
  assert.equal(existsSync(join(root, ".projects", "PROJECT.md")), true);
  assert.equal(events.at(-1).type, "domain_context_recorded");
});

test("scan plan emits parallel task packets", () => {
  const root = makePlainRepo();
  const result = run(root, ["scan", "plan", "--path", ".", "--mode", "quick"]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /# Deep Scan Plan/);
  assert.match(result.stdout, /### DS1 - stack/);
  assert.match(result.stdout, /### DS6 - concerns/);
  assert.match(result.stdout, /Parallel group: `1`/);
  assert.match(result.stdout, /Testability\/evidence class: `artifact-check`/);
  assert.equal(existsSync(join(root, ".projects")), false);
});

test("scan plan write creates scan plan and updates state", () => {
  const root = makePlainRepo();
  const result = run(root, ["scan", "plan", "--mode", "quick", "--write"]);
  const plan = readFileSync(join(root, ".projects", "SCAN-PLAN.md"), "utf8");
  const state = readFileSync(join(root, ".projects", "STATE.md"), "utf8");
  const events = readFileSync(join(root, ".projects", "events.jsonl"), "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));

  assert.equal(result.status, 0, result.stderr);
  assert.match(plan, /# Deep Scan Plan/);
  assert.match(state, /Deep scan plan created/);
  assert.equal(existsSync(join(root, ".projects", "PROJECT.md")), true);
  assert.equal(events.at(-1).type, "scan_plan_created");
});

test("large repo scan plan recommends parallel deep scan", () => {
  const root = makePlainRepo();
  for (let index = 0; index < 320; index += 1) {
    writeFileSync(join(root, "src", `file-${index}.js`), `export const value${index} = ${index};\n`);
  }
  const result = run(root, ["scan", "plan", "--mode", "quick"]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Large repo recommendation: yes; split work into parallel focus packets/);
});

test("api service scan plan adds services-contracts packet", () => {
  const root = makePlainRepo();
  writeFileSync(join(root, "docker-compose.yml"), "services:\n  api:\n    image: node:20\n");
  writeFileSync(join(root, "openapi.yaml"), "openapi: 3.0.0\ninfo:\n  title: Test\n  version: 1.0.0\npaths: {}\n");
  mkdirSync(join(root, "src", "routes"), { recursive: true });
  writeFileSync(join(root, "src", "routes", "users.js"), "export const routes = [];\n");
  const result = run(root, ["scan", "plan", "--mode", "quick"]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /services-contracts/);
  assert.match(result.stdout, /Docker Compose/);
  assert.match(result.stdout, /OpenAPI\/Swagger/);
});

test("scan map previews topology without requiring .projects", () => {
  const root = makePlainRepo();
  const result = run(root, ["scan", "map", "--path", ".", "--mode", "quick"]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /# Service Topology Report/);
  assert.match(result.stdout, /Services: 1/);
  assert.match(result.stdout, /svc-root/);
  assert.equal(existsSync(join(root, ".projects")), false);
});

test("scan focus alias maps services", () => {
  const root = makePlainRepo();
  const result = run(root, ["scan", "--focus", "services", "--mode", "quick"]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Focus: `services`/);
  assert.match(result.stdout, /## Services/);
  assert.doesNotMatch(result.stdout, /## Contracts/);
});

test("scan map write creates topology bundle", () => {
  const root = makePlainRepo();
  writeFileSync(join(root, "openapi.yaml"), "openapi: 3.0.0\ninfo:\n  title: Root API\n  version: 1.0.0\npaths: {}\n");
  const result = run(root, ["scan", "map", "--mode", "quick", "--write"]);
  const serviceMap = readFileSync(join(root, ".projects", "SERVICE-MAP.md"), "utf8");
  const apiContracts = readFileSync(join(root, ".projects", "API-CONTRACTS.md"), "utf8");
  const graphJson = JSON.parse(readFileSync(join(root, ".projects", "graphs", "service-graph.json"), "utf8"));
  const graphMermaid = readFileSync(join(root, ".projects", "graphs", "service-graph.mmd"), "utf8");
  const events = readFileSync(join(root, ".projects", "events.jsonl"), "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));

  assert.equal(result.status, 0, result.stderr);
  assert.match(serviceMap, /# Service Map/);
  assert.match(apiContracts, /openapi/);
  assert.equal(graphJson.schemaVersion, 1);
  assert.ok(graphJson.contracts.some((contract) => contract.protocol === "openapi"));
  assert.match(graphMermaid, /flowchart LR/);
  assert.equal(events.at(-1).type, "service_topology_mapped");
});

test("scan map detects workspace services and package dependency edges", () => {
  const root = makePlainRepo();
  mkdirSync(join(root, "apps", "web"), { recursive: true });
  mkdirSync(join(root, "services", "api"), { recursive: true });
  writeFileSync(join(root, "package.json"), JSON.stringify({ workspaces: ["apps/*", "services/*"] }, null, 2));
  writeFileSync(join(root, "apps", "web", "package.json"), JSON.stringify({
    name: "@demo/web",
    dependencies: { "@demo/api": "workspace:*" },
  }, null, 2));
  writeFileSync(join(root, "services", "api", "package.json"), JSON.stringify({ name: "@demo/api" }, null, 2));
  const result = run(root, ["scan", "map", "--mode", "quick"]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /apps\/web/);
  assert.match(result.stdout, /services\/api/);
  assert.match(result.stdout, /package_dependency/);
});

test("scan map detects compose depends_on edges", () => {
  const root = makePlainRepo();
  mkdirSync(join(root, "services", "api"), { recursive: true });
  mkdirSync(join(root, "services", "worker"), { recursive: true });
  writeFileSync(join(root, "services", "api", "package.json"), JSON.stringify({ name: "api" }));
  writeFileSync(join(root, "services", "worker", "package.json"), JSON.stringify({ name: "worker" }));
  writeFileSync(join(root, "docker-compose.yml"), "services:\n  worker:\n    depends_on:\n      - api\n  api:\n    image: node:20\n");
  const result = run(root, ["scan", "map", "--mode", "quick"]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /depends_on/);
  assert.match(result.stdout, /compose depends_on/);
  assert.match(result.stdout, /`high`/);
});

test("scan map detects contract source types", () => {
  const root = makePlainRepo();
  mkdirSync(join(root, "services", "api", "routes"), { recursive: true });
  writeFileSync(join(root, "services", "api", "package.json"), JSON.stringify({ name: "api" }));
  writeFileSync(join(root, "services", "api", "openapi.yaml"), "openapi: 3.0.0\ninfo:\n  title: API\n  version: 1.0.0\npaths: {}\n");
  writeFileSync(join(root, "services", "api", "schema.graphql"), "type Query { ok: Boolean }\n");
  writeFileSync(join(root, "services", "api", "service.proto"), "syntax = \"proto3\";\n");
  writeFileSync(join(root, "services", "api", "asyncapi.yaml"), "asyncapi: 2.0.0\ninfo:\n  title: Events\n  version: 1.0.0\n");
  writeFileSync(join(root, "services", "api", "routes", "users.js"), "export const users = [];\n");
  const result = run(root, ["scan", "map", "--focus", "contracts", "--mode", "quick"]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /openapi/);
  assert.match(result.stdout, /graphql/);
  assert.match(result.stdout, /protobuf\/grpc/);
  assert.match(result.stdout, /asyncapi/);
  assert.match(result.stdout, /rest/);
});

test("scan map respects ignore files and labels inferred edges", () => {
  const root = makePlainRepo();
  mkdirSync(join(root, "docs"), { recursive: true });
  writeFileSync(join(root, ".agentignore"), "ignored-openapi.yaml\n");
  writeFileSync(join(root, "ignored-openapi.yaml"), "openapi: 3.0.0\n");
  writeFileSync(join(root, "docs", "api-contract.md"), "# API contract notes\n");
  const result = run(root, ["scan", "map", "--mode", "quick"]);

  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stdout, /ignored-openapi/);
  assert.match(result.stdout, /docs\/api-contract\.md/);
  assert.match(result.stdout, /inferred/);
});

test("contracts init previews and writes registry layout", () => {
  const root = makePlainRepo();
  const preview = run(root, ["contracts", "init", "--path", ".projects/contracts"]);

  assert.equal(preview.status, 0, preview.stderr);
  assert.match(preview.stdout, /# Contract Registry Init/);
  assert.equal(existsSync(join(root, ".projects")), false);

  const written = run(root, ["contracts", "init", "--path", ".projects/contracts", "--write"]);
  const registry = JSON.parse(readFileSync(join(root, ".projects", "contracts", "registry.json"), "utf8"));
  const ignore = readFileSync(join(root, ".projects", "contracts", ".gitignore"), "utf8");
  const events = readFileSync(join(root, ".projects", "contracts", "events.jsonl"), "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));

  assert.equal(written.status, 0, written.stderr);
  assert.equal(registry.schemaVersion, 1);
  assert.match(ignore, /\.env/);
  assert.equal(existsSync(join(root, ".projects", "contracts", "services")), true);
  assert.equal(existsSync(join(root, ".projects", "contracts", "interactions")), true);
  assert.equal(existsSync(join(root, ".projects", "contracts", "channels", "kafka")), true);
  assert.equal(existsSync(join(root, ".projects", "contracts", "channels", "redis-pubsub")), true);
  assert.equal(existsSync(join(root, ".projects", "contracts", "graphs")), true);
  assert.equal(existsSync(join(root, ".projects", "PROJECT.md")), false);
  assert.equal(existsSync(join(root, ".projects", "STATE.md")), false);
  assert.equal(existsSync(join(root, ".projects", "MEMORY.md")), false);
  assert.equal(existsSync(join(root, ".projects", "CODEBASE.md")), false);
  assert.equal(existsSync(join(root, ".projects", "events.jsonl")), false);
  assert.equal(existsSync(join(root, ".taphelu")), false);
  assert.equal(events.at(-1).type, "contracts_initialized");
});

test("contracts init rejects unsafe remote values", () => {
  const root = makePlainRepo();
  const result = run(root, ["contracts", "init", "--remote", "--upload-pack=touch /tmp/nope", "--write"]);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Remote URL must not start/);
  assert.equal(existsSync(join(root, ".projects")), false);
});

test("contracts init rejects paths outside .projects", () => {
  const root = makePlainRepo();
  const result = run(root, ["contracts", "init", "--path", ".taphelu/contracts", "--write"]);
  const projectRoot = run(root, ["contracts", "init", "--path", ".projects", "--write"]);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Contracts path must stay under \.projects\//);
  assert.notEqual(projectRoot.status, 0);
  assert.match(projectRoot.stderr, /Contracts path must stay under \.projects\//);
  assert.equal(existsSync(join(root, ".taphelu")), false);
  assert.equal(existsSync(join(root, ".projects")), false);
});

test("contracts rootless commands resolve git root from subdirectories", () => {
  const root = makePlainRepo();
  mkdirSync(join(root, "nested"), { recursive: true });
  assert.equal(spawnSync("git", ["init"], { cwd: root, encoding: "utf8" }).status, 0);

  const result = spawnSync(process.execPath, [cliPath, "contracts", "init", "--write"], {
    cwd: join(root, "nested"),
    encoding: "utf8",
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(existsSync(join(root, ".projects", "contracts", "registry.json")), true);
  assert.equal(existsSync(join(root, "nested", ".projects")), false);
});

test("contracts link validates registry without writing root project files", () => {
  const root = makePlainRepo();
  const init = run(root, ["contracts", "init", "--write"]);
  const linked = run(root, ["contracts", "link", "--path", ".projects/contracts", "--write"]);
  const events = readFileSync(join(root, ".projects", "contracts", "events.jsonl"), "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));

  assert.equal(init.status, 0, init.stderr);
  assert.equal(linked.status, 0, linked.stderr);
  assert.equal(existsSync(join(root, ".projects", "CONTRACTS.md")), false);
  assert.equal(existsSync(join(root, ".projects", "PROJECT.md")), false);
  assert.equal(existsSync(join(root, ".projects", "STATE.md")), false);
  assert.equal(existsSync(join(root, ".projects", "MEMORY.md")), false);
  assert.equal(existsSync(join(root, ".projects", "events.jsonl")), false);
  assert.equal(events.at(-1).type, "contracts_linked");
});

test("contracts scan writes service metadata, copied specs, and graph without root context files", () => {
  const root = makePlainRepo();
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "@demo/billing-api", scripts: { test: "node --test" } }, null, 2));
  mkdirSync(join(root, "proto", "billing", "v1"), { recursive: true });
  mkdirSync(join(root, "openapi"), { recursive: true });
  mkdirSync(join(root, "graphql"), { recursive: true });
  writeFileSync(join(root, "proto", "billing", "v1", "billing.proto"), "syntax = \"proto3\";\n");
  writeFileSync(join(root, "openapi", "billing.yaml"), "openapi: 3.0.0\ninfo:\n  title: Billing\n  version: 1.0.0\npaths: {}\n");
  writeFileSync(join(root, "openapi", "notes.yaml"), "name: internal notes\n");
  writeFileSync(join(root, "graphql", "schema.graphql"), "type Query { invoice: String }\n");

  const init = run(root, ["contracts", "init", "--write"]);
  const scanned = run(root, ["contracts", "scan", "--path", ".", "--mode", "quick", "--write"]);
  const registry = JSON.parse(readFileSync(join(root, ".projects", "contracts", "registry.json"), "utf8"));
  const service = registry.services.find((item) => item.id === "demo-billing-api");
  const graph = JSON.parse(readFileSync(join(root, ".projects", "contracts", "graphs", "service-graph.json"), "utf8"));

  assert.equal(init.status, 0, init.stderr);
  assert.equal(scanned.status, 0, scanned.stderr);
  assert.ok(service);
  assert.ok(service.contracts.some((contract) => contract.protocol === "protobuf/grpc"));
  assert.ok(service.contracts.some((contract) => contract.protocol === "openapi"));
  assert.ok(!service.contracts.some((contract) => contract.source_path === "openapi/notes.yaml"));
  assert.ok(service.contracts.every((contract) => !contract.path.includes("src/index.js")));
  assert.equal(existsSync(join(root, ".projects", "contracts", "services", "demo-billing-api.yaml")), true);
  assert.ok(service.contracts.some((contract) => existsSync(join(root, ".projects", "contracts", contract.path))));
  assert.ok(graph.edges.some((edge) => edge.type === "exposes_contract"));
  assert.equal(existsSync(join(root, ".projects", "PROJECT.md")), false);
  assert.equal(existsSync(join(root, ".projects", "STATE.md")), false);
  assert.equal(existsSync(join(root, ".projects", "MEMORY.md")), false);
  assert.equal(existsSync(join(root, ".projects", "CODEBASE.md")), false);
  assert.equal(existsSync(join(root, ".projects", "events.jsonl")), false);
  assert.equal(existsSync(join(root, "docs")), false);
  assert.equal(existsSync(join(root, ".taphelu")), false);
});

test("context index includes contracts pointers when project context already exists", () => {
  const root = makeProject();
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "@demo/billing-api" }, null, 2));
  writeFileSync(join(root, "openapi.yaml"), "openapi: 3.0.0\ninfo:\n  title: Billing\n  version: 1.0.0\npaths: {}\n");

  assert.equal(run(root, ["contracts", "init", "--write"]).status, 0);
  assert.equal(run(root, ["contracts", "scan", "--path", ".", "--mode", "quick", "--write"]).status, 0);
  const index = run(root, ["context", "index", "--write"]);
  const contextIndex = JSON.parse(readFileSync(join(root, ".projects", "index.json"), "utf8"));

  assert.equal(index.status, 0, index.stderr);
  assert.ok(contextIndex.artifacts.some((artifact) => artifact.type === "contract" && artifact.path.includes(".projects/contracts")));
  assert.ok(!contextIndex.artifacts.some((artifact) => artifact.path.endsWith("events.jsonl")));
});

test("contracts scan imports service interactions and maps messaging edges", () => {
  const root = makePlainRepo();
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "@demo/billing-api", dependencies: { kafkajs: "^2.0.0" } }, null, 2));
  mkdirSync(join(root, "asyncapi"), { recursive: true });
  writeFileSync(join(root, "asyncapi", "events.yaml"), `asyncapi: 2.0.0
servers:
  production:
    protocol: kafka
channels:
  invoice.approved:
    publish:
      message:
        name: InvoiceApproved
  ledger.updated:
    subscribe:
      message:
        name: LedgerUpdated
`);
  writeFileSync(join(root, "taphelu-interactions.json"), JSON.stringify({
    provides: [
      { kind: "pubsub", protocol: "redis-pubsub", name: "billing.invalidate", confidence: "high" },
      { kind: "event-stream", protocol: "redis-stream", name: "billing.stream", confidence: "high" },
    ],
    consumes: [
      { kind: "queue", protocol: "sqs", name: "ledger-export", provider_service: "ledger-worker", confidence: "high" },
      { kind: "event-stream", protocol: "redis-stream", name: "ledger.stream", provider_service: "ledger-worker", confidence: "high" },
    ],
  }, null, 2));

  assert.equal(run(root, ["contracts", "init", "--write"]).status, 0);
  const scanned = run(root, ["contracts", "scan", "--path", ".", "--mode", "quick", "--write"]);
  const registry = JSON.parse(readFileSync(join(root, ".projects", "contracts", "registry.json"), "utf8"));
  const service = registry.services.find((item) => item.id === "demo-billing-api");
  const graph = JSON.parse(readFileSync(join(root, ".projects", "contracts", "graphs", "service-graph.json"), "utf8"));
  const interactions = readFileSync(join(root, ".projects", "contracts", "interactions", "demo-billing-api.yaml"), "utf8");

  assert.equal(scanned.status, 0, scanned.stderr);
  assert.ok(service.provides.some((item) => item.protocol === "kafka" && item.name === "invoice.approved"));
  assert.ok(service.provides.some((item) => item.protocol === "redis-pubsub" && item.name === "billing.invalidate"));
  assert.ok(service.provides.some((item) => item.protocol === "redis-stream" && item.name === "billing.stream"));
  assert.ok(service.consumes.some((item) => item.protocol === "kafka" && item.name === "ledger.updated"));
  assert.ok(service.consumes.some((item) => item.protocol === "sqs" && item.name === "ledger-export"));
  assert.ok(service.consumes.some((item) => item.protocol === "redis-stream" && item.name === "ledger.stream"));
  assert.ok(service.depends_on.includes("ledger-worker"));
  assert.match(interactions, /billing.invalidate/);
  assert.ok(graph.interactions.some((item) => item.name === "invoice.approved"));
  assert.ok(graph.edges.some((edge) => edge.type === "publishes_to"));
  assert.ok(graph.edges.some((edge) => edge.type === "subscribes_to"));
  assert.ok(graph.edges.some((edge) => edge.type === "uses_cache_channel"));
  assert.ok(graph.edges.some((edge) => edge.type === "consumes_queue"));
  assert.ok(graph.edges.some((edge) => edge.type === "writes_stream"));
  assert.ok(graph.edges.some((edge) => edge.type === "reads_stream"));
});

test("contracts current and deps return current service dependency slice", () => {
  const root = makePlainRepo();
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "@demo/billing-api" }, null, 2));
  assert.equal(run(root, ["contracts", "init", "--write"]).status, 0);
  const registryPath = join(root, ".projects", "contracts", "registry.json");
  const registry = JSON.parse(readFileSync(registryPath, "utf8"));
  registry.services = [
    { id: "demo-billing-api", name: "Billing API", repo: "", root: ".", runtime: { language: "node" }, contracts: [], provides: [], consumes: [{ id: "demo-billing-api.consumes.kafka.identity-events", kind: "event-stream", protocol: "kafka", name: "identity.events", direction: "consumes", owner_service: "demo-billing-api", provider_service: "identity-api", consumer_services: [], confidence: "high", evidence: ["services/billing-api.yaml"] }], depends_on: ["identity-api"] },
    { id: "identity-api", name: "Identity API", repo: "", root: ".", runtime: { language: "node" }, contracts: [], provides: [{ id: "identity-api.provides.kafka.identity-events", kind: "event-stream", protocol: "kafka", name: "identity.events", direction: "provides", owner_service: "identity-api", provider_service: "identity-api", consumer_services: ["demo-billing-api"], confidence: "high", evidence: ["services/identity-api.yaml"] }], consumes: [], depends_on: [] },
  ];
  registry.interactions = [...registry.services[0].consumes, ...registry.services[1].provides];
  writeFileSync(registryPath, `${JSON.stringify(registry, null, 2)}\n`);

  const current = run(root, ["contracts", "current", "--path", "."]);
  const deps = run(root, ["contracts", "deps", "--service", "demo-billing-api", "--direction", "outbound"]);
  const inbound = run(root, ["contracts", "deps", "--service", "identity-api", "--direction", "inbound"]);

  assert.equal(current.status, 0, current.stderr);
  assert.match(current.stdout, /billing-api/);
  assert.match(current.stdout, /identity-api/);
  assert.equal(deps.status, 0, deps.stderr);
  assert.match(deps.stdout, /identity-api/);
  assert.equal(inbound.status, 0, inbound.stderr);
  assert.match(inbound.stdout, /billing-api/);
});

test("contracts check strict fails unknown dependency and consumed provider", () => {
  const root = makePlainRepo();
  assert.equal(run(root, ["contracts", "init", "--write"]).status, 0);
  const registryPath = join(root, ".projects", "contracts", "registry.json");
  const registry = JSON.parse(readFileSync(registryPath, "utf8"));
  registry.services = [
    { id: "demo-billing-api", name: "Billing API", repo: "", root: ".", runtime: { language: "node" }, contracts: [], provides: [], consumes: [{ id: "billing-api.consumes.kafka.ledger-events", kind: "event-stream", protocol: "kafka", name: "ledger.events", direction: "consumes", owner_service: "demo-billing-api", provider_service: "", consumer_services: [], confidence: "high", evidence: ["services/billing-api.yaml"] }], depends_on: ["missing-api"] },
  ];
  registry.interactions = registry.services[0].consumes;
  writeFileSync(registryPath, `${JSON.stringify(registry, null, 2)}\n`);

  const normal = run(root, ["contracts", "check"]);
  const strict = run(root, ["contracts", "check", "--strict"]);

  assert.equal(normal.status, 0, normal.stderr);
  assert.match(normal.stdout, /`WARN`/);
  assert.equal(strict.status, 0, strict.stderr);
  assert.match(strict.stdout, /`FAIL`/);
  assert.match(strict.stdout, /unknown provider/);
  assert.match(strict.stdout, /depends_on unknown service/);
});

test("contracts scan blocks registry conflicts before writing", () => {
  const root = makePlainRepo();
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "@demo/billing-api" }, null, 2));
  writeFileSync(join(root, "openapi.yaml"), "openapi: 3.0.0\ninfo:\n  title: Billing\n  version: 1.0.0\npaths: {}\n");
  assert.equal(run(root, ["contracts", "init", "--write"]).status, 0);
  assert.equal(run(root, ["contracts", "scan", "--path", ".", "--mode", "quick", "--write"]).status, 0);

  mkdirSync(join(root, "asyncapi"), { recursive: true });
  writeFileSync(join(root, "asyncapi", "events.yaml"), "asyncapi: 2.0.0\ninfo:\n  title: Events\n  version: 1.0.0\n");
  const preview = run(root, ["contracts", "scan", "--path", ".", "--mode", "quick"]);
  const write = run(root, ["contracts", "scan", "--path", ".", "--mode", "quick", "--write"]);

  assert.equal(preview.status, 0, preview.stderr);
  assert.match(preview.stdout, /Service repo has contract missing from registry/);
  assert.notEqual(write.status, 0);
  assert.match(write.stderr, /Contract registry conflict detected/);
});

test("contracts map writes shared topology and sync is gated", () => {
  const root = makePlainRepo();
  assert.equal(run(root, ["contracts", "init", "--write"]).status, 0);
  const registryPath = join(root, ".projects", "contracts", "registry.json");
  const registry = JSON.parse(readFileSync(registryPath, "utf8"));
  registry.services = [
    {
      id: "billing-api",
      name: "Billing API",
      repo: "git@example.com:billing.git",
      root: ".",
      owners: ["finance-platform"],
      runtime: { language: "go", stack: ["Go module"] },
      contracts: [{ protocol: "openapi", path: "openapi/billing.yaml", source_path: "openapi/billing.yaml", confidence: "high" }],
      depends_on: ["identity-api"],
    },
    {
      id: "identity-api",
      name: "Identity API",
      repo: "git@example.com:identity.git",
      root: ".",
      owners: [],
      runtime: { language: "node", stack: ["Node.js package"] },
      contracts: [],
      depends_on: [],
    },
  ];
  writeFileSync(registryPath, `${JSON.stringify(registry, null, 2)}\n`);
  mkdirSync(join(root, ".projects", "contracts", "openapi"), { recursive: true });
  writeFileSync(join(root, ".projects", "contracts", "openapi", "billing.yaml"), "openapi: 3.0.0\n");

  const mapped = run(root, ["contracts", "map", "--write"]);
  const graph = JSON.parse(readFileSync(join(root, ".projects", "contracts", "graphs", "service-graph.json"), "utf8"));
  const blocked = run(root, ["contracts", "sync", "--push"]);

  assert.equal(mapped.status, 0, mapped.stderr);
  assert.ok(graph.edges.some((edge) => edge.type === "depends_on"));
  assert.notEqual(blocked.status, 0);
  assert.match(blocked.stderr, /remote push requires --commit/);
});

test("mcp contracts supports init, check, scan, current, deps, and legacy alias", () => {
  const root = makePlainRepo();
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "@demo/billing-api" }, null, 2));
  writeFileSync(join(root, "openapi.yaml"), "openapi: 3.0.0\ninfo:\n  title: Billing\n  version: 1.0.0\npaths: {}\n");

  const init = callTapheluTool("dl_contracts", { cwd: root, action: "init", write: true });
  const scan = callTapheluTool("dl_contracts", { cwd: root, action: "scan", mode: "quick", write: true });
  const check = callTapheluTool("taphelu_contracts", { cwd: root, action: "check" });
  const strict = callTapheluTool("dl_contracts", { cwd: root, action: "check", strict: true });
  const registryPath = join(root, ".projects", "contracts", "registry.json");
  const registry = JSON.parse(readFileSync(registryPath, "utf8"));
  registry.services.push({
    id: "ledger-worker",
    name: "Ledger Worker",
    repo: "",
    root: ".",
    runtime: { language: "node" },
    contracts: [],
    provides: [{
      id: "ledger-worker.provides.queue.ledger-export",
      kind: "queue",
      protocol: "sqs",
      name: "ledger-export",
      direction: "provides",
      owner_service: "ledger-worker",
      provider_service: "ledger-worker",
      consumer_services: ["demo-billing-api"],
      confidence: "high",
      evidence: ["services/ledger-worker.yaml"],
    }],
    consumes: [],
    depends_on: [],
  });
  registry.services[0].consumes = [{
    id: "demo-billing-api.consumes.queue.ledger-export",
    kind: "queue",
    protocol: "sqs",
    name: "ledger-export",
    direction: "consumes",
    owner_service: "demo-billing-api",
    provider_service: "ledger-worker",
    consumer_services: [],
    confidence: "high",
    evidence: ["services/demo-billing-api.yaml"],
  }];
  registry.services[0].depends_on = ["ledger-worker"];
  registry.interactions = [...registry.services[0].consumes, ...registry.services[1].provides];
  writeFileSync(registryPath, `${JSON.stringify(registry, null, 2)}\n`);
  const current = callTapheluTool("dl_contracts", { cwd: root, action: "current" });
  const deps = callTapheluTool("dl_contracts", { cwd: root, action: "deps", service: "demo-billing-api", direction: "all" });

  assert.equal(init.wrote, true);
  assert.equal(scan.action, "scan");
  assert.equal(scan.report.service.id, "demo-billing-api");
  assert.equal(check.report.status, "PASS");
  assert.equal(strict.report.status, "PASS");
  assert.equal(current.report.service.id, "demo-billing-api");
  assert.ok(deps.report.deps.outbound.some((item) => item.service === "ledger-worker"));
});

test("scan interview does not write unsafe answer content", () => {
  const root = makePlainRepo();
  const result = run(root, [
    "scan",
    "interview",
    "--domain",
    "api_key=sk-should-not-be-written-because-it-is-a-secret",
    "--user",
    "developer",
    "--write",
  ]);
  const domain = readFileSync(join(root, ".projects", "DOMAIN.md"), "utf8");

  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(domain, /sk-should-not/);
  assert.match(domain, /developer/);
});

test("import project reuses scan pipeline", () => {
  const root = makePlainRepo();
  const result = run(root, ["import", "project", "--mode", "quick", "--write"]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /# Project Scan Report/);
  assert.equal(existsSync(join(root, ".projects", "CODEBASE.md")), true);
});

test("mcp scan project can write and context includes codebase summary", () => {
  const root = makeProject();
  writeFileSync(join(root, "package.json"), JSON.stringify({ scripts: { test: "node --test" } }));
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "src", "index.js"), "console.log('ok');\n");
  const result = callTapheluTool("dl_scan_project", { cwd: root, mode: "quick", write: true });
  const context = callTapheluTool("dl_context", { cwd: root });

  assert.equal(result.wrote, true);
  assert.match(context.codebaseSummary, /Files observed/);
});

test("mcp scan project supports interview and plan actions", () => {
  const root = makePlainRepo();
  const interview = callTapheluTool("dl_scan_project", {
    cwd: root,
    action: "interview",
    mode: "quick",
  });
  const plan = callTapheluTool("taphelu_scan_project", {
    cwd: root,
    action: "plan",
    mode: "quick",
    domain: "Developer workflow tooling",
    objective: "onboarding",
  });

  assert.equal(interview.action, "interview");
  assert.equal(interview.report.kind, "domain_interview");
  assert.ok(interview.report.questions.length >= 3);
  assert.equal(plan.action, "plan");
  assert.equal(plan.report.kind, "deep_scan_plan");
  assert.ok(plan.report.tasks.some((task) => task.focusArea === "stack"));
});

test("mcp scan project supports map action and legacy alias", () => {
  const root = makePlainRepo();
  writeFileSync(join(root, "openapi.yaml"), "openapi: 3.0.0\ninfo:\n  title: API\n  version: 1.0.0\npaths: {}\n");
  const direct = callTapheluTool("dl_scan_project", {
    cwd: root,
    action: "map",
    focus: "all",
    mode: "quick",
  });
  const legacy = callTapheluTool("taphelu_scan_project", {
    cwd: root,
    action: "map",
    focus: "contracts",
    mode: "quick",
  });

  assert.equal(direct.action, "map");
  assert.equal(direct.report.kind, "service_topology");
  assert.ok(direct.report.services.length >= 1);
  assert.ok(direct.report.contracts.some((contract) => contract.protocol === "openapi"));
  assert.equal(legacy.report.focus, "contracts");
});

test("import bmad detects blockers", () => {
  const root = makeProject();
  makeBmadFixture(root, { blocker: true });
  const result = run(root, ["import", "bmad"]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /blocker: Blocker: scope conflicts/);
  assert.match(result.stdout, /`blocked`/);
});

test("import bmad write updates continuation state and memory", () => {
  const root = makeProject();
  makeBmadFixture(root);
  const result = run(root, ["import", "bmad", "--write"]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /`continue`/);

  const state = readFileSync(join(root, ".projects", "STATE.md"), "utf8");
  const memory = readFileSync(join(root, ".projects", "MEMORY.md"), "utf8");
  const events = readFileSync(join(root, ".projects", "events.jsonl"), "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));

  assert.match(state, /Continue BMAD-imported plan/);
  assert.match(state, /Run `dl plan` against the imported BMAD continuation summary/);
  assert.match(memory, /BMAD import source: _bmad-output/);
  assert.equal(events.at(-1).type, "bmad_imported");
});

test("import gsd write updates continuation state and memory", () => {
  const root = makeProject();
  makeGsdFixture(root);
  const result = run(root, ["import", "gsd", "--write"]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /# GSD Import Report/);
  assert.match(result.stdout, /`continue`/);

  const state = readFileSync(join(root, ".projects", "STATE.md"), "utf8");
  const memory = readFileSync(join(root, ".projects", "MEMORY.md"), "utf8");
  const events = readFileSync(join(root, ".projects", "events.jsonl"), "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));

  assert.match(state, /Continue GSD-imported plan/);
  assert.match(state, /imported GSD continuation summary/);
  assert.match(memory, /GSD import source: .planning/);
  assert.equal(events.at(-1).type, "gsd_imported");
});

test("import superpower writes methodology continuation without raw dump", () => {
  const root = makeProject();
  makeSuperpowerFixture(root);
  const result = run(root, ["import", "superpower", "--write"]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /# Superpower Import Report/);
  assert.match(result.stdout, /karpathy-guidelines\/SKILL.md/);

  const state = readFileSync(join(root, ".projects", "STATE.md"), "utf8");
  const memory = readFileSync(join(root, ".projects", "MEMORY.md"), "utf8");
  const events = readFileSync(join(root, ".projects", "events.jsonl"), "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));

  assert.match(state, /Adapt Superpower-imported methodology/);
  assert.match(memory, /Superpower import source: superpowers/);
  assert.match(memory, /Superpower import:/);
  assert.doesNotMatch(memory, /Verify with examples/);
  assert.equal(events.at(-1).type, "superpower_imported");
});

test("imported bmad project can feed status and plan", () => {
  const root = makeProject();
  makeBmadFixture(root);
  const imported = run(root, ["import", "bmad", "--write"]);
  const status = run(root, ["status"]);
  const plan = run(root, [
    "plan",
    "--context",
    "_bmad-output/project-context.md",
    "--task",
    "Continue imported story.",
    "--verification",
    "Plan references imported context.",
    "Continue BMAD-imported plan.",
  ]);

  assert.equal(imported.status, 0, imported.stderr);
  assert.equal(status.status, 0, status.stderr);
  assert.equal(plan.status, 0, plan.stderr);
  assert.match(status.stdout, /Continue BMAD-imported plan/);
  assert.match(plan.stdout, /_bmad-output\/project-context.md/);
  assert.match(plan.stdout, /`execute`/);
});

test("missing flag value exits with clear error", () => {
  const root = makeProject();
  const result = run(root, ["ask", "--mode"]);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Missing value for --mode/);
});
