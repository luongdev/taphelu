import { join } from "node:path";
import { parseArgs, parseLimit } from "../args.mjs";
import { EVENT_TYPES, MEMORY_CATEGORIES } from "../constants.mjs";
import { appendEvent, timestampForId } from "../events.mjs";
import { fail } from "../errors.mjs";
import { readProjectFile, withProjectFilesTransaction, writeTextFileAtomic } from "../project.mjs";
import { escapeTable, formatList, replaceSection, section, unsafeMemory } from "../utils.mjs";
import { memoryBullets } from "./memory.mjs";

export function runCleanup(root, rawArgs) {
  const [subcommand, ...rest] = rawArgs;
  if (subcommand !== "context") {
    fail("Missing cleanup subcommand. Usage: dl cleanup context [--limit n] [--dry-run|--write]");
  }
  const { options, values } = parseArgs(rest);
  if (values.length) fail("Unexpected positional value for dl cleanup context. Use flags.");
  const limit = parseLimit(options.limit ?? "5");
  const report = analyzeContextCleanup(root, { limit });
  if (options.write && !options["dry-run"]) applyContextCleanup(root, report);
  console.log(buildContextCleanupReport(report, Boolean(options.write && !options["dry-run"])));
}

export function analyzeContextCleanup(root, input = {}) {
  const limit = input.limit || 5;
  const state = readProjectFile(root, "STATE.md");
  const runs = readProjectFile(root, "RUNS.md");
  const memory = readProjectFile(root, "MEMORY.md");
  const nextState = compactState(state);
  const nextRuns = compactRuns(runs, limit);
  const nextMemory = compactMemory(memory);
  const files = [
    fileChange("STATE.md", state, nextState),
    fileChange("RUNS.md", runs, nextRuns),
    fileChange("MEMORY.md", memory, nextMemory),
  ];
  return {
    limit,
    files,
    changed: files.filter((file) => file.changed).length,
    recommendations: [
      "Run after a passed closeout, not during active implementation.",
      "Keep raw logs, raw browser content, PII, and secrets out of durable context.",
      "Use L0 search for drill-down instead of copying history into runtime instruction files.",
    ],
    nextRoute: files.some((file) => file.changed) ? "write_optional" : "done",
  };
}

export function applyContextCleanup(root, report) {
  withProjectFilesTransaction(root, ["events.jsonl", "STATE.md", "RUNS.md", "MEMORY.md"], () => {
    for (const file of report.files) {
      if (!file.changed) continue;
      writeTextFileAtomic(join(root, ".projects", file.name), file.after);
    }
    appendEvent(root, {
      ts: new Date().toISOString(),
      type: EVENT_TYPES.CONTEXT_CLEANED,
      run_id: `run-${timestampForId()}-cleanup`,
      summary: "Project context compacted after closeout.",
      data: {
        changed_files: report.files.filter((file) => file.changed).map((file) => file.name),
        runs_detail_limit: report.limit,
      },
    });
  });
}

export function buildContextCleanupReport(report, didWrite = false) {
  const rows = report.files
    .map((file) => `| ${file.changed ? "CHANGE" : "OK"} | ${file.name} | ${file.beforeLines} | ${file.afterLines} | ${escapeTable(file.reason)} |`)
    .join("\n");
  return `# Context Cleanup Report

## Mode

${didWrite ? "write" : "preview"}

## Files

| Status | File | Before Lines | After Lines | Reason |
|---|---|---:|---:|---|
${rows}

## Recommendations

${formatList(report.recommendations, "None.")}

## Write Behavior

${didWrite ? "- Cleanup was written to `.projects`." : "- Add `--write` to persist cleanup. Preview mode writes nothing."}

## Next Route

\`${report.nextRoute}\`
`;
}

export function publicContextCleanupSummary(report) {
  return {
    limit: report.limit,
    changed: report.changed,
    files: report.files.map((file) => ({
      name: file.name,
      changed: file.changed,
      beforeLines: file.beforeLines,
      afterLines: file.afterLines,
      reason: file.reason,
    })),
    recommendations: report.recommendations,
    nextRoute: report.nextRoute,
  };
}

function compactState(markdown) {
  if (!markdown.trim()) return markdown;
  const requiredHeadings = ["Current Goal", "Current Milestone", "Current Phase", "Next Action", "Blockers", "Last Verification"];
  const headings = stateHeadings(markdown);
  let next = markdown.trimEnd();
  for (const heading of headings) {
    const body = compactText(section(markdown, heading), 12);
    next = replaceSection(next, heading, body || "None.");
  }
  for (const heading of requiredHeadings) {
    if (!headings.includes(heading)) next = replaceSection(next, heading, "None.");
  }
  return next;
}

function compactRuns(markdown, limit) {
  if (!markdown.trim()) return markdown;
  const detailStart = markdown.search(/^## run-/m);
  const indexPart = detailStart === -1 ? markdown : markdown.slice(0, detailStart);
  const detailPart = detailStart === -1 ? "" : markdown.slice(detailStart);
  const indexLines = compactRunIndex(indexPart, limit);
  const details = detailPart
    .split(/\n(?=## run-)/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(-limit)
    .map((item) => compactText(item, 40));
  return `${indexLines.trimEnd()}${details.length ? `\n\n${details.join("\n\n")}` : ""}\n`;
}

function compactRunIndex(markdown, limit) {
  const lines = markdown.split(/\r?\n/);
  const runLineIndexes = lines
    .map((line, index) => line.startsWith("| run-") ? index : -1)
    .filter((index) => index !== -1);
  const keepIndexes = new Set(runLineIndexes.slice(-limit));
  return lines
    .filter((line, index) => !line.startsWith("| run-") || keepIndexes.has(index))
    .join("\n");
}

function compactMemory(markdown) {
  if (!markdown.trim()) return markdown;
  let next = markdown;
  const headings = [...Object.values(MEMORY_CATEGORIES), "Layered Memory Profile"];
  for (const heading of headings) {
    const bullets = memoryBullets(next, heading);
    if (!bullets.length) continue;
    const clean = [];
    const seen = new Set();
    for (const item of [...bullets].reverse()) {
      if (unsafeMemory(item) || seen.has(item)) continue;
      seen.add(item);
      clean.push(item);
      if (clean.length >= 20) break;
    }
    clean.reverse();
    next = replaceSection(next, heading, clean.length ? clean.map((item) => `- ${item}`).join("\n") : "None recorded.");
  }
  return next;
}

function fileChange(name, before, after) {
  const changed = before !== after;
  return {
    name,
    before,
    after,
    changed,
    beforeLines: lineCount(before),
    afterLines: lineCount(after),
    reason: changed ? "Compacted durable project context." : "Already compact.",
  };
}

function compactText(value, maxLines) {
  const lines = [];
  let previousBlank = false;
  for (const rawLine of String(value || "").split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    if (/^Implemented commands:/i.test(line)) continue;
    if (!line.trim()) {
      if (lines.length && !previousBlank) {
        lines.push("");
        previousBlank = true;
      }
      continue;
    }
    lines.push(line);
    previousBlank = false;
    if (lines.length >= maxLines) break;
  }
  while (lines.at(-1) === "") lines.pop();
  return lines.join("\n");
}

function stateHeadings(markdown) {
  return [...String(markdown).matchAll(/^##\s+(.+?)\s*$/gm)].map((match) => match[1]);
}

function lineCount(value) {
  return String(value || "").trim() ? String(value).trimEnd().split(/\r?\n/).length : 0;
}
