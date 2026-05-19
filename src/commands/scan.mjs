import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from "node:fs";
import { extname, isAbsolute, join, relative, resolve } from "node:path";
import { parseArgs, parseMode } from "../args.mjs";
import { EVENT_TYPES } from "../constants.mjs";
import { appendEvent, timestampForId } from "../events.mjs";
import { fail } from "../errors.mjs";
import { readProjectFile, relativeProjectPath, withProjectFilesTransaction, writeTextFileAtomic } from "../project.mjs";
import { escapeTable, formatList, replaceSection, unsafeMemory } from "../utils.mjs";

const IGNORE_DIRS = new Set([
  ".git",
  ".projects",
  ".samples",
  ".codex",
  ".claude",
  ".gemini",
  ".hg",
  ".svn",
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".cache",
  ".turbo",
  ".next",
  ".nuxt",
  ".venv",
  "venv",
  "target",
  "vendor",
  "__pycache__",
]);

const MODE_LIMITS = {
  quick: { maxFiles: 500, maxDepth: 3 },
  standard: { maxFiles: 2000, maxDepth: 6 },
  deep: { maxFiles: 5000, maxDepth: 12 },
};

const PACKAGE_FILES = [
  "package.json",
  "pyproject.toml",
  "requirements.txt",
  "go.mod",
  "Cargo.toml",
  "pom.xml",
  "build.gradle",
  "composer.json",
  "Gemfile",
  "deno.json",
  "bun.lockb",
  "pnpm-lock.yaml",
  "yarn.lock",
];

const ENTRYPOINT_NAMES = [
  "main.js",
  "index.js",
  "main.ts",
  "index.ts",
  "app.js",
  "app.ts",
  "main.py",
  "app.py",
  "main.go",
  "main.rs",
];

const TOPOLOGY_FOCUS = new Set(["services", "contracts", "topology", "all"]);
const MAX_CONTRACT_SNIFF_BYTES = 1024 * 1024;

export function runScan(root, rawArgs) {
  const [subcommand, ...rest] = rawArgs;
  if (subcommand === "interview") {
    runScanInterview(root, rest);
    return;
  }
  if (subcommand === "plan") {
    runScanPlan(root, rest);
    return;
  }
  if (subcommand === "map") {
    runScanMap(root, rest);
    return;
  }

  const { options, values } = parseArgs(rawArgs);
  if (values.length) fail("Unexpected positional value for dl scan. Use --path, --mode, --dry-run, or --write.");
  if (options.focus) {
    const report = analyzeServiceTopology(root, options);
    if (options.write && !options["dry-run"]) applyServiceTopology(root, report);
    console.log(buildServiceTopologyReport(report, Boolean(options.write && !options["dry-run"])));
    return;
  }
  const mode = parseMode(options.mode || "standard");
  const report = analyzeProjectScan(root, {
    path: options.path || ".",
    mode,
  });
  if (options.write && !options["dry-run"]) applyProjectScan(root, report);
  console.log(buildProjectScanReport(report, Boolean(options.write && !options["dry-run"])));
}

function runScanInterview(root, rawArgs) {
  const { options, values } = parseArgs(rawArgs);
  if (values.length) {
    fail("Unexpected positional value for dl scan interview. Use --path, --mode, domain flags, and --write.");
  }
  const report = analyzeScanInterview(root, options);
  if (options.write && !options["dry-run"]) applyScanInterview(root, report);
  console.log(buildScanInterviewReport(report, Boolean(options.write && !options["dry-run"])));
}

function runScanPlan(root, rawArgs) {
  const { options, values } = parseArgs(rawArgs);
  if (values.length) {
    fail("Unexpected positional value for dl scan plan. Use --path, --mode, domain flags, and --write.");
  }
  const report = analyzeDeepScanPlan(root, options);
  if (options.write && !options["dry-run"]) applyDeepScanPlan(root, report);
  console.log(buildDeepScanPlanReport(report, Boolean(options.write && !options["dry-run"])));
}

function runScanMap(root, rawArgs) {
  const { options, values } = parseArgs(rawArgs);
  if (values.length) {
    fail("Unexpected positional value for dl scan map. Use --path, --mode, --focus, and --write.");
  }
  const report = analyzeServiceTopology(root, options);
  if (options.write && !options["dry-run"]) applyServiceTopology(root, report);
  console.log(buildServiceTopologyReport(report, Boolean(options.write && !options["dry-run"])));
}

export function analyzeProjectScan(root, input = {}) {
  const mode = parseMode(input.mode || "standard");
  const scanRoot = resolveContainedPath(root, input.path || ".");
  const limits = MODE_LIMITS[mode];
  const ignoreRules = readIgnoreRules(root, limits);
  const files = collectProjectFiles(root, scanRoot, limits, ignoreRules);
  const topLevelDirs = topLevelDirectories(root, scanRoot, ignoreRules);
  const packageFiles = files.filter((file) => PACKAGE_FILES.includes(file.name));
  const docs = files.filter((file) => isDoc(file.relativePath)).slice(0, 30);
  const entrypoints = detectEntrypoints(files);
  const languages = detectLanguages(files);
  const packageJson = packageFiles.find((file) => file.name === "package.json");
  const scripts = packageJson ? packageJsonScripts(join(root, packageJson.relativePath)) : {};
  const testCommands = detectTestCommands(files, scripts);
  const stack = detectStack(files, scripts);
  const serviceSignals = detectServiceSignals(files, packageFiles);
  const confidence = confidenceForScan(packageFiles, docs, testCommands);
  const openQuestions = [];
  if (!packageFiles.length) openQuestions.push("No package or build manifest detected.");
  if (!testCommands.length) openQuestions.push("No obvious test command detected.");
  if (!docs.some((doc) => /(^|\/)readme\.md$/i.test(doc.relativePath))) openQuestions.push("No README.md detected in scan scope.");

  return {
    mode,
    scanPath: relativeProjectPath(root, scanRoot),
    truncated: files.truncated,
    ignoreFiles: ignoreRules.sources,
    fileCount: files.length,
    topLevelDirs,
    packageFiles: packageFiles.map((file) => file.relativePath),
    docs: docs.map((file) => file.relativePath),
    entrypoints: entrypoints.map((file) => file.relativePath),
    languages,
    scripts,
    testCommands,
    stack,
    serviceSignals,
    confidence,
    openQuestions,
    largeRepo: files.length > 300,
    nextRoute: openQuestions.length ? "clarify_or_plan" : "plan",
  };
}

export function applyProjectScan(root, report) {
  mkdirSync(join(root, ".projects"), { recursive: true });
  const codebase = renderCodebaseArtifact(report);
  withProjectFilesTransaction(root, ["events.jsonl", "CODEBASE.md", "PROJECT.md", "STATE.md"], () => {
    writeTextFileAtomic(join(root, ".projects", "CODEBASE.md"), codebase);
    writeTextFileAtomic(join(root, ".projects", "PROJECT.md"), updateProjectArtifact(readProjectFile(root, "PROJECT.md"), report));
    writeTextFileAtomic(join(root, ".projects", "STATE.md"), updateScanState(readProjectFile(root, "STATE.md"), report));
    appendEvent(root, {
      ts: new Date().toISOString(),
      type: EVENT_TYPES.PROJECT_SCANNED,
      run_id: `run-${timestampForId()}-scan`,
      summary: "Existing project scanned for Taphelu continuation.",
      data: {
        scan_path: report.scanPath,
        mode: report.mode,
        file_count: report.fileCount,
        confidence: report.confidence,
        next_route: report.nextRoute,
      },
    });
  });
}

