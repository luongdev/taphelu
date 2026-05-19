import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { parseArgs, parseMode } from "../args.mjs";
import { EVENT_TYPES } from "../constants.mjs";
import { fail } from "../errors.mjs";
import { relativeProjectPath, writeTextFileAtomic } from "../project.mjs";
import { analyzeServiceTopology } from "./scan.mjs";

const DEFAULT_CONTRACTS_PATH = ".projects/contracts";
const REGISTRY_VERSION = 1;
const MAX_CONTRACT_FILE_BYTES = 10 * 1024 * 1024;
const MAX_INTERACTION_SCAN_BYTES = 1024 * 1024;
const CONTRACT_FAMILIES = new Map([
  ["protobuf/grpc", "proto"],
  ["grpc", "proto"],
  ["protobuf", "proto"],
  ["openapi", "openapi"],
  ["swagger", "openapi"],
  ["asyncapi", "asyncapi"],
  ["graphql", "graphql"],
  ["json-schema", "schemas"],
  ["schema", "schemas"],
]);
const CONTRACT_DIRS = ["services", "interactions", "proto", "openapi", "asyncapi", "graphql", "schemas", "channels", "channels/kafka", "channels/redis-pubsub", "channels/redis-stream", "channels/queues", "channels/topics", "graphs"];
const METADATA_EXTENSIONS = new Set([".yaml", ".yml", ".json"]);
const INTERACTION_METADATA_NAMES = new Set([
  "taphelu-interactions.json",
  "taphelu-interactions.yaml",
  "taphelu-interactions.yml",
  "interactions.json",
  "interactions.yaml",
  "interactions.yml",
  "service-interactions.json",
  "service-interactions.yaml",
  "service-interactions.yml",
]);
const INTERACTION_SCAN_DIRS = new Set([".git", ".projects", ".taphelu", ".samples", "node_modules", "dist", "build", "coverage", ".cache", ".turbo", ".next", "vendor"]);

export function runContracts(root, rawArgs = []) {
  const { options, values } = parseArgs(rawArgs);
  const action = String(values.shift() || "check").trim();
  if (values.length) fail(`Unexpected positional value for dl contracts ${action}: ${values.join(" ")}`);

  if (action === "init") {
    const report = analyzeContractsInit(root, options);
    if (options.write) applyContractsInit(root, report);
    console.log(buildContractsInitReport(report, Boolean(options.write)));
    return;
  }
  if (action === "link") {
    const report = analyzeContractsLink(root, options);
    if (options.write) applyContractsLink(root, report);
    console.log(buildContractsLinkReport(report, Boolean(options.write)));
    return;
  }
  if (action === "scan") {
    const report = analyzeContractsScan(root, options);
    if (options.write) applyContractsScan(root, report);
    console.log(buildContractsScanReport(report, Boolean(options.write)));
    return;
  }
  if (action === "map") {
    const report = analyzeContractsMap(root, options);
    if (options.write) applyContractsMap(root, report);
    console.log(buildContractsMapReport(report, Boolean(options.write)));
    return;
  }
  if (action === "check") {
    const report = analyzeContractsCheck(root, options);
    console.log(buildContractsCheckReport(report));
    return;
  }
  if (action === "current") {
    const report = analyzeContractsCurrent(root, options);
    console.log(buildContractsCurrentReport(report));
    return;
  }
  if (action === "deps") {
    const report = analyzeContractsDeps(root, options);
    console.log(buildContractsDepsReport(report));
    return;
  }
  if (action === "sync") {
    const report = analyzeContractsSync(root, options);
    if (options.commit || options.push) applyContractsSync(root, report);
    console.log(buildContractsSyncReport(report, Boolean(options.commit || options.push)));
    return;
  }

  fail(`Unknown dl contracts action: ${action}. Expected init, link, scan, map, check, current, deps, or sync.`);
}

export function analyzeContractsInit(root, input = {}) {
  const path = contractsPath(root, input.path);
  const exists = existsSync(path);
  const remote = validateRemote(input.remote);
  if (exists && !statSync(path).isDirectory()) fail(`Contracts path exists but is not a directory: ${input.path || DEFAULT_CONTRACTS_PATH}`);
  return {
    kind: "contracts_init",
    path: relativeProjectPath(root, path),
    absolutePath: path,
    remote,
    exists,
    layout: CONTRACT_DIRS.map((name) => `${relativeProjectPath(root, path)}/${name}`),
    operations: [
      exists ? "validate existing contract registry layout" : remote ? `git clone ${remote} ${relativeProjectPath(root, path)}` : "create local contract registry directory",
      "create registry.json, services/, contract family directories, graphs/, README.md",
    ],
    nextRoute: "write_optional",
  };
}

export function applyContractsInit(root, report) {
  if (report.remote && !report.exists) {
    mkdirSync(dirname(report.absolutePath), { recursive: true });
    const result = spawnSync("git", ["clone", "--", report.remote, report.absolutePath], {
      cwd: root,
      encoding: "utf8",
    });
    if (result.status !== 0) fail(`git clone failed: ${(result.stderr || result.stdout || "").trim()}`);
  }
  ensureContractLayout(report.absolutePath);
  writeRegistryIfMissing(report.absolutePath);
  writeReadmeIfMissing(report.absolutePath);
  writeGitignoreIfMissing(report.absolutePath);
  appendContractsEvent(report.absolutePath, EVENT_TYPES.CONTRACTS_INITIALIZED, "Contract registry initialized.", {
    path: report.path,
    remote: report.remote || "",
  });
}

export function analyzeContractsLink(root, input = {}) {
  const path = contractsPath(root, input.path);
  const exists = existsSync(path) && statSync(path).isDirectory();
  const registryPath = join(path, "registry.json");
  return {
    kind: "contracts_link",
    path: relativeProjectPath(root, path),
    absolutePath: path,
    exists,
    hasRegistry: existsSync(registryPath),
    git: inspectGit(path),
    status: exists ? "PASS" : "FAIL",
    findings: exists ? [] : [`Contracts path not found: ${relativeProjectPath(root, path)}`],
    nextRoute: exists ? "write_optional" : "fix_contract_registry",
  };
}

export function applyContractsLink(root, report) {
  if (!report.exists) fail(`Contracts path not found: ${report.path}`);
  ensureContractLayout(report.absolutePath);
  writeReadmeIfMissing(report.absolutePath);
  writeGitignoreIfMissing(report.absolutePath);
  appendContractsEvent(report.absolutePath, EVENT_TYPES.CONTRACTS_LINKED, "Contract registry linked.", {
    path: report.path,
    git: report.git.kind,
  });
}

export function analyzeContractsScan(root, input = {}) {
  const registryRoot = contractsPath(root, input["contracts-path"] || input.registry || DEFAULT_CONTRACTS_PATH);
  const scanPath = input.path || input.scanPath || input["scan-path"] || ".";
  const mode = parseMode(input.mode || "standard");
  const topology = analyzeServiceTopology(root, { path: scanPath, mode, focus: "all" });
  const current = readRegistry(registryRoot);
  const service = serviceMetadataFromTopology(root, topology, current);
  const detectedInteractions = detectServiceInteractions(root, service, topology);
  service.provides = detectedInteractions.provides;
  service.consumes = detectedInteractions.consumes;
  service.depends_on = deriveDependsOn(service, current);
  const registryAfter = upsertRegistryService(current, service);
  registryAfter.interactions = upsertRegistryInteractions(current, service, [...service.provides, ...service.consumes]);
  const graph = buildContractGraph(registryAfter);
  const conflicts = detectRegistryConflicts(current, service, [...service.provides, ...service.consumes]);
  return {
    kind: "contracts_scan",
    path: relativeProjectPath(root, registryRoot),
    absolutePath: registryRoot,
    scanPath: topology.scanPath,
    mode,
    service,
    contracts: service.contracts,
    provides: service.provides,
    consumes: service.consumes,
    inferredInteractions: detectedInteractions.inferred,
    skippedImplementationContracts: topology.contracts.filter((contract) => !copyableContract(contract)).map((contract) => ({
      protocol: contract.protocol,
      path: contract.path,
      reason: "implementation route/controller evidence is metadata-only",
    })),
    conflicts,
    registry: registryAfter,
    graph,
    nextRoute: conflicts.length ? "resolve_contract_conflicts" : "review_contract_registry",
  };
}

