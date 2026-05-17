import { EVENT_TYPES } from "../constants.mjs";
import { parseArgs, parseConfidence } from "../args.mjs";
import { appendEvent, timestampForId } from "../events.mjs";
import { hasAny, formatList } from "../utils.mjs";
import { fail } from "../errors.mjs";

export function runResearch(root, rawArgs) {
  const { options, values } = parseArgs(rawArgs);
  const question = values.join(" ").trim();

  if (!question) {
    fail("Missing question. Usage: dl research [--source text] [--finding text] <question>");
  }

  const confidence = parseConfidence(options.confidence ?? "low");
  const research = analyzeResearch(question, {
    sources: options.source ?? [],
    findings: options.finding ?? [],
    inferences: options.inference ?? [],
    risks: options.risk ?? [],
    followUps: options["follow-up"] ?? [],
    impact: options.impact ?? "",
    approvalScope: options["approval-scope"] ?? "",
    confidence,
  });
  const packet = buildResearchPacket(question, research);

  console.log(packet);

  if (options.write) {
    const runId = `run-${timestampForId()}-research`;
    appendEvent(root, {
      ts: new Date().toISOString(),
      type: EVENT_TYPES.RESEARCH_RECORDED,
      run_id: runId,
      summary: "Research packet created by dl research.",
      data: {
        question,
        source_count: research.sources.length,
        finding_count: research.findings.length,
        confidence: research.confidence,
        next_route: research.nextRoute,
      },
    });
  }
}

export function analyzeResearch(question, input) {
  const text = question.toLowerCase();
  const approval = input.approvalScope.toLowerCase();
  const browserMentioned = hasAny(text, ["browser", "website", "web page", "login"]);
  const browserApproved = approval && hasAny(approval, ["browser", "website", "domain", "docs", "page", "research"]);
  const sources = input.sources;
  const findings = input.findings;
  const risks = [...input.risks];
  const followUps = [...input.followUps];
  let nextRoute = "plan";

  if (!sources.length) {
    risks.push("No source was recorded.");
  }
  if (!findings.length) {
    followUps.push("Add at least one source-grounded finding.");
  }
  if (browserMentioned && !browserApproved) {
    risks.push("Browser research appears relevant but no browser permission was granted.");
    followUps.push("Get task or session permission before browser research.");
  }
  if (!sources.length || !findings.length || (browserMentioned && !browserApproved)) {
    nextRoute = "blocked";
  }

  return {
    sources,
    findings,
    inferences: input.inferences,
    risks,
    followUps,
    impact: input.impact || "No planning impact recorded yet.",
    approvalScope: input.approvalScope,
    confidence: input.confidence,
    nextRoute,
  };
}

function buildResearchPacket(question, research) {
  return `# Research Packet

## Question

${question}

## Why It Matters

- This research should reduce uncertainty before planning.

## Sources Checked

${formatList(research.sources, "No sources recorded.")}

## Findings

${formatList(research.findings, "No findings recorded.")}

## Inferences

${formatList(research.inferences, "No inferences recorded.")}

## Risks

${formatList(research.risks, "No risks recorded.")}

## Confidence

\`${research.confidence}\`

## Planning Impact

${research.impact}

## Browser Permission

${research.approvalScope ? `- Granted for this session: ${research.approvalScope}` : "- No browser or external automation permission granted."}

## Follow-Up Needed

${formatList(research.followUps, "None.")}

## State/Memory Update Recommendations

STATE.md:

- Current goal: ${question}
- Blockers: ${research.nextRoute === "blocked" ? "research incomplete or permission missing" : "none"}
- Next route: ${research.nextRoute}

MEMORY.md:

- Add durable findings only if they are stable project facts, integration constraints, or workflow decisions.

events.jsonl:

- Append \`research_recorded\` if this packet is accepted or written.

## Next Route

\`${research.nextRoute}\`
`;
}