export function buildProjectScanReport(report, didWrite = false) {
  const languageRows = Object.entries(report.languages)
    .map(([language, count]) => `| ${language} | ${count} |`)
    .join("\n") || "| None | 0 |";
  const scriptRows = Object.entries(report.scripts)
    .map(([name, command]) => `| ${escapeTable(name)} | ${escapeTable(command)} |`)
    .join("\n") || "| None | No package scripts detected. |";

  return `# Project Scan Report

## Mode

${didWrite ? "write" : "preview"}

## Scope

- Path: \`${report.scanPath}\`
- Scan mode: \`${report.mode}\`
- Files observed: ${report.fileCount}${report.truncated ? " (truncated by mode limit)" : ""}
- Confidence: \`${report.confidence}\`
- Ignore files: ${report.ignoreFiles.length ? report.ignoreFiles.join(", ") : "none"}

## Top-Level Directories

${formatList(report.topLevelDirs, "No directories discovered.")}

## Package Files

${formatList(report.packageFiles, "No package files discovered.")}

## Stack Signals

${formatList(report.stack, "No stack signals discovered.")}

## Service/API Signals

${formatList(report.serviceSignals, "No service or API signals discovered.")}

## Languages

| Language | Files |
|---|---:|
${languageRows}

## Scripts

| Name | Command |
|---|---|
${scriptRows}

## Test Commands

${formatList(report.testCommands, "No test commands inferred.")}

## Entrypoints

${formatList(report.entrypoints, "No entrypoints inferred.")}

## Docs

${formatList(report.docs, "No docs discovered.")}

## Open Questions

${formatList(report.openQuestions, "None.")}

## Agent Mapping Recommendation

${report.largeRepo ? "- Large enough to split scan follow-up into stack, architecture, testing, and concerns focus areas." : "- Small enough for one agent to continue from this scan report."}

## Write Behavior

${didWrite ? "- Wrote `.projects/CODEBASE.md`, updated `.projects/PROJECT.md`, updated `.projects/STATE.md`, and appended an event." : "- Add `--write` to persist scan context. Preview mode writes nothing."}

## Next Route

\`${report.nextRoute}\`
`;
}

export function analyzeScanInterview(root, input = {}) {
  const normalized = normalizeScanContextInput(input);
  const scan = analyzeProjectScan(root, {
    path: normalized.path,
    mode: normalized.mode,
  });
  const answers = normalized.answers;
  const hasAnswers = Boolean(
    answers.domain ||
    answers.users.length ||
    answers.coreFlows.length ||
    answers.objective ||
    answers.contractSources.length ||
    answers.restrictedAreas.length
  );
  const questions = buildDomainQuestions(scan, answers);
  return {
    kind: hasAnswers ? "domain_context" : "domain_interview",
    scan,
    answers,
    hasAnswers,
    questions,
    remainingOpenQuestions: questions.map((question) => question.question),
    nextRoute: hasAnswers ? "scan_plan" : "answer_domain_questions",
  };
}

export function applyScanInterview(root, report) {
  mkdirSync(join(root, ".projects"), { recursive: true });
  withProjectFilesTransaction(root, ["events.jsonl", "DOMAIN.md", "PROJECT.md"], () => {
    writeTextFileAtomic(join(root, ".projects", "PROJECT.md"), updateProjectOnboarding(readProjectFile(root, "PROJECT.md"), report.scan));
    writeTextFileAtomic(join(root, ".projects", "DOMAIN.md"), renderDomainArtifact(report));
    appendEvent(root, {
      ts: new Date().toISOString(),
      type: EVENT_TYPES.DOMAIN_CONTEXT_RECORDED,
      run_id: `run-${timestampForId()}-domain`,
      summary: "Domain context recorded from project scan interview.",
      data: {
        scan_path: report.scan.scanPath,
        mode: report.scan.mode,
        has_answers: report.hasAnswers,
        question_count: report.questions.length,
        next_route: report.nextRoute,
      },
    });
  });
}

export function buildScanInterviewReport(report, didWrite = false) {
  if (!report.hasAnswers) {
    const rows = report.questions
      .map((question) => `| \`${escapeTable(question.id)}\` | ${escapeTable(question.question)} | ${escapeTable(question.evidence)} |`)
      .join("\n");
    return `# Project Domain Interview

## Scan Evidence

- Path: \`${report.scan.scanPath}\`
- Scan mode: \`${report.scan.mode}\`
- Files observed: ${report.scan.fileCount}${report.scan.truncated ? " (truncated by mode limit)" : ""}
- Stack signals: ${report.scan.stack.length ? report.scan.stack.join(", ") : "none"}
- Service/API signals: ${report.scan.serviceSignals.length ? report.scan.serviceSignals.join(", ") : "none"}
- Open scan questions: ${report.scan.openQuestions.length ? report.scan.openQuestions.join("; ") : "none"}

## Questions

| ID | Question | Missing repo evidence |
|---|---|---|
${rows}

## Write Behavior

${didWrite ? "- Wrote `.projects/DOMAIN.md` with the interview packet and appended an event." : "- Answer with flags such as `--domain`, `--user`, `--core-flow`, and `--objective`. Add `--write` only when recording context."}

## Next Route

\`${report.nextRoute}\`
`;
  }

  return `# Domain Context

## Domain

${report.answers.domain || "Not provided."}

## Users/Actors

${formatList(report.answers.users, "Not provided.")}

## Core Flows

${formatList(report.answers.coreFlows, "Not provided.")}

## Scan Objective

${report.answers.objective || "Not provided."}

## Contract Sources

${formatList(report.answers.contractSources, "Not provided.")}

## Restricted Areas

${formatList(report.answers.restrictedAreas, "Not provided.")}

## Evidence From Quick Scan

- Path: \`${report.scan.scanPath}\`
- Scan mode: \`${report.scan.mode}\`
- Files observed: ${report.scan.fileCount}${report.scan.truncated ? " (truncated by mode limit)" : ""}
- Stack signals: ${report.scan.stack.length ? report.scan.stack.join(", ") : "none"}
- Service/API signals: ${report.scan.serviceSignals.length ? report.scan.serviceSignals.join(", ") : "none"}
- Test commands: ${report.scan.testCommands.length ? report.scan.testCommands.join("; ") : "none"}

## Remaining Open Questions

${formatList(report.remainingOpenQuestions, "None.")}

## Write Behavior

${didWrite ? "- Wrote `.projects/DOMAIN.md` and appended `domain_context_recorded`." : "- Add `--write` to persist `.projects/DOMAIN.md`; preview mode writes nothing."}

## Next Route

\`${report.nextRoute}\`
`;
}

export function analyzeDeepScanPlan(root, input = {}) {
  const normalized = normalizeScanContextInput(input);
  const scan = analyzeProjectScan(root, {
    path: normalized.path,
    mode: normalized.mode,
  });
  const tasks = buildDeepScanTasks(scan, normalized.answers);
  return {
    kind: "deep_scan_plan",
    scan,
    answers: normalized.answers,
    tasks,
    largeRepoRecommendation: scan.largeRepo || scan.truncated,
    nextRoute: "execute_scan_packets",
  };
}

export function applyDeepScanPlan(root, report) {
  mkdirSync(join(root, ".projects"), { recursive: true });
  withProjectFilesTransaction(root, ["events.jsonl", "SCAN-PLAN.md", "STATE.md", "PROJECT.md"], () => {
    writeTextFileAtomic(join(root, ".projects", "PROJECT.md"), updateProjectOnboarding(readProjectFile(root, "PROJECT.md"), report.scan));
    writeTextFileAtomic(join(root, ".projects", "SCAN-PLAN.md"), renderScanPlanArtifact(report));
    writeTextFileAtomic(join(root, ".projects", "STATE.md"), updateScanPlanState(readProjectFile(root, "STATE.md"), report));
    appendEvent(root, {
      ts: new Date().toISOString(),
      type: EVENT_TYPES.SCAN_PLAN_CREATED,
      run_id: `run-${timestampForId()}-scan-plan`,
      summary: "Deep scan work packets created for existing project onboarding.",
      data: {
        scan_path: report.scan.scanPath,
        mode: report.scan.mode,
        task_count: report.tasks.length,
        focus_areas: report.tasks.map((task) => task.focusArea),
        large_repo: report.largeRepoRecommendation,
        next_route: report.nextRoute,
      },
    });
  });
}

export function buildDeepScanPlanReport(report, didWrite = false) {
  return `${renderScanPlanArtifact(report)}
## Write Behavior

${didWrite ? "- Wrote `.projects/SCAN-PLAN.md`, updated `.projects/STATE.md`, and appended `scan_plan_created`." : "- Add `--write` to persist `.projects/SCAN-PLAN.md`; preview mode writes nothing."}

## Next Route

\`${report.nextRoute}\`
`;
}

export function analyzeServiceTopology(root, input = {}) {
  const normalized = normalizeTopologyInput(input);
  const mode = normalized.mode;
  const scanRoot = resolveContainedPath(root, normalized.path);
  const limits = MODE_LIMITS[mode];
  const ignoreRules = readIgnoreRules(root, limits);
  const files = collectProjectFiles(root, scanRoot, limits, ignoreRules);
  const packageFiles = files.filter((file) => PACKAGE_FILES.includes(file.name));
  const services = detectServices(root, files, packageFiles);
  const contracts = detectContracts(files, services);
  ensureContractService(services, contracts, files);
  const edges = detectTopologyEdges(root, files, services, contracts);
  const serviceSignals = detectServiceSignals(files, packageFiles);

  return {
    kind: "service_topology",
    mode,
    focus: normalized.focus,
    scanPath: relativeProjectPath(root, scanRoot),
    truncated: files.truncated,
    ignoreFiles: ignoreRules.sources,
    fileCount: files.length,
    serviceSignals,
    services,
    contracts,
    edges,
    graph: {
      schemaVersion: 1,
      generatedBy: "taphelu",
      scanPath: relativeProjectPath(root, scanRoot),
      services,
      contracts,
      edges,
    },
    nextRoute: "review_topology",
  };
}