export function applyContractsScan(root, report) {
  if (report.conflicts.length) {
    fail(`Contract registry conflict detected for ${report.service.id}. Resolve before writing: ${report.conflicts.map((item) => item.summary).join("; ")}`);
  }
  const touchedPaths = registryWritePaths(report.absolutePath, report.service);
  withFileRollback(touchedPaths, () => {
    ensureContractLayout(report.absolutePath);
    writeGitignoreIfMissing(report.absolutePath);
    copyContractFiles(root, report.absolutePath, report.service);
    writeServiceMetadata(report.absolutePath, report.service);
    writeInteractionMetadata(report.absolutePath, report.service);
    writeRegistry(report.absolutePath, report.registry);
    writeContractGraph(report.absolutePath, report.graph);
  });
  appendContractsEvent(report.absolutePath, EVENT_TYPES.CONTRACTS_SCANNED, "Service interactions imported into shared contract registry.", {
    path: report.path,
    service_id: report.service.id,
    contract_count: report.service.contracts.length,
    interaction_count: [...(report.service.provides || []), ...(report.service.consumes || [])].length,
  });
}

export function analyzeContractsMap(root, input = {}) {
  const registryRoot = contractsPath(root, input.path);
  const registry = readRegistry(registryRoot);
  const graph = buildContractGraph(registry);
  return {
    kind: "contracts_map",
    path: relativeProjectPath(root, registryRoot),
    absolutePath: registryRoot,
    registry,
    graph,
    nextRoute: "review_contract_topology",
  };
}

export function applyContractsMap(root, report) {
  withFileRollback(graphWritePaths(report.absolutePath), () => {
    ensureContractLayout(report.absolutePath);
    writeGitignoreIfMissing(report.absolutePath);
    writeContractGraph(report.absolutePath, report.graph);
  });
  appendContractsEvent(report.absolutePath, EVENT_TYPES.CONTRACTS_MAPPED, "Cross-repo service interaction graph generated.", {
    path: report.path,
    service_count: report.graph.services.length,
    contract_count: report.graph.contracts.length,
    interaction_count: report.graph.interactions.length,
    edge_count: report.graph.edges.length,
  });
}

export function analyzeContractsCheck(root, input = {}) {
  const registryRoot = contractsPath(root, input.path);
  const strict = Boolean(input.strict);
  const findings = [];
  let registry = emptyRegistry();
  if (!existsSync(registryRoot)) {
    findings.push(finding("FAIL", `Contracts path missing: ${relativeProjectPath(root, registryRoot)}`));
  } else {
    for (const dir of CONTRACT_DIRS) {
      if (!existsSync(join(registryRoot, dir))) findings.push(finding("WARN", `Missing registry directory: ${dir}/`));
    }
    registry = readRegistry(registryRoot);
    findings.push(...validateRegistry(registryRoot, registry, { strict }));
    const currentService = currentServiceIfPresent(root, registry);
    if (currentService) {
      const topology = analyzeServiceTopology(root, { path: ".", mode: "quick", focus: "all" });
      const scanned = serviceMetadataFromTopology(root, topology, registry);
      const detectedInteractions = detectServiceInteractions(root, scanned, topology);
      scanned.provides = detectedInteractions.provides;
      scanned.consumes = detectedInteractions.consumes;
      scanned.depends_on = deriveDependsOn(scanned, registry);
      findings.push(...detectRegistryConflicts(registry, scanned, [...scanned.provides, ...scanned.consumes]).map((conflict) => finding("FAIL", conflict.summary)));
    }
  }
  if (!findings.length) findings.push(finding("PASS", "Contract registry layout and metadata look valid."));
  const status = findings.some((item) => item.level === "FAIL") ? "FAIL" : findings.some((item) => item.level === "WARN") ? "WARN" : "PASS";
  return {
    kind: "contracts_check",
    path: relativeProjectPath(root, registryRoot),
    absolutePath: registryRoot,
    status,
    strict,
    registry,
    findings,
    nextRoute: status === "PASS" ? "plan_with_contract_registry" : "fix_contract_registry",
  };
}

export function analyzeContractsCurrent(root, input = {}) {
  const registryRoot = contractsPath(root, input["contracts-path"] || DEFAULT_CONTRACTS_PATH);
  const scanPath = input.path || ".";
  const registry = readRegistry(registryRoot);
  const service = resolveCurrentService(root, registry, input.service, scanPath);
  const graph = buildContractGraph(registry);
  const deps = service ? dependencySlice(registry, service.id, "all") : emptyDependencySlice("", "all");
  return {
    kind: "contracts_current",
    path: relativeProjectPath(root, registryRoot),
    scanPath,
    service,
    graph,
    deps,
    status: service ? "PASS" : "FAIL",
    nextRoute: service ? "plan_with_service_interactions" : "identify_current_service",
  };
}

export function analyzeContractsDeps(root, input = {}) {
  const registryRoot = contractsPath(root, input["contracts-path"] || DEFAULT_CONTRACTS_PATH);
  const registry = readRegistry(registryRoot);
  const direction = normalizeDirection(input.direction || "all");
  const current = resolveCurrentService(root, registry, input.service, input.path || ".");
  const deps = dependencySlice(registry, current?.id || cleanText(input.service), direction);
  return {
    kind: "contracts_deps",
    path: relativeProjectPath(root, registryRoot),
    service: current,
    direction,
    deps,
    status: current ? "PASS" : "FAIL",
    nextRoute: current ? "plan_with_dependency_slice" : "identify_current_service",
  };
}

export function analyzeContractsSync(root, input = {}) {
  const registryRoot = contractsPath(root, input.path);
  const check = analyzeContractsCheck(root, input);
  const git = inspectGit(registryRoot);
  const status = git.kind === "git" ? gitStatus(registryRoot) : { ok: false, output: "", changed: false };
  const wantsCommit = Boolean(input.commit);
  const wantsPush = Boolean(input.push);
  const blocked = [];
  if (check.status === "FAIL") blocked.push("contract check has FAIL findings");
  if (git.kind !== "git") blocked.push("contracts path is not a git repository/worktree/submodule");
  if (wantsPush && !wantsCommit) blocked.push("remote push requires --commit in the same command");
  if (wantsPush && git.kind === "git" && !gitBranch(registryRoot)) blocked.push("contract registry git checkout is detached; checkout a branch before --push");
  return {
    kind: "contracts_sync",
    path: relativeProjectPath(root, registryRoot),
    absolutePath: registryRoot,
    check,
    git,
    status,
    wantsCommit,
    wantsPush,
    blocked,
    operations: [
      "git status --short",
      wantsCommit ? "git add managed registry paths && git commit -m \"Update Taphelu contract registry\"" : "preview only; add --commit to commit local registry changes",
      wantsPush ? "git push" : "no remote push; add --push with --commit to push",
    ],
    nextRoute: blocked.length ? "fix_contract_registry" : wantsCommit || wantsPush ? "sync_contract_registry" : "write_optional",
  };
}

export function applyContractsSync(root, report) {
  if (report.blocked.length) fail(`Cannot sync contract registry: ${report.blocked.join("; ")}`);
  if (!report.status.changed) return;
  if (report.wantsCommit) {
    runGit(report.absolutePath, ["add", "--", ...managedRegistryGitPaths()]);
    const afterAdd = gitStatus(report.absolutePath);
    if (afterAdd.changed) runGit(report.absolutePath, ["commit", "-m", "Update Taphelu contract registry"]);
    appendContractsEvent(report.absolutePath, EVENT_TYPES.CONTRACTS_SYNCED, "Contract registry changes committed.", {
      path: report.path,
      pushed: false,
    });
  }
  if (report.wantsPush) {
    runGit(report.absolutePath, ["push"]);
    appendContractsEvent(report.absolutePath, EVENT_TYPES.CONTRACTS_SYNCED, "Contract registry changes pushed.", {
      path: report.path,
      pushed: true,
    });
  }
}

function managedRegistryGitPaths() {
  return ["registry.json", "README.md", ".gitignore", ...CONTRACT_DIRS];
}

export function buildContractsInitReport(report, didWrite = false) {
  return `# Contract Registry Init

## Scope

- Path: \`${report.path}\`
- Remote: ${report.remote ? `\`${report.remote}\`` : "none"}
- Existing path: ${report.exists ? "yes" : "no"}

## Planned Operations

${formatList(report.operations)}

## Layout

${formatList(report.layout.map((path) => `\`${path}\``))}

## Write Behavior

${didWrite ? "- Wrote or validated the contract registry layout and appended a registry-local `contracts_initialized` event." : "- Preview only. Add `--write` to create the layout or clone the remote registry inside `.projects`."}

## Next Route

\`${report.nextRoute}\`
`;
}

