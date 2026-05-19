import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import { EVENT_TYPES } from "../constants.mjs";
import { parseArgs } from "../args.mjs";
import { appendEvent, timestampForId } from "../events.mjs";
import { readProjectFile, relativeProjectPath, withProjectFilesTransaction, writeTextFileAtomic } from "../project.mjs";
import { formatList, escapeTable, replaceSection } from "../utils.mjs";
import { memoryBullets } from "./memory.mjs";
import { fail } from "../errors.mjs";
import { analyzeProjectScan, applyProjectScan, buildProjectScanReport } from "./scan.mjs";
import { analyzeStructuredPlanCreate, applyStructuredPlanCreate, nextMilestoneId } from "../task-store.mjs";

export function runImport(root, rawArgs) {
  const [subcommand, ...rest] = rawArgs;
  if (!subcommand) {
    fail("Missing import subcommand. Usage: dl import bmad|gsd|superpower|project [--path path] [--write]");
  }

  if (subcommand === "bmad") {
    runImportBmad(root, rest);
    return;
  }
  if (subcommand === "gsd") {
    runImportKnownWorkflow(root, rest, GSD_IMPORT_SPEC);
    return;
  }
  if (subcommand === "superpower" || subcommand === "superpowers") {
    runImportKnownWorkflow(root, rest, SUPERPOWER_IMPORT_SPEC);
    return;
  }
  if (subcommand === "project") {
    runImportProject(root, rest);
    return;
  }

  fail(`Unknown import subcommand: ${subcommand}`);
}

const GSD_IMPORT_SPEC = {
  id: "gsd",
  label: "GSD",
  defaultPath: ".planning",
  eventType: EVENT_TYPES.GSD_IMPORTED,
  stateGoal: (report) => `Continue GSD-imported plan from ${report.importPath}.`,
  statePhase: "GSD import completed.",
  nextAction: "Run `dl plan` or `dl context index` against the imported GSD continuation summary.",
  noArtifacts: "No GSD planning artifacts were discovered.",
  targets: [
    { key: "project", path: "PROJECT.md", label: "Project" },
    { key: "roadmap", path: "ROADMAP.md", label: "Roadmap" },
    { key: "state", path: "STATE.md", label: "State" },
    { key: "memory", path: "MEMORY.md", label: "Memory" },
    { key: "context", path: "CONTEXT.md", label: "Context" },
    { key: "agents", path: "AGENTS.md", label: "Agents" },
  ],
  collections: [
    { key: "plans", dir: "plans", label: "Plans", extensions: [".md", ".json", ".yaml", ".yml"] },
    { key: "phases", dir: "phases", label: "Phases", extensions: [".md", ".json", ".yaml", ".yml"] },
    { key: "milestones", dir: "milestones", label: "Milestones", extensions: [".md", ".json", ".yaml", ".yml"] },
    { key: "threads", dir: "threads", label: "Threads", extensions: [".md", ".json", ".yaml", ".yml"] },
  ],
};

const SUPERPOWER_IMPORT_SPEC = {
  id: "superpower",
  label: "Superpower",
  defaultPath: "superpowers",
  eventType: EVENT_TYPES.SUPERPOWER_IMPORTED,
  stateGoal: (report) => `Adapt Superpower-imported methodology from ${report.importPath}.`,
  statePhase: "Superpower import completed.",
  nextAction: "Review imported Superpower principles, then map durable methodology into Taphelu skills or project workflow rules.",
  noArtifacts: "No Superpower methodology artifacts were discovered.",
  targets: [
    { key: "readme", path: "README.md", label: "README" },
    { key: "claude", path: "CLAUDE.md", label: "Claude Guidance" },
    { key: "cursor", path: "CURSOR.md", label: "Cursor Guidance" },
    { key: "examples", path: "EXAMPLES.md", label: "Examples" },
  ],
  collections: [
    { key: "skills", dir: "skills", label: "Skills", extensions: [".md"] },
    { key: "agents", dir: "agents", label: "Agents", extensions: [".md"] },
  ],
};

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
    if (report.nextRoute !== "blocked" && report.stories.length) {
      applyBmadStoriesToTaskStore(root, report);
    }
  }
}