export function applyServiceTopology(root, report) {
  mkdirSync(join(root, ".projects", "graphs"), { recursive: true });
  withProjectFilesTransaction(root, [
    "events.jsonl",
    "PROJECT.md",
    "SERVICE-MAP.md",
    "API-CONTRACTS.md",
    "graphs/service-graph.json",
    "graphs/service-graph.mmd",
  ], () => {
    writeTextFileAtomic(join(root, ".projects", "PROJECT.md"), updateProjectTopology(readProjectFile(root, "PROJECT.md"), report));
    writeTextFileAtomic(join(root, ".projects", "SERVICE-MAP.md"), renderServiceMapArtifact(report));
    writeTextFileAtomic(join(root, ".projects", "API-CONTRACTS.md"), renderApiContractsArtifact(report));
    writeTextFileAtomic(join(root, ".projects", "graphs", "service-graph.json"), `${JSON.stringify(report.graph, null, 2)}\n`);
    writeTextFileAtomic(join(root, ".projects", "graphs", "service-graph.mmd"), renderServiceGraphMermaid(report));
    appendEvent(root, {
      ts: new Date().toISOString(),
      type: EVENT_TYPES.SERVICE_TOPOLOGY_MAPPED,
      run_id: `run-${timestampForId()}-service-map`,
      summary: "Service topology and API contract map generated.",
      data: {
        scan_path: report.scanPath,
        mode: report.mode,
        focus: report.focus,
        service_count: report.services.length,
        contract_count: report.contracts.length,
        edge_count: report.edges.length,
        next_route: report.nextRoute,
      },
    });
  });
}

export function buildServiceTopologyReport(report, didWrite = false) {
  const includeServices = report.focus === "all" || report.focus === "services" || report.focus === "topology";
  const includeContracts = report.focus === "all" || report.focus === "contracts" || report.focus === "topology";
  const includeEdges = report.focus === "all" || report.focus === "topology";
  return `# Service Topology Report

## Scope

- Path: \`${report.scanPath}\`
- Scan mode: \`${report.mode}\`
- Focus: \`${report.focus}\`
- Files observed: ${report.fileCount}${report.truncated ? " (truncated by mode limit)" : ""}
- Ignore files: ${report.ignoreFiles.length ? report.ignoreFiles.join(", ") : "none"}
- Service/API signals: ${report.serviceSignals.length ? report.serviceSignals.join(", ") : "none"}

## Summary

- Services: ${report.services.length}
- Contracts: ${report.contracts.length}
- Edges: ${report.edges.length}
- Low-confidence edges: ${report.edges.filter((edge) => edge.confidence === "low").length}

${includeServices ? renderServicesSection(report.services) : ""}
${includeContracts ? renderContractsSection(report.contracts) : ""}
${includeEdges ? renderEdgesSection(report.edges) : ""}
## Write Behavior

${didWrite ? "- Wrote `.projects/SERVICE-MAP.md`, `.projects/API-CONTRACTS.md`, `.projects/graphs/service-graph.json`, `.projects/graphs/service-graph.mmd`, updated `.projects/PROJECT.md`, and appended `service_topology_mapped`." : "- Add `--write` to persist the full topology bundle. Preview mode writes nothing."}

## Next Route

\`${report.nextRoute}\`
`;
}

function renderServiceMapArtifact(report) {
  return `# Service Map

## Summary

- Path: \`${report.scanPath}\`
- Mode: \`${report.mode}\`
- Services: ${report.services.length}
- Edges: ${report.edges.length}
- Low-confidence edges are inferred and require verification.

${renderServicesSection(report.services)}
${renderEdgesSection(report.edges)}
`;
}

function renderApiContractsArtifact(report) {
  return `# API Contracts

## Summary

- Path: \`${report.scanPath}\`
- Mode: \`${report.mode}\`
- Contracts: ${report.contracts.length}
- Contract records are file/path evidence only; no raw source content is stored.

${renderContractsSection(report.contracts)}
`;
}

function renderServicesSection(services) {
  const rows = services.map((service) => `| \`${escapeTable(service.id)}\` | ${escapeTable(service.name)} | \`${escapeTable(service.root)}\` | ${escapeTable(service.kind)} | ${escapeTable(service.stack.join(", ") || "unknown")} | \`${service.confidence}\` | ${escapeTable(service.evidence.join("; "))} |`).join("\n") ||
    "| None | No services detected. | - | - | - | - | - |";
  return `## Services

| ID | Name | Root | Kind | Stack | Confidence | Evidence |
|---|---|---|---|---|---|---|
${rows}

`;
}

function renderContractsSection(contracts) {
  const rows = contracts.map((contract) => `| \`${escapeTable(contract.id)}\` | \`${escapeTable(contract.serviceId)}\` | ${escapeTable(contract.protocol)} | \`${escapeTable(contract.path)}\` | ${escapeTable(contract.surface)} | \`${contract.confidence}\` | ${escapeTable(contract.evidence.join("; "))} |`).join("\n") ||
    "| None | - | No contracts detected. | - | - | - | - |";
  return `## Contracts

| ID | Service | Protocol | Path | Surface | Confidence | Evidence |
|---|---|---|---|---|---|---|
${rows}

`;
}

function renderEdgesSection(edges) {
  const rows = edges.map((edge) => `| \`${escapeTable(edge.from)}\` | \`${escapeTable(edge.to)}\` | ${escapeTable(edge.type)} | ${escapeTable(edge.label)} | \`${edge.confidence}\` | ${edge.confidence === "low" ? "inferred" : "evidence-backed"} | ${escapeTable(edge.evidence.join("; "))} |`).join("\n") ||
    "| None | None | No edges detected. | - | - | - | - |";
  return `## Relationships

| From | To | Type | Label | Confidence | Status | Evidence |
|---|---|---|---|---|---|---|
${rows}

`;
}

function renderServiceGraphMermaid(report) {
  const lines = ["flowchart LR"];
  if (!report.services.length && !report.contracts.length) {
    lines.push("  empty[\"No services detected\"]");
    return `${lines.join("\n")}\n`;
  }
  for (const service of report.services) {
    lines.push(`  ${mermaidId(service.id)}["${mermaidLabel(`${service.name}\\n${service.root}`)}"]`);
  }
  for (const contract of report.contracts) {
    lines.push(`  ${mermaidId(contract.id)}["${mermaidLabel(`${contract.protocol}\\n${contract.path}`)}"]`);
  }
  for (const edge of report.edges) {
    lines.push(`  ${mermaidId(edge.from)} -->|"${mermaidLabel(`${edge.label} ${edge.confidence}`)}"| ${mermaidId(edge.to)}`);
  }
  return `${lines.join("\n")}\n`;
}

function normalizeTopologyInput(input = {}) {
  return {
    path: input.path || ".",
    mode: parseMode(input.mode || "standard"),
    focus: parseTopologyFocus(input.focus || "all"),
  };
}

function parseTopologyFocus(focus) {
  const normalized = String(focus || "all").trim().toLowerCase();
  if (TOPOLOGY_FOCUS.has(normalized)) return normalized;
  fail(`Invalid focus: ${focus}. Expected services, contracts, topology, or all.`);
}

