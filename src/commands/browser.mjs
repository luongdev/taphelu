import { EVENT_TYPES } from "../constants.mjs";
import { parseArgs, parseBrowserResult } from "../args.mjs";
import { appendEvent, timestampForId } from "../events.mjs";
import { formatList, unsafeBrowserArtifact } from "../utils.mjs";
import { fail } from "../errors.mjs";

export function runBrowser(root, rawArgs) {
  const [subcommand, ...rest] = rawArgs;
  if (!subcommand) {
    fail("Missing browser subcommand. Usage: dl browser research|verify ...");
  }

  if (subcommand === "research") {
    runBrowserResearch(root, rest);
    return;
  }

  if (subcommand === "verify") {
    runBrowserVerify(root, rest);
    return;
  }

  fail(`Unknown browser subcommand: ${subcommand}`);
}

function runBrowserResearch(root, rawArgs) {
  const { options, values } = parseArgs(rawArgs);
  const question = values.join(" ").trim() || options.purpose || "Browser research observation.";
  const report = analyzeBrowserResearch(question, {
    approvalScope: options["approval-scope"] ?? "",
    scope: options.scope ?? "",
    url: options.url ?? "",
    purpose: options.purpose ?? "",
    actions: options.action ?? [],
    observation: options.observation ?? "",
    evidence: options.evidence ?? "",
    impact: options.impact ?? "",
    followUps: options["follow-up"] ?? [],
  });

  console.log(buildBrowserResearchPacket(report, options.write));

  if (options.write && report.nextRoute !== "blocked") {
    appendEvent(root, {
      ts: new Date().toISOString(),
      type: EVENT_TYPES.BROWSER_RESEARCH_RECORDED,
      run_id: `run-${timestampForId()}-browser`,
      summary: "Browser research observation recorded.",
      data: {
        question: report.question,
        url: report.url,
        action_count: report.actions.length,
        evidence_path: report.evidence || "",
        next_route: report.nextRoute,
      },
    });
  }
}

function runBrowserVerify(root, rawArgs) {
  const { options, values } = parseArgs(rawArgs);
  const flow = values.join(" ").trim();
  if (!flow) {
    fail("Missing flow. Usage: dl browser verify [options] <flow>");
  }

  const report = analyzeBrowserVerification(flow, {
    approvalScope: options["approval-scope"] ?? "",
    scope: options.scope ?? "",
    url: options.url ?? "",
    preconditions: options.precondition ?? [],
    steps: options.step ?? [],
    expected: options.expected ?? "",
    actual: options.actual ?? "",
    result: options.result ?? "",
    evidence: options.evidence ?? "",
    blockers: options.blocker ?? [],
  });

  console.log(buildBrowserVerificationPacket(report, options.write));

  if (options.write && report.nextRoute !== "blocked") {
    appendEvent(root, {
      ts: new Date().toISOString(),
      type: EVENT_TYPES.BROWSER_VERIFICATION_RECORDED,
      run_id: `run-${timestampForId()}-browser`,
      summary: "Browser E2E verification report recorded.",
      data: {
        flow: report.flow,
        url: report.url,
        result: report.result,
        evidence_path: report.evidence || "",
        next_route: report.nextRoute,
      },
    });
  }
}

function analyzeBrowserResearch(question, input) {
  const risks = [];
  const followUps = [...input.followUps];
  let nextRoute = "plan";

  if (!input.approvalScope) {
    risks.push("Browser research requires explicit task or session permission.");
  }
  if (!input.url) {
    risks.push("Browser research requires a URL or local target.");
  }
  if (!input.observation) {
    followUps.push("Add a summarized observation; do not store raw page content.");
  }
  if (unsafeBrowserArtifact(input.observation) || unsafeBrowserArtifact(input.evidence)) {
    risks.push("Observation or evidence appears to contain raw browser content, raw logs, PII, or secrets.");
  }
  if (risks.length || !input.observation) {
    nextRoute = "blocked";
  }

  return {
    question,
    approvalScope: input.approvalScope,
    scope: input.scope || input.approvalScope,
    url: input.url,
    purpose: input.purpose || question,
    actions: input.actions,
    observation: input.observation,
    evidence: input.evidence,
    impact: input.impact || "Use summarized browser observation as research evidence.",
    followUps,
    risks,
    nextRoute,
  };
}