export function buildContractsLinkReport(report, didWrite = false) {
  return `# Contract Registry Link

## Status

- Path: \`${report.path}\`
- Exists: ${report.exists ? "yes" : "no"}
- Registry: ${report.hasRegistry ? "present" : "missing"}
- Git: ${report.git.kind}

${report.findings.length ? `## Findings\n\n${formatList(report.findings)}` : ""}
## Write Behavior

${didWrite ? "- Validated the registry layout and wrote a registry-local event." : "- Preview only. Add `--write` to validate this registry path."}

## Next Route

\`${report.nextRoute}\`
`;
}

export function buildContractsScanReport(report, didWrite = false) {
  return `# Contract Registry Scan

## Scope

- Registry: \`${report.path}\`
- Service scan path: \`${report.scanPath}\`
- Mode: \`${report.mode}\`
- Service: \`${report.service.id}\` (${report.service.name})

## Contracts

${formatContractRows(report.service.contracts)}

## Interactions

Provides:

${formatInteractionRows(report.service.provides || [])}

Consumes:

${formatInteractionRows(report.service.consumes || [])}

Inferred only:

${formatInteractionRows(report.inferredInteractions || [])}

## Metadata-Only Evidence

${formatList(report.skippedImplementationContracts.map((item) => `${item.protocol}: \`${item.path}\` (${item.reason})`), "None.")}

## Conflicts

${formatList(report.conflicts.map((item) => item.summary), "None.")}

## Write Behavior

${didWrite ? "- Updated service metadata, copied contract spec files, refreshed registry graph, and appended `contracts_scanned`." : "- Preview only. Add `--write` to update the shared contract registry."}

## Next Route

\`${report.nextRoute}\`
`;
}

export function buildContractsMapReport(report, didWrite = false) {
  return `# Contract Registry Map

## Summary

- Registry: \`${report.path}\`
- Services: ${report.graph.services.length}
- Contracts: ${report.graph.contracts.length}
- Interactions: ${report.graph.interactions.length}
- Edges: ${report.graph.edges.length}

## Services

${formatServiceRows(report.graph.services)}

## Relationships

${formatEdgeRows(report.graph.edges)}

## Write Behavior

${didWrite ? "- Wrote `graphs/service-graph.json`, `graphs/service-graph.mmd`, and appended `contracts_mapped`." : "- Preview only. Add `--write` to refresh graph artifacts."}

## Next Route

\`${report.nextRoute}\`
`;
}

export function buildContractsCheckReport(report) {
  return `# Contract Registry Check

## Status

\`${report.status}\`

- Strict: ${report.strict ? "yes" : "no"}

## Findings

${report.findings.map((item) => `- ${item.level}: ${item.message}`).join("\n")}

## Next Route

\`${report.nextRoute}\`
`;
}

export function buildContractsCurrentReport(report) {
  return `# Contract Registry Current Service

## Status

\`${report.status}\`

## Service

${report.service ? `- ID: \`${report.service.id}\`
- Name: ${report.service.name}
- Repo: ${report.service.repo || "-"}` : "- Current service not found in registry."}

## Outbound

${formatDependencyRows(report.deps.outbound)}

## Inbound

${formatDependencyRows(report.deps.inbound)}

## Provides

${formatInteractionRows(report.deps.provides)}

## Consumes

${formatInteractionRows(report.deps.consumes)}

## Unresolved

${formatList(report.deps.unresolved.map((item) => `${item.protocol}:${item.name}`), "None.")}

## Next Route

\`${report.nextRoute}\`
`;
}

export function buildContractsDepsReport(report) {
  return `# Contract Registry Dependencies

## Status

\`${report.status}\`

- Service: ${report.service ? `\`${report.service.id}\`` : "not found"}
- Direction: \`${report.direction}\`

## Outbound

${formatDependencyRows(report.deps.outbound)}

## Inbound

${formatDependencyRows(report.deps.inbound)}

## Provides

${formatInteractionRows(report.deps.provides)}

## Consumes

${formatInteractionRows(report.deps.consumes)}

## Unresolved

${formatList(report.deps.unresolved.map((item) => `${item.protocol}:${item.name}`), "None.")}

## Next Route

\`${report.nextRoute}\`
`;
}

export function buildContractsSyncReport(report, didWrite = false) {
  return `# Contract Registry Sync

## Status

- Registry: \`${report.path}\`
- Git: ${report.git.kind}
- Changed files: ${report.status.changed ? "yes" : "no"}
- Commit requested: ${report.wantsCommit ? "yes" : "no"}
- Push requested: ${report.wantsPush ? "yes" : "no"}

## Operations

${formatList(report.operations)}

## Blockers

${formatList(report.blocked, "None.")}

## Write Behavior

${didWrite ? "- Ran requested gated git operation(s)." : "- Preview only. Add `--commit` to commit and `--push` to push after commit."}

## Next Route

\`${report.nextRoute}\`
`;
}

function contractsPath(root, inputPath = DEFAULT_CONTRACTS_PATH) {
  const value = inputPath || DEFAULT_CONTRACTS_PATH;
  const path = isAbsolute(value) ? resolve(value) : resolve(root, value);
  const rel = relative(root, path);
  if (rel.startsWith("..") || isAbsolute(rel)) fail(`Contracts path must stay inside the project root: ${value}`);
  const normalized = rel.replaceAll("\\", "/");
  if (!normalized.startsWith(".projects/")) {
    fail(`Contracts path must stay under .projects/: ${value}`);
  }
  return path;
}

function ensureContractLayout(path) {
  mkdirSync(path, { recursive: true });
  for (const dir of CONTRACT_DIRS) mkdirSync(join(path, dir), { recursive: true });
}

function writeRegistryIfMissing(path) {
  const registryPath = join(path, "registry.json");
  if (!existsSync(registryPath)) writeRegistry(path, emptyRegistry());
}

function writeReadmeIfMissing(path) {
  const readmePath = join(path, "README.md");
  if (existsSync(readmePath)) return;
  writeTextFileAtomic(readmePath, `# Taphelu Contract Registry

Shared contract source of truth for polyrepo services.

- Service metadata lives in \`services/*.yaml\`.
- Service interaction metadata lives in \`interactions/*.yaml\`.
- Contract specs live in \`proto/\`, \`openapi/\`, \`asyncapi/\`, \`graphql/\`, or \`schemas/\`.
- Messaging and channel metadata lives in \`channels/\`.
- Graph artifacts live in \`graphs/\`.
- Generated client code does not belong in this registry.
`);
}

function writeGitignoreIfMissing(path) {
  const ignorePath = join(path, ".gitignore");
  if (existsSync(ignorePath)) return;
  writeTextFileAtomic(ignorePath, `.DS_Store
.env
.env.*
node_modules/
dist/
build/
*.log
`);
}

function emptyRegistry() {
  return {
    schemaVersion: REGISTRY_VERSION,
    updatedAt: new Date().toISOString(),
    services: [],
    interactions: [],
    graphs: {
      serviceGraph: "graphs/service-graph.json",
      mermaid: "graphs/service-graph.mmd",
    },
  };
}

function readRegistry(path) {
  const registryPath = join(path, "registry.json");
  if (!existsSync(registryPath)) return emptyRegistry();
  try {
    const parsed = JSON.parse(readFileSync(registryPath, "utf8"));
    return {
      ...emptyRegistry(),
      ...parsed,
      services: Array.isArray(parsed.services) ? parsed.services : [],
      interactions: Array.isArray(parsed.interactions) ? parsed.interactions : [],
      graphs: parsed.graphs && typeof parsed.graphs === "object" ? parsed.graphs : emptyRegistry().graphs,
    };
  } catch (error) {
    fail(`Invalid registry.json: ${error.message}`);
  }
}

function writeRegistry(path, registry) {
  const next = {
    ...registry,
    schemaVersion: REGISTRY_VERSION,
    updatedAt: new Date().toISOString(),
    services: [...(registry.services || [])].sort((a, b) => a.id.localeCompare(b.id)),
    interactions: [...(registry.interactions || [])].sort((a, b) => a.id.localeCompare(b.id)),
    graphs: registry.graphs || emptyRegistry().graphs,
  };
  writeTextFileAtomic(join(path, "registry.json"), `${JSON.stringify(next, null, 2)}\n`);
}