function detectServices(root, files, packageFiles) {
  const serviceMap = new Map();
  const rootPackage = packageFiles.find((file) => file.relativePath === "package.json");
  const rootWorkspaces = rootPackage ? readPackageMetadata(rootPackage.path).workspaces : [];

  for (const file of packageFiles) {
    const serviceRoot = dirnameRelative(file.relativePath);
    const serviceFiles = filesUnderRoot(files, serviceRoot);
    const metadata = file.name === "package.json" ? readPackageMetadata(file.path) : {};
    const scripts = metadata.scripts || {};
    addService(serviceMap, serviceRoot, {
      name: metadata.name || serviceNameFromRoot(serviceRoot),
      root: serviceRoot,
      kind: kindForServiceRoot(serviceRoot, metadata.name),
      stack: detectStack(serviceFiles, scripts),
      manifests: [file.relativePath],
      testCommands: detectTestCommands(serviceFiles, scripts),
      deploySignals: [],
      confidence: "high",
      evidence: [file.relativePath],
    });
  }

  for (const workspaceRoot of workspaceRoots(rootWorkspaces, files)) {
    addService(serviceMap, workspaceRoot, {
      name: serviceNameFromRoot(workspaceRoot),
      root: workspaceRoot,
      kind: kindForServiceRoot(workspaceRoot, ""),
      stack: detectStack(filesUnderRoot(files, workspaceRoot), {}),
      manifests: rootPackage ? [rootPackage.relativePath] : [],
      testCommands: detectTestCommands(filesUnderRoot(files, workspaceRoot), {}),
      deploySignals: [],
      confidence: "medium",
      evidence: rootPackage ? [rootPackage.relativePath] : [workspaceRoot],
    });
  }

  for (const serviceRoot of conventionalServiceRoots(files)) {
    addService(serviceMap, serviceRoot, {
      name: serviceNameFromRoot(serviceRoot),
      root: serviceRoot,
      kind: kindForServiceRoot(serviceRoot, ""),
      stack: detectStack(filesUnderRoot(files, serviceRoot), {}),
      manifests: [],
      testCommands: detectTestCommands(filesUnderRoot(files, serviceRoot), {}),
      deploySignals: [],
      confidence: "medium",
      evidence: [serviceRoot],
    });
  }

  for (const composeFile of files.filter((file) => /(^|\/)(docker-compose|compose)\.ya?ml$/i.test(file.relativePath))) {
    for (const service of parseComposeServices(composeFile.path)) {
      const matchingRoot = inferServiceRootFromName(service.name, serviceMap, files);
      addService(serviceMap, matchingRoot ? matchingRoot : `compose:${service.name}`, {
        name: service.name,
        root: matchingRoot || ".",
        kind: "compose-service",
        stack: [],
        manifests: [composeFile.relativePath],
        testCommands: [],
        deploySignals: [`Docker Compose: ${composeFile.relativePath}`],
        confidence: matchingRoot ? "high" : "medium",
        evidence: [composeFile.relativePath],
      });
    }
  }

  for (const [key, service] of serviceMap.entries()) {
    const deploySignals = deploySignalsForService(service.root, files);
    addService(serviceMap, key, {
      ...service,
      deploySignals,
      evidence: [...service.evidence, ...deploySignals],
    });
  }

  return [...serviceMap.entries()]
    .map(([key, service]) => publicService(key, service))
    .sort((a, b) => a.root.localeCompare(b.root) || a.name.localeCompare(b.name));
}

function detectContracts(files, services) {
  const contracts = [];
  for (const file of files) {
    const contract = contractSignalForFile(file);
    if (!contract) continue;
    contracts.push({
      id: `contract-${String(contracts.length + 1).padStart(2, "0")}`,
      serviceId: nearestServiceId(file.relativePath, services),
      protocol: contract.protocol,
      path: file.relativePath,
      surface: contract.surface,
      confidence: contract.confidence,
      evidence: [file.relativePath],
    });
  }
  return contracts;
}

function ensureContractService(services, contracts, files) {
  if (!contracts.some((contract) => contract.serviceId === "svc-root")) return;
  if (services.some((service) => service.id === "svc-root")) return;
  services.push({
    id: "svc-root",
    name: "root",
    root: ".",
    kind: "repo",
    stack: detectStack(files, {}),
    manifests: [],
    testCommands: detectTestCommands(files, {}),
    deploySignals: deploySignalsForService(".", files),
    confidence: "low",
    evidence: contracts.filter((contract) => contract.serviceId === "svc-root").map((contract) => contract.path).slice(0, 20),
  });
}

function detectTopologyEdges(root, files, services, contracts) {
  const edges = [];
  for (const contract of contracts) {
    edges.push({
      from: contract.serviceId,
      to: contract.id,
      type: "exposes",
      label: `${contract.protocol} contract`,
      confidence: contract.confidence,
      evidence: contract.evidence,
    });
  }

  for (const composeFile of files.filter((file) => /(^|\/)(docker-compose|compose)\.ya?ml$/i.test(file.relativePath))) {
    for (const service of parseComposeServices(composeFile.path)) {
      const from = serviceIdForName(service.name, services);
      for (const dependency of service.dependsOn) {
        const to = serviceIdForName(dependency, services);
        if (!from || !to || from === to) continue;
        edges.push({
          from,
          to,
          type: "depends_on",
          label: "compose depends_on",
          confidence: "high",
          evidence: [composeFile.relativePath],
        });
      }
    }
  }

  const packageNameMap = packageNameToServiceId(root, services);
  for (const service of services) {
    const packageManifest = service.manifests.find((manifest) => manifest.endsWith("package.json"));
    if (!packageManifest) continue;
    const metadata = readPackageMetadata(join(root, packageManifest));
    for (const dependency of Object.keys(metadata.dependencies || {})) {
      const to = packageNameMap.get(dependency);
      if (!to || to === service.id) continue;
      edges.push({
        from: service.id,
        to,
        type: "package_dependency",
        label: dependency,
        confidence: "medium",
        evidence: [packageManifest],
      });
    }
  }

  return dedupeEdges(edges).sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to) || a.type.localeCompare(b.type));
}

function addService(map, key, input) {
  const existing = map.get(key) || {
    name: input.name || serviceNameFromRoot(input.root || key),
    root: input.root || key,
    kind: input.kind || "service",
    stack: [],
    manifests: [],
    testCommands: [],
    deploySignals: [],
    confidence: "low",
    evidence: [],
  };
  map.set(key, {
    name: existing.name || input.name || serviceNameFromRoot(input.root || key),
    root: existing.root || input.root || key,
    kind: strongestKind(existing.kind, input.kind),
    stack: uniqueStrings([...existing.stack, ...(input.stack || [])]),
    manifests: uniqueStrings([...existing.manifests, ...(input.manifests || [])]),
    testCommands: uniqueStrings([...existing.testCommands, ...(input.testCommands || [])]),
    deploySignals: uniqueStrings([...existing.deploySignals, ...(input.deploySignals || [])]),
    confidence: strongerConfidence(existing.confidence, input.confidence || "low"),
    evidence: uniqueStrings([...existing.evidence, ...(input.evidence || [])]).slice(0, 20),
  });
}

function publicService(key, service) {
  return {
    id: `svc-${slug(key === "." ? "root" : key)}`,
    name: service.name || serviceNameFromRoot(service.root),
    root: service.root || ".",
    kind: service.kind || "service",
    stack: service.stack,
    manifests: service.manifests,
    testCommands: service.testCommands,
    deploySignals: service.deploySignals,
    confidence: service.confidence,
    evidence: service.evidence,
  };
}

function readPackageMetadata(path) {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    const workspaces = Array.isArray(parsed.workspaces)
      ? parsed.workspaces
      : Array.isArray(parsed.workspaces?.packages)
        ? parsed.workspaces.packages
        : [];
    return {
      name: cleanSignal(parsed.name || ""),
      scripts: parsed.scripts && typeof parsed.scripts === "object"
        ? Object.fromEntries(Object.entries(parsed.scripts).map(([key, value]) => [key, cleanSignal(value)]).filter(([, value]) => value))
        : {},
      dependencies: {
        ...(parsed.dependencies && typeof parsed.dependencies === "object" ? parsed.dependencies : {}),
        ...(parsed.devDependencies && typeof parsed.devDependencies === "object" ? parsed.devDependencies : {}),
        ...(parsed.peerDependencies && typeof parsed.peerDependencies === "object" ? parsed.peerDependencies : {}),
      },
      workspaces: workspaces.map((workspace) => cleanSignal(workspace)).filter(Boolean),
    };
  } catch {
    return { name: "", scripts: {}, dependencies: {}, workspaces: [] };
  }
}

