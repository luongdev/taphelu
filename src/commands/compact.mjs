import { parseArgs } from "../args.mjs";
import { fail } from "../errors.mjs";
import {
  analyzeMilestoneCompaction,
  analyzePlanCompaction,
  analyzeRunsCompaction,
  applyMilestoneCompaction,
  applyPlanCompaction,
  applyRunsCompaction,
  buildCompactionReport,
} from "../context-store.mjs";

export function runCompact(root, rawArgs) {
  const [subcommand, ...rest] = rawArgs;
  if (subcommand === "milestone") return runMilestoneCompact(root, rest);
  if (subcommand === "runs") return runRunsCompact(root, rest);
  if (subcommand === "plan") return runPlanCompact(root, rest);
  fail("Missing compact subcommand. Usage: dl compact milestone|runs|plan ...");
}

function runMilestoneCompact(root, rawArgs) {
  const { options, values } = parseArgs(rawArgs);
  if (values.length) fail("Unexpected positional value for dl compact milestone. Use --id.");
  const report = analyzeMilestoneCompaction(root, { id: options.id });
  const didWrite = Boolean(options.write && !options["dry-run"]);
  if (didWrite) applyMilestoneCompaction(root, report);
  console.log(buildCompactionReport(report, didWrite));
}

function runRunsCompact(root, rawArgs) {
  const { options, values } = parseArgs(rawArgs);
  if (values.length) fail("Unexpected positional value for dl compact runs. Use --keep.");
  const report = analyzeRunsCompaction(root, { keep: options.keep });
  const didWrite = Boolean(options.write && !options["dry-run"]);
  if (didWrite) applyRunsCompaction(root, report);
  console.log(buildCompactionReport(report, didWrite));
}

function runPlanCompact(root, rawArgs) {
  const { options, values } = parseArgs(rawArgs);
  if (values.length) fail("Unexpected positional value for dl compact plan. Use flags.");
  const report = analyzePlanCompaction(root);
  const didWrite = Boolean(options.write && !options["dry-run"]);
  if (didWrite) applyPlanCompaction(root, report);
  console.log(buildCompactionReport(report, didWrite));
}