function buildBrowserResearchPacket(report, willWrite) {
  return `# Browser Research Packet

## Question

${report.question}

## Permission Scope

${report.approvalScope ? `- ${report.approvalScope}` : "- Missing explicit browser permission."}

## Target

- URL: ${report.url || "Not recorded."}
- Scope: ${report.scope || "Not recorded."}

## Purpose

${report.purpose}

## Actions Taken

${formatList(report.actions, "No actions recorded.")}

## Observation

${report.observation || "- No observation recorded."}

## Evidence Path

${report.evidence || "- No evidence path recorded."}

## Planning Impact

${report.impact}

## Risks

${formatList(report.risks, "None.")}

## Follow-Up

${formatList(report.followUps, "None.")}

## Write Behavior

${willWrite ? report.nextRoute === "blocked" ? "- This invocation will not write because the report is blocked." : "- This invocation will append a browser_research_recorded event." : "- Add `--write` to persist this browser research event."}

## Next Route

\`${report.nextRoute}\`
`;
}

function analyzeBrowserVerification(flow, input) {
  const blockers = [...input.blockers];
  const risks = [];

  if (!input.approvalScope) {
    blockers.push("Browser verification requires explicit task or session permission.");
  }
  if (!input.url) {
    blockers.push("Browser verification requires a URL or local target.");
  }
  if (!input.steps.length) {
    blockers.push("Browser verification requires at least one user-visible step.");
  }
  if (!input.expected || !input.actual) {
    blockers.push("Browser verification requires expected and actual behavior.");
  }
  const result = input.result ? parseBrowserResult(input.result) : "blocked";
  if (!input.result) {
    blockers.push("Browser verification requires --result pass|fail|blocked.");
  }
  if (unsafeBrowserArtifact(input.actual) || unsafeBrowserArtifact(input.evidence)) {
    blockers.push("Actual behavior or evidence appears to contain raw browser content, raw logs, PII, or secrets.");
  }
  if (result === "fail") {
    risks.push("Failed browser verification blocks done.");
  }

  const nextRoute = blockers.length || result !== "pass" ? "blocked" : "done";

  return {
    flow,
    approvalScope: input.approvalScope,
    scope: input.scope || input.approvalScope,
    url: input.url,
    preconditions: input.preconditions,
    steps: input.steps,
    expected: input.expected,
    actual: input.actual,
    result,
    evidence: input.evidence,
    blockers,
    risks,
    nextRoute,
  };
}

function buildBrowserVerificationPacket(report, willWrite) {
  return `# Browser Verification Report

## Flow

${report.flow}

## Permission Scope

${report.approvalScope ? `- ${report.approvalScope}` : "- Missing explicit browser permission."}

## Target

- URL: ${report.url || "Not recorded."}
- Scope: ${report.scope || "Not recorded."}

## Preconditions

${formatList(report.preconditions, "No preconditions recorded.")}

## Steps

${formatList(report.steps, "No steps recorded.")}

## Expected Behavior

${report.expected || "- Not recorded."}

## Actual Behavior

${report.actual || "- Not recorded."}

## Result

\`${report.result}\`

## Evidence Path

${report.evidence || "- No evidence path recorded."}

## Blocking Issues

${formatList(report.blockers, "None.")}

## Risks

${formatList(report.risks, "None.")}

## Write Behavior

${willWrite ? report.nextRoute === "blocked" ? "- This invocation will not write because verification is blocked." : "- This invocation will append a browser_verification_recorded event." : "- Add `--write` to persist this browser verification event."}

## Next Route

\`${report.nextRoute}\`
`;
}