function workspaceRoots(patterns, files) {
  const roots = new Set();
  for (const pattern of patterns) {
    const match = /^([^/*]+)\/\*$/u.exec(pattern);
    if (!match) continue;
    const prefix = `${match[1]}/`;
    for (const file of files) {
      if (!file.relativePath.startsWith(prefix)) continue;
      const parts = file.relativePath.split("/");
      if (parts.length >= 2) roots.add(`${parts[0]}/${parts[1]}`);
    }
  }
  return [...roots].sort();
}

function conventionalServiceRoots(files) {
  const roots = new Set();
  for (const file of files) {
    const parts = file.relativePath.split("/");
    if (parts.length >= 3 && ["services", "apps", "packages"].includes(parts[0])) roots.add(`${parts[0]}/${parts[1]}`);
    if (parts.length >= 2 && ["api", "web", "worker"].includes(parts[0])) roots.add(parts[0]);
  }
  return [...roots].sort();
}

function deploySignalsForService(serviceRoot, files) {
  return uniqueStrings(files
    .filter((file) => pathUnderRoot(file.relativePath, serviceRoot) || serviceRoot === ".")
    .map((file) => deploySignalForFile(file.relativePath))
    .filter(Boolean))
    .slice(0, 20);
}

function deploySignalForFile(path) {
  const normalized = path.replaceAll("\\", "/");
  const lower = normalized.toLowerCase();
  if (/(^|\/)dockerfile$/u.test(lower)) return `Dockerfile: ${normalized}`;
  if (/(^|\/)(docker-compose|compose)\.ya?ml$/u.test(lower)) return `Docker Compose: ${normalized}`;
  if (/(^|\/)(chart\.yaml|kustomization\.ya?ml)$/u.test(lower) || /(^|\/)(k8s|kubernetes|helm)\//u.test(lower)) return `Kubernetes/Helm: ${normalized}`;
  if (lower.endsWith(".tf")) return `Terraform: ${normalized}`;
  if (/^\.github\/workflows\/.+\.ya?ml$/u.test(lower)) return `CI: ${normalized}`;
  return "";
}

function contractSignalForFile(file) {
  const path = file.relativePath.replaceAll("\\", "/");
  const lower = path.toLowerCase();
  if (/(^|\/)(openapi|swagger)[^/]*\.(ya?ml|json)$/u.test(lower) || (/(^|\/)(openapi|swagger)\/.+\.(ya?ml|json)$/u.test(lower) && looksLikeContractSpec(file.path, "openapi"))) {
    return { protocol: "openapi", surface: file.name, confidence: "high" };
  }
  if (/(^|\/)asyncapi[^/]*\.(ya?ml|json)$/u.test(lower) || (/(^|\/)asyncapi\/.+\.(ya?ml|json)$/u.test(lower) && looksLikeContractSpec(file.path, "asyncapi"))) {
    return { protocol: "asyncapi", surface: file.name, confidence: "high" };
  }
  if (lower.endsWith(".graphql") || lower.endsWith(".gql") || lower.includes("/graphql/")) {
    return { protocol: "graphql", surface: file.name, confidence: "high" };
  }
  if (lower.endsWith(".proto") || lower.includes("/grpc/")) {
    return { protocol: "protobuf/grpc", surface: file.name, confidence: "high" };
  }
  if (/(^|\/)(routes?|controllers?|handlers?)\//u.test(lower) || /(^|\/)(routes?|controllers?|handlers?)\.[cm]?[jt]sx?$/u.test(lower) || lower.includes("/app/api/") || lower.includes("/pages/api/")) {
    return { protocol: "rest", surface: routeSurface(path), confidence: "medium" };
  }
  if (/^docs\/.*(api|contract|openapi|swagger|graphql|grpc|asyncapi).*\.md$/u.test(lower)) {
    return { protocol: "docs", surface: file.name, confidence: "low" };
  }
  return null;
}

function looksLikeContractSpec(path, key) {
  try {
    if (statSync(path).size > MAX_CONTRACT_SNIFF_BYTES) return false;
    const content = readFileSync(path, "utf8").slice(0, 4096);
    if (key === "openapi") return /(^|\n)\s*(openapi|swagger)\s*[:{]/iu.test(content);
    if (key === "asyncapi") return /(^|\n)\s*asyncapi\s*[:{]/iu.test(content);
    return false;
  } catch {
    return false;
  }
}

function routeSurface(path) {
  return path
    .replace(/\.[^.]+$/u, "")
    .replace(/(^|\/)(src|app|pages)\//u, "")
    .replace(/(^|\/)(routes?|controllers?|handlers?)\//u, "/")
    .replace(/\/index$/u, "")
    .replaceAll("[", ":")
    .replaceAll("]", "")
    || path;
}

function parseComposeServices(path) {
  let content;
  try {
    content = readFileSync(path, "utf8");
  } catch {
    return [];
  }
  const services = [];
  let inServices = false;
  let servicesIndent = 0;
  let current = null;
  let currentIndent = 0;
  let inDepends = false;
  for (const rawLine of content.split(/\r?\n/u)) {
    const line = rawLine.replace(/\t/g, "  ");
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const indent = line.length - line.trimStart().length;
    if (/^services:\s*$/u.test(trimmed)) {
      inServices = true;
      servicesIndent = indent;
      current = null;
      continue;
    }
    if (!inServices) continue;
    if (indent <= servicesIndent && !/^services:\s*$/u.test(trimmed)) {
      inServices = false;
      current = null;
      continue;
    }
    const serviceMatch = /^([A-Za-z0-9_.-]+):\s*(?:#.*)?$/u.exec(trimmed);
    if (serviceMatch && indent === servicesIndent + 2) {
      current = { name: serviceMatch[1], dependsOn: [] };
      services.push(current);
      currentIndent = indent;
      inDepends = false;
      continue;
    }
    if (!current) continue;
    if (indent <= currentIndent) {
      inDepends = false;
      continue;
    }
    const dependsMatch = /^depends_on:\s*(.*)$/u.exec(trimmed);
    if (dependsMatch) {
      inDepends = true;
      const inline = dependsMatch[1].trim();
      if (inline.startsWith("[") && inline.endsWith("]")) {
        for (const item of inline.slice(1, -1).split(",")) addComposeDependency(current, item);
      } else if (inline && !inline.startsWith("#")) {
        addComposeDependency(current, inline);
      }
      continue;
    }
    if (inDepends && trimmed.startsWith("- ")) {
      addComposeDependency(current, trimmed.slice(2));
      continue;
    }
    if (inDepends && /^([A-Za-z0-9_.-]+):/u.test(trimmed)) {
      addComposeDependency(current, trimmed.replace(/:.*/u, ""));
    }
  }
  return services;
}

function addComposeDependency(service, value) {
  const dependency = String(value || "").replace(/["']/g, "").trim();
  if (dependency && !service.dependsOn.includes(dependency)) service.dependsOn.push(dependency);
}

function inferServiceRootFromName(name, serviceMap, files) {
  const lowerName = String(name).toLowerCase();
  for (const service of serviceMap.values()) {
    if (service.name.toLowerCase() === lowerName || service.root.split("/").at(-1)?.toLowerCase() === lowerName) return service.root;
  }
  for (const root of conventionalServiceRoots(files)) {
    if (root.split("/").at(-1)?.toLowerCase() === lowerName) return root;
  }
  return "";
}

function nearestServiceId(path, services) {
  const candidates = services
    .filter((service) => service.root !== "." && pathUnderRoot(path, service.root))
    .sort((a, b) => b.root.length - a.root.length);
  if (candidates[0]) return candidates[0].id;
  const rootService = services.find((service) => service.root === ".");
  return rootService?.id || "svc-root";
}

function serviceIdForName(name, services) {
  const lowerName = String(name).toLowerCase();
  return services.find((service) =>
    service.name.toLowerCase() === lowerName ||
    service.root.split("/").at(-1)?.toLowerCase() === lowerName ||
    service.id === `svc-compose-${slug(lowerName)}`
  )?.id || "";
}

function packageNameToServiceId(root, services) {
  const map = new Map();
  for (const service of services) {
    const packageManifest = service.manifests.find((manifest) => manifest.endsWith("package.json"));
    if (!packageManifest) continue;
    const metadata = readPackageMetadata(join(root, packageManifest));
    if (metadata.name) map.set(metadata.name, service.id);
  }
  return map;
}

function dedupeEdges(edges) {
  const output = [];
  const seen = new Set();
  for (const edge of edges) {
    const key = `${edge.from}|${edge.to}|${edge.type}|${edge.label}`;
    if (seen.has(key)) continue;
    seen.add(key);
    output.push({
      ...edge,
      evidence: uniqueStrings(edge.evidence || []).slice(0, 10),
    });
  }
  return output;
}

function updateProjectTopology(markdown, report) {
  const current = markdown.trim() ? markdown : "# Project\n";
  return replaceSection(current, "Service Topology", [
    `- Scan path: \`${report.scanPath}\`.`,
    `- Services: ${report.services.length}.`,
    `- Contracts: ${report.contracts.length}.`,
    `- Edges: ${report.edges.length}.`,
    "- Topology artifacts: `.projects/SERVICE-MAP.md`, `.projects/API-CONTRACTS.md`, `.projects/graphs/service-graph.json`, `.projects/graphs/service-graph.mmd`.",
  ].join("\n"));
}

function filesUnderRoot(files, root) {
  return files.filter((file) => pathUnderRoot(file.relativePath, root));
}

function pathUnderRoot(path, root) {
  if (!root || root === ".") return true;
  return path === root || path.startsWith(`${root}/`);
}

function dirnameRelative(path) {
  const parts = path.split("/");
  return parts.length > 1 ? parts.slice(0, -1).join("/") : ".";
}

function serviceNameFromRoot(root) {
  if (!root || root === ".") return "root";
  return root.split("/").filter(Boolean).at(-1) || "root";
}

function kindForServiceRoot(root, packageName = "") {
  const name = `${root} ${packageName}`.toLowerCase();
  if (/\b(worker|queue|job)\b/u.test(name)) return "worker";
  if (/\b(api|service|server)\b/u.test(name) || root.startsWith("services/")) return "service";
  if (/\b(web|frontend|ui|app)\b/u.test(name) || root.startsWith("apps/")) return "app";
  if (root.startsWith("packages/")) return "package";
  if (root === ".") return "repo";
  return "service";
}

function strongestKind(existing, next) {
  if (!existing || existing === "service") return next || existing || "service";
  if (!next || next === "service") return existing;
  if (existing === "repo") return next;
  return existing;
}

function strongerConfidence(left, right) {
  const rank = { low: 1, medium: 2, high: 3 };
  return (rank[right] || 1) > (rank[left] || 1) ? right : left;
}

function uniqueStrings(values) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean).filter((value) => !unsafeMemory(value)))];
}

