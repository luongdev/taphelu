import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { EVENT_TYPES } from "./constants.mjs";
import { appendEvent, timestampForId } from "./events.mjs";
import { fail } from "./errors.mjs";
import { readProjectConfig } from "./project-config.mjs";
import { readProjectFile, withProjectFilesTransaction, writeTextFileAtomic } from "./project.mjs";
import { escapeTable, formatList, replaceSection, section, unsafeMemory } from "./utils.mjs";

const CONTEXT_INDEX_FILE = "index.json";
const CONTEXT_ENTRY_FILE = "CONTEXT.md";
const PROJECT_ROOT_SKIP = new Set(["config.json", "events.jsonl", CONTEXT_INDEX_FILE, CONTEXT_ENTRY_FILE]);
const TEXT_EXTENSIONS = new Set([".md", ".mmd", ".json", ".yaml", ".yml", ".txt"]);
const MAX_INDEX_SUMMARY_CHARS = 220;
const DEFAULT_GET_CHARS = 4000;

export function analyzeContextIndex(root) {
  const config = readProjectConfig(root);
  const store = resolveContextStore(root, config);
  const index = buildContextIndex(root, config, store);
  const context = buildContextDocument(root, index, config, store);
  const currentIndex = readProjectFile(root, CONTEXT_INDEX_FILE);
  const currentContext = readProjectFile(root, CONTEXT_ENTRY_FILE);
  return {
    kind: "context_index",
    store: publicStore(store),
    index,
    context,
    files: [
      fileChange(CONTEXT_INDEX_FILE, currentIndex, `${JSON.stringify(index, null, 2)}\n`),
      fileChange(CONTEXT_ENTRY_FILE, currentContext, context),
    ],
    nextRoute: "write_optional",
  };
}

export function applyContextIndex(root, report) {
  withProjectFilesTransaction(root, [CONTEXT_INDEX_FILE, CONTEXT_ENTRY_FILE, "events.jsonl"], () => {
    writeProjectArtifact(root, CONTEXT_INDEX_FILE, `${JSON.stringify(report.index, null, 2)}\n`);
    writeProjectArtifact(root, CONTEXT_ENTRY_FILE, report.context);
    appendContextEvent(root, EVENT_TYPES.CONTEXT_INDEXED, "Context index refreshed.", {
      artifact_count: report.index.artifacts.length,
      store: report.store,
    });
  });
}

export function buildContextIndex(root, config = readProjectConfig(root), store = resolveContextStore(root, config)) {
  validateStore(root, store);
  const artifacts = [
    ...collectArtifacts(root, join(root, ".projects"), ".projects"),
    ...(store.kind === "project" ? [] : collectArtifacts(root, store.root, store.displayPath)),
  ]
    .filter((artifact, index, all) => all.findIndex((item) => item.path === artifact.path) === index)
    .sort((a, b) => a.id.localeCompare(b.id));
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    store: publicStore(store),
    loadPolicy: {
      alwaysLoad: [".projects/CONTEXT.md", ".projects/STATE.md", ".projects/MEMORY.md"],
      searchFirst: true,
      fullArtifactOnDemand: true,
      maxAlwaysLoadChars: config.context.compaction.max_always_load_chars,
    },
    artifacts,
  };
}

