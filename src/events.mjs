import { randomBytes } from "node:crypto";
import { fail } from "./errors.mjs";
import { appendProjectFile } from "./project.mjs";
import { unsafeMemory } from "./utils.mjs";

export function appendEvent(root, event) {
  assertSafeEvent(event);
  appendProjectFile(root, "events.jsonl", `${JSON.stringify(event)}\n`);
}

export function timestampForId() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return [
    now.getUTCFullYear(),
    pad(now.getUTCMonth() + 1),
    pad(now.getUTCDate()),
    "-",
    pad(now.getUTCHours()),
    pad(now.getUTCMinutes()),
    pad(now.getUTCSeconds()),
    "-",
    String(now.getUTCMilliseconds()).padStart(3, "0"),
    "-",
    randomBytes(2).toString("hex"),
  ].join("");
}

function assertSafeEvent(event) {
  const unsafePath = findUnsafeString(event);
  if (unsafePath) {
    fail(`Refusing to write event because ${unsafePath} appears to contain secrets, PII, raw logs, or raw browser content.`);
  }
}

function findUnsafeString(value, path = "event") {
  if (typeof value === "string") {
    return unsafeMemory(value) ? path : "";
  }
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const nested = findUnsafeString(value[index], `${path}[${index}]`);
      if (nested) return nested;
    }
    return "";
  }
  if (value && typeof value === "object") {
    for (const [key, nestedValue] of Object.entries(value)) {
      const nested = findUnsafeString(nestedValue, `${path}.${key}`);
      if (nested) return nested;
    }
  }
  return "";
}