function slug(value) {
  return String(value || "item").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "item";
}

function mermaidId(value) {
  return slug(value).replace(/-/g, "_");
}

function mermaidLabel(value) {
  return String(value || "").replace(/["\\]/g, "").replace(/\r?\n/g, "\\n").slice(0, 120);
}

function renderDomainArtifact(report) {
  return buildScanInterviewReport(report, true)
    .replace(/\n## Write Behavior[\s\S]*?\n## Next Route\n\n`[^`]*`\n?$/u, `\n## Source Scan\n\n- Path: \`${report.scan.scanPath}\`\n- Mode: \`${report.scan.mode}\`\n- Files observed: ${report.scan.fileCount}\n`);
}

function renderScanPlanArtifact(report) {
  const taskBlocks = report.tasks.map((task) => `### ${task.id} - ${task.focusArea}

- Owner role: \`${task.ownerRole}\`
- Boundary: ${task.boundary}
- Depends on: ${task.dependsOn.length ? task.dependsOn.map((id) => `\`${id}\``).join(", ") : "none"}
- Objective: ${task.objective}
- Evidence to collect: ${task.evidenceToCollect.join("; ")}
- Output artifact: \`${task.outputArtifact}\`
- Testability/evidence class: \`${task.testability}\`
- Parallel group: \`${task.parallelGroup}\``).join("\n\n");

  const groupRows = Object.entries(groupTasksByParallel(report.tasks))
    .map(([group, tasks]) => `| ${group} | ${tasks.map((task) => `\`${task.id}\``).join(", ")} |`)
    .join("\n");

  return `# Deep Scan Plan

## Scan Evidence

- Path: \`${report.scan.scanPath}\`
- Scan mode: \`${report.scan.mode}\`
- Files observed: ${report.scan.fileCount}${report.scan.truncated ? " (truncated by mode limit)" : ""}
- Stack signals: ${report.scan.stack.length ? report.scan.stack.join(", ") : "none"}
- Service/API signals: ${report.scan.serviceSignals.length ? report.scan.serviceSignals.join(", ") : "none"}
- Large repo recommendation: ${report.largeRepoRecommendation ? "yes; split work into parallel focus packets" : "no; packets still keep analysis bounded"}

## Task Packets

${taskBlocks}

## Parallel Groups

| Group | Tasks |
|---|---|
${groupRows}
`;
}

function updateScanPlanState(markdown, report) {
  const current = markdown.trim() ? markdown : "# State\n";
  let next = replaceSection(current, "Current Goal", `Onboard existing project at \`${report.scan.scanPath}\` through bounded deep scan packets.`);
  next = replaceSection(next, "Current Phase", `Deep scan plan created with ${report.tasks.length} packet(s). Use \`.projects/SCAN-PLAN.md\` before broad source analysis.`);
  next = replaceSection(next, "Blockers", report.scan.openQuestions.length ? formatList(report.scan.openQuestions, "") : "None.");
  next = replaceSection(next, "Next Action", "Route scan packets to sub-agents by parallel group, then merge compact findings.");
  next = replaceSection(next, "Last Verification", `SCAN-PLAN.md created from ${report.scan.fileCount} observed file(s); no raw source dumped.`);
  return next;
}

function updateProjectOnboarding(markdown, scan) {
  const current = markdown.trim() ? markdown : "# Project\n";
  return replaceSection(current, "Existing Project Onboarding", [
    `- Scan path: \`${scan.scanPath}\`.`,
    `- Scan mode: \`${scan.mode}\`.`,
    `- Stack: ${scan.stack.length ? scan.stack.join(", ") : "unknown"}.`,
    `- Service/API signals: ${scan.serviceSignals.length ? scan.serviceSignals.join(", ") : "none"}.`,
    "Use `.projects/DOMAIN.md` and `.projects/SCAN-PLAN.md` before broad source analysis.",
  ].join("\n"));
}

function buildDomainQuestions(scan, answers) {
  const questions = [];
  if (!answers.domain) {
    questions.push({
      id: "domain",
      question: "What business/domain does this project serve?",
      evidence: "Quick scan captures structure only; no durable domain context exists.",
    });
  }
  if (!answers.users.length) {
    questions.push({
      id: "users",
      question: "Who are the primary users, actors, or operators?",
      evidence: "No structured user/actor source was found in scan artifacts.",
    });
  }
  if (!answers.coreFlows.length) {
    questions.push({
      id: "core_flows",
      question: "Which core workflows must future agents preserve first?",
      evidence: "Entrypoints and docs do not define prioritized business flows.",
    });
  }
  if (!answers.objective) {
    questions.push({
      id: "objective",
      question: "What is this scan for: onboarding, refactor, bugfix, migration, architecture review, or testing?",
      evidence: "Repo structure does not reveal the current agent objective.",
    });
  }
  if (scan.serviceSignals.length && !answers.contractSources.length) {
    questions.push({
      id: "contract_sources",
      question: "What is the source of truth for API/service contracts?",
      evidence: `Service/API signals detected: ${scan.serviceSignals.join(", ")}.`,
    });
  }
  if ((scan.largeRepo || scan.truncated || scan.serviceSignals.length) && !answers.restrictedAreas.length) {
    questions.push({
      id: "restricted_areas",
      question: "Which repo areas are off-limits, sensitive, generated, or low-value for deep scan?",
      evidence: scan.largeRepo || scan.truncated ? "Repo appears broad enough to benefit from scan boundaries." : "Service/API work may touch sensitive integration surfaces.",
    });
  }
  if (!scan.testCommands.length) {
    questions.push({
      id: "verification",
      question: "What verification path matters most if test commands are not obvious?",
      evidence: "No obvious test command was inferred from package/build files.",
    });
  }
  return questions.slice(0, 7);
}