export function buildContextDocument(root, index, config = readProjectConfig(root), store = resolveContextStore(root, config)) {
  const recentArtifacts = index.artifacts
    .filter((artifact) => !["state", "memory"].includes(artifact.type))
    .slice(0, 12);
  const body = `# Taphelu Context

## Load Policy

- Default agent context loads this file plus STATE.md and MEMORY.md only.
- Runtime state source of truth is STATE.md or the structured fields returned by \`dl_context\`; this file intentionally does not mirror state.
- Use \`dl context search <query>\` before reading large artifacts.
- Use \`dl context get <id>\` for targeted artifact loading.
- Use \`dl compact milestone --id <id> --write\` after verified closeout.
- Never promote raw logs, raw browser content, secrets, or PII into durable context.

## Store

- Kind: \`${store.kind}\`
- Path: \`${store.displayPath}\`
- Max always-load chars: ${config.context.compaction.max_always_load_chars}
- After close: \`${config.context.compaction.after_close}\`

## Indexed Artifacts

${recentArtifacts.length ? recentArtifacts.map((artifact) => `- \`${artifact.id}\`: ${artifact.title}`).join("\n") : "- None yet."}
`;
  return clampContext(body, config.context.compaction.max_always_load_chars);
}

export function searchContextArtifacts(root, query, input = {}) {
  const normalized = String(query || "").trim();
  if (!normalized) fail("Missing context search query.");
  const index = input.index || readOrBuildContextIndex(root);
  const tokens = normalized.toLowerCase().split(/\s+/).filter(Boolean);
  const results = index.artifacts
    .map((artifact) => ({ artifact, score: scoreArtifact(artifact, tokens) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.artifact.id.localeCompare(b.artifact.id))
    .slice(0, input.limit || 20)
    .map((item) => item.artifact);
  return {
    kind: "context_search",
    query: normalized,
    results,
    nextRoute: results.length ? "get_artifact" : "refine_query",
  };
}

export function getContextArtifact(root, id, input = {}) {
  const artifactId = String(id || "").trim();
  if (!artifactId) fail("Missing context artifact id.");
  const index = input.index || readOrBuildContextIndex(root);
  const artifact = index.artifacts.find((item) => item.id === artifactId);
  if (!artifact) fail(`Unknown context artifact id: ${artifactId}`);
  const path = resolveArtifactPath(root, artifact.path);
  if (!existsSync(path)) fail(`Context artifact is missing: ${artifact.path}`);
  const raw = readFileSync(path, "utf8");
  const selected = selectLineRange(raw, input);
  const maxChars = input.full ? Number.POSITIVE_INFINITY : input.maxChars || DEFAULT_GET_CHARS;
  const content = safeContentPreview(selected.content, maxChars);
  return {
    kind: "context_artifact",
    artifact,
    lineRange: selected.lineRange,
    content,
    truncated: Boolean(selected.lineRange) || content.length < raw.length,
    nextRoute: "continue",
  };
}

export function analyzeMilestoneCompaction(root, input = {}) {
  const id = normalizeMilestoneId(input.id);
  const config = readProjectConfig(root);
  const store = resolveContextStore(root, config);
  validateStore(root, store);
  const milestoneRoot = join(store.root, "milestones", id);
  const summaryPath = join(milestoneRoot, "SUMMARY.md");
  const summary = buildMilestoneSummary(root, id);
  const current = existsSync(summaryPath) ? readFileSync(summaryPath, "utf8") : "";
  return {
    kind: "milestone_compaction",
    id,
    store: publicStore(store),
    files: [fileChange(displayPath(root, summaryPath), current, summary)],
    summaryPath,
    summary,
    nextRoute: "write_optional",
  };
}

export function applyMilestoneCompaction(root, report) {
  if (isProjectPath(root, report.summaryPath)) {
    withProjectFilesTransaction(root, [projectFileName(root, report.summaryPath), CONTEXT_INDEX_FILE, CONTEXT_ENTRY_FILE, "events.jsonl"], () => {
      writeAnyArtifact(report.summaryPath, report.summary);
      writeContextIndexInline(root);
      appendContextEvent(root, EVENT_TYPES.MILESTONE_COMPACTED, `Milestone ${report.id} compacted.`, {
        milestone_id: report.id,
        summary_path: displayPath(root, report.summaryPath),
      });
    });
    return;
  }
  writeAnyArtifact(report.summaryPath, report.summary);
  applyContextIndex(root, analyzeContextIndex(root));
  appendContextEvent(root, EVENT_TYPES.MILESTONE_COMPACTED, `Milestone ${report.id} compacted.`, {
    milestone_id: report.id,
    summary_path: displayPath(root, report.summaryPath),
  });
}

export function analyzeRunsCompaction(root, input = {}) {
  const config = readProjectConfig(root);
  const store = resolveContextStore(root, config);
  validateStore(root, store);
  const keep = parseKeepRuns(input.keep ?? config.context.compaction.keep_recent_runs);
  const runs = readProjectFile(root, "RUNS.md");
  const split = splitRuns(runs, keep, root, store);
  return {
    kind: "runs_compaction",
    keep,
    store: publicStore(store),
    split,
    files: [
      fileChange("RUNS.md", runs, split.nextRuns),
      fileChange(displayPath(root, split.indexPath), existsSync(split.indexPath) ? readFileSync(split.indexPath, "utf8") : "", split.indexContent),
      ...split.runFiles.map((file) => fileChange(displayPath(root, file.path), existsSync(file.path) ? readFileSync(file.path, "utf8") : "", file.content)),
    ],
    nextRoute: "write_optional",
  };
}

export function applyRunsCompaction(root, report) {
  const artifactPaths = [report.split.indexPath, ...report.split.runFiles.map((file) => file.path)];
  if (artifactPaths.every((path) => isProjectPath(root, path))) {
    const names = ["RUNS.md", CONTEXT_INDEX_FILE, CONTEXT_ENTRY_FILE, "events.jsonl", ...artifactPaths.map((path) => projectFileName(root, path))];
    withProjectFilesTransaction(root, names, () => {
      for (const file of report.split.runFiles) writeAnyArtifact(file.path, file.content);
      writeAnyArtifact(report.split.indexPath, report.split.indexContent);
      writeProjectArtifact(root, "RUNS.md", report.split.nextRuns);
      writeContextIndexInline(root);
      appendContextEvent(root, EVENT_TYPES.RUNS_COMPACTED, "Run history compacted into indexed artifacts.", {
        keep_recent_runs: report.keep,
        run_artifacts: report.split.runFiles.length,
      });
    });
    return;
  }
  for (const file of report.split.runFiles) writeAnyArtifact(file.path, file.content);
  writeAnyArtifact(report.split.indexPath, report.split.indexContent);
  withProjectFilesTransaction(root, ["RUNS.md", "events.jsonl"], () => {
    writeProjectArtifact(root, "RUNS.md", report.split.nextRuns);
    appendContextEvent(root, EVENT_TYPES.RUNS_COMPACTED, "Run history compacted into indexed artifacts.", {
      keep_recent_runs: report.keep,
      run_artifacts: report.split.runFiles.length,
    });
  });
  applyContextIndex(root, analyzeContextIndex(root));
}

export function analyzePlanCompaction(root) {
  const config = readProjectConfig(root);
  const store = resolveContextStore(root, config);
  validateStore(root, store);
  const source = firstExistingPlan(root);
  const timestamp = timestampForId();
  const archivePath = join(store.root, "archive", "plans", `${timestamp}-PLAN.md`);
  const sourceContent = source ? readFileSync(source.absolutePath, "utf8") : "";
  const archived = sourceContent
    ? `# Archived Plan

