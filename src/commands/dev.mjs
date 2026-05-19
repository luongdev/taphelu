import { fail } from "../errors.mjs";
import { buildDevPacket } from "../task-store.mjs";

export function runDev(root, rawArgs) {
  const [subcommand, taskId] = rawArgs;
  if (subcommand !== "implement" || !taskId) {
    fail("Usage: dl dev implement M32-S01-T01");
  }
  console.log(buildDevPacket(root, taskId));
}