function buildDeepScanTasks(scan, answers) {
  const tasks = [
    taskPacket("DS1", "stack", "taphelu-analyst", "package/build manifests, scripts, language signals", [], "Confirm stack, package managers, build/test commands, and confidence gaps.", [
      "package/build files",
      "scripts",
      "languages",
      "stack signals",
    ], ".projects/CODEBASE.md", "artifact-check", 1),
    taskPacket("DS2", "architecture", "taphelu-architect", "entrypoints, module layout, docs, high-level boundaries", ["DS1"], "Map the codebase architecture without reading broad source bodies.", [
      "entrypoints",
      "top-level directories",
      "architecture docs",
    ], ".projects/ARCHITECTURE.md", "artifact-check", 2),
    taskPacket("DS3", "testing", "taphelu-qa", "test scripts, test directories, CI hints, smoke paths", [], "Identify reliable verification commands and where extra tests are worth the effort.", [
      "test commands",
      "CI/test config",
      "missing verification questions",
    ], ".projects/TESTING.md", "artifact-check", 1),
    taskPacket("DS4", "infra", "taphelu-dev", "deployment, container, config, and infra manifests", [], "Identify infrastructure and environment surfaces relevant to agent work.", [
      "Docker/Kubernetes/config files",
      "environment docs",
      "build outputs excluded by ignores",
    ], ".projects/INFRA.md", "artifact-check", 1),
    taskPacket("DS5", "domain", "taphelu-analyst", "README/docs and recorded domain answers", [], "Convert repo evidence plus interview answers into compact domain context.", [
      answers.domain ? "provided domain answer" : "missing domain answer",
      "README/docs names",
      "core flow answers",
    ], ".projects/DOMAIN.md", "artifact-check", 1),
    taskPacket("DS6", "concerns", "taphelu-qa", "known gaps, risky areas, missing tests, sensitive paths", [], "List risks and open questions before implementation begins.", [
      "open scan questions",
      "large repo/truncation signal",
      "restricted areas",
    ], ".projects/CONCERNS.md", "artifact-check", 1),
  ];

  if (scan.serviceSignals.length) {
    tasks.push(taskPacket("DS7", "services-contracts", "taphelu-architect", "service/API indicators only; no topology graph yet", ["DS1"], "Locate service and contract sources for Milestone 23 mapping.", [
      "Docker Compose/Kubernetes hints",
      "OpenAPI/GraphQL/protobuf/AsyncAPI files",
      "route/controller paths",
      "multiple package roots",
    ], ".projects/SERVICES-CONTRACTS.md", "artifact-check", 2));
  }

  return tasks;
}

function taskPacket(id, focusArea, ownerRole, boundary, dependsOn, objective, evidenceToCollect, outputArtifact, testability, parallelGroup) {
  return {
    id,
    focusArea,
    ownerRole,
    boundary,
    dependsOn,
    objective,
    evidenceToCollect,
    outputArtifact,
    testability,
    parallelGroup,
  };
}

function groupTasksByParallel(tasks) {
  const grouped = {};
  for (const task of tasks) {
    const key = String(task.parallelGroup);
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(task);
  }
  return grouped;
}

function normalizeScanContextInput(input = {}) {
  return {
    path: input.path || ".",
    mode: parseMode(input.mode || "standard"),
    answers: {
      domain: cleanUserInput(input.domain),
      users: cleanUserInputList(input.user || input.users),
      coreFlows: cleanUserInputList(input["core-flow"] || input.core_flow || input.coreFlows),
      objective: cleanUserInput(input.objective),
      contractSources: cleanUserInputList(input["contract-source"] || input.contract_source || input.contractSources),
      restrictedAreas: cleanUserInputList(input["restricted-area"] || input.restricted_area || input.restrictedAreas),
    },
  };
}

function cleanUserInputList(value) {
  if (!value) return [];
  const list = Array.isArray(value) ? value : [value];
  return list.map(cleanUserInput).filter(Boolean).slice(0, 20);
}

function cleanUserInput(value) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text || unsafeMemory(text)) return "";
  return text.length > 500 ? `${text.slice(0, 497)}...` : text;
}

function collectProjectFiles(root, scanRoot, limits, ignoreRules) {
  const output = [];
  let truncated = false;
  walk(scanRoot, 0);
  output.truncated = truncated;
  return output;

  function walk(dir, depth) {
    if (output.length >= limits.maxFiles) {
      truncated = true;
      return;
    }
    if (depth > limits.maxDepth) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (output.length >= limits.maxFiles) {
        truncated = true;
        return;
      }
      const path = join(dir, entry.name);
      const relativePath = relativeProjectPath(root, path);
      if (entry.isDirectory()) {
        if (!IGNORE_DIRS.has(entry.name) && !ignoredByRules(relativePath, true, ignoreRules.rules)) walk(path, depth + 1);
      } else if (entry.isFile()) {
        if (ignoredByRules(relativePath, false, ignoreRules.rules)) continue;
        output.push({
          name: entry.name,
          path,
          relativePath,
          extension: extname(entry.name).toLowerCase(),
        });
      }
    }
  }
}

function topLevelDirectories(root, scanRoot, ignoreRules) {
  if (!existsSync(scanRoot)) return [];
  return readdirSync(scanRoot, { withFileTypes: true })
    .filter((entry) => {
      if (!entry.isDirectory() || IGNORE_DIRS.has(entry.name)) return false;
      return !ignoredByRules(relativeProjectPath(root, join(scanRoot, entry.name)), true, ignoreRules.rules);
    })
    .map((entry) => entry.name)
    .sort()
    .slice(0, 30);
}

function detectLanguages(files) {
  const map = {
    ".js": "JavaScript",
    ".mjs": "JavaScript",
    ".cjs": "JavaScript",
    ".ts": "TypeScript",
    ".tsx": "TypeScript",
    ".jsx": "JavaScript",
    ".py": "Python",
    ".go": "Go",
    ".rs": "Rust",
    ".java": "Java",
    ".kt": "Kotlin",
    ".rb": "Ruby",
    ".php": "PHP",
    ".cs": "C#",
    ".swift": "Swift",
    ".css": "CSS",
    ".scss": "CSS",
    ".html": "HTML",
  };
  const counts = {};
  for (const file of files) {
    const language = map[file.extension];
    if (!language) continue;
    counts[language] = (counts[language] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1]));
}

function detectStack(files, scripts) {
  const names = new Set(files.map((file) => file.name));
  const paths = files.map((file) => file.relativePath);
  const stack = [];
  if (names.has("package.json")) stack.push("Node.js package");
  if (names.has("tsconfig.json") || paths.some((path) => path.endsWith(".ts") || path.endsWith(".tsx"))) stack.push("TypeScript");
  if (names.has("pyproject.toml") || names.has("requirements.txt")) stack.push("Python");
  if (names.has("go.mod")) stack.push("Go module");
  if (names.has("Cargo.toml")) stack.push("Rust crate");
  if (Object.values(scripts).some((script) => /vite/i.test(script))) stack.push("Vite");
  if (Object.values(scripts).some((script) => /next/i.test(script)) || paths.some((path) => path.startsWith("app/") || path.startsWith("pages/"))) stack.push("Next.js signal");
  if (Object.values(scripts).some((script) => /vitest/i.test(script))) stack.push("Vitest");
  if (Object.values(scripts).some((script) => /jest/i.test(script))) stack.push("Jest");
  return stack;
}