- Source: \`${source.displayPath}\`
- Archived at: ${new Date().toISOString()}

${safeContentPreview(sourceContent, Number.POSITIVE_INFINITY).trim()}
`
    : "";
  const activePointer = source?.displayPath === ".projects/active/PLAN.md"
    ? `# Active Plan

No active plan. Last archived plan: \`${displayPath(root, archivePath)}\`.
`
    : "";
  return {
    kind: "plan_compaction",
    source,
    archivePath,
    archived,
    activePointer,
    store: publicStore(store),
    files: source ? [
      fileChange(displayPath(root, archivePath), existsSync(archivePath) ? readFileSync(archivePath, "utf8") : "", archived),
      ...(activePointer ? [fileChange(".projects/active/PLAN.md", sourceContent, activePointer)] : []),
    ] : [],
    nextRoute: source ? "write_optional" : "done",
  };
}

export function applyPlanCompaction(root, report) {
  if (!report.source) return;
  if (isProjectPath(root, report.archivePath)) {
    const names = [projectFileName(root, report.archivePath), "active/PLAN.md", CONTEXT_INDEX_FILE, CONTEXT_ENTRY_FILE, "events.jsonl"];
    withProjectFilesTransaction(root, names, () => {
      writeAnyArtifact(report.archivePath, report.archived);
      if (report.activePointer) writeProjectArtifact(root, "active/PLAN.md", report.activePointer);
      writeContextIndexInline(root);
      appendContextEvent(root, EVENT_TYPES.PLAN_ARCHIVED, "Completed plan archived as an indexed artifact.", {
        source_path: report.source.displayPath,
        archive_path: displayPath(root, report.archivePath),
      });
    });
    return;
  }
  writeAnyArtifact(report.archivePath, report.archived);
  withProjectFilesTransaction(root, ["active/PLAN.md", "events.jsonl"], () => {
    if (report.activePointer) writeProjectArtifact(root, "active/PLAN.md", report.activePointer);
    appendContextEvent(root, EVENT_TYPES.PLAN_ARCHIVED, "Completed plan archived as an indexed artifact.", {
      source_path: report.source.displayPath,
      archive_path: displayPath(root, report.archivePath),
    });
  });
  applyContextIndex(root, analyzeContextIndex(root));
}