function serviceMetadataFromTopology(root, topology, registry) {
  const preferred = topology.services.find((service) => service.root === topology.scanPath) || topology.services.find((service) => service.root === ".") || topology.services[0];
  const id = serviceId(preferred?.name || basename(root));
  const rootService = preferred || {
    id,
    name: basename(root),
    root: ".",
    kind: "service",
    stack: [],
    manifests: [],
    testCommands: [],
    deploySignals: [],
    confidence: "low",
    evidence: ["repo root"],
  };
  const repo = gitRemote(root);
  const contracts = topology.contracts.map((contract) => contractMetadata(id, contract)).filter(Boolean);
  const dependsOn = [...new Set(topology.edges
    .filter((edge) => edge.type === "depends_on" || edge.type === "package_dependency")
    .filter((edge) => edge.from === rootService.id || edge.from === id || edge.from === rootService.name)
    .map((edge) => serviceId(edge.to))
    .filter((value) => value && value !== id))];
  const existing = registry.services.find((service) => service.id === id) || {};
  return {
    id,
    name: cleanText(rootService.name || existing.name || id),
    repo: repo || existing.repo || "",
    root: rootService.root || ".",
    owners: Array.isArray(existing.owners) ? existing.owners : [],
    runtime: {
      language: runtimeLanguage(rootService.stack || []),
      stack: rootService.stack || [],
    },
    contracts,
    provides: Array.isArray(existing.provides) ? existing.provides : [],
    consumes: Array.isArray(existing.consumes) ? existing.consumes : [],
    depends_on: dependsOn.length ? dependsOn : Array.isArray(existing.depends_on) ? existing.depends_on : [],
    manifests: rootService.manifests || [],
    testCommands: rootService.testCommands || [],
    deploySignals: rootService.deploySignals || [],
    confidence: rootService.confidence || "medium",
    evidence: rootService.evidence || [],
  };
}

function contractMetadata(serviceIdValue, contract) {
  const protocol = normalizeProtocol(contract.protocol);
  const family = CONTRACT_FAMILIES.get(protocol);
  const sourcePath = contract.path.replaceAll("\\", "/");
  const targetPath = family && copyableContract(contract)
    ? `${family}/${serviceIdValue}/${sourcePath.split("/").map(safePathPart).join("/")}`
    : sourcePath;
  return {
    protocol,
    path: targetPath,
    source_path: sourcePath,
    surface: cleanText(contract.surface || protocol),
    confidence: contract.confidence || "medium",
    evidence: contract.evidence || [sourcePath],
  };
}

function copyableContract(contract) {
  const protocol = normalizeProtocol(contract.protocol);
  if (!CONTRACT_FAMILIES.has(protocol)) return false;
  const ext = extname(contract.path).toLowerCase();
  if (protocol === "graphql") return [".graphql", ".gql"].includes(ext);
  if (protocol === "protobuf/grpc") return ext === ".proto";
  if (protocol === "openapi" || protocol === "asyncapi" || protocol === "json-schema") return METADATA_EXTENSIONS.has(ext);
  return false;
}

function detectServiceInteractions(root, service, topology) {
  const explicit = detectExplicitInteractions(root, service.id);
  const asyncApi = detectAsyncApiInteractions(root, service, topology);
  const signals = detectSignalInteractions(root, service.id);
  const all = dedupeInteractions([...explicit, ...asyncApi, ...signals]);
  const writable = all.filter((interaction) => interaction.confidence !== "low");
  return {
    provides: writable.filter((interaction) => interaction.direction === "provides"),
    consumes: writable.filter((interaction) => interaction.direction === "consumes"),
    inferred: all.filter((interaction) => interaction.confidence === "low"),
  };
}

function detectExplicitInteractions(root, serviceIdValue) {
  const interactions = [];
  for (const file of collectInteractionScanFiles(root)) {
    if (!INTERACTION_METADATA_NAMES.has(basename(file).toLowerCase())) continue;
    const parsed = parseInteractionMetadata(file);
    for (const direction of ["provides", "consumes"]) {
      for (const item of parsed[direction] || []) {
        interactions.push(normalizeInteraction({
          ...item,
          direction,
          owner_service: item.owner_service || serviceIdValue,
          confidence: item.confidence || "high",
          evidence: item.evidence || [relativeProjectPath(root, file)],
        }, serviceIdValue));
      }
    }
  }
  return interactions;
}

function detectAsyncApiInteractions(root, service, topology) {
  const interactions = [];
  for (const contract of topology.contracts || []) {
    if (normalizeProtocol(contract.protocol) !== "asyncapi") continue;
    const filePath = resolve(root, contract.path);
    if (!existsSync(filePath)) continue;
    const parsed = parseAsyncApiInteractions(root, filePath, service.id);
    interactions.push(...parsed);
  }
  return interactions;
}

