import { EVENT_TYPES } from "../constants.mjs";
import { parseArgs, parseMode } from "../args.mjs";
import { appendEvent, timestampForId } from "../events.mjs";
import { hasAny } from "../utils.mjs";
import { fail } from "../errors.mjs";

export function runAsk(root, rawArgs) {
  const { options, values } = parseArgs(rawArgs);
  const goal = values.join(" ").trim();

  if (!goal) {
    fail("Missing goal. Usage: dl ask [--mode quick|standard|deep] <goal>");
  }

  const mode = parseMode(options.mode ?? "standard");
  const approvalScope = options["approval-scope"] ?? "";
  const contextPaths = options.context ?? [];
  const analysis = analyzeGoal(goal, mode, approvalScope);
  const packet = buildRequirementPacket(goal, analysis, approvalScope, contextPaths);

  console.log(packet);

  if (options.write) {
    const runId = `run-${timestampForId()}-ask`;
    appendEvent(root, {
      ts: new Date().toISOString(),
      type: EVENT_TYPES.GOAL_RECEIVED,
      run_id: runId,
      summary: "Requirement gathering goal received.",
      data: { goal, mode, context_paths: contextPaths },
    });
    appendEvent(root, {
      ts: new Date().toISOString(),
      type: EVENT_TYPES.REQUIREMENT_PACKET_CREATED,
      run_id: runId,
      summary: "Requirement packet created by dl ask.",
      data: {
        ambiguity: analysis.ambiguity,
        next_route: analysis.nextRoute,
        question_count: analysis.questions.length,
      },
    });
  }
}

export function analyzeGoal(goal, mode, approvalScope) {
  const text = goal.toLowerCase();
  const questionBudget = { quick: 1, standard: 3, deep: 7 }[mode];
  const questions = [];
  const assumptions = [];
  let ambiguity = "low";
  let nextRoute = "plan";

  const approval = approvalScope.toLowerCase();
  const mentionsBrowser = hasAny(text, ["browser", "login", "scrape", "crawl", "e2e"]) ||
    (hasAny(text, ["website", "web page", "page"]) && hasAny(text, ["automate", "automation", "test", "research", "verify", "browse"]));
  const mentionsSecret = hasAny(text, ["secret", "credential", "token", "key"]);
  const browserApproved = approval && hasAny(approval, ["browser", "website", "domain", "docs", "page", "research"]);
  const secretApproved = approval && hasAny(approval, ["secret", "credential", "token", "key"]);
  const needsPermission = (mentionsBrowser && !browserApproved) || (mentionsSecret && !secretApproved);
  const broadAutomation = hasAny(text, ["automate", "automation"]) && !hasAny(text, ["test", "e2e", "research"]);
  const externalResearch = hasAny(text, ["research", "nghiên cứu", "latest", "current", "api", "library", "docs"]);
  const broadVerb = hasAny(text, ["improve", "make", "build", "integrate", "tích hợp", "smart", "smarter"]);
  const specificArtifact = hasAny(text, ["create", "write", "add", "update", "tạo"]) &&
    hasAny(text, [".md", ".jsonl", "state", "memory", "roadmap", "contract", "schema"]);

  if (needsPermission || broadAutomation) {
    ambiguity = "high";
    nextRoute = "blocked";
  } else if (broadVerb && !specificArtifact) {
    ambiguity = "medium";
  }

  if (externalResearch && nextRoute !== "blocked") {
    nextRoute = "research";
  }

  if (specificArtifact && ambiguity === "low") {
    assumptions.push("The requested artifact names and storage location are part of the goal.");
    assumptions.push("No browser or external research is required unless explicitly requested.");
  }

  if (ambiguity !== "low") {
    questions.push("What exact outcome should this produce?");
  }
  if (needsPermission) {
    questions.push("What permission scope is granted for browser, secret, or credential use in this session?");
  }
  if (broadVerb) {
    questions.push("What must be true for this to count as done?");
  }
  if (nextRoute === "research") {
    assumptions.push("Research findings should distinguish facts from inference.");
  }

  return {
    ambiguity,
    nextRoute,
    questions: questions.slice(0, questionBudget),
    assumptions,
    mode,
  };
}

function buildRequirementPacket(goal, analysis, approvalScope, contextPaths) {
  const openQuestions = analysis.questions.length
    ? analysis.questions.map((q) => `- ${q}`).join("\n")
    : "- None.";
  const defaultAssumption = analysis.ambiguity === "high"
    ? "- No safe assumptions; blocked pending answers."
    : "- Goal is clear enough to continue with current project defaults.";
  const assumptions = analysis.assumptions.length
    ? analysis.assumptions.map((a) => `- ${a}`).join("\n")
    : defaultAssumption;
  const approval = approvalScope
    ? `- Granted for this session: ${approvalScope}`
    : "- No extra permission granted.";
  const context = contextPaths.length
    ? contextPaths.map((path) => `- ${path}`).join("\n")
    : "- Loaded from the current .projects context.";

  return `# Requirement Packet

## Goal

${goal}

## Background

${context}

## Users

- Maintainer and small-team users working with long-running AI-agent workflows.

## Must-Haves

- Produce an output that can feed the next workflow step.
- Keep state resumable through .projects.
- Preserve concise, inspectable artifacts.

## Nice-to-Haves

- Keep the result easy to wrap from future command runtimes.

## Non-Goals

- Do not introduce broad runtime or platform coupling unless explicitly required.
- Do not store raw logs, raw browser content, PII, or secrets.

## Constraints

- Ambiguity level: ${analysis.ambiguity}.
- Mode: ${analysis.mode}.

## Approval Boundaries

${approval}

## Assumptions

${assumptions}

## Open Questions

${openQuestions}

## Verification Expectations

- Requirement packet has a clear next route.
- Open questions are limited to items that affect planning, safety, or acceptance.
- Assumptions are explicit.

## State/Memory Update Recommendations

STATE.md:

- Current goal: ${goal}
- Pending questions: ${analysis.questions.length}
- Active assumptions: ${analysis.assumptions.length || (analysis.ambiguity === "high" ? 0 : 1)}
- Next route: ${analysis.nextRoute}

MEMORY.md:

- Add nothing by default unless the goal or answer introduces a stable user preference, project decision, workflow rule, or integration constraint.

events.jsonl:

- Append \`goal_received\`.
- Append \`requirement_packet_created\` if a packet is accepted or written.

## Next Route

\`${analysis.nextRoute}\`
`;
}
