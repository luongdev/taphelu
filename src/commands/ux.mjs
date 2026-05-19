import { fail } from "../errors.mjs";
import { buildUxPacket } from "../task-store.mjs";

export function runUx(root, rawArgs) {
  const [subcommand, taskId] = rawArgs;
  if (subcommand !== "verify" || !taskId) {
    fail("Usage: dl ux verify M32-S01-T01");
  }
  console.log(buildUxPacket(root, taskId));
}
