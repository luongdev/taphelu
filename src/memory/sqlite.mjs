import { mkdirSync, existsSync, readFileSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { readProjectFile, writeTextFileAtomic } from "../project.mjs";
import { replaceSection, unsafeBrowserArtifact, unsafeMemory } from "../utils.mjs";

const MEMORY_DB_FILENAME = "taphelu.db";
const TAPHELU_HOME_ENV = "TAPHELU_HOME";
const TAPHELU_MEMORY_DB_ENV = "TAPHELU_MEMORY_DB";
const MAX_SEARCH_LIMIT = 20;
const MAX_FTS_TERMS = 6;
const MAX_QUERY_CHARS = 256;

export function memoryDbPath(root) {
  if (process.env[TAPHELU_MEMORY_DB_ENV]) return process.env[TAPHELU_MEMORY_DB_ENV];
  return join(tapheluHome(), "memory", workspaceKey(root), MEMORY_DB_FILENAME);
}

export function withMemoryDb(root, fn) {
  const db = openMemoryDb(root);
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

export function openMemoryDb(root) {
  const path = memoryDbPath(root);
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  initializeMemoryDb(db);
  return db;
}

export function initializeMemoryDb(db) {
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;

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

    CREATE VIRTUAL TABLE IF NOT EXISTS l0_fts USING fts5(
      content,
      content='l0_records',
      content_rowid='rowid'
    );

    CREATE TABLE IF NOT EXISTS l1_memories (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      content TEXT NOT NULL,
      confidence TEXT NOT NULL,
      source_ids_json TEXT NOT NULL,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS l1_fts USING fts5(
      content,
      content='l1_memories',
      content_rowid='rowid'
    );

    CREATE TABLE IF NOT EXISTS l2_scenes (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      summary TEXT NOT NULL,
      source_ids_json TEXT NOT NULL,
      memory_ids_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS l2_fts USING fts5(
      title,
      summary,
      content='l2_scenes',
      content_rowid='rowid'
    );

    CREATE TABLE IF NOT EXISTS l3_profile (
      key TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      source_ids_json TEXT NOT NULL DEFAULT '[]',
      updated_at TEXT NOT NULL
    );
  `);
}

export function createSession(root, input = {}) {
  return withMemoryDb(root, (db) => {
    const now = new Date().toISOString();
    const session = {
      id: input.sessionId || createId("session"),
      agentId: input.agentId || "default_agent",
      platform: input.platform || "mcp",
      workspace: input.workspace || root,
      goal: input.goal || "",
      status: "active",
      startedAt: now,
      endedAt: null,
    };
    db.prepare(`
      INSERT OR IGNORE INTO sessions (id, agent_id, platform, workspace, goal, status, started_at, ended_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      session.id,
      session.agentId,
      session.platform,
      session.workspace,
      session.goal,
      session.status,
      session.startedAt,
      session.endedAt,
    );
    return getSessionById(db, session.id);
  });
}

export function closeSession(root, sessionId) {
  return withMemoryDb(root, (db) => {
    const now = new Date().toISOString();
    db.prepare("UPDATE sessions SET status = 'closed', ended_at = ? WHERE id = ?").run(now, sessionId);
    return getSessionById(db, sessionId);
  });
}

export function captureL0(root, input) {
  return withMemoryDb(root, (db) => captureL0WithDb(db, input));
}

export function captureL0WithDb(db, input) {
  const content = String(input.content || "").trim();
  if (!content) userError("Missing L0 content.");
  const sessionId = input.sessionId || "session-default";
  const sanitized = sanitizeL0Content(content);
  const now = new Date().toISOString();
  const record = {
    id: input.id || createId("l0"),
    sessionId,
    role: input.role || "agent",
    source: input.source || "observation",
    content: sanitized.content,
    unsafe: sanitized.unsafe ? 1 : 0,
    metadata: input.metadata || {},
    createdAt: now,
  };
  runTransaction(db, () => {
    const result = db.prepare(`
      INSERT INTO l0_records (id, session_id, role, source, content, unsafe, metadata_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      record.id,
      record.sessionId,
      record.role,
      record.source,
      record.content,
      record.unsafe,
      JSON.stringify(record.metadata),
      record.createdAt,
    );
    db.prepare("INSERT INTO l0_fts(rowid, content) VALUES (?, ?)").run(result.lastInsertRowid, record.content);
  });
  return record;
}

export function createL1Memory(root, input) {
  return withMemoryDb(root, (db) => createL1MemoryWithDb(db, input));
}

export function createL1MemoryWithDb(db, input) {
  const content = String(input.content || "").trim();
  const sourceIds = normalizeArray(input.sourceIds);
  if (!content) userError("Missing L1 memory content.");
  if (!sourceIds.length) userError("L1 memory requires at least one source ID.");
  assertPromotable(content, "L1 memory");
  const now = new Date().toISOString();
  const memory = {
    id: input.id || createId("l1"),
    type: input.type || "fact",
    content,
    confidence: input.confidence || "medium",
    sourceIds,
    metadata: input.metadata || {},
    createdAt: now,
  };
  runTransaction(db, () => {
    const result = db.prepare(`
      INSERT INTO l1_memories (id, type, content, confidence, source_ids_json, metadata_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      memory.id,
      memory.type,
      memory.content,
      memory.confidence,
      JSON.stringify(memory.sourceIds),
      JSON.stringify(memory.metadata),
      memory.createdAt,
    );
    db.prepare("INSERT INTO l1_fts(rowid, content) VALUES (?, ?)").run(result.lastInsertRowid, memory.content);
  });
  return memory;
}

export function createL2Scene(root, input) {
  return withMemoryDb(root, (db) => createL2SceneWithDb(db, input));
}

export function createL2SceneWithDb(db, input) {
  const title = String(input.title || "").trim();
  const summary = String(input.summary || "").trim();
  const sourceIds = normalizeArray(input.sourceIds);
  const memoryIds = normalizeArray(input.memoryIds);
  if (!title) userError("Missing L2 scene title.");
  if (!summary) userError("Missing L2 scene summary.");
  if (!sourceIds.length && !memoryIds.length) userError("L2 scene requires source IDs or memory IDs.");
  assertPromotable(`${title}\n${summary}`, "L2 scene");
  const now = new Date().toISOString();
  const scene = {
    id: input.id || createId("l2"),
    title,
    summary,
    sourceIds,
    memoryIds,
    createdAt: now,
  };
  runTransaction(db, () => {
    const result = db.prepare(`
      INSERT INTO l2_scenes (id, title, summary, source_ids_json, memory_ids_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      scene.id,
      scene.title,
      scene.summary,
      JSON.stringify(scene.sourceIds),
      JSON.stringify(scene.memoryIds),
      scene.createdAt,
    );
    db.prepare("INSERT INTO l2_fts(rowid, title, summary) VALUES (?, ?, ?)").run(result.lastInsertRowid, scene.title, scene.summary);
  });
  return scene;
}

export function upsertL3Profile(root, input) {
  return withMemoryDb(root, (db) => upsertL3ProfileWithDb(db, input));
}

export function upsertL3ProfileWithDb(db, input) {
  const key = normalizeProfileKey(input.key || "profile");
  const content = String(input.content || "").trim();
  const sourceIds = normalizeArray(input.sourceIds);
  if (!content) userError("Missing L3 profile content.");
  if (!sourceIds.length) userError("L3 profile requires at least one source ID.");
  assertPromotable(content, "L3 profile");
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO l3_profile (key, content, source_ids_json, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      content = excluded.content,
      source_ids_json = excluded.source_ids_json,
      updated_at = excluded.updated_at
  `).run(key, content, JSON.stringify(sourceIds), now);
  return { key, content, sourceIds, updatedAt: now };
}

export function recallMemory(root, input = {}) {
  return withMemoryDb(root, (db) => {
    const query = normalizeSearchQuery(input.query);
    const limit = normalizeLimit(input.limit, 5);
    return {
      query,
      l3Profile: listL3ProfileWithDb(db),
      l1Memories: searchL1WithDb(db, query, limit),
      l2Scenes: searchL2WithDb(db, query, limit),
    };
  });
}

export function searchConversation(root, input = {}) {
  return withMemoryDb(root, (db) => {
    const query = normalizeSearchQuery(input.query);
    const limit = normalizeLimit(input.limit, 10);
    return searchL0WithDb(db, query, limit);
  });
}

export function getMemoryStats(root) {
  return withMemoryDb(root, (db) => ({
    sessions: db.prepare("SELECT COUNT(*) AS count FROM sessions").get().count,
    l0Records: db.prepare("SELECT COUNT(*) AS count FROM l0_records").get().count,
    l1Memories: db.prepare("SELECT COUNT(*) AS count FROM l1_memories").get().count,
    l2Scenes: db.prepare("SELECT COUNT(*) AS count FROM l2_scenes").get().count,
    l3Profiles: db.prepare("SELECT COUNT(*) AS count FROM l3_profile").get().count,
    dbPath: memoryDbPath(root),
  }));
}

export function mirrorL3ProfileToMemory(root) {
  const profile = recallMemory(root, { limit: 20 }).l3Profile;
  const profileLines = profile.length
    ? profile.map((item) => `- ${item.key}: ${item.content}`).join("\n")
    : "- No layered memory profile recorded.";
  const path = join(root, ".projects", "MEMORY.md");
  const markdown = existsSync(path) ? readFileSync(path, "utf8") : readProjectFile(root, "MEMORY.md");
  const next = replaceSection(markdown, "Layered Memory Profile", profileLines);
  writeTextFileAtomic(path, next);
  return profile;
}

function searchL0WithDb(db, query, limit) {
  if (!query) {
    return db.prepare(`
      SELECT id, session_id, role, source, content, unsafe, metadata_json, created_at
      FROM l0_records
      ORDER BY created_at DESC
      LIMIT ?
    `).all(limit).map(mapL0Row);
  }
  const ftsQuery = toFtsQuery(query);
  if (!ftsQuery) return [];
  return db.prepare(`
    SELECT l0_records.id, l0_records.session_id, l0_records.role, l0_records.source, l0_records.content, l0_records.unsafe, l0_records.metadata_json, l0_records.created_at
    FROM l0_fts
    JOIN l0_records ON l0_records.rowid = l0_fts.rowid
    WHERE l0_fts MATCH ?
    ORDER BY rank
    LIMIT ?
  `).all(ftsQuery, limit).map(mapL0Row);
}

function searchL1WithDb(db, query, limit) {
  if (!query) {
    return db.prepare(`
      SELECT id, type, content, confidence, source_ids_json, metadata_json, created_at
      FROM l1_memories
      ORDER BY created_at DESC
      LIMIT ?
    `).all(limit).map(mapL1Row);
  }
  const ftsQuery = toFtsQuery(query);
  if (!ftsQuery) return [];
  return db.prepare(`
    SELECT l1_memories.id, l1_memories.type, l1_memories.content, l1_memories.confidence, l1_memories.source_ids_json, l1_memories.metadata_json, l1_memories.created_at
    FROM l1_fts
    JOIN l1_memories ON l1_memories.rowid = l1_fts.rowid
    WHERE l1_fts MATCH ?
    ORDER BY rank
    LIMIT ?
  `).all(ftsQuery, limit).map(mapL1Row);
}

function searchL2WithDb(db, query, limit) {
  if (!query) {
    return db.prepare(`
      SELECT id, title, summary, source_ids_json, memory_ids_json, created_at
      FROM l2_scenes
      ORDER BY created_at DESC
      LIMIT ?
    `).all(limit).map(mapL2Row);
  }
  const ftsQuery = toFtsQuery(query);
  if (!ftsQuery) return [];
  return db.prepare(`
    SELECT l2_scenes.id, l2_scenes.title, l2_scenes.summary, l2_scenes.source_ids_json, l2_scenes.memory_ids_json, l2_scenes.created_at
    FROM l2_fts
    JOIN l2_scenes ON l2_scenes.rowid = l2_fts.rowid
    WHERE l2_fts MATCH ?
    ORDER BY rank
    LIMIT ?
  `).all(ftsQuery, limit).map(mapL2Row);
}

function listL3ProfileWithDb(db) {
  return db.prepare(`
    SELECT key, content, source_ids_json, updated_at
    FROM l3_profile
    ORDER BY key ASC
  `).all().map((row) => ({
    key: row.key,
    content: row.content,
    sourceIds: parseJsonArray(row.source_ids_json),
    updatedAt: row.updated_at,
  }));
}

function getSessionById(db, id) {
  const row = db.prepare(`
    SELECT id, agent_id, platform, workspace, goal, status, started_at, ended_at
    FROM sessions
    WHERE id = ?
  `).get(id);
  if (!row) return null;
  return {
    id: row.id,
    agentId: row.agent_id,
    platform: row.platform,
    workspace: row.workspace,
    goal: row.goal,
    status: row.status,
    startedAt: row.started_at,
    endedAt: row.ended_at,
  };
}

function mapL0Row(row) {
  return {
    id: row.id,
    sessionId: row.session_id,
    role: row.role,
    source: row.source,
    content: row.content,
    unsafe: Boolean(row.unsafe),
    metadata: parseJsonObject(row.metadata_json),
    createdAt: row.created_at,
  };
}

function mapL1Row(row) {
  return {
    id: row.id,
    type: row.type,
    content: row.content,
    confidence: row.confidence,
    sourceIds: parseJsonArray(row.source_ids_json),
    metadata: parseJsonObject(row.metadata_json),
    createdAt: row.created_at,
  };
}

function mapL2Row(row) {
  return {
    id: row.id,
    title: row.title,
    summary: row.summary,
    sourceIds: parseJsonArray(row.source_ids_json),
    memoryIds: parseJsonArray(row.memory_ids_json),
    createdAt: row.created_at,
  };
}

function sanitizeL0Content(content) {
  let output = String(content);
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
  if (unsafeBrowserArtifact(output)) {
    unsafe = true;
    output = output
      .replace(/<!doctype html[\s\S]*/i, "[REDACTED RAW BROWSER CONTENT]")
      .replace(/<html[\s\S]*/i, "[REDACTED RAW BROWSER CONTENT]")
      .replace(/\braw log\b/gi, "[REDACTED RAW LOG]")
      .replace(/\bfull log\b/gi, "[REDACTED RAW LOG]");
  }
  return { content: output.trim(), unsafe };
}

function assertPromotable(content, label) {
  if (unsafeMemory(content) || unsafeBrowserArtifact(content)) {
    userError(`${label} appears to contain secrets, PII, raw logs, or raw browser content and cannot be promoted.`);
  }
}

function userError(message) {
  throw new Error(message);
}

function toFtsQuery(query) {
  const terms = normalizeSearchQuery(query)
    .toLowerCase()
    .match(/[\p{L}\p{N}_-]+/gu);
  if (!terms || !terms.length) return "";
  return terms.slice(0, MAX_FTS_TERMS).map((term) => `"${term.replaceAll('"', '""')}"`).join(" AND ");
}

function runTransaction(db, fn) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

function normalizeArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  return [String(value).trim()].filter(Boolean);
}

function normalizeLimit(limit, fallback) {
  const parsed = Number.parseInt(limit ?? fallback, 10);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, MAX_SEARCH_LIMIT) : fallback;
}

function normalizeSearchQuery(query) {
  return String(query || "").trim().slice(0, MAX_QUERY_CHARS);
}

function normalizeProfileKey(key) {
  return String(key).trim().toLowerCase().replaceAll(" ", "_") || "profile";
}

function tapheluHome() {
  return process.env[TAPHELU_HOME_ENV] || join(homedir(), ".taphelu");
}

function workspaceKey(root) {
  const digest = createHash("sha256").update(root).digest("hex").slice(0, 16);
  const slug = root.split(/[\\/]/).filter(Boolean).at(-1)?.replace(/[^a-z0-9._-]+/gi, "-") || "workspace";
  return `${slug}-${digest}`;
}

function createId(prefix) {
  return `${prefix}_${Date.now()}_${randomBytes(4).toString("hex")}`;
}

function parseJsonArray(value) {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseJsonObject(value) {
  try {
    const parsed = JSON.parse(value || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}