function detectServiceSignals(files, packageFiles) {
  const paths = files.map((file) => file.relativePath.replaceAll("\\", "/"));
  const lowerPaths = paths.map((path) => path.toLowerCase());
  const names = new Set(files.map((file) => file.name.toLowerCase()));
  const signals = [];
  const add = (signal) => {
    if (!signals.includes(signal)) signals.push(signal);
  };

  if (lowerPaths.some((path) => /(^|\/)(docker-compose|compose)\.ya?ml$/u.test(path))) add("Docker Compose");
  if (lowerPaths.some((path) => /(^|\/)(chart\.yaml|kustomization\.ya?ml)$/u.test(path) || /(^|\/)(k8s|kubernetes|helm)\//u.test(path))) add("Kubernetes/Helm");
  if (lowerPaths.some((path) => /(^|\/)(openapi|swagger)[^/]*\.(ya?ml|json)$/u.test(path) || /(^|\/)(openapi|swagger)\/.+\.(ya?ml|json)$/u.test(path))) add("OpenAPI/Swagger");
  if (lowerPaths.some((path) => path.endsWith(".graphql") || path.endsWith(".gql") || path.includes("/graphql/"))) add("GraphQL");
  if (lowerPaths.some((path) => path.endsWith(".proto") || path.includes("/grpc/"))) add("protobuf/gRPC");
  if (lowerPaths.some((path) => /(^|\/)asyncapi[^/]*\.(ya?ml|json)$/u.test(path) || /(^|\/)asyncapi\/.+\.(ya?ml|json)$/u.test(path))) add("AsyncAPI");
  if (lowerPaths.some((path) => /(^|\/)(routes?|controllers?|handlers?)\//u.test(path) || /(^|\/)(routes?|controllers?|handlers?)\.[cm]?[jt]sx?$/u.test(path) || path.includes("/app/api/") || path.includes("/pages/api/"))) add("route/controller files");
  if (names.has("serverless.yml") || names.has("serverless.yaml")) add("serverless config");

  const packageRoots = new Set(packageFiles.map((file) => {
    const parts = file.relativePath.split("/");
    return parts.length > 1 ? parts.slice(0, -1).join("/") : ".";
  }));
  if (packageRoots.size > 1) add("multiple package roots");

  return signals;
}

function detectTestCommands(files, scripts) {
  const commands = [];
  const names = new Set(files.map((file) => file.name));
  if (scripts.test) commands.push(`npm test (${scripts.test})`);
  if (names.has("pnpm-lock.yaml") && scripts.test) commands.push("pnpm test");
  if (names.has("yarn.lock") && scripts.test) commands.push("yarn test");
  if (names.has("pyproject.toml") || names.has("requirements.txt")) commands.push("pytest");
  if (names.has("go.mod")) commands.push("go test ./...");
  if (names.has("Cargo.toml")) commands.push("cargo test");
  return [...new Set(commands)];
}

function detectEntrypoints(files) {
  const entrypoints = [];
  for (const file of files) {
    const base = file.name.toLowerCase();
    const path = file.relativePath;
    if (ENTRYPOINT_NAMES.includes(base) && (/^(src|app|bin)\//.test(path) || !path.includes("/"))) {
      entrypoints.push(file);
    }
  }
  return entrypoints.slice(0, 20);
}

function packageJsonScripts(path) {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    const scripts = parsed.scripts && typeof parsed.scripts === "object" ? parsed.scripts : {};
    return Object.fromEntries(Object.entries(scripts)
      .map(([key, value]) => [key, cleanSignal(value)])
      .filter(([, value]) => value));
  } catch {
    return {};
  }
}

function cleanSignal(value) {
  const text = String(value).replace(/\s+/g, " ").trim();
  if (!text || unsafeMemory(text)) return "";
  return text.length > 220 ? `${text.slice(0, 217)}...` : text;
}

function isDoc(path) {
  return /(^|\/)(README|CHANGELOG|CONTRIBUTING|AGENTS|CLAUDE|GEMINI)\.md$/i.test(path) ||
    /^docs\/.*\.md$/i.test(path);
}

function renderCodebaseArtifact(report) {
  return `# Codebase Scan

## Summary

- Path: \`${report.scanPath}\`
- Mode: \`${report.mode}\`
- Files observed: ${report.fileCount}${report.truncated ? " (truncated)" : ""}
- Confidence: \`${report.confidence}\`

## Stack

${formatList(report.stack, "No stack signals discovered.")}

## Service/API Signals

${formatList(report.serviceSignals, "No service or API signals discovered.")}

## Package Files

${formatList(report.packageFiles, "No package files discovered.")}

## Test Commands

${formatList(report.testCommands, "No test commands inferred.")}

## Entrypoints

${formatList(report.entrypoints, "No entrypoints inferred.")}

## Docs

${formatList(report.docs, "No docs discovered.")}

## Open Questions

${formatList(report.openQuestions, "None.")}
`;
}

function updateProjectArtifact(markdown, report) {
  const current = markdown.trim() ? markdown : "# Project\n";
  return replaceSection(current, "Existing Project Scan", [
    `- Scan path: \`${report.scanPath}\`.`,
    `- Confidence: \`${report.confidence}\`.`,
    `- Stack: ${report.stack.length ? report.stack.join(", ") : "unknown"}.`,
    `- Test commands: ${report.testCommands.length ? report.testCommands.join("; ") : "not detected"}.`,
    `- Next route: \`${report.nextRoute}\`.`,
  ].filter((line) => !unsafeMemory(line)).join("\n"));
}

function updateScanState(markdown, report) {
  const current = markdown.trim() ? markdown : "# State\n";
  let next = replaceSection(current, "Current Goal", `Continue from existing project scan at \`${report.scanPath}\`.`);
  next = replaceSection(next, "Current Phase", `Project scan completed with \`${report.confidence}\` confidence. Use \`.projects/CODEBASE.md\` before planning.`);
  next = replaceSection(next, "Blockers", report.openQuestions.length ? formatList(report.openQuestions, "") : "None.");
  next = replaceSection(next, "Next Action", "Run `dl plan` using `.projects/CODEBASE.md` as context.");
  next = replaceSection(next, "Last Verification", `Project scan wrote CODEBASE.md with ${report.fileCount} observed file(s).`);
  return next;
}

function confidenceForScan(packageFiles, docs, testCommands) {
  if (packageFiles.length && docs.length && testCommands.length) return "high";
  if (packageFiles.length || docs.length) return "medium";
  return "low";
}

function resolveContainedPath(root, inputPath) {
  if (isAbsolute(inputPath) && !inputPath.startsWith(root)) {
    fail(`Scan path must stay inside the project root: ${inputPath}`);
  }
  const path = resolve(root, inputPath);
  const rel = relative(root, path);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    fail(`Scan path must stay inside the project root: ${inputPath}`);
  }
  if (!existsSync(path)) fail(`Scan path not found: ${inputPath}`);
  return path;
}

function readIgnoreRules(root, limits = {}) {
  const sources = [];
  const rules = [];
  const maxDepth = limits.maxDepth ?? 6;
  const maxDirs = limits.maxFiles ?? 2000;
  let visitedDirs = 0;
  let truncated = false;
  collect(root, "", 0);
  if (truncated) sources.push("ignore-discovery-truncated");
  return { sources, rules };

  function collect(dir, base, depth) {
    if (depth > maxDepth || visitedDirs >= maxDirs) {
      truncated = true;
      return;
    }
    visitedDirs += 1;
    for (const name of [".gitignore", ".agentignore"]) {
      const path = join(dir, name);
      if (!existsSync(path)) continue;
      sources.push(base ? `${base}/${name}` : name);
      const lines = readFileSync(path, "utf8").split(/\r?\n/);
      for (const line of lines) {
        const rule = parseIgnoreRule(line, base);
        if (rule) rules.push(rule);
      }
    }

    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || IGNORE_DIRS.has(entry.name)) continue;
      const relativePath = base ? `${base}/${entry.name}` : entry.name;
      if (ignoredByRules(relativePath, true, rules)) continue;
      collect(join(dir, entry.name), relativePath, depth + 1);
    }
  }
}

function parseIgnoreRule(line, base = "") {
  let pattern = String(line).trim();
  if (!pattern || pattern.startsWith("#")) return null;
  const negative = pattern.startsWith("!");
  if (negative) pattern = pattern.slice(1).trim();
  if (!pattern) return null;
  const directoryOnly = pattern.endsWith("/");
  pattern = pattern.replace(/^\/+/, "").replace(/\/+$/, "");
  if (!pattern) return null;
  return {
    negative,
    directoryOnly,
    anchored: line.trim().replace(/^!/, "").startsWith("/"),
    base,
    pattern,
    hasSlash: pattern.includes("/"),
    regex: globRegex(pattern),
  };
}

function ignoredByRules(relativePath, isDir, rules) {
  const normalized = relativePath.replaceAll("\\", "/");
  let ignored = false;
  for (const rule of rules) {
    if (ruleMatches(rule, normalized, isDir)) {
      ignored = !rule.negative;
    }
  }
  return ignored;
}

function ruleMatches(rule, relativePath, isDir) {
  let scopedPath = relativePath;
  if (rule.base) {
    if (relativePath === rule.base) return false;
    if (!relativePath.startsWith(`${rule.base}/`)) return false;
    scopedPath = relativePath.slice(rule.base.length + 1);
  }
  if (rule.directoryOnly && !isDir && !scopedPath.startsWith(`${rule.pattern}/`)) return false;
  if (!rule.hasSlash && !rule.anchored) {
    return scopedPath.split("/").some((part, index, parts) => {
      if (rule.directoryOnly && index === parts.length - 1 && !isDir) return false;
      return rule.regex.test(part);
    });
  }
  if (rule.regex.test(scopedPath)) return true;
  return rule.directoryOnly && scopedPath.startsWith(`${rule.pattern}/`);
}

function globRegex(pattern) {
  let output = "";
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    if (char === "*" && pattern[index + 1] === "*") {
      output += ".*";
      index += 1;
    } else if (char === "*") {
      output += "[^/]*";
    } else if (char === "?") {
      output += "[^/]";
    } else if (char === "[") {
      const end = pattern.indexOf("]", index + 1);
      const body = end === -1 ? "" : pattern.slice(index + 1, end);
      if (body && !body.includes("/")) {
        output += `[${escapeCharacterClass(body)}]`;
        index = end;
      } else {
        output += "\\[";
      }
    } else {
      output += char.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`^${output}$`);
}

function escapeCharacterClass(value) {
  const negated = value.startsWith("!");
  const body = negated ? value.slice(1) : value;
  return `${negated ? "^" : ""}${body.replace(/\\/g, "\\\\").replace(/\]/g, "\\]").replace(/\^/g, "\\^")}`;
}
