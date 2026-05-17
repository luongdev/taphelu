import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { EVENT_TYPES } from "../constants.mjs";
import { parseArgs } from "../args.mjs";
import { appendEvent, timestampForId } from "../events.mjs";
import { readProjectFile, relativeProjectPath, withProjectFilesTransaction, writeTextFileAtomic } from "../project.mjs";
import { formatList, escapeTable, replaceSection } from "../utils.mjs";
import { memoryBullets } from "./memory.mjs";
import { fail } from "../errors.mjs";
import { analyzeProjectScan, applyProjectScan, buildProjectScanReport } from "./scan.mjs";

export function runImport(root, rawArgs) {
  const [subcommand, ...rest] = rawArgs;
  if (!subcommand) {
    fail("Missing import subcommand. Usage: dl import bmad|project [--path path] [--write]");
  }

  if (subcommand === "bmad") {
    runImportBmad(root, rest);
    return;
  }
  if (subcommand === "project") {
    runImportProject(root, rest);
    return;
  }

  fail(`Unknown import subcommand: ${subcommand}`);
}

function runImportProject(root, rawArgs) {
  const { options, values } = parseArgs(rawArgs);
  if (values.length) {
    fail("Unexpected positional value for dl import project. Use --path, --mode, and --write.");
  }
  const report = analyzeProjectScan(root, {
    path: options.path || ".",
    mode: options.mode || "standard",
  });
  if (options.write && !options["dry-run"]) applyProjectScan(root, report);
  console.log(buildProjectScanReport(report, Boolean(options.write && !options["dry-run"])));
}

function runImportBmad(root, rawArgs) {
  const { options, values } = parseArgs(rawArgs);
  if (values.length) {
    fail("Unexpected positional value for dl import bmad. Use --path and --write.");
  }

  const importPath = options.path ?? "_bmad-output";
  const report = analyzeBmadImport(root, importPath);
  console.log(buildBmadImportReport(report, options.write));

  if (options.write) {
    withProjectFilesTransaction(root, ["events.jsonl", "STATE.md", "MEMORY.md"], () => {
      appendEvent(root, {
        ts: new Date().toISOString(),
        type: EVENT_TYPES.BMAD_IMPORTED,
        run_id: `run-${timestampForId()}-import`,
        summary: "BMAD planning artifacts imported for continuation.",
        data: {
          import_path: importPath,
          discovered_count: report.discovered.length,
          conflict_count: report.conflicts.length,
          next_route: report.nextRoute,
        },
      });
      if (report.nextRoute !== "blocked") {
        applyBmadContinuation(root, report);
      }
    });
  }
}

function analyzeBmadImport(root, importPath) {
  const absoluteImportPath = resolve(root, importPath);
  const targets = [
    { key: "project_context", path: join(absoluteImportPath, "project-context.md"), label: "Project Context" },
    { key: "prd", path: join(absoluteImportPath, "planning-artifacts", "PRD.md"), label: "PRD" },
    { key: "architecture", path: join(absoluteImportPath, "planning-artifacts", "architecture.md"), label: "Architecture" },
    { key: "sprint_status", path: join(absoluteImportPath, "implementation-artifacts", "sprint-status.yaml"), label: "Sprint Status" },
  ];
  const discovered = targets
    .filter((target) => existsSync(target.path))
    .map((target) => ({
      ...target,
      relativePath: relativeProjectPath(root, target.path),
      summary: summarizeArtifact(readFileSync(target.path, "utf8")),
    }));
  const epics = collectFiles(join(absoluteImportPath, "planning-artifacts", "epics"), [".md", ".yaml", ".yml"]);
  const stories = collectFiles(join(absoluteImportPath, "implementation-artifacts"), [".md", ".yaml", ".yml"])
    .filter((file) => file.toLowerCase().includes("story") || file.toLowerCase().includes("stories"));
  const conflicts = [];
  const blockers = [];

  if (!existsSync(absoluteImportPath)) {
    blockers.push(`Import path not found: ${importPath}`);
  }
  if (!discovered.length && !epics.length && !stories.length) {
    blockers.push("No BMAD artifacts were discovered.");
  }

  const allContents = [
    ...discovered.map((artifact) => readFileSync(artifact.path, "utf8")),
    ...epics.map((file) => readFileSync(file, "utf8")),
    ...stories.map((file) => readFileSync(file, "utf8")),
  ].join("\n");
  for (const line of allContents.split(/\r?\n/)) {
    if (/conflict\s*:\s*blocker/i.test(line) || /blocker\s*:/i.test(line)) {
      conflicts.push({ severity: "blocker", text: cleanImportLine(line) });
    } else if (/conflict\s*:\s*warning/i.test(line) || /warning\s*:/i.test(line)) {
      conflicts.push({ severity: "warning", text: cleanImportLine(line) });
    }
  }
  for (const blocker of blockers) {
    conflicts.push({ severity: "blocker", text: blocker });
  }

  const prd = discovered.find((artifact) => artifact.key === "prd");
  const projectContext = discovered.find((artifact) => artifact.key === "project_context");
  const architecture = discovered.find((artifact) => artifact.key === "architecture");
  const sprintStatus = discovered.find((artifact) => artifact.key === "sprint_status");
  const nextRoute = conflicts.some((conflict) => conflict.severity === "blocker") ? "blocked" : "continue";

  return {
    importPath,
    discovered,
    epics: epics.map((file) => relativeProjectPath(root, file)),
    stories: stories.map((file) => relativeProjectPath(root, file)),
    extraction: {
      productGoal: projectContext?.summary || prd?.summary || "No project goal extracted.",
      durableDecisions: architecture?.summary ? [architecture.summary] : [],
      currentProgress: sprintStatus?.summary || "No sprint status extracted.",
      continuationSummary: `Discovered ${discovered.length} core artifact(s), ${epics.length} epic artifact(s), and ${stories.length} story artifact(s).`,
    },
    conflicts,
    nextRoute,
  };
}

