import { parseArgs } from "../args.mjs";
import { fail } from "../errors.mjs";
import { inspectInstall } from "../pack/adapter.mjs";
import { escapeTable } from "../utils.mjs";

export function runRuntime(root, rawArgs) {
  const [subcommand, ...rest] = rawArgs;
  if (subcommand !== "status") {
    fail("Usage: dl runtime status --runtime claude|kiro|codex|gemini|all --scope local|global [--config-dir path] [--live]");
  }
  const { options, values } = parseArgs(rest);
  if (values.length) fail("Unexpected positional value for dl runtime status.");

  const report = inspectInstall(root, {
    runtime: options.runtime || "all",
    scope: options.scope || "local",
    configDir: options["config-dir"] || "",
    profile: options.profile || "full-auto",
    hooks: options.hooks,
    statusline: options.statusline,
    live: Boolean(options.live),
  });

  console.log(buildRuntimeStatus(report));
}

function buildRuntimeStatus(report) {
  const rows = report.checks.length
    ? report.checks.map((check) => `| ${check.status} | ${escapeTable(check.path)} | ${escapeTable(check.message)} |`).join("\n")
    : "| FAIL | No checks | No generated files expected. |";

  return `# Taphelu Runtime Status

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
`;
}
