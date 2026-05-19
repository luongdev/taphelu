import { parseArgs } from "../args.mjs";
import { fail } from "../errors.mjs";
import {
  analyzeTaskStatus,
  applyTaskStatus,
  buildPlanValidationReport,
  buildTaskListReport,
  buildTaskShowReport,
  buildTaskStatusReport,
  getTaskPacket,
  listTasks,
  validatePlanStore,
} from "../task-store.mjs";

export function runTask(root, rawArgs) {
  const [subcommand, ...rest] = rawArgs;
  if (!subcommand) fail("Missing task subcommand. Usage: dl task list|show|status|validate ...");

  if (subcommand === "list") {
    const { options, values } = parseArgs(rest);
    if (values.length) fail("Unexpected positional value for dl task list.");
    const report = listTasks(root, {
      milestone: options.milestone,
      story: options.story,
      status: options.status,
    });
    console.log(buildTaskListReport(report));
    return;
  }

  if (subcommand === "show") {
    const { options, values } = parseArgs(rest);
    const id = values[0];
    if (!id) fail("Missing task id. Usage: dl task show M32-S01-T01 [--json]");
    const packet = getTaskPacket(root, id);
    console.log(options.json ? `${JSON.stringify(packet, null, 2)}\n` : buildTaskShowReport(packet));
    return;
  }

  if (subcommand === "status") {
    const { options, values } = parseArgs(rest);
    const id = values[0];
    if (!id || !options.set) fail("Usage: dl task status M32-S01-T01 --set in_progress|blocked|review|done|verified");
    const report = analyzeTaskStatus(root, id, options.set);
    if (!report.blockers.length) applyTaskStatus(root, report);
    console.log(buildTaskStatusReport(report, !report.blockers.length));
    return;
  }

  if (subcommand === "validate") {
    const { values } = parseArgs(rest);
    const id = values[0];
    if (!id) fail("Missing task id. Usage: dl task validate M32-S01-T01");
    const report = validatePlanStore(root, { taskId: id });
    console.log(buildPlanValidationReport(report));
    return;
  }

  fail(`Unknown task subcommand: ${subcommand}`);
}