function detectSignalInteractions(root, serviceIdValue) {
  const interactions = [];
  const packagePath = join(root, "package.json");
  if (existsSync(packagePath)) {
    try {
      const parsed = JSON.parse(readFileSync(packagePath, "utf8"));
      const deps = Object.keys({
        ...(parsed.dependencies || {}),
        ...(parsed.devDependencies || {}),
        ...(parsed.peerDependencies || {}),
      }).map((item) => item.toLowerCase());
      const protocols = [];
      if (deps.some((dep) => ["kafkajs", "kafka-node", "node-rdkafka"].includes(dep))) protocols.push(["kafka", "event-stream"]);
      if (deps.some((dep) => ["ioredis", "redis"].includes(dep))) protocols.push(["redis-pubsub", "pubsub"]);
      if (deps.some((dep) => ["bullmq", "bull", "amqplib"].includes(dep))) protocols.push(["queue", "queue"]);
      if (deps.some((dep) => dep.includes("aws-sdk") || dep.includes("@aws-sdk/client-sqs") || dep.includes("@aws-sdk/client-sns"))) protocols.push(["sqs", "queue"]);
      for (const [protocol, kind] of protocols) {
        interactions.push(normalizeInteraction({
          kind,
          protocol,
          name: `${protocol}-configured`,
          direction: "consumes",
          owner_service: serviceIdValue,
          confidence: "medium",
          evidence: ["package.json"],
        }, serviceIdValue));
      }
    } catch {
      // Ignore malformed package metadata; normal project scan will report package issues elsewhere.
    }
  }

  for (const file of collectInteractionScanFiles(root)) {
    if (statSync(file).size > MAX_INTERACTION_SCAN_BYTES) continue;
    const ext = extname(file).toLowerCase();
    if (![".js", ".mjs", ".cjs", ".ts", ".tsx", ".go", ".py", ".env", ".yaml", ".yml", ".json"].includes(ext)) continue;
    let content = "";
    try {
      content = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    const regex = /\b([A-Z0-9_]*(?:KAFKA_TOPIC|REDIS_CHANNEL|REDIS_STREAM|QUEUE_NAME|EVENT_TOPIC)[A-Z0-9_]*)\b\s*[:=]\s*["']?([A-Za-z0-9_.:-]{3,})/gu;
    for (const match of content.matchAll(regex)) {
      const key = match[1];
      const name = match[2];
      const direction = /(PUBLISH|PRODUCE|WRITE|OUT)/u.test(key) ? "provides" : "consumes";
      interactions.push(normalizeInteraction({
        kind: kindFromSignalKey(key),
        protocol: protocolFromSignalKey(key),
        name,
        direction,
        owner_service: serviceIdValue,
        confidence: "low",
        inferred: true,
        evidence: [relativeProjectPath(root, file)],
      }, serviceIdValue));
    }
  }
  return interactions;
}

function parseInteractionMetadata(path) {
  const text = readFileSync(path, "utf8");
  if (path.toLowerCase().endsWith(".json")) {
    try {
      const parsed = JSON.parse(text);
      return {
        provides: Array.isArray(parsed.provides) ? parsed.provides : [],
        consumes: Array.isArray(parsed.consumes) ? parsed.consumes : [],
      };
    } catch {
      return { provides: [], consumes: [] };
    }
  }
  return parseSimpleInteractionYaml(text);
}

function parseSimpleInteractionYaml(text) {
  const result = { provides: [], consumes: [] };
  let section = "";
  let current = null;
  for (const rawLine of text.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    if (line === "provides:" || line === "consumes:") {
      section = line.slice(0, -1);
      current = null;
      continue;
    }
    if (!section) continue;
    const itemMatch = /^-\s+([A-Za-z0-9_:-]+):\s*(.*)$/u.exec(line);
    if (line.startsWith("- ")) {
      current = {};
      result[section].push(current);
      const inline = line.slice(2).trim();
      if (inline && itemMatch) current[itemMatch[1]] = unquoteYaml(itemMatch[2]);
      continue;
    }
    const kv = /^([A-Za-z0-9_:-]+):\s*(.*)$/u.exec(line);
    if (current && kv) current[kv[1]] = unquoteYaml(kv[2]);
  }
  return result;
}

function parseAsyncApiInteractions(root, path, serviceIdValue) {
  const content = readFileSync(path, "utf8");
  const protocol = /protocol:\s*["']?([A-Za-z0-9_.-]+)/iu.exec(content)?.[1] || (content.toLowerCase().includes("kafka") ? "kafka" : "asyncapi");
  const interactions = [];
  let inChannels = false;
  let channelsIndent = 0;
  let currentChannel = "";
  for (const rawLine of content.split(/\r?\n/u)) {
    const line = rawLine.replace(/\t/g, "  ");
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const indent = line.length - line.trimStart().length;
    if (/^channels:\s*$/u.test(trimmed)) {
      inChannels = true;
      channelsIndent = indent;
      continue;
    }
    if (!inChannels) continue;
    if (indent <= channelsIndent && !/^channels:\s*$/u.test(trimmed)) {
      inChannels = false;
      currentChannel = "";
      continue;
    }
    const channel = /^["']?([^"':{}][^"':{}]*)["']?:\s*$/u.exec(trimmed);
    if (channel && indent === channelsIndent + 2) {
      currentChannel = channel[1].trim();
      continue;
    }
    if (!currentChannel) continue;
    if (/^publish:\s*$/u.test(trimmed)) {
      interactions.push(normalizeInteraction({
        kind: "event-stream",
        protocol,
        name: currentChannel,
        direction: "provides",
        owner_service: serviceIdValue,
        provider_service: serviceIdValue,
        contract_path: relativeProjectPath(root, path),
        confidence: "high",
        evidence: [relativeProjectPath(root, path)],
      }, serviceIdValue));
    }
    if (/^subscribe:\s*$/u.test(trimmed)) {
      interactions.push(normalizeInteraction({
        kind: "event-stream",
        protocol,
        name: currentChannel,
        direction: "consumes",
        owner_service: serviceIdValue,
        contract_path: relativeProjectPath(root, path),
        confidence: "high",
        evidence: [relativeProjectPath(root, path)],
      }, serviceIdValue));
    }
  }
  return interactions;
}

function normalizeInteraction(input, fallbackServiceId) {
  const protocol = normalizeInteractionProtocol(input.protocol || input.kind || "");
  const kind = normalizeInteractionKind(input.kind || protocol);
  const name = cleanText(input.name || input.topic || input.queue || input.channel || input.stream || protocol);
  const ownerService = serviceId(input.owner_service || input.ownerService || fallbackServiceId);
  const direction = input.direction === "provides" ? "provides" : "consumes";
  const provider = cleanText(input.provider_service || input.providerService || (direction === "provides" ? ownerService : ""));
  const consumers = normalizeStringArray(input.consumer_services || input.consumerServices);
  const id = safeId(input.id || `${ownerService}.${direction}.${protocol}.${name}`);
  return {
    id,
    kind,
    protocol,
    name,
    direction,
    owner_service: ownerService,
    provider_service: provider ? serviceId(provider) : "",
    consumer_services: consumers.map(serviceId),
    contract_path: cleanText(input.contract_path || input.contractPath || ""),
    confidence: normalizeConfidence(input.confidence || "medium"),
    inferred: Boolean(input.inferred) || input.confidence === "low",
    evidence: normalizeStringArray(input.evidence).length ? normalizeStringArray(input.evidence) : [name],
  };
}

function normalizeInteractionKind(value) {
  const text = String(value || "").toLowerCase();
  if (text.includes("queue") || ["sqs", "rabbitmq", "amqp", "bullmq"].some((item) => text.includes(item))) return "queue";
  if (text.includes("pubsub") || text.includes("pub/sub") || text.includes("channel")) return "pubsub";
  if (text.includes("stream") && text.includes("redis")) return "cache-channel";
  if (text.includes("stream") || text.includes("topic") || ["kafka", "nats", "sns"].some((item) => text.includes(item))) return "event-stream";
  if (["openapi", "graphql", "grpc", "protobuf/grpc"].some((item) => text.includes(item))) return "api";
  return "event-stream";
}

function normalizeInteractionProtocol(value) {
  const text = String(value || "").toLowerCase();
  if (text.includes("redis") && text.includes("stream")) return "redis-stream";
  if (text.includes("redis")) return "redis-pubsub";
  if (text.includes("kafka")) return "kafka";
  if (text.includes("rabbit") || text.includes("amqp")) return "rabbitmq";
  if (text.includes("sqs")) return "sqs";
  if (text.includes("sns")) return "sns";
  if (text.includes("nats")) return "nats";
  if (text.includes("graphql")) return "graphql";
  if (text.includes("openapi") || text.includes("swagger")) return "openapi";
  if (text.includes("grpc") || text.includes("protobuf")) return "grpc";
  if (text.includes("queue")) return "queue";
  if (text.includes("pubsub")) return "redis-pubsub";
  return text || "unknown";
}

function protocolFromSignalKey(key) {
  if (key.includes("REDIS_STREAM")) return "redis-stream";
  if (key.includes("REDIS_CHANNEL")) return "redis-pubsub";
  if (key.includes("QUEUE")) return "queue";
  return "kafka";
}

function kindFromSignalKey(key) {
  if (key.includes("REDIS_STREAM")) return "cache-channel";
  if (key.includes("REDIS_CHANNEL")) return "pubsub";
  if (key.includes("QUEUE")) return "queue";
  return "event-stream";
}

function collectInteractionScanFiles(root) {
  const files = [];
  walk(root, 0);
  return files;

  function walk(dir, depth) {
    if (files.length >= 1000 || depth > 6) return;
    let entries = [];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (files.length >= 1000) return;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!INTERACTION_SCAN_DIRS.has(entry.name)) walk(path, depth + 1);
      } else if (entry.isFile()) {
        files.push(path);
      }
    }
  }
}

function deriveDependsOn(service, registry) {
  const deps = new Set(Array.isArray(service.depends_on) ? service.depends_on.map(serviceId) : []);
  const providers = providerIndex(registry, [...(service.provides || []), ...(service.consumes || [])]);
  for (const interaction of service.consumes || []) {
    const provider = interaction.provider_service || providers.get(interactionKey(interaction));
    if (provider && provider !== service.id) deps.add(serviceId(provider));
  }
  return [...deps].sort();
}

function upsertRegistryInteractions(registry, service, interactions) {
  return [
    ...(registry.interactions || []).filter((interaction) => interaction.owner_service !== service.id),
    ...interactions,
  ].sort((a, b) => a.id.localeCompare(b.id));
}

function dedupeInteractions(interactions) {
  const map = new Map();
  for (const interaction of interactions) {
    const key = `${interaction.owner_service}:${interaction.direction}:${interaction.protocol}:${interaction.name}`;
    const existing = map.get(key);
    if (!existing || confidenceRank(interaction.confidence) > confidenceRank(existing.confidence)) map.set(key, interaction);
  }
  return [...map.values()].sort((a, b) => a.id.localeCompare(b.id));
}

function interactionKey(interaction) {
  return `${normalizeInteractionProtocol(interaction.protocol)}:${cleanText(interaction.name).toLowerCase()}`;
}

function providerIndex(registry, extraInteractions = []) {
  const providers = new Map();
  for (const interaction of [...(registry.interactions || []), ...extraInteractions]) {
    if (interaction.direction !== "provides") continue;
    providers.set(interactionKey(interaction), interaction.provider_service || interaction.owner_service);
  }
  return providers;
}

function interactionEdgeType(interaction) {
  if (interaction.kind === "queue") return interaction.direction === "provides" ? "produces_queue" : "consumes_queue";
  if (interaction.protocol === "redis-stream") return interaction.direction === "provides" ? "writes_stream" : "reads_stream";
  if (interaction.kind === "pubsub" || interaction.protocol === "redis-pubsub") return "uses_cache_channel";
  if (interaction.direction === "provides") return "publishes_to";
  return "subscribes_to";
}

function normalizeStringArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.map((item) => cleanText(item)).filter(Boolean);
  return [cleanText(value)].filter(Boolean);
}

function normalizeConfidence(value) {
  return ["high", "medium", "low"].includes(value) ? value : "medium";
}

function confidenceRank(value) {
  if (value === "high") return 3;
  if (value === "medium") return 2;
  return 1;
}