function buildBmadImportReport(report, willWrite) {
  const discoveredRows = report.discovered.length
    ? report.discovered.map((artifact) => `| ${artifact.label} | ${artifact.relativePath} | ${escapeTable(artifact.summary)} |`).join("\n")
    : "| None | Not found | No core artifacts discovered. |";
  const conflicts = report.conflicts.length
    ? report.conflicts.map((conflict) => `- ${conflict.severity}: ${conflict.text}`).join("\n")
    : "- None.";

  return `# BMAD Import Report

## Import Path

${report.importPath}

## Discovered Artifacts

| Artifact | Path | Summary |
|---|---|---|
${discoveredRows}

## Epics

${formatList(report.epics, "No epic artifacts discovered.")}

## Stories

${formatList(report.stories, "No story artifacts discovered.")}

## Extraction Map

- Product goal: ${report.extraction.productGoal}
- Current progress: ${report.extraction.currentProgress}
- Continuation summary: ${report.extraction.continuationSummary}

Durable decisions:

${formatList(report.extraction.durableDecisions, "No durable decisions extracted.")}

## Conflict Report

${conflicts}

## Write Behavior

${willWrite ? report.nextRoute === "blocked" ? "- This invocation will append a bmad_imported event but will not update continuation state because import is blocked." : "- This invocation will append a bmad_imported event and update STATE.md and MEMORY.md." : "- Add `--write` to persist import event and continuation state."}

## Next Route

\`${report.nextRoute}\`
`;
}

function applyBmadContinuation(root, report) {
  const statePath = join(root, ".projects", "STATE.md");
  if (existsSync(statePath)) {
    let state = readFileSync(statePath, "utf8");
    state = replaceSection(state, "Current Goal", `Continue BMAD-imported plan from ${report.importPath}.`);
    state = replaceSection(state, "Current Phase", `BMAD import completed.\n\n${report.extraction.continuationSummary}`);
    state = replaceSection(state, "Blockers", "None.");
    state = replaceSection(state, "Next Action", "Run `dl plan` against the imported BMAD continuation summary.");
    state = replaceSection(state, "Last Verification", `${new Date().toISOString()}: \`dl import bmad --write\` imported ${report.discovered.length} core artifact(s), ${report.epics.length} epic artifact(s), and ${report.stories.length} story artifact(s).`);
    writeTextFileAtomic(statePath, state);
  }

  const memoryPath = join(root, ".projects", "MEMORY.md");
  let memory = readProjectFile(root, "MEMORY.md");
  const importedFacts = memoryBullets(memory, "Repo Facts")
    .filter((item) => !item.startsWith("BMAD import source:"));
  importedFacts.push(`BMAD import source: ${report.importPath}.`);
  memory = replaceSection(memory, "Repo Facts", importedFacts.map((item) => `- ${item}`).join("\n"));
  writeTextFileAtomic(memoryPath, memory);
}

function collectFiles(dir, extensions) {
  if (!existsSync(dir)) return [];
  const entries = readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectFiles(path, extensions));
    } else if (extensions.some((extension) => entry.name.toLowerCase().endsWith(extension))) {
      files.push(path);
    }
  }
  return files.sort();
}

function summarizeArtifact(markdown) {
  const lines = markdown
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.startsWith("```"));
  const heading = lines.find((line) => line.startsWith("#"));
  const bullet = lines.find((line) => line.startsWith("- "));
  const plain = lines.find((line) => !line.startsWith("#") && !line.startsWith("- "));
  return cleanImportLine(heading || bullet || plain || "No summary extracted.");
}

function cleanImportLine(line) {
  return String(line)
    .replace(/^#+\s*/, "")
    .replace(/^-\s*/, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 220);
}