export function buildContextIndexReport(report, didWrite = false) {
  return `# Context Index Report

## Mode

${didWrite ? "write" : "preview"}

## Store

- Kind: \`${report.store.kind}\`
- Path: \`${report.store.path}\`

## Files

${formatFileChanges(report.files)}

## Artifacts

${formatArtifactRows(report.index.artifacts.slice(0, 25))}

## Write Behavior

${didWrite ? "- Wrote `.projects/CONTEXT.md` and `.projects/index.json`." : "- Add `--write` to persist the context index. Preview mode writes nothing."}

## Next Route

\`${didWrite ? "done" : report.nextRoute}\`
`;
}

export function buildContextSearchReport(report) {
  return `# Context Search

## Query

\`${report.query}\`

## Results

${formatArtifactRows(report.results)}

## Next Route

\`${report.nextRoute}\`
`;
}

export function buildContextArtifactReport(report) {
  const lineSection = report.lineRange ? `## Lines\n\n${report.lineRange.start}-${report.lineRange.end}\n\n` : "";
  const truncated = report.truncated ? "Content was truncated or line-limited.\n\n" : "";
  return `# Context Artifact

## Artifact

- ID: \`${report.artifact.id}\`
- Type: \`${report.artifact.type}\`
- Path: \`${report.artifact.path}\`
- Summary: ${report.artifact.summary || "None."}

## Content

\`\`\`markdown
${report.content.trimEnd()}
\`\`\`

${lineSection}${truncated}## Next Route

\`${report.nextRoute}\`
`;
}

export function buildCompactionReport(report, didWrite = false) {
  const title = {
    milestone_compaction: "Milestone Compaction Report",
    runs_compaction: "Runs Compaction Report",
    plan_compaction: "Plan Compaction Report",
  }[report.kind] || "Context Compaction Report";
  return `# ${title}

## Mode

${didWrite ? "write" : "preview"}

## Store

- Kind: \`${report.store.kind}\`
- Path: \`${report.store.path}\`

## Files

${formatFileChanges(report.files)}

## Write Behavior

${didWrite ? "- Compaction was written and context index refreshed." : "- Add `--write` to persist compaction. Preview mode writes nothing."}

## Next Route

\`${didWrite ? "done" : report.nextRoute}\`
`;
}

export function publicContextIndexSummary(report) {
  return {
    store: report.store,
    artifactCount: report.index.artifacts.length,
    files: report.files.map((file) => publicFileChange(file)),
    artifacts: report.index.artifacts.slice(0, 25),
    nextRoute: report.nextRoute,
  };
}

export function publicCompactionSummary(report) {
  return {
    kind: report.kind,
    store: report.store,
    files: (report.files || []).map((file) => publicFileChange(file)),
    nextRoute: report.nextRoute,
  };
}

export function readOrBuildContextIndex(root) {
  return readExistingContextIndex(root) || buildContextIndex(root);
}

export function readExistingContextIndex(root) {
  const raw = readProjectFile(root, CONTEXT_INDEX_FILE);
  if (raw.trim()) {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
  return null;
}

function collectArtifacts(root, base, displayBase) {
  if (!existsSync(base)) return [];
  const files = [];
  walk(base, files);
  return files
    .filter((path) => shouldIndexFile(root, path, base))
    .map((path) => artifactFromFile(root, path, displayPathFromBase(root, path, base, displayBase)))
    .filter(Boolean);
}

function walk(dir, files) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".tx-")) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (["node_modules", ".git"].includes(entry.name)) continue;
      walk(path, files);
    } else if (entry.isFile()) {
      files.push(path);
    }
  }
}

