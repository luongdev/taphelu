import { existsSync, mkdirSync, readdirSync, readFileSync, rmdirSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { writeTextFileAtomic } from "../project.mjs";

const SOURCE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PACK_DIR = join(SOURCE_DIR, "taphelu-pack");
const MCP_BIN = join(SOURCE_DIR, "bin", "taphelu-mcp.mjs");
const MANAGED_START = "# TAPHELU MANAGED MCP START";
const MANAGED_END = "# TAPHELU MANAGED MCP END";
const JSON_MANAGED_ENV = "TAPHELU_MANAGED";
const SUPPORTED_RUNTIMES = ["codex", "claude", "gemini", "kiro"];

export function loadPack() {
  const manifestPath = join(PACK_DIR, "manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  validateManifest(manifest);
  const skills = manifest.skills.map((item) => loadPackItem(item, "skill"));
  const agents = manifest.agents.map((item) => loadPackItem(item, "agent"));
  const mcp = JSON.parse(readFileSync(join(PACK_DIR, manifest.mcp), "utf8"));
  return { manifest, skills, agents, mcp, packDir: PACK_DIR };
}

export function validateManifest(manifest) {
  if (manifest.schemaVersion !== 1) throw new Error("taphelu-pack manifest schemaVersion must be 1.");
  if (!manifest.name || !manifest.version) throw new Error("taphelu-pack manifest requires name and version.");
  if (!Array.isArray(manifest.skills) || !manifest.skills.length) throw new Error("taphelu-pack manifest requires skills.");
  if (!Array.isArray(manifest.agents) || !manifest.agents.length) throw new Error("taphelu-pack manifest requires agents.");
  for (const runtime of SUPPORTED_RUNTIMES) {
    if (!manifest.runtimes?.[runtime]) throw new Error(`taphelu-pack manifest missing runtime: ${runtime}.`);
  }
  for (const item of [...manifest.skills, ...manifest.agents]) {
    if (!item.name || !item.path) throw new Error("taphelu-pack manifest items require name and path.");
    if (!existsSync(join(PACK_DIR, item.path))) throw new Error(`taphelu-pack item not found: ${item.path}.`);
  }
  if (!manifest.mcp || !existsSync(join(PACK_DIR, manifest.mcp))) throw new Error("taphelu-pack manifest requires mcp.json.");
  return true;
}

export function buildInstallPlan(root, input = {}) {
  const pack = loadPack();
  const runtimes = normalizeRuntime(input.runtime || "all");
  const scope = normalizeScope(input.scope || "local");
  const files = [];
  const blockers = [];
  const warnings = [];
  const manualActions = [];

  for (const runtime of runtimes) {
    const runtimePlan = buildRuntimeInstallPlan(root, pack, {
      runtime,
      scope,
      configDir: runtimeConfigDir(input.configDir, runtime, runtimes),
      nodeCommand: input.nodeCommand || process.execPath,
    });
    files.push(...runtimePlan.files);
    blockers.push(...runtimePlan.blockers);
    warnings.push(...runtimePlan.warnings);
    manualActions.push(...runtimePlan.manualActions);
  }

  return {
    pack: {
      name: pack.manifest.name,
      version: pack.manifest.version,
      skills: pack.skills.map((item) => item.name),
      agents: pack.agents.map((item) => item.name),
    },
    runtimes,
    scope,
    files,
    blockers,
    warnings,
    manualActions,
  };
}

export function applyInstallPlan(plan) {
  if (plan.blockers.length) {
    throw new Error(`Install blocked: ${plan.blockers.join("; ")}`);
  }
  const snapshots = plan.files.map((file) => snapshotTarget(file.path));
  const directorySnapshots = snapshotMissingDirectories(plan.files.map((file) => dirname(file.path)));
  try {
    for (const file of plan.files) {
      mkdirSync(dirname(file.path), { recursive: true });
      writeTextFileAtomic(file.path, file.content);
    }
  } catch (error) {
    rollbackTargets(snapshots, error);
    removeCreatedDirectories(directorySnapshots, error);
    throw error;
  }
  return plan.files.length;
}

export function inspectInstall(root, input = {}) {
  const plan = buildInstallPlan(root, input);
  const checks = plan.files.map((file) => {
    if (!existsSync(file.path)) {
      return { path: file.path, status: "FAIL", message: "Missing generated file." };
    }
    const content = readFileSync(file.path, "utf8");
    if (file.kind === "skill" || file.kind === "agent") {
      return content.includes(file.marker)
        ? { path: file.path, status: "PASS", message: "Managed adapter file present." }
        : { path: file.path, status: "FAIL", message: "File exists but lacks Taphelu managed marker." };
    }
    if (file.kind === "mcp-toml") {
      return inspectCodexMcpFile(file, content);
    }
    if (file.kind === "mcp-json") {
      return inspectJsonMcpFile(file, content);
    }
    return { path: file.path, status: "PASS", message: "Present." };
  });
  const status = plan.blockers.length || checks.some((check) => check.status === "FAIL") ? "FAIL" : "PASS";
  return { ...plan, checks, status };
}

function buildRuntimeInstallPlan(root, pack, input) {
  const runtimeConfig = pack.manifest.runtimes[input.runtime];
  const targetRoot = runtimeTargetRoot(root, runtimeConfig, input.runtime, input.scope, input.configDir);
  const files = [];
  const blockers = [];
  const warnings = [];
  const manualActions = [];

  for (const skill of pack.skills) {
    addManagedFile(files, blockers, {
      path: join(targetRoot.skillsRoot, skill.name, "SKILL.md"),
      content: renderSkill(skill, pack.manifest.managedMarker, input.runtime),
      marker: pack.manifest.managedMarker,
      kind: "skill",
      runtime: input.runtime,
    });
  }

  if (runtimeConfig.nativeAgents) {
    for (const agent of pack.agents) {
      addManagedFile(files, blockers, {
        path: join(targetRoot.agentsRoot, `${agent.name}.md`),
        content: renderAgent(agent, pack.manifest.managedMarker, input.runtime),
        marker: pack.manifest.managedMarker,
        kind: "agent",
        runtime: input.runtime,
      });
    }
  } else {
    for (const agent of pack.agents) {
      addManagedFile(files, blockers, {
        path: join(targetRoot.skillsRoot, agent.name, "SKILL.md"),
        content: renderAgentAsSkill(agent, pack.manifest.managedMarker, input.runtime),
        marker: pack.manifest.managedMarker,
        kind: "skill",
        runtime: input.runtime,
      });
    }
  }

  const mcp = buildMcpServerConfig(input.nodeCommand, input.runtime);
  if (input.runtime === "codex") {
    const configPath = targetRoot.mcpConfigPath;
    const existing = existsSync(configPath) ? readFileSync(configPath, "utf8") : "";
    const merged = mergeCodexToml(existing, mcp);
    if (merged.blocker) {
      blockers.push(`${configPath}: ${merged.blocker}`);
    } else {
      files.push({ path: configPath, content: merged.content, kind: "mcp-toml", runtime: input.runtime, marker: MANAGED_START, mcp });
    }
  } else {
    const configPath = targetRoot.mcpConfigPath;
    const existing = existsSync(configPath) ? readFileSync(configPath, "utf8") : "";
    const merged = mergeMcpJson(existing, mcp);
    if (merged.blocker) {
      blockers.push(`${configPath}: ${merged.blocker}`);
    } else {
      files.push({ path: configPath, content: merged.content, kind: "mcp-json", runtime: input.runtime, marker: JSON_MANAGED_ENV, mcp });
    }
    if (input.runtime === "claude" && input.scope === "global") {
      manualActions.push(`Claude global MCP can also be installed with: claude mcp add -e ${JSON_MANAGED_ENV}=1 --transport stdio --scope user taphelu -- ${input.nodeCommand} ${MCP_BIN}`);
    }
    if (input.runtime === "kiro" && input.scope === "global") {
      manualActions.push(`Kiro global MCP can also be installed with: kiro --add-mcp '${JSON.stringify({ name: "taphelu", command: input.nodeCommand, args: [MCP_BIN], env: { [JSON_MANAGED_ENV]: "1" } })}'`);
    }
  }

  if (input.scope === "global" && input.runtime === "claude" && input.configDir) {
    warnings.push("Claude --config-dir is used for testable generated config; Claude Code user-scope MCP normally lives in ~/.claude.json.");
  }

  return { files, blockers, warnings, manualActions };
}

function loadPackItem(item, type) {
  const content = readFileSync(join(PACK_DIR, item.path), "utf8");
  const parsed = parseFrontmatter(content);
  return {
    ...item,
    type,
    content,
    body: parsed.body,
    frontmatter: parsed.frontmatter,
    description: parsed.frontmatter.description || "",
  };
}

function addManagedFile(files, blockers, file) {
  if (existsSync(file.path)) {
    const existing = readFileSync(file.path, "utf8");
    if (!existing.includes(file.marker)) {
      blockers.push(`${file.path}: existing file is not Taphelu-managed.`);
    }
  }
  files.push(file);
}

function renderSkill(item, marker, runtime) {
  return renderMarkdownWithFrontmatter(item, marker, runtime, item.name, item.description);
}

function renderAgent(item, marker, runtime) {
  return renderMarkdownWithFrontmatter(item, marker, runtime, item.name, item.description);
}

function renderAgentAsSkill(item, marker, runtime) {
  const name = item.name;
  const description = `Use as the ${item.frontmatter.name || item.name} role contract when this runtime has no native Taphelu subagent adapter. ${item.description}`;
  return renderMarkdownWithFrontmatter(item, marker, runtime, name, description);
}

function renderMarkdownWithFrontmatter(item, marker, runtime, name, description) {
  const body = item.body.trim();
  return `---
name: ${yamlString(name)}
description: ${yamlString(description)}
taphelu_managed: true
taphelu_runtime: ${yamlString(runtime)}
taphelu_source: ${yamlString(`taphelu-pack/${item.path}`)}
---

<!-- ${marker}: do not edit. Source: taphelu-pack/${item.path}. Regenerate with dl install. -->

${body}

## Taphelu Runtime Adapter

This file is generated from the canonical Taphelu pack. Edit the canonical source, then reinstall adapters.
`;
}

function buildMcpServerConfig(nodeCommand, runtime) {
  const config = {
    command: nodeCommand,
    args: [MCP_BIN],
    env: {
      [JSON_MANAGED_ENV]: "1",
    },
  };
  if (runtime === "claude") config.type = "stdio";
  return config;
}

function snapshotTarget(path) {
  return {
    path,
    exists: existsSync(path),
    content: existsSync(path) ? readFileSync(path, "utf8") : "",
  };
}

function rollbackTargets(snapshots, originalError) {
  const failures = [];
  for (const snapshot of snapshots.slice().reverse()) {
    try {
      if (snapshot.exists) {
        writeTextFileAtomic(snapshot.path, snapshot.content);
      } else if (existsSync(snapshot.path)) {
        unlinkSync(snapshot.path);
      }
    } catch (rollbackError) {
      failures.push(`${snapshot.path}: ${rollbackError.message}`);
    }
  }
  if (failures.length) {
    originalError.message = `${originalError.message} (rollback failed: ${failures.join("; ")})`;
  }
}

function snapshotMissingDirectories(paths) {
  const seen = new Set();
  const snapshots = [];
  for (const start of paths) {
    let current = start;
    while (current && !existsSync(current) && !seen.has(current)) {
      seen.add(current);
      snapshots.push({ path: current });
      const parent = dirname(current);
      if (parent === current) break;
      current = parent;
    }
  }
  return snapshots;
}

function removeCreatedDirectories(snapshots, originalError) {
  const failures = [];
  for (const snapshot of snapshots.slice().sort((a, b) => b.path.length - a.path.length)) {
    try {
      if (existsSync(snapshot.path) && !readdirSync(snapshot.path).length) {
        rmdirSync(snapshot.path);
      }
    } catch (rollbackError) {
      failures.push(`${snapshot.path}: ${rollbackError.message}`);
    }
  }
  if (failures.length) {
    originalError.message = `${originalError.message} (directory rollback failed: ${failures.join("; ")})`;
  }
}

function mergeCodexToml(existing, mcp) {
  const stripped = stripManagedBlock(existing);
  if (/\[mcp_servers\.taphelu\]/.test(stripped)) {
    return { blocker: "existing taphelu MCP block is not Taphelu-managed." };
  }
  const block = `${MANAGED_START}
[mcp_servers.taphelu]
command = ${tomlString(mcp.command)}
args = [${mcp.args.map(tomlString).join(", ")}]
[mcp_servers.taphelu.env]
${JSON_MANAGED_ENV} = "1"
${MANAGED_END}
`;
  return { content: `${stripped.trimEnd()}${stripped.trim() ? "\n\n" : ""}${block}` };
}

function mergeMcpJson(existing, mcp) {
  const parsed = existing.trim() ? safeJson(existing) : {};
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { blocker: "existing MCP JSON is invalid or not an object." };
  }
  const next = { ...parsed, mcpServers: { ...(parsed.mcpServers || {}) } };
  const current = next.mcpServers.taphelu;
  if (current && current.env?.[JSON_MANAGED_ENV] !== "1") {
    return { blocker: "existing taphelu MCP entry is not Taphelu-managed." };
  }
  next.mcpServers.taphelu = {
    ...(mcp.type ? { type: mcp.type } : {}),
    command: mcp.command,
    args: mcp.args,
    env: mcp.env,
  };
  return { content: `${JSON.stringify(next, null, 2)}\n` };
}

function inspectCodexMcpFile(file, content) {
  if (!content.includes(MANAGED_START) || !content.includes("[mcp_servers.taphelu]")) {
    return { path: file.path, status: "FAIL", message: "Codex MCP block missing." };
  }
  const block = managedCodexBlock(content);
  const command = block.match(/^\s*command\s*=\s*"([^"]+)"/m)?.[1];
  const argsRaw = block.match(/^\s*args\s*=\s*\[(.*?)\]/m)?.[1] || "";
  const args = [...argsRaw.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
  return inspectMcpCommand(file, command, args);
}

function inspectJsonMcpFile(file, content) {
  const parsed = safeJson(content);
  const entry = parsed?.mcpServers?.taphelu;
  if (entry?.env?.[JSON_MANAGED_ENV] !== "1") {
    return { path: file.path, status: "FAIL", message: "MCP server entry missing or unmanaged." };
  }
  return inspectMcpCommand(file, entry.command, entry.args);
}

function inspectMcpCommand(file, command, args = []) {
  if (command !== file.mcp.command) {
    return { path: file.path, status: "FAIL", message: `MCP command drift: expected ${file.mcp.command}, found ${command || "missing"}.` };
  }
  const [mcpPath] = Array.isArray(args) ? args : [];
  if (mcpPath !== file.mcp.args[0]) {
    return { path: file.path, status: "FAIL", message: `MCP server path drift: expected ${file.mcp.args[0]}, found ${mcpPath || "missing"}.` };
  }
  if (!existsSync(mcpPath)) {
    return { path: file.path, status: "FAIL", message: `MCP server path does not exist: ${mcpPath}.` };
  }
  return { path: file.path, status: "PASS", message: "Managed MCP server entry points to installed taphelu-mcp." };
}

function managedCodexBlock(content) {
  const start = content.indexOf(MANAGED_START);
  const end = content.indexOf(MANAGED_END);
  if (start === -1 || end === -1 || end < start) return "";
  return content.slice(start, end + MANAGED_END.length);
}

function runtimeTargetRoot(root, runtimeConfig, runtime, scope, configDir) {
  if (scope === "local") {
    const base = join(root, runtimeConfig.configDir);
    return {
      base,
      skillsRoot: join(base, runtimeConfig.skillsDir),
      agentsRoot: runtimeConfig.agentsDir ? join(base, runtimeConfig.agentsDir) : join(base, "agents"),
      mcpConfigPath: runtime === "claude" ? join(root, ".mcp.json") : join(base, runtimeConfig.mcpConfig),
    };
  }

  const base = resolveGlobalDir(runtimeConfig, configDir);
  return {
    base,
    skillsRoot: join(base, runtimeConfig.skillsDir),
    agentsRoot: runtimeConfig.agentsDir ? join(base, runtimeConfig.agentsDir) : join(base, "agents"),
    mcpConfigPath: runtime === "claude" && !configDir ? join(homedir(), ".claude.json") : join(base, runtime === "codex" ? "config.toml" : runtimeConfig.mcpConfig),
  };
}

function resolveGlobalDir(runtimeConfig, configDir) {
  if (configDir) return resolve(configDir);
  if (runtimeConfig.globalEnv && process.env[runtimeConfig.globalEnv]) return resolve(process.env[runtimeConfig.globalEnv]);
  return join(homedir(), runtimeConfig.defaultGlobalDir);
}

function runtimeConfigDir(configDir, runtime, runtimes) {
  if (!configDir || runtimes.length === 1) return configDir;
  return join(configDir, runtime);
}

function normalizeRuntime(runtime) {
  if (runtime === "all") return SUPPORTED_RUNTIMES;
  const runtimes = String(runtime).split(",").map((item) => item.trim()).filter(Boolean);
  if (!runtimes.length) throw new Error("Missing runtime.");
  for (const item of runtimes) {
    if (!SUPPORTED_RUNTIMES.includes(item)) {
      throw new Error(`Invalid runtime: ${item}. Expected ${SUPPORTED_RUNTIMES.join(", ")}, or all.`);
    }
  }
  return [...new Set(runtimes)];
}

function normalizeScope(scope) {
  if (scope === "local" || scope === "global") return scope;
  throw new Error(`Invalid scope: ${scope}. Expected local or global.`);
}

function parseFrontmatter(content) {
  const lines = content.split(/\r?\n/);
  if (lines[0] !== "---") return { frontmatter: {}, body: content };
  const end = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
  if (end === -1) return { frontmatter: {}, body: content };
  const raw = lines.slice(1, end).join("\n").trim();
  const body = lines.slice(end + 1).join("\n").trimStart();
  const frontmatter = {};
  for (const line of raw.split(/\r?\n/)) {
    const match = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line.trim());
    if (match) frontmatter[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
  return { frontmatter, body };
}

function stripManagedBlock(content) {
  const start = content.indexOf(MANAGED_START);
  const end = content.indexOf(MANAGED_END);
  if (start === -1 || end === -1 || end < start) return content;
  return `${content.slice(0, start)}${content.slice(end + MANAGED_END.length)}`.trimEnd();
}

function safeJson(content) {
  try {
    return JSON.parse(content || "{}");
  } catch {
    return null;
  }
}

function yamlString(value) {
  return JSON.stringify(String(value));
}

function tomlString(value) {
  return JSON.stringify(String(value));
}
