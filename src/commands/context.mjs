import { parseArgs } from "../args.mjs";
import { fail } from "../errors.mjs";
import {
  analyzeContextIndex,
  applyContextIndex,
  buildContextArtifactReport,
  buildContextIndexReport,
  buildContextSearchReport,
  getContextArtifact,
  searchContextArtifacts,
} from "../context-store.mjs";

export function runContext(root, rawArgs) {
  const [subcommand, ...rest] = rawArgs;
  if (subcommand === "index") return runContextIndex(root, rest);
  if (subcommand === "search") return runContextSearch(root, rest);
  if (subcommand === "get") return runContextGet(root, rest);
  fail("Missing context subcommand. Usage: dl context index|search|get ...");
}

function runContextIndex(root, rawArgs) {
  const { options, values } = parseArgs(rawArgs);
  if (values.length) fail("Unexpected positional value for dl context index. Use flags.");
  const report = analyzeContextIndex(root);
  const didWrite = Boolean(options.write && !options["dry-run"]);
  if (didWrite) applyContextIndex(root, report);
  console.log(buildContextIndexReport(report, didWrite));
}

function runContextSearch(root, rawArgs) {
  const { values } = parseArgs(rawArgs);
  const query = values.join(" ").trim();
  const report = searchContextArtifacts(root, query);
  console.log(buildContextSearchReport(report));
}

function runContextGet(root, rawArgs) {
  const { options, values } = parseArgs(rawArgs);
  if (values.length !== 1) fail("Usage: dl context get <id> [--full] [--start-line n] [--end-line n]");
  const report = getContextArtifact(root, values[0], {
    full: Boolean(options.full),
    startLine: options["start-line"],
    endLine: options["end-line"],
  });
  console.log(buildContextArtifactReport(report));
}