function unquoteYaml(value) {
  return String(value || "").replace(/^["']|["']$/g, "").trim();
}

function copyContractFiles(root, registryRoot, service) {
  const rootReal = realpathSync(root);
  for (const contract of service.contracts) {
    if (contract.path === contract.source_path) continue;
    const from = resolve(root, contract.source_path);
    const rel = relative(root, from);
    if (rel.startsWith("..") || isAbsolute(rel)) fail(`Contract source path escapes project root: ${contract.source_path}`);
    const to = join(registryRoot, contract.path);
    if (!existsSync(from)) continue;
    const fromReal = realpathSync(from);
    const realRel = relative(rootReal, fromReal);
    if (realRel.startsWith("..") || isAbsolute(realRel)) fail(`Contract source realpath escapes project root: ${contract.source_path}`);
    const stat = statSync(fromReal);
    if (stat.size > MAX_CONTRACT_FILE_BYTES) fail(`Contract source file is too large to copy: ${contract.source_path}`);
    mkdirSync(dirname(to), { recursive: true });
    copyFileSync(fromReal, to);
  }
}

function registryWritePaths(registryRoot, service) {
  return [
    join(registryRoot, "registry.json"),
    join(registryRoot, "README.md"),
    join(registryRoot, ".gitignore"),
    join(registryRoot, "services", `${service.id}.yaml`),
    join(registryRoot, "interactions", `${service.id}.yaml`),
    ...graphWritePaths(registryRoot),
    ...(service.contracts || [])
      .filter((contract) => contract.path !== contract.source_path)
      .map((contract) => join(registryRoot, contract.path)),
  ];
}

function graphWritePaths(registryRoot) {
  return [
    join(registryRoot, "graphs", "service-graph.json"),
    join(registryRoot, "graphs", "service-graph.mmd"),
  ];
}

function withFileRollback(paths, fn) {
  const snapshots = paths.map((path) => ({
    path,
    exists: existsSync(path),
    content: existsSync(path) ? readFileSync(path) : null,
  }));
  try {
    return fn();
  } catch (error) {
    for (const snapshot of snapshots.reverse()) {
      try {
        if (snapshot.exists) {
          writeFileSync(snapshot.path, snapshot.content);
        } else if (existsSync(snapshot.path)) {
          unlinkSync(snapshot.path);
        }
      } catch {
        // Preserve the original write failure; rollback is best-effort.
      }
    }
    throw error;
  }
}

function writeServiceMetadata(registryRoot, service) {
  writeTextFileAtomic(join(registryRoot, "services", `${service.id}.yaml`), renderServiceYaml(service));
}

function writeInteractionMetadata(registryRoot, service) {
  writeTextFileAtomic(join(registryRoot, "interactions", `${service.id}.yaml`), renderInteractionsYaml(service));
}

function renderServiceYaml(service) {
  const lines = [
    `id: ${yamlScalar(service.id)}`,
    `name: ${yamlScalar(service.name)}`,
    `repo: ${yamlScalar(service.repo || "")}`,
    `root: ${yamlScalar(service.root || ".")}`,
    "owners:",
    ...(service.owners?.length ? service.owners.map((owner) => `  - ${yamlScalar(owner)}`) : ["  -"]),
    "runtime:",
    `  language: ${yamlScalar(service.runtime?.language || "unknown")}`,
    "  stack:",
    ...(service.runtime?.stack?.length ? service.runtime.stack.map((item) => `    - ${yamlScalar(item)}`) : ["    -"]),
    "contracts:",
    ...(service.contracts?.length ? service.contracts.flatMap((contract) => [
      `  - protocol: ${yamlScalar(contract.protocol)}`,
      `    path: ${yamlScalar(contract.path)}`,
      `    source_path: ${yamlScalar(contract.source_path || "")}`,
      `    confidence: ${yamlScalar(contract.confidence || "medium")}`,
    ]) : ["  -"]),
    "provides:",
    ...(service.provides?.length ? service.provides.map((interaction) => `  - ${yamlScalar(interaction.id)}`) : ["  -"]),
    "consumes:",
    ...(service.consumes?.length ? service.consumes.map((interaction) => `  - ${yamlScalar(interaction.id)}`) : ["  -"]),
    "depends_on:",
    ...(service.depends_on?.length ? service.depends_on.map((dep) => `  - ${yamlScalar(dep)}`) : ["  -"]),
  ];
  return `${lines.join("\n")}\n`;
}

function renderInteractionsYaml(service) {
  const lines = [`service: ${yamlScalar(service.id)}`];
  for (const section of ["provides", "consumes"]) {
    lines.push(`${section}:`);
    const interactions = service[section] || [];
    if (!interactions.length) {
      lines.push("  -");
      continue;
    }
    for (const interaction of interactions) {
      lines.push(`  - id: ${yamlScalar(interaction.id)}`);
      lines.push(`    kind: ${yamlScalar(interaction.kind)}`);
      lines.push(`    protocol: ${yamlScalar(interaction.protocol)}`);
      lines.push(`    name: ${yamlScalar(interaction.name)}`);
      lines.push(`    direction: ${yamlScalar(interaction.direction)}`);
      lines.push(`    owner_service: ${yamlScalar(interaction.owner_service)}`);
      lines.push(`    provider_service: ${yamlScalar(interaction.provider_service || "")}`);
      lines.push("    consumer_services:");
      lines.push(...(interaction.consumer_services?.length ? interaction.consumer_services.map((service) => `      - ${yamlScalar(service)}`) : ["      -"]));
      lines.push(`    contract_path: ${yamlScalar(interaction.contract_path || "")}`);
      lines.push(`    confidence: ${yamlScalar(interaction.confidence || "medium")}`);
      lines.push("    evidence:");
      lines.push(...(interaction.evidence?.length ? interaction.evidence.map((item) => `      - ${yamlScalar(item)}`) : ["      -"]));
    }
  }
  return `${lines.join("\n")}\n`;
}

function upsertRegistryService(registry, service) {
  const next = {
    ...registry,
    services: registry.services.filter((item) => item.id !== service.id),
  };
  next.services.push(service);
  return next;
}

function detectRegistryConflicts(registry, scannedService, scannedInteractions = []) {
  const existing = registry.services.find((service) => service.id === scannedService.id);
  if (!existing) return [];
  const conflicts = [];
  const existingContracts = existing.contracts || [];
  const scannedContracts = scannedService.contracts || [];
  for (const contract of existingContracts) {
    if (!scannedContracts.some((candidate) => sameContractIdentity(contract, candidate))) {
      conflicts.push({ summary: `Registry has contract not seen in service repo: ${contractIdentity(contract)}` });
    }
  }
  for (const contract of scannedContracts) {
    if (!existingContracts.some((candidate) => sameContractIdentity(contract, candidate))) {
      conflicts.push({ summary: `Service repo has contract missing from registry: ${contractIdentity(contract)}` });
    }
  }
  const existingInteractions = (registry.interactions || []).filter((interaction) => interaction.owner_service === scannedService.id);
  for (const interaction of existingInteractions) {
    if (!scannedInteractions.some((candidate) => sameInteractionIdentity(interaction, candidate))) {
      conflicts.push({ summary: `Registry has interaction not seen in service repo: ${interactionIdentity(interaction)}` });
    }
  }
  for (const interaction of scannedInteractions) {
    if (existingInteractions.length && !existingInteractions.some((candidate) => sameInteractionIdentity(interaction, candidate))) {
      conflicts.push({ summary: `Service repo has interaction missing from registry: ${interactionIdentity(interaction)}` });
    }
  }
  return conflicts;
}

function sameContractIdentity(left, right) {
  if (normalizeProtocol(left.protocol) !== normalizeProtocol(right.protocol)) return false;
  const leftPaths = contractIdentityPaths(left);
  const rightPaths = contractIdentityPaths(right);
  return leftPaths.some((path) => rightPaths.includes(path));
}

function contractIdentity(contract) {
  return `${normalizeProtocol(contract.protocol)}:${contract.source_path || contract.path}`;
}

function contractIdentityPaths(contract) {
  return [...new Set([contract.path, contract.source_path].filter(Boolean).map((path) => String(path).replaceAll("\\", "/")))];
}

function sameInteractionIdentity(left, right) {
  return left.direction === right.direction && interactionKey(left) === interactionKey(right);
}

function interactionIdentity(interaction) {
  return `${interaction.direction}:${interaction.protocol}:${interaction.name}`;
}

function buildContractGraph(registry) {
  const services = [...(registry.services || [])].map((service) => ({
    id: service.id,
    name: service.name,
    repo: service.repo || "",
    root: service.root || ".",
    owners: service.owners || [],
    runtime: service.runtime || {},
  })).sort((a, b) => a.id.localeCompare(b.id));
  const contracts = [];
  const interactions = [...(registry.interactions || [])].map((interaction) => ({
    id: interaction.id,
    kind: interaction.kind,
    protocol: interaction.protocol,
    name: interaction.name,
    direction: interaction.direction,
    owner_service: interaction.owner_service,
    provider_service: interaction.provider_service || "",
    consumer_services: interaction.consumer_services || [],
    contract_path: interaction.contract_path || "",
    confidence: interaction.confidence || "medium",
    inferred: Boolean(interaction.inferred),
    evidence: interaction.evidence || [],
  })).sort((a, b) => a.id.localeCompare(b.id));
  const edges = [];
  for (const service of registry.services || []) {
    for (const contract of service.contracts || []) {
      const id = `contract:${service.id}:${normalizeProtocol(contract.protocol)}:${safeId(contract.path)}`;
      contracts.push({
        id,
        serviceId: service.id,
        protocol: normalizeProtocol(contract.protocol),
        path: contract.path,
        surface: contract.surface || normalizeProtocol(contract.protocol),
        confidence: contract.confidence || "medium",
        evidence: contract.evidence || [contract.path],
      });
      edges.push({
        from: service.id,
        to: id,
        type: "exposes_contract",
        label: normalizeProtocol(contract.protocol),
        confidence: contract.confidence || "medium",
        evidence: contract.evidence || [contract.path],
      });
    }
    for (const dep of service.depends_on || []) {
      edges.push({
        from: service.id,
        to: serviceId(dep),
        type: "depends_on",
        label: "declared dependency",
        confidence: "high",
        evidence: [`services/${service.id}.yaml`],
      });
    }
  }
  const knownServices = new Set(services.map((service) => service.id));
  for (const interaction of interactions) {
    const interactionNode = `interaction:${interaction.id}`;
    edges.push({
      from: interaction.owner_service,
      to: interactionNode,
      type: interactionEdgeType(interaction),
      label: `${interaction.protocol}:${interaction.name}`,
      confidence: interaction.confidence || "medium",
      evidence: interaction.evidence || [interaction.contract_path || interaction.name],
    });
    if (interaction.direction === "consumes") {
      const provider = interaction.provider_service || providerIndex(registry).get(interactionKey(interaction));
      if (provider) {
        edges.push({
          from: interaction.owner_service,
          to: serviceId(provider),
          type: "depends_on",
          label: `${interaction.protocol}:${interaction.name}`,
          confidence: interaction.confidence || "medium",
          evidence: interaction.evidence || [interaction.name],
        });
      } else {
        edges.push({
          from: interaction.owner_service,
          to: `unresolved:${safeId(interaction.protocol)}:${safeId(interaction.name)}`,
          type: interactionEdgeType(interaction),
          label: `${interaction.protocol}:${interaction.name}`,
          confidence: "low",
          evidence: interaction.evidence || [interaction.name],
        });
      }
    }
    for (const consumer of interaction.consumer_services || []) {
      if (!knownServices.has(consumer)) continue;
      edges.push({
        from: consumer,
        to: interaction.owner_service,
        type: "depends_on",
        label: `${interaction.protocol}:${interaction.name}`,
        confidence: interaction.confidence || "medium",
        evidence: interaction.evidence || [interaction.name],
      });
    }
  }
  return {
    schemaVersion: REGISTRY_VERSION,
    generatedBy: "taphelu",
    generatedAt: new Date().toISOString(),
    services,
    contracts: contracts.sort((a, b) => a.id.localeCompare(b.id)),
    interactions,
    edges: edges.sort((a, b) => `${a.from}:${a.to}:${a.type}`.localeCompare(`${b.from}:${b.to}:${b.type}`)),
  };
}

function writeContractGraph(registryRoot, graph) {
  mkdirSync(join(registryRoot, "graphs"), { recursive: true });
  writeTextFileAtomic(join(registryRoot, "graphs", "service-graph.json"), `${JSON.stringify(graph, null, 2)}\n`);
  writeTextFileAtomic(join(registryRoot, "graphs", "service-graph.mmd"), renderMermaid(graph));
}

function renderMermaid(graph) {
  const lines = ["flowchart LR"];
  if (!graph.services.length && !graph.contracts.length && !(graph.interactions || []).length) {
    lines.push("  empty[\"No services registered\"]");
    return `${lines.join("\n")}\n`;
  }
  for (const service of graph.services) lines.push(`  ${mermaidId(service.id)}["${mermaidLabel(service.name || service.id)}"]`);
  for (const contract of graph.contracts) lines.push(`  ${mermaidId(contract.id)}["${mermaidLabel(`${contract.protocol}\\n${contract.path}`)}"]`);
  for (const interaction of graph.interactions || []) lines.push(`  ${mermaidId(`interaction:${interaction.id}`)}["${mermaidLabel(`${interaction.protocol}\\n${interaction.name}`)}"]`);
  for (const edge of graph.edges) lines.push(`  ${mermaidId(edge.from)} -->|"${mermaidLabel(edge.label)}"| ${mermaidId(edge.to)}`);
  return `${lines.join("\n")}\n`;
}

function validateRegistry(registryRoot, registry, options = {}) {
  const findings = [];
  if (registry.schemaVersion !== REGISTRY_VERSION) findings.push(finding("WARN", `Unexpected registry schemaVersion: ${registry.schemaVersion}`));
  const seen = new Set();
  const serviceIds = new Set((registry.services || []).map((service) => service.id).filter(Boolean));
  for (const service of registry.services || []) {
    if (!service.id) findings.push(finding("FAIL", "Service missing id."));
    if (seen.has(service.id)) findings.push(finding("FAIL", `Duplicate service id: ${service.id}`));
    seen.add(service.id);
    if (!existsSync(join(registryRoot, "services", `${service.id}.yaml`))) findings.push(finding("WARN", `Service metadata YAML missing: services/${service.id}.yaml`));
    for (const contract of service.contracts || []) {
      if (!contract.protocol || !contract.path) findings.push(finding("FAIL", `Service ${service.id} has malformed contract entry.`));
      if (contract.path && contract.path !== contract.source_path && !existsSync(join(registryRoot, contract.path))) {
        findings.push(finding("FAIL", `Missing contract file: ${contract.path}`));
      }
    }
    for (const dep of service.depends_on || []) {
      if (!serviceIds.has(serviceId(dep))) findings.push(finding(options.strict ? "FAIL" : "WARN", `Service ${service.id} depends_on unknown service: ${dep}`));
    }
  }
  const interactionIds = new Set();
  const providers = providerIndex(registry);
  for (const interaction of registry.interactions || []) {
    if (!interaction.id) findings.push(finding("FAIL", "Interaction missing id."));
    if (interactionIds.has(interaction.id)) findings.push(finding("FAIL", `Duplicate interaction id: ${interaction.id}`));
    interactionIds.add(interaction.id);
    if (!interaction.owner_service || !serviceIds.has(interaction.owner_service)) findings.push(finding("FAIL", `Interaction ${interaction.id || "unknown"} has unknown owner_service: ${interaction.owner_service || "missing"}`));
    if (!interaction.name || !interaction.protocol || !interaction.direction) findings.push(finding("FAIL", `Interaction ${interaction.id || "unknown"} is missing name, protocol, or direction.`));
    if (interaction.direction === "consumes") {
      const provider = interaction.provider_service || providers.get(interactionKey(interaction));
      if (!provider || !serviceIds.has(serviceId(provider))) {
        findings.push(finding(options.strict ? "FAIL" : "WARN", `Interaction ${interaction.id} consumes ${interaction.protocol}:${interaction.name} with unknown provider.`));
      }
    }
    for (const consumer of interaction.consumer_services || []) {
      if (!serviceIds.has(serviceId(consumer))) findings.push(finding(options.strict ? "FAIL" : "WARN", `Interaction ${interaction.id} references unknown consumer service: ${consumer}`));
    }
  }
  return findings;
}

function currentServiceIfPresent(root, registry) {
  const remote = gitRemote(root);
  const rootName = serviceId(basename(root));
  return registry.services.find((service) => (remote && service.repo === remote) || service.id === rootName);
}

function resolveCurrentService(root, registry, requestedService, scanPath = ".") {
  if (requestedService) {
    const id = serviceId(requestedService);
    return registry.services.find((service) => service.id === id || service.name === requestedService) || null;
  }
  const current = currentServiceIfPresent(root, registry);
  if (current) return current;
  try {
    const topology = analyzeServiceTopology(root, { path: scanPath, mode: "quick", focus: "all" });
    const scanned = serviceMetadataFromTopology(root, topology, registry);
    return registry.services.find((service) => service.id === scanned.id) || null;
  } catch {
    return null;
  }
}

function dependencySlice(registry, serviceIdValue, direction) {
  const id = serviceId(serviceIdValue);
  const graph = buildContractGraph(registry);
  const provides = (registry.interactions || []).filter((interaction) => interaction.owner_service === id && interaction.direction === "provides");
  const consumes = (registry.interactions || []).filter((interaction) => interaction.owner_service === id && interaction.direction === "consumes");
  const outbound = [];
  const inbound = [];
  const unresolved = [];
  const serviceMap = new Map((registry.services || []).map((service) => [service.id, service]));
  for (const edge of graph.edges || []) {
    if (edge.type !== "depends_on") continue;
    if (edge.from === id) {
      const target = serviceMap.get(edge.to);
      outbound.push({ service: edge.to, name: target?.name || edge.to, via: edge.label, confidence: edge.confidence, evidence: edge.evidence || [] });
    }
    if (edge.to === id) {
      const source = serviceMap.get(edge.from);
      inbound.push({ service: edge.from, name: source?.name || edge.from, via: edge.label, confidence: edge.confidence, evidence: edge.evidence || [] });
    }
  }
  for (const interaction of consumes) {
    const provider = interaction.provider_service || providerIndex(registry).get(interactionKey(interaction));
    if (!provider) unresolved.push(interaction);
  }
  return {
    serviceId: id,
    direction,
    outbound: direction === "inbound" ? [] : dedupeDependencyRows(outbound),
    inbound: direction === "outbound" ? [] : dedupeDependencyRows(inbound),
    provides,
    consumes,
    unresolved,
  };
}

function emptyDependencySlice(serviceIdValue, direction) {
  return {
    serviceId: serviceIdValue,
    direction,
    outbound: [],
    inbound: [],
    provides: [],
    consumes: [],
    unresolved: [],
  };
}

function dedupeDependencyRows(rows) {
  const map = new Map();
  for (const row of rows) map.set(`${row.service}:${row.via}`, row);
  return [...map.values()].sort((a, b) => a.service.localeCompare(b.service));
}

function normalizeDirection(value) {
  const direction = String(value || "all").trim().toLowerCase();
  if (["outbound", "inbound", "all"].includes(direction)) return direction;
  fail(`Invalid direction: ${value}. Expected outbound, inbound, or all.`);
}

function inspectGit(path) {
  if (!existsSync(path)) return { kind: "missing", root: "" };
  const result = spawnSync("git", ["rev-parse", "--show-toplevel"], { cwd: path, encoding: "utf8" });
  if (result.status !== 0) return { kind: "directory", root: "" };
  return { kind: "git", root: result.stdout.trim() };
}

function gitRemote(root) {
  const result = spawnSync("git", ["config", "--get", "remote.origin.url"], { cwd: root, encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : "";
}

function gitStatus(path) {
  const result = spawnSync("git", ["status", "--short"], { cwd: path, encoding: "utf8" });
  return {
    ok: result.status === 0,
    output: result.stdout.trim(),
    changed: Boolean(result.stdout.trim()),
  };
}

function gitBranch(path) {
  const result = spawnSync("git", ["symbolic-ref", "--short", "HEAD"], { cwd: path, encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : "";
}

function runGit(path, args) {
  const result = spawnSync("git", args, { cwd: path, encoding: "utf8" });
  if (result.status !== 0) fail(`git ${args.join(" ")} failed: ${(result.stderr || result.stdout || "").trim()}`);
}

function appendContractsEvent(registryRoot, type, summary, data) {
  mkdirSync(registryRoot, { recursive: true });
  writeFileSync(join(registryRoot, "events.jsonl"), `${JSON.stringify({
    ts: new Date().toISOString(),
    type,
    summary,
    data,
  })}\n`, { flag: "a" });
}

function serviceId(value) {
  return safeId(String(value || "service").replace(/^@/, "").replace("/", "-"));
}

function safeId(value) {
  const id = String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9._/-]+/g, "-")
    .replace(/[/_]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return id || "service";
}

function safePathPart(value) {
  return String(value || "file").replace(/[^a-zA-Z0-9._-]+/g, "-");
}

function normalizeProtocol(value) {
  const protocol = String(value || "").trim().toLowerCase();
  if (protocol.includes("protobuf") || protocol.includes("grpc")) return "protobuf/grpc";
  if (protocol.includes("openapi") || protocol.includes("swagger")) return "openapi";
  if (protocol.includes("asyncapi")) return "asyncapi";
  if (protocol.includes("graphql")) return "graphql";
  if (protocol.includes("schema")) return "json-schema";
  if (protocol.includes("rest")) return "rest";
  return protocol || "unknown";
}

function runtimeLanguage(stack) {
  const joined = stack.join(" ").toLowerCase();
  if (joined.includes("go")) return "go";
  if (joined.includes("python")) return "python";
  if (joined.includes("rust")) return "rust";
  if (joined.includes("node") || joined.includes("typescript") || joined.includes("javascript")) return "node";
  return "unknown";
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function validateRemote(value) {
  const remote = cleanText(value);
  if (!remote) return "";
  if (remote.startsWith("-")) fail("Remote URL must not start with '-'.");
  if (/[\0\r\n]/u.test(remote)) fail("Remote URL contains invalid control characters.");
  if (!/^(git@|ssh:\/\/|https?:\/\/|file:\/\/|\/|\.{1,2}\/|[A-Za-z0-9._-]+\/)/u.test(remote)) {
    fail("Remote URL must be a git SSH/HTTP/file URL or a local path.");
  }
  return remote;
}

function yamlScalar(value) {
  if (value === "" || value === undefined || value === null) return '""';
  const text = String(value);
  if (/^[a-zA-Z0-9._/@:-]+$/u.test(text)) return text;
  return JSON.stringify(text);
}

function finding(level, message) {
  return { level, message };
}

function formatList(items, fallback = "None.") {
  return items.length ? items.map((item) => `- ${item}`).join("\n") : `- ${fallback}`;
}

function formatContractRows(contracts) {
  if (!contracts.length) return "| Protocol | Path | Source | Confidence |\n|---|---|---|---|\n| None | - | - | - |";
  return `| Protocol | Path | Source | Confidence |
|---|---|---|---|
${contracts.map((contract) => `| ${contract.protocol} | \`${contract.path}\` | \`${contract.source_path || contract.path}\` | \`${contract.confidence}\` |`).join("\n")}`;
}

function formatServiceRows(services) {
  if (!services.length) return "| Service | Repo | Runtime |\n|---|---|---|\n| None | - | - |";
  return `| Service | Repo | Runtime |
|---|---|---|
${services.map((service) => `| \`${service.id}\` | ${service.repo || "-"} | ${service.runtime?.language || "unknown"} |`).join("\n")}`;
}

function formatEdgeRows(edges) {
  if (!edges.length) return "| From | To | Type | Confidence |\n|---|---|---|---|\n| None | - | - | - |";
  return `| From | To | Type | Confidence |
|---|---|---|---|
${edges.map((edge) => `| \`${edge.from}\` | \`${edge.to}\` | ${edge.type} | \`${edge.confidence}\` |`).join("\n")}`;
}

function formatInteractionRows(interactions) {
  if (!interactions.length) return "| Direction | Kind | Protocol | Name | Provider | Confidence |\n|---|---|---|---|---|---|\n| None | - | - | - | - | - |";
  return `| Direction | Kind | Protocol | Name | Provider | Confidence |
|---|---|---|---|---|---|
${interactions.map((interaction) => `| ${interaction.direction} | ${interaction.kind} | ${interaction.protocol} | \`${interaction.name}\` | ${interaction.provider_service ? `\`${interaction.provider_service}\`` : "-"} | \`${interaction.confidence}\`${interaction.inferred ? " inferred" : ""} |`).join("\n")}`;
}

function formatDependencyRows(rows) {
  if (!rows.length) return "| Service | Via | Confidence |\n|---|---|---|\n| None | - | - |";
  return `| Service | Via | Confidence |
|---|---|---|
${rows.map((row) => `| \`${row.service}\` | ${row.via || "-"} | \`${row.confidence || "medium"}\` |`).join("\n")}`;
}

function mermaidId(value) {
  return `n_${safeId(value).replaceAll("-", "_").replaceAll(".", "_")}`;
}

function mermaidLabel(value) {
  return String(value || "").replaceAll("\\", "\\\\").replaceAll("\"", "'");
}
