#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { homedir } from "node:os";

const input = readJsonStdin();
const event = input.hook_event_name || input.hookEventName || input.event || "";
const toolName = String(input.tool_name || input.toolName || "");
const toolInput = input.tool_input || input.toolInput || {};
const cwd = input.cwd || process.cwd();
const policy = flagValue("--policy") || "strict";

if (policy === "off") process.exit(0);

const command = String(toolInput.command || toolInput.cmd || "");
const payload = JSON.stringify(toolInput).slice(0, 2000);

if (event.toLowerCase().includes("pretool") && isBlockedToolUse(toolName, command, payload)) {
  const reason = "Taphelu strict gate blocked destructive command or unsafe memory content.";
  console.error(reason);
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: event,
      permissionDecision: "deny",
      permissionDecisionReason: reason,
    },
  }));
  process.exit(2);
}

captureHookObservation(cwd, input, event, toolName);

if (["SessionStart", "sessionStart", "agentSpawn", "UserPromptSubmit", "userPromptSubmit"].includes(event)) {
  const context = buildContextHint(cwd);
  if (context) {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: event,
        additionalContext: context,
      },
    }));
  }
}

process.exit(0);

function readJsonStdin() {
  if (process.stdin.isTTY) return {};
  try {
    const raw = fs.readFileSync(0, "utf8").trim();
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function flagValue(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? "" : process.argv[index + 1] || "";
}

function isBlockedToolUse(name, cmd, text) {
  if (isDestructiveRm(cmd)) return true;
  if (/\bgit\s+reset\b[^\n;&|]*\s--hard(?:\s|$)/.test(cmd) || /\bgit\s+clean\s+-fd(?:\s|$)/.test(cmd) || /\bchmod\s+-R\s+777\b/.test(cmd)) return true;
  if (/dl_(memory_promote|observe)|dl\s+remember|dl\s+browser/i.test(`${name} ${cmd}`)) {
    return containsUnsafeMemoryContent(text);
  }
  return /(delete_file|fs_delete)/i.test(name) && /(\.env|id_rsa|private|secret)/i.test(text);
}

function captureHookObservation(start, payloadInput, hookEvent, tool) {
  const root = findProjectRoot(start);
  if (!root) return;
  const normalized = String(hookEvent || "").toLowerCase();
  const observation = observationFromHook(payloadInput, normalized, tool);
  if (!observation.content) return;
  writeL0(root, {
    sessionId: String(payloadInput.session_id || payloadInput.sessionId || "claude-hook"),
    role: observation.role,
    source: observation.source,
    content: observation.content,
    metadata: {
      hook_event: hookEvent || "",
      tool_name: tool || "",
    },
  });
}

function observationFromHook(payloadInput, normalizedEvent, tool) {
  if (normalizedEvent === "userpromptsubmit") {
    return {
      role: "user",
      source: "user_prompt",
      content: sanitizeL0Content(String(payloadInput.prompt || payloadInput.user_prompt || payloadInput.message || "")).content,
    };
  }
  if (normalizedEvent === "sessionstart" || normalizedEvent === "agentspawn") {
    return {
      role: "system",
      source: "runtime_hook",
      content: `Claude hook observed ${normalizedEvent}.`,
    };
  }
  if (normalizedEvent === "posttooluse") {
    return {
      role: "tool",
      source: `tool_result:${tool || "unknown"}`,
      content: summarizeToolResult(tool, payloadInput.tool_response || payloadInput.toolResponse || payloadInput.tool_output || payloadInput.toolOutput),
    };
  }
  if (normalizedEvent === "stop" || normalizedEvent === "subagentstop") {
    return {
      role: "system",
      source: "runtime_hook",
      content: `Claude hook observed ${normalizedEvent}.`,
    };
  }
  return { role: "", source: "", content: "" };
}

function summarizeToolResult(tool, response) {
  if (response == null || response === "") return `Tool ${tool || "unknown"} completed.`;
  if (typeof response === "string") return `Tool ${tool || "unknown"} completed with ${response.length} chars of output.`;
  if (typeof response !== "object") return `Tool ${tool || "unknown"} completed.`;
  const status = response.status || response.result || response.outcome || "";
  const exitCode = response.exit_code ?? response.exitCode ?? response.code ?? "";
  const error = response.error ? "error present" : "";
  const outputSize = ["stdout", "stderr", "output", "content"]
    .map((key) => typeof response[key] === "string" ? response[key].length : 0)
    .reduce((sum, length) => sum + length, 0);
  return [
    `Tool ${tool || "unknown"} completed.`,
    status ? `status=${String(status).slice(0, 40)}` : "",
    exitCode !== "" ? `exit=${exitCode}` : "",
    outputSize ? `output_chars=${outputSize}` : "",
    error,
  ].filter(Boolean).join(" ");
}

function containsUnsafeMemoryContent(text) {
  return /(api[_-]?key|private[_-]?key)\s*[:=]\s*["']?[^"'\s,}]+/i.test(text)
    || /\b(secret|token|password|authorization|cookie|set-cookie)\b\s*[:=]\s*["']?[^"'\s,}]+/i.test(text)
    || /\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{12,}/i.test(text)
    || /\b(?:pii|raw browser|raw log)\b/i.test(text);
}

function writeL0(root, record) {
  const sqlite = sqlite3Command();
  if (!sqlite) return;
  const dbPath = memoryDbPath(root);
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const now = new Date().toISOString();
  const sanitized = sanitizeL0Content(record.content);
  if (!sanitized.content) return;
  const sql = `
PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  workspace TEXT NOT NULL,
  goal TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active',
  started_at TEXT NOT NULL,
  ended_at TEXT
);
CREATE TABLE IF NOT EXISTS l0_records (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  role TEXT NOT NULL,
  source TEXT NOT NULL,
  content TEXT NOT NULL,
  unsafe INTEGER NOT NULL DEFAULT 0,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE VIRTUAL TABLE IF NOT EXISTS l0_fts USING fts5(content, content='l0_records', content_rowid='rowid');
CREATE TABLE IF NOT EXISTS l1_memories (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  content TEXT NOT NULL,
  confidence TEXT NOT NULL,
  source_ids_json TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS l2_scenes (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  source_ids_json TEXT NOT NULL,
  memory_ids_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS l3_profile (
  key TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  source_ids_json TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL
);
INSERT OR IGNORE INTO sessions (id, agent_id, platform, workspace, goal, status, started_at, ended_at)
VALUES (${sqlString(record.sessionId)}, 'claude', 'claude', ${sqlString(root)}, '', 'active', ${sqlString(now)}, NULL);
INSERT INTO l0_records (id, session_id, role, source, content, unsafe, metadata_json, created_at)
VALUES (${sqlString(createId("l0"))}, ${sqlString(record.sessionId)}, ${sqlString(record.role)}, ${sqlString(record.source)}, ${sqlString(sanitized.content)}, ${sanitized.unsafe ? 1 : 0}, ${sqlString(JSON.stringify(record.metadata || {}))}, ${sqlString(now)});
INSERT INTO l0_fts(rowid, content) VALUES (last_insert_rowid(), ${sqlString(sanitized.content)});
`;
  const result = spawnSync(sqlite, [dbPath], {
    input: sql,
    encoding: "utf8",
    stdio: ["pipe", "ignore", "ignore"],
    timeout: 1000,
  });
  if (result.error || result.status !== 0) {
    debugHook(`L0 capture failed: ${result.error?.message || `sqlite exited ${result.status}`}`);
  }
}

function sqlite3Command() {
  const result = spawnSync("sqlite3", ["--version"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    timeout: 500,
  });
  return result.status === 0 ? "sqlite3" : "";
}

function sanitizeL0Content(content) {
  let output = String(content || "");
  let unsafe = false;
  const replacements = [
    [/((?:\\?["'])?(?:password|passwd|token|secret|api[_ -]?key)(?:\\?["'])?\s*[:=]\s*(?:\\?["'])).*?((?:\\?["']))/gi, "$1[REDACTED]$2"],
    [/((?:"|')?(?:password|passwd|token|secret|api[_ -]?key)(?:"|')?\s*[:=]\s*)(["']).*?\2/gi, "$1$2[REDACTED]$2"],
    [/(password|passwd|token|secret|api[_ -]?key)\s*[:=]\s*[^\s,;}]+/gi, "$1=[REDACTED]"],
    [/authorization\s*:\s*bearer\s+\S+/gi, "authorization: bearer [REDACTED]"],
    [/\bsk-[A-Za-z0-9_-]{20,}\b/g, "[REDACTED TOKEN]"],
    [/\b[A-Za-z0-9+/]{48,}={0,2}\b/g, "[REDACTED TOKEN]"],
    [/cookie\s*[:=]\s*\S+/gi, "cookie=[REDACTED]"],
    [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, "[REDACTED PRIVATE KEY]"],
    [/\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b/gi, "[REDACTED EMAIL]"],
  ];
  for (const [pattern, replacement] of replacements) {
    if (pattern.test(output)) {
      unsafe = true;
      output = output.replace(pattern, replacement);
    }
  }
  if (/<!doctype html[\s\S]*/i.test(output) || /<html[\s\S]*/i.test(output) || /\b(raw|full)\s+log\b/i.test(output)) {
    unsafe = true;
    output = output
      .replace(/<!doctype html[\s\S]*/i, "[REDACTED RAW BROWSER CONTENT]")
      .replace(/<html[\s\S]*/i, "[REDACTED RAW BROWSER CONTENT]")
      .replace(/\b(raw|full)\s+log\b/gi, "[REDACTED RAW LOG]");
  }
  return { content: output.trim().slice(0, 2000), unsafe };
}

function memoryDbPath(root) {
  if (process.env.TAPHELU_MEMORY_DB) return process.env.TAPHELU_MEMORY_DB;
  const base = process.env.TAPHELU_HOME || path.join(homedir(), ".taphelu");
  return path.join(base, "memory", workspaceKey(root), "taphelu.db");
}

function workspaceKey(root) {
  const digest = createHash("sha256").update(root).digest("hex").slice(0, 16);
  const slug = root.split(/[\\/]/).filter(Boolean).at(-1)?.replace(/[^a-z0-9._-]+/gi, "-") || "workspace";
  return `${slug}-${digest}`;
}

function createId(prefix) {
  return `${prefix}_${Date.now()}_${randomBytes(4).toString("hex")}`;
}

function sqlString(value) {
  return `'${String(value ?? "").replaceAll("'", "''")}'`;
}

function debugHook(message) {
  if (process.env.TAPHELU_HOOK_DEBUG === "1") {
    console.error(`Taphelu hook: ${message}`);
  }
}

function isDestructiveRm(cmd) {
  const match = /\brm\s+([^;&|]+)/.exec(cmd);
  if (!match) return false;
  const tokens = match[1].trim().split(/\s+/).filter(Boolean);
  const hasRecursive = tokens.some((token) => token.startsWith("-") && token.includes("r")) || tokens.includes("--recursive");
  const hasForce = tokens.some((token) => token.startsWith("-") && token.includes("f")) || tokens.includes("--force");
  const hasRecursiveForce = hasRecursive && hasForce;
  if (!hasRecursiveForce) return false;
  return tokens.some((token) => !token.startsWith("-") && isDangerousRmTarget(token));
}

function isDangerousRmTarget(target) {
  return /^\/(?:[*.]|\.\/?)?$/.test(target)
    || /^\/(?:etc|var|usr|bin|sbin|System|Library|Users|Applications|private|opt)(?:\/|$)/.test(target)
    || /^(?:~|\$HOME|\$\{HOME\})(?:\/(?:[*.]|\.\/?)?)?$/.test(target)
    || /^(?:\.\/)?\.git(?:\/|$)/.test(target)
    || /^\.(?:\/(?:[*.]|\.\/?)?)?$/.test(target);
}

function buildContextHint(start) {
  const root = findProjectRoot(start);
  if (!root) return "Taphelu: no .projects context found. Use dl_scan_project action=scan before planning.";
  const contextPath = path.join(root, ".projects", "CONTEXT.md");
  if (fs.existsSync(contextPath)) {
    return `Taphelu: load compact context via dl_context or ${contextPath}; avoid raw logs/history.`;
  }
  return "Taphelu: call dl_start, then dl_context. If context is stale, run dl_context_store action=index.";
}

function findProjectRoot(start) {
  let current = path.resolve(start || process.cwd());
  while (true) {
    if (fs.existsSync(path.join(current, ".projects", "PROJECT.md"))) return current;
    const parent = path.dirname(current);
    if (parent === current) return "";
    current = parent;
  }
}
