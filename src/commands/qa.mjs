import { fail } from "../errors.mjs";
import { buildQaPacket } from "../task-store.mjs";

export function runQa(root, rawArgs) {
  const [subcommand, taskId] = rawArgs;
  if (subcommand !== "review" || !taskId) {
    fail("Usage: dl qa review M32-S01-T01");
  }
  console.log(buildQaPacket(root, taskId));
}
