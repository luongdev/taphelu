import { parseArgs } from "../args.mjs";
import { fail } from "../errors.mjs";
import { inspectInstall } from "../pack/adapter.mjs";
import { escapeTable, formatList } from "../utils.mjs";

export function runDoctor(root, rawArgs) {
  const { options, values } = parseArgs(rawArgs);
  if (values.length) fail("Unexpected positional value for dl doctor. Use --runtime, --scope, or --config-dir.");

  const report = inspectInstall(root, {
    runtime: options.runtime || "all",
    scope: options.scope || "local",
    configDir: options["config-dir"] || "",
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