function runImportKnownWorkflow(root, rawArgs, spec) {
  const { options, values } = parseArgs(rawArgs);
  if (values.length) {
    fail(`Unexpected positional value for dl import ${spec.id}. Use --path and --write.`);
  }

  const importPath = options.path ?? spec.defaultPath;
  const report = analyzeKnownWorkflowImport(root, importPath, spec);
  console.log(buildKnownWorkflowImportReport(report, Boolean(options.write), spec));

  if (options.write) {
    withProjectFilesTransaction(root, ["events.jsonl", "STATE.md", "MEMORY.md"], () => {
      appendEvent(root, {
        ts: new Date().toISOString(),
        type: spec.eventType,
        run_id: `run-${timestampForId()}-import`,
        summary: `${spec.label} artifacts imported for Taphelu continuation.`,
        data: {
          import_path: importPath,
          discovered_count: report.discovered.length,
          collection_count: report.collectionCount,
          conflict_count: report.conflicts.length,
          next_route: report.nextRoute,
        },
      });
      if (report.nextRoute !== "blocked") {
        applyKnownWorkflowContinuation(root, report, spec);
      }
    });
  }
}

function analyzeKnownWorkflowImport(root, importPath, spec) {
  const absoluteImportPath = resolve(root, importPath);
  const discovered = spec.targets
    .map((target) => ({
      ...target,
      path: join(absoluteImportPath, target.path),
    }))
    .filter((target) => existsSync(target.path))
    .map((target) => ({
      ...target,
      relativePath: relativeProjectPath(root, target.path),
      summary: summarizeArtifact(readFileSync(target.path, "utf8")),
    }));
  const collections = Object.fromEntries(spec.collections.map((collection) => {
    const files = collectFiles(join(absoluteImportPath, collection.dir), collection.extensions);
    return [collection.key, files.map((file) => relativeProjectPath(root, file))];
  }));
  const collectionCount = Object.values(collections).reduce((sum, files) => sum + files.length, 0);
  const conflicts = [];
  const blockers = [];

  if (!existsSync(absoluteImportPath)) {
    blockers.push(`Import path not found: ${importPath}`);
  }
  if (!discovered.length && !collectionCount) {
    blockers.push(spec.noArtifacts);
  }

  const allContents = [
    ...discovered.map((artifact) => readFileSync(artifact.path, "utf8")),
    ...Object.values(collections).flat().slice(0, 50).map((file) => {
      const absolute = resolve(root, file);
      return existsSync(absolute) ? readFileSync(absolute, "utf8") : "";
    }),
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

  const project = discovered.find((artifact) => artifact.key === "project" || artifact.key === "readme");
  const roadmap = discovered.find((artifact) => artifact.key === "roadmap" || artifact.key === "examples");
  const state = discovered.find((artifact) => artifact.key === "state" || artifact.key === "claude");
  const memory = discovered.find((artifact) => artifact.key === "memory" || artifact.key === "cursor");
  const nextRoute = conflicts.some((conflict) => conflict.severity === "blocker") ? "blocked" : "continue";

  return {
    id: spec.id,
    label: spec.label,
    importPath,
    discovered,
    collections,
    collectionCount,
    extraction: {
      productGoal: project?.summary || roadmap?.summary || `No ${spec.label} goal extracted.`,
      durableDecisions: [memory?.summary, roadmap?.summary].filter(Boolean),
      currentProgress: state?.summary || `No ${spec.label} progress extracted.`,
      continuationSummary: `Discovered ${discovered.length} core artifact(s) and ${collectionCount} collection artifact(s).`,
    },
    conflicts,
    nextRoute,
  };
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

function buildKnownWorkflowImportReport(report, willWrite, spec) {
  const discoveredRows = report.discovered.length
    ? report.discovered.map((artifact) => `| ${artifact.label} | ${artifact.relativePath} | ${escapeTable(artifact.summary)} |`).join("\n")
    : `| None | Not found | ${escapeTable(spec.noArtifacts)} |`;
  const collectionSections = spec.collections.map((collection) => {
    const files = report.collections[collection.key] || [];
    return `### ${collection.label}\n\n${formatList(files, `No ${collection.label.toLowerCase()} discovered.`)}`;
  }).join("\n\n");
  const conflicts = report.conflicts.length
    ? report.conflicts.map((conflict) => `- ${conflict.severity}: ${conflict.text}`).join("\n")
    : "- None.";

  return `# ${spec.label} Import Report

## Import Path

${report.importPath}

## Discovered Artifacts

| Artifact | Path | Summary |
|---|---|---|
${discoveredRows}

## Collections

${collectionSections}

## Extraction Map

- Product goal: ${report.extraction.productGoal}
- Current progress: ${report.extraction.currentProgress}
- Continuation summary: ${report.extraction.continuationSummary}

Durable decisions:

${formatList(report.extraction.durableDecisions, "No durable decisions extracted.")}

## Conflict Report

${conflicts}

## Write Behavior

${willWrite ? report.nextRoute === "blocked" ? `- This invocation will append a ${spec.eventType} event but will not update continuation state because import is blocked.` : `- This invocation will append a ${spec.eventType} event and update STATE.md and MEMORY.md.` : "- Add `--write` to persist import event and continuation state."}

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

function applyBmadStoriesToTaskStore(root, report) {
  const storyTasks = report.stories.slice(0, 20).map((relativePath, index) => {
    const absolute = resolve(root, relativePath);
    const content = pathInsideRoot(root, absolute) && existsSync(absolute) ? readFileSync(absolute, "utf8") : "";
    return {
      id: `T${String(index + 1).padStart(2, "0")}`,
      objective: heading(content) || `Continue BMAD story ${basename(relativePath)}`,
      verification: firstAcceptanceCriterion(content) || "Story acceptance criteria are satisfied.",
      testability: "integration",
      requiredEvidence: "BMAD story AC reviewed with implementation evidence.",
      owner: "taphelu-dev",
      boundary: "business",
      references: [relativePath],
      sourceExcerpt: content.split(/\r?\n/).slice(0, 30).join("\n"),
    };
  });
  const plan = analyzeStructuredPlanCreate(root, {
    goal: `Continue BMAD-imported plan from ${report.importPath}.`,
    milestone: nextMilestoneId(root),
    story: "S01",
    references: report.stories,
    tasks: storyTasks,
  });
  applyStructuredPlanCreate(root, plan);
}

function pathInsideRoot(root, absolutePath) {
  const rel = relative(resolve(root), absolutePath);
  return !rel.startsWith("..") && !isAbsolute(rel);
}

function applyKnownWorkflowContinuation(root, report, spec) {
  const statePath = join(root, ".projects", "STATE.md");
  if (existsSync(statePath)) {
    let state = readFileSync(statePath, "utf8");
    state = replaceSection(state, "Current Goal", spec.stateGoal(report));
    state = replaceSection(state, "Current Phase", `${spec.statePhase}\n\n${report.extraction.continuationSummary}`);
    state = replaceSection(state, "Blockers", "None.");
    state = replaceSection(state, "Next Action", spec.nextAction);
    state = replaceSection(state, "Last Verification", `${new Date().toISOString()}: \`dl import ${spec.id} --write\` imported ${report.discovered.length} core artifact(s) and ${report.collectionCount} collection artifact(s).`);
    writeTextFileAtomic(statePath, state);
  }

  const memoryPath = join(root, ".projects", "MEMORY.md");
  let memory = readProjectFile(root, "MEMORY.md");
  const marker = `${report.label} import source:`;
  const importedFacts = memoryBullets(memory, "Repo Facts")
    .filter((item) => !item.startsWith(marker));
  importedFacts.push(`${marker} ${report.importPath}.`);
  memory = replaceSection(memory, "Repo Facts", importedFacts.map((item) => `- ${item}`).join("\n"));

  const durable = memoryBullets(memory, "Workflow Principles")
    .filter((item) => !item.startsWith(`${report.label} import:`));
  for (const decision of report.extraction.durableDecisions.slice(0, 2)) {
    durable.push(`${report.label} import: ${decision}.`);
  }
  if (durable.length) {
    memory = replaceSection(memory, "Workflow Principles", durable.map((item) => `- ${item}`).join("\n"));
  }
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

function heading(markdown) {
  return cleanImportLine(markdown.match(/^#\s+(.+?)\s*$/m)?.[1] || "");
}

function firstAcceptanceCriterion(markdown) {
  const ac = markdown.match(/##\s+Acceptance Criteria([\s\S]*?)(?:\n##\s+|$)/i)?.[1] || "";
  return cleanImportLine(ac.match(/^\s*[-*]\s+(.+?)\s*$/m)?.[1] || "");
}

function cleanImportLine(line) {
  return String(line)
    .replace(/^#+\s*/, "")
    .replace(/^-\s*/, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 220);
}
