import { parseArgs } from "../args.mjs";
import { fail } from "../errors.mjs";
import { buildReviewPolicyReport } from "../review-policy.mjs";

export function runReview(root, rawArgs) {
  const [subcommand = "status", ...rest] = rawArgs;
  if (subcommand === "status" || subcommand === "plan") {
    const { options, values } = parseArgs(rest);
    if (values.length) fail(`Unexpected positional value for dl review ${subcommand}. Use flags.`);
    const triggers = [
      ...(options["review-trigger"] ?? []),
      ...(options.risk ?? []).map((risk) => `risk ${risk}`),
      options.files ? `${options.files} files` : "",
      options.commits ? `${options.commits} commits` : "",
    ].filter(Boolean);
    console.log(buildReviewPolicyReport(root, {
      triggers,
      currentRuntime: options.runtime || "codex",
      reviewed: Boolean(options.reviewed),
      evidence: options["review-evidence"] ?? [],
    }));
    return;
  }
  fail("Unknown review subcommand. Usage: dl review status|plan [--runtime codex|claude|gemini] [--review-trigger text] [--files n] [--commits n]");
}