function shouldIndexFile(root, path, base) {
  const name = basename(path);
  if (!TEXT_EXTENSIONS.has(extension(name))) return false;
  const rel = relative(base, path).replaceAll("\\", "/");
  if (PROJECT_ROOT_SKIP.has(rel)) return false;
  if (rel.startsWith("memory/")) return false;
  if (rel.startsWith("graphs/") && name.endsWith(".json")) return true;
  return true;
}

function artifactFromFile(root, absolutePath, display) {
  const content = readFileSync(absolutePath, "utf8");
  const stat = statSync(absolutePath);
  const type = artifactType(display);
  const title = artifactTitle(content, display);
  const summary = summarizeArtifact(content, display);
  const id = artifactId(type, display);
  return {
    id,
    type,
    title,
    summary,
    tags: artifactTags(type, display),
    path: display,
    updatedAt: stat.mtime.toISOString(),
    lifecycle: artifactLifecycle(display),
    fingerprint: contentFingerprint(content),
    size: {
      lines: content.trim() ? content.trimEnd().split(/\r?\n/).length : 0,
      chars: content.length,
    },
  };
}

function artifactType(display) {
  const path = display.replaceAll("\\", "/");
  if (path.endsWith("/STATE.md") || path.endsWith(".projects/STATE.md")) return "state";
  if (path.endsWith("/MEMORY.md") || path.endsWith(".projects/MEMORY.md")) return "memory";
  if (path.includes(".projects/plans/tasks/") || path.includes("/plans/tasks/")) return "task";
  if (path.includes(".projects/plans/stories/") || path.includes("/plans/stories/")) return "story";
  if (path.includes(".projects/plans/runs/") || path.includes("/plans/runs/")) return "task-run";
  if (path.includes(".projects/plans/milestones/") || path.includes("/plans/milestones/")) return "milestone";
  if (path.includes("/milestones/")) return "milestone";
  if (path.includes("/runs/")) return "run";
  if (path.includes("/archive/")) return "archive";
  if (path.includes("/active/")) return "active";
  if (path.includes("/scans/") || /CODEBASE|SERVICE-MAP|API-CONTRACTS|DOMAIN|SCAN-PLAN/.test(path)) return "scan";
  if (path.includes(".projects/contracts/") || path.includes("/contracts/")) return "contract";
  if (/ROADMAP|MILESTONE-PLANS/.test(path)) return "roadmap";
  if (path.includes("/graphs/")) return "graph";
  return "artifact";
}

