import { parseArgs } from "../args.mjs";
import { fail } from "../errors.mjs";
import { inspectInstall } from "../pack/adapter.mjs";
import { escapeTable, formatList } from "../utils.mjs";
import { inspectInstructionHygiene } from "../instruction-hygiene.mjs";

export function runDoctor(root, rawArgs) {
  if (rawArgs[0] === "instructions") {
    const { options, values } = parseArgs(rawArgs.slice(1));
    if (values.length || Object.keys(options).length) fail("Usage: dl doctor instructions");
    console.log(buildInstructionDoctorReport(inspectInstructionHygiene(root)));
    return;
  }
  const { options, values } = parseArgs(rawArgs);
  if (values.length) fail("Unexpected positional value for dl doctor. Use --runtime, --scope, --config-dir, --profile, --hooks, --statusline, or --live.");

  const report = inspectInstall(root, {
    runtime: options.runtime || "all",
    scope: options.scope || "local",
    configDir: options["config-dir"] || "",
    profile: options.profile || "full-auto",
    hooks: options.hooks,
    statusline: options.statusline,
    live: Boolean(options.live),
  });

  console.log(buildDoctorReport(report));
}

function buildDoctorReport(report) {
  const rows = report.checks.length
    ? report.checks.map((check) => `| ${check.status} | ${escapeTable(check.path)} | ${escapeTable(check.message)} |`).join("\n")
    : "| FAIL | No checks | No generated files expected. |";

  return `# Taphelu Doctor

## Status

\`${report.status}\`

## Scope

- Runtimes: ${report.runtimes.join(", ")}
- Scope: ${report.scope}
- Profile: ${report.profile}
- Hooks: ${report.hooks}
- Statusline: ${report.statusline}

## Checks

| Status | Path | Message |
|---|---|---|
${rows}

## Blockers

${formatList(report.blockers, "None.")}

## Warnings

${formatList(report.warnings, "None.")}

## Manual Actions

${formatList(report.manualActions, "None.")}
`;
}

function buildInstructionDoctorReport(report) {
  const rows = report.checks.length
    ? report.checks.map((check) => `| ${check.status} | ${escapeTable(check.path)} | ${check.lines} | ${check.chars} | ${escapeTable(check.reason)} |`).join("\n")
    : "| PASS | No instruction files | 0 | 0 | No instruction files discovered. |";

  return `# Taphelu Instruction Doctor

## Status

\`${report.status}\`

## Budget

- Lines: ${report.budget.max_lines}
- Chars: ${report.budget.max_chars}

## Checks

| Status | Path | Lines | Chars | Message |
|---|---|---:|---:|---|
${rows}
`;
}
