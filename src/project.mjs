import { randomBytes } from "node:crypto";
import { appendFileSync, existsSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const TX_PREFIX = ".tx-";
const TX_SUFFIX = ".json";
const APPEND_ONLY_PROJECT_FILES = new Set(["events.jsonl"]);
const TX_RECOVERY_GRACE_MS = 30_000;
let activeTransaction = null;

export function findProjectRoot(start) {
  let dir = resolve(start);
  while (true) {
    if (existsSync(join(dir, ".projects", "PROJECT.md"))) {
      recoverProjectTransactions(dir);
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export function readProjectFile(root, name) {
  const path = join(root, ".projects", name);
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

export function writeTextFileAtomic(path, content) {
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
  try {
    writeFileSync(tmp, content);
    renameSync(tmp, path);
  } catch (error) {
    if (existsSync(tmp)) unlinkSync(tmp);
    throw error;
  }
}

export function writeProjectFile(root, name, content) {
  writeTextFileAtomic(join(root, ".projects", name), content);
}

export function withProjectFilesTransaction(root, names, fn) {
  recoverProjectTransactions(root);
  const snapshots = names.map((name) => snapshotFile(join(root, ".projects", name)));
  const journalPath = transactionJournalPath(root);
  const transaction = { root, journalPath, snapshots };
  writeTransactionJournal(journalPath, "pending", snapshots);
  const previousTransaction = activeTransaction;
  activeTransaction = transaction;
  try {
    const result = fn();
    writeTransactionJournal(journalPath, "committed", []);
    unlinkIfExists(journalPath);
    return result;
  } catch (error) {
    rollbackSnapshots(snapshots, error);
    unlinkIfExists(journalPath);
    throw error;
  } finally {
    activeTransaction = previousTransaction;
  }
}

export function relativeProjectPath(root, path) {
  return relative(root, path) || ".";
}

export function appendProjectFile(root, name, content) {
  const path = join(root, ".projects", name);
  const snapshot = activeTransaction?.root === root
    ? activeTransaction.snapshots.find((item) => item.path === path && item.appendOnly)
    : null;
  if (snapshot) {
    snapshot.appended = `${snapshot.appended || ""}${content}`;
    snapshot.appendedChunks = [...(snapshot.appendedChunks || []), content];
    writeTransactionJournal(activeTransaction.journalPath, "pending", activeTransaction.snapshots);
  }
  appendFileSync(path, content);
}

export function recoverProjectTransactions(root) {
  const projectsDir = join(root, ".projects");
  if (!existsSync(projectsDir)) return;
  for (const entry of readdirSync(projectsDir)) {
    if (!entry.startsWith(TX_PREFIX) || !entry.endsWith(TX_SUFFIX)) continue;
    const path = join(projectsDir, entry);
    const journal = readTransactionJournal(path);
    if (journal?.status === "pending" && Array.isArray(journal.snapshots)) {
      if (!shouldRecoverJournal(journal)) continue;
      rollbackSnapshots(journal.snapshots, new Error(`Recovered interrupted transaction ${entry}.`));
    }
    unlinkIfExists(path);
  }
}

function snapshotFile(path) {
  const appendOnly = APPEND_ONLY_PROJECT_FILES.has(path.split(/[\\/]/).at(-1));
  return {
    path,
    exists: existsSync(path),
    appendOnly,
    appended: "",
    appendedChunks: [],
    baseLength: appendOnly && existsSync(path) ? readFileSync(path, "utf8").length : 0,
    content: appendOnly ? "" : existsSync(path) ? readFileSync(path, "utf8") : "",
  };
}

function rollbackSnapshots(snapshots, originalError) {
  const failures = [];
  for (const snapshot of snapshots.slice().reverse()) {
    try {
      if (snapshot.appendOnly) {
        rollbackAppendOnlySnapshot(snapshot);
        continue;
      }
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

function rollbackAppendOnlySnapshot(snapshot) {
  const chunks = snapshot.appendedChunks?.length ? snapshot.appendedChunks : snapshot.appended ? [snapshot.appended] : [];
  if (!existsSync(snapshot.path) || !chunks.length) return;
  let next = readFileSync(snapshot.path, "utf8");
  for (const chunk of chunks.slice().reverse()) {
    const suffix = next.slice(snapshot.baseLength || 0);
    const appendedAt = suffix.indexOf(chunk);
    if (appendedAt === -1) continue;
    const start = (snapshot.baseLength || 0) + appendedAt;
    next = `${next.slice(0, start)}${next.slice(start + chunk.length)}`;
  }
  if (!snapshot.exists && !next) {
    unlinkSync(snapshot.path);
    return;
  }
  writeTextFileAtomic(snapshot.path, next);
}

function transactionJournalPath(root) {
  return join(root, ".projects", `${TX_PREFIX}${process.pid}-${Date.now()}-${randomBytes(2).toString("hex")}${TX_SUFFIX}`);
}

function writeTransactionJournal(path, status, snapshots) {
  writeTextFileAtomic(path, `${JSON.stringify({ status, pid: process.pid, updatedAt: Date.now(), snapshots })}\n`);
}

function readTransactionJournal(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function unlinkIfExists(path) {
  if (existsSync(path)) unlinkSync(path);
}

function shouldRecoverJournal(journal) {
  if (journal.pid) return !processIsAlive(journal.pid);
  return !journal.updatedAt || Date.now() - journal.updatedAt >= TX_RECOVERY_GRACE_MS;
}

function processIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}
