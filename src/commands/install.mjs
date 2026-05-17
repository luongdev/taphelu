import { parseArgs } from "../args.mjs";
import { fail } from "../errors.mjs";
import { applyInstallPlan, buildInstallPlan } from "../pack/adapter.mjs";
import { escapeTable, formatList } from "../utils.mjs";

export function runInstall(root, rawArgs) {
  const { options, values } = parseArgs(rawArgs);
  if (values.length) fail("Unexpected positional value for dl install. Use --runtime, --scope, --config-dir, --dry-run, or --write.");

  const plan = buildInstallPlan(root, {
    runtime: options.runtime || "all",
    scope: options.scope || "local",
    configDir: options["config-dir"] || "",
  });
  const willWrite = Boolean(options.write) && !options["dry-run"];

  if (willWrite) {
    try {
      applyInstallPlan(plan);
    } catch (err) {
      fail(err instanceof Error ? err.message : String(err));
    }
  }

  console.log(buildInstallReport(plan, willWrite));
}

function buildInstallReport(plan, didWrite) {
  const files = plan.files.length
    ? plan.files.map((file) => `| ${file.runtime} | ${file.kind} | ${escapeTable(file.path)} |`).join("\n")
    : "| none | none | No files planned. |";

  return `# Taphelu Install Plan

## Mode

${didWrite ? "write" : "dry-run"}

## Pack

- Name: ${plan.pack.name}
- Version: ${plan.pack.version}
- Scope: ${plan.scope}
- Runtimes: ${plan.runtimes.join(", ")}

## Generated Files

| Runtime | Kind | Path |
|---|---|---|
${files}

## Blockers

${formatList(plan.blockers, "None.")}

## Warnings

${formatList(plan.warnings, "None.")}

## Manual Actions

${formatList(plan.manualActions, "None.")}

## Result

${plan.blockers.length ? "`blocked`" : didWrite ? "`installed`" : "`dry_run`"}
`;
}
