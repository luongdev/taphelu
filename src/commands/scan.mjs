import { existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
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

export function runScan(root, rawArgs) {
  const { options, values } = parseArgs(rawArgs);
  if (values.length) fail("Unexpected positional value for dl scan. Use --path, --mode, --dry-run, or --write.");
  const mode = parseMode(options.mode || "standard");
  const report = analyzeProjectScan(root, {
    path: options.path || ".",
    mode,
  });
  if (options.write && !options["dry-run"]) applyProjectScan(root, report);
  console.log(buildProjectScanReport(report, Boolean(options.write && !options["dry-run"])));
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