function artifactTitle(content, display) {
  const heading = stripFrontmatter(content).match(/^#\s+(.+?)\s*$/m)?.[1];
  if (heading) return singleLine(heading);
  return basename(display);
}

function summarizeArtifact(content, display) {
  if (unsafeMemory(content)) return "Content may contain sensitive or noisy details; load only with explicit need.";
  const lines = stripFrontmatter(content)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#") && !unsafeMemory(line));
  const summary = lines.slice(0, 3).join(" ");
  return clamp(singleLine(summary || artifactTitle(content, display)), MAX_INDEX_SUMMARY_CHARS);
}

function stripFrontmatter(content) {
  const text = String(content || "");
  const start = text.match(/^---\r?\n/);
  if (!start) return text;
  const end = text.search(/\r?\n---/);
  if (end === -1 || end === 0) return text;
  const close = text.slice(end).match(/^\r?\n---/)[0];
  return text.slice(end + close.length).trimStart();
}

function artifactId(type, display) {
  const path = display.replaceAll("\\", "/");
  const planMilestone = path.match(/plans\/milestones\/([^/]+)\.(?:md|json)$/);
  if (planMilestone) return `milestone:${planMilestone[1]}`;
  const story = path.match(/plans\/stories\/([^/]+)\.(?:md|json)$/);
  if (story) return `story:${story[1]}`;
  const task = path.match(/plans\/tasks\/([^/]+)\.(?:md|json)$/);
  if (task) return `task:${task[1]}`;
  const taskRun = path.match(/plans\/runs\/([^/]+)\/([^/]+)$/);
  if (taskRun) return `task-run:${taskRun[1]}-${taskRun[2].replace(/\.[^.]+$/, "")}`;
  const milestone = path.match(/milestones\/([^/]+)\/SUMMARY\.md$/);
  if (milestone) return `milestone:${milestone[1]}`;
  const run = path.match(/runs\/(run-[^/]+)\.md$/);
  if (run) return `run:${run[1]}`;
  const normalized = path
    .replace(/^\.projects\//, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
  return `${type}:${normalized || "root"}`;
}

function artifactTags(type, display) {
  const parts = display.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  return [...new Set([type, ...parts])].slice(0, 12);
}

function scoreArtifact(artifact, tokens) {
  const haystack = [
    artifact.id,
    artifact.type,
    artifact.title,
    artifact.summary,
    artifact.path,
    ...(artifact.tags || []),
  ].join(" ").toLowerCase();
  return tokens.reduce((score, token) => score + (haystack.includes(token) ? 1 : 0), 0);
}

function buildMilestoneSummary(root, id) {
  const state = readProjectFile(root, "STATE.md");
  const memory = readProjectFile(root, "MEMORY.md");
  const artifacts = [
    "STATE.md",
    "MEMORY.md",
    "CODEBASE.md",
    "DOMAIN.md",
    "SCAN-PLAN.md",
    "SERVICE-MAP.md",
    "API-CONTRACTS.md",
    "RUNS.md",
    "active/PLAN.md",
    "PLAN.md",
    "plans/index.json",
  ].filter((name) => readProjectFile(root, name).trim());
  return `# Milestone ${id} Summary

## Status

Compacted after verified closeout.

## Current State

- Goal: ${singleLine(section(state, "Current Goal") || "None.")}
- Phase: ${singleLine(section(state, "Current Phase") || "None.")}
- Next action: ${singleLine(section(state, "Next Action") || "None.")}
- Last verification: ${singleLine(section(state, "Last Verification") || "None.")}

## Durable Decisions

${formatSafeBullets(section(memory, "Product Decisions"), 8)}

## Architecture Notes

${formatSafeBullets(section(memory, "Architecture Decisions"), 8)}

## Evidence Pointers

${formatList(artifacts.map((name) => `.projects/${name}`), "No project artifacts recorded.")}

## Load Policy

- Read this summary first when resuming milestone ${id}.
- Use \`dl context get <id>\` only for targeted drill-down.
- Do not copy raw runs, logs, browser content, secrets, or PII into always-loaded context.
`;
}

function splitRuns(markdown, keep, root, store) {
  const detailStart = markdown.search(/^## run-/m);
  const indexPart = detailStart === -1 ? markdown : markdown.slice(0, detailStart);
  const detailPart = detailStart === -1 ? "" : markdown.slice(detailStart);
  const preamble = runPreamble(indexPart);
  const details = detailPart
    .split(/\n(?=## run-)/)
    .map((item) => item.trim())
    .filter(Boolean);
  const rows = indexPart.split(/\r?\n/).filter((line) => line.startsWith("| run-"));
  const keepIds = new Set((keep === 0 ? [] : rows.slice(-keep)).map((line) => line.split("|")[1]?.trim()).filter(Boolean));
  const recentRows = rows.filter((line) => keepIds.has(line.split("|")[1]?.trim()));
  const indexContent = `# Run Artifact Index

| Run ID | Date | Goal | Outcome |
|---|---|---|---|
${rows.join("\n")}
`;
  const runFiles = details.map((detail) => {
    const id = detail.match(/^##\s+(run-[^\s]+)/)?.[1] || `run-${timestampForId()}`;
    return {
      id,
      path: join(store.root, "runs", `${id}.md`),
      content: `${safeContentPreview(detail, Number.POSITIVE_INFINITY).trim()}\n`,
    };
  });
  const nextRuns = `# Runs

${preamble ? `${preamble}\n\n` : ""}## Run Storage

Run details are stored as indexed artifacts. Use \`dl context search run\` or \`dl context get run:<run-id>\`.

## Recent Run Index

| Run ID | Date | Goal | Outcome |
|---|---|---|---|
${recentRows.join("\n")}
`;
  return {
    indexPath: join(store.root, "runs", "INDEX.md"),
    indexContent,
    runFiles,
    nextRuns,
  };
}

function firstExistingPlan(root) {
  const candidates = [
    { name: "active/PLAN.md", displayPath: ".projects/active/PLAN.md" },
    { name: "SCAN-PLAN.md", displayPath: ".projects/SCAN-PLAN.md" },
  ];
  for (const candidate of candidates) {
    const absolutePath = join(root, ".projects", candidate.name);
    if (existsSync(absolutePath) && readFileSync(absolutePath, "utf8").trim()) {
      return { ...candidate, absolutePath };
    }
  }
  return null;
}

function resolveContextStore(root, config) {
  const kind = config.context.store.kind;
  const rawPath = config.context.store.path || ".projects";
  const absolute = kind === "project" ? join(root, rawPath) : resolve(root, rawPath);
  return {
    kind,
    root: absolute,
    displayPath: displayPath(root, absolute),
  };
}

function validateStore(root, store) {
  if (store.kind === "git-submodule") {
    const gitPath = join(store.root, ".git");
    if (!existsSync(gitPath)) {
      fail(`Invalid context.store.path for git-submodule: ${store.displayPath}. Expected an existing git worktree or submodule path.`);
    }
  }
}

function readContextStoreConfig(root) {
  return readProjectConfig(root).context;
}

function safeContentPreview(content, maxChars) {
  const lines = String(content || "")
    .split(/\r?\n/)
    .filter((line) => !unsafeMemory(line));
  const safe = lines.join("\n");
  if (maxChars === Number.POSITIVE_INFINITY || safe.length <= maxChars) return safe;
  return `${safe.slice(0, maxChars).trimEnd()}\n\n[truncated]\n`;
}

function selectLineRange(content, input = {}) {
  const start = parseOptionalLine(input.startLine ?? input.start_line, "start-line");
  const end = parseOptionalLine(input.endLine ?? input.end_line, "end-line");
  if (start === undefined && end === undefined) return { content, lineRange: null };
  const lines = String(content || "").split(/\r?\n/);
  const normalizedStart = start ?? 1;
  const normalizedEnd = end ?? lines.length;
  if (normalizedEnd < normalizedStart) fail("Invalid line range: end-line must be greater than or equal to start-line.");
  return {
    content: lines.slice(normalizedStart - 1, normalizedEnd).join("\n"),
    lineRange: {
      start: normalizedStart,
      end: Math.min(normalizedEnd, lines.length),
    },
  };
}

function parseOptionalLine(value, label) {
  if (value === undefined || value === null || value === "") return undefined;
  if (!/^[1-9]\d*$/.test(String(value))) fail(`Invalid ${label}: ${value}. Expected a positive integer.`);
  return Number.parseInt(value, 10);
}

function parseKeepRuns(value) {
  if (!/^\d+$/.test(String(value))) fail(`Invalid keep: ${value}. Expected a non-negative integer.`);
  return Number.parseInt(value, 10);
}

function runPreamble(indexPart) {
  const lines = String(indexPart || "").split(/\r?\n/);
  const start = lines[0]?.trim() === "# Runs" ? 1 : 0;
  const runIndex = lines.findIndex((line) => /^##\s+Run Index\s*$/i.test(line.trim()));
  const end = runIndex === -1 ? lines.length : runIndex;
  return lines.slice(start, end).join("\n").trim();
}

function artifactLifecycle(display) {
  const path = display.replaceAll("\\", "/");
  if (path.includes("/active/")) return "active";
  if (path.includes("/archive/") || path.includes("/milestones/") || path.includes("/runs/")) return "historical";
  if (/ROADMAP|MILESTONE-PLANS/.test(path)) return "reference";
  return "current";
}

function contentFingerprint(content) {
  return createHash("sha256").update(String(content || "")).digest("hex").slice(0, 16);
}

function formatSafeBullets(markdown, limit) {
  const bullets = String(markdown || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- ") && !unsafeMemory(line))
    .slice(0, limit);
  return bullets.length ? bullets.join("\n") : "- None.";
}

function clampContext(content, maxChars) {
  if (content.length <= maxChars) return content;
  return `${content.slice(0, maxChars).trimEnd()}\n\n## Truncated\n\nUse \`dl context search\` for more.\n`;
}

function formatArtifactRows(artifacts) {
  if (!artifacts.length) return "- None.";
  return `| ID | Type | Path | Summary |
|---|---|---|---|
${artifacts.map((artifact) => `| \`${artifact.id}\` | ${artifact.type} | \`${escapeTable(artifact.path)}\` | ${escapeTable(artifact.summary)} |`).join("\n")}`;
}

function formatFileChanges(files = []) {
  if (!files.length) return "- No file changes.";
  return `| Status | File | Before Lines | After Lines |
|---|---|---:|---:|
${files.map((file) => `| ${file.changed ? "CHANGE" : "OK"} | \`${escapeTable(file.name)}\` | ${file.beforeLines} | ${file.afterLines} |`).join("\n")}`;
}

function fileChange(name, before, after) {
  return {
    name,
    before,
    after,
    changed: before !== after,
    beforeLines: lineCount(before),
    afterLines: lineCount(after),
  };
}

function publicFileChange(file) {
  return {
    name: file.name,
    changed: file.changed,
    beforeLines: file.beforeLines,
    afterLines: file.afterLines,
  };
}

function lineCount(value) {
  return String(value || "").trim() ? String(value).trimEnd().split(/\r?\n/).length : 0;
}

function singleLine(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function clamp(value, max) {
  const text = String(value || "").trim();
  return text.length > max ? `${text.slice(0, max - 3).trimEnd()}...` : text;
}

function extension(name) {
  const index = name.lastIndexOf(".");
  return index === -1 ? "" : name.slice(index).toLowerCase();
}

function normalizeMilestoneId(id) {
  const normalized = String(id || "").trim();
  if (!normalized) fail("Missing milestone id. Usage: dl compact milestone --id M23 [--write]");
  if (!/^[A-Za-z0-9._-]+$/.test(normalized)) fail(`Invalid milestone id: ${id}`);
  return normalized;
}

function resolveArtifactPath(root, display) {
  if (display.startsWith(".projects/")) return join(root, display);
  if (display.startsWith(".")) return resolve(root, display);
  return resolve(display);
}

function displayPath(root, path) {
  const rel = relative(root, path).replaceAll("\\", "/");
  return rel && !rel.startsWith("..") ? rel : path;
}

function displayPathFromBase(root, path, base, displayBase) {
  const rel = relative(base, path).replaceAll("\\", "/");
  return displayBase === ".projects" ? `.projects/${rel}` : `${displayBase.replace(/\/$/, "")}/${rel}`;
}

function writeProjectArtifact(root, name, content) {
  const path = join(root, ".projects", name);
  writeAnyArtifact(path, content);
}

function writeAnyArtifact(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  writeTextFileAtomic(path, content);
}

function appendContextEvent(root, type, summary, data) {
  appendEvent(root, {
    ts: new Date().toISOString(),
    type,
    run_id: `run-${timestampForId()}-context`,
    summary,
    data,
  });
}

function writeContextIndexInline(root) {
  const report = analyzeContextIndex(root);
  writeProjectArtifact(root, CONTEXT_INDEX_FILE, `${JSON.stringify(report.index, null, 2)}\n`);
  writeProjectArtifact(root, CONTEXT_ENTRY_FILE, report.context);
  appendContextEvent(root, EVENT_TYPES.CONTEXT_INDEXED, "Context index refreshed.", {
    artifact_count: report.index.artifacts.length,
    store: report.store,
  });
}

function publicStore(store) {
  return {
    kind: store.kind,
    path: store.displayPath,
  };
}

function isProjectPath(root, path) {
  const projectRoot = join(root, ".projects");
  return path === projectRoot || path.startsWith(`${projectRoot}/`);
}

function projectFileName(root, path) {
  return relative(join(root, ".projects"), path).replaceAll("\\", "/");
}
