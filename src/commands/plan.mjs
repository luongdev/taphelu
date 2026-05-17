import { EVENT_TYPES } from "../constants.mjs";
import { parseArgs, parseTestability } from "../args.mjs";
import { appendEvent, timestampForId } from "../events.mjs";
import { hasAny, formatList, escapeTable } from "../utils.mjs";
import { fail } from "../errors.mjs";
import { testingStrictness } from "../project-config.mjs";

export function runPlan(root, rawArgs) {
  const { options, values } = parseArgs(rawArgs);
  const goal = values.join(" ").trim();

  if (!goal) {
    fail("Missing goal. Usage: dl plan [--task text] [--verification text] <goal>");
  }

  const plan = analyzePlan(goal, {
    contexts: options.context ?? [],
    requirements: options.requirement ?? [],
    research: options.research ?? [],
    tasks: options.task ?? [],
    constraints: options.constraint ?? [],
    nonGoals: options["non-goal"] ?? [],
    assumptions: options.assumption ?? [],
    risks: options.risk ?? [],
    approvalGates: options["approval-gate"] ?? [],
    verifications: options.verification ?? [],
    owners: options.owner ?? [],
    boundaries: options.boundary ?? [],
    dependsOn: options["depends-on"] ?? [],
    testabilities: options.testability ?? [],
    requiredEvidence: options["required-evidence"] ?? [],
    testEffortReasons: options["test-effort-reason"] ?? [],
    testingStrictness: testingStrictness(root, options["testing-strictness"] || ""),
  });
  const packet = buildPlanPacket(goal, plan);

  console.log(packet);

  if (options.write) {
    const runId = `run-${timestampForId()}-plan`;
    appendEvent(root, {
      ts: new Date().toISOString(),
      type: EVENT_TYPES.PLAN_CREATED,
      run_id: runId,
      summary: "Plan packet created by dl plan.",
      data: {
        goal,
        task_count: plan.tasks.length,
        testing_strictness: plan.testingStrictness,
        qa_gate: plan.qaGate.status,
        next_route: plan.nextRoute,
      },
    });
  }
}

export function analyzePlan(goal, input) {
  const text = goal.toLowerCase();
  const tasks = input.tasks.length ? input.tasks : [`Complete: ${goal}`];
  const risks = [...input.risks];
  const approvalGates = [...input.approvalGates];
  let nextRoute = "execute";

  const needsApproval = hasAny(text, ["browser", "secret", "credential", "delete", "remove", "destructive"]);
  if (needsApproval && !approvalGates.length) {
    risks.push("Approval-sensitive work has no approval gate.");
    nextRoute = "blocked";
  }

  const plannedTasks = tasks.map((objective, index) => {
    const strictness = input.testingStrictness || "medium";
    const testability = input.testabilities?.[index]
      ? parseTestability(input.testabilities[index])
      : defaultTestability(objective, strictness);
    return {
      id: `T${index + 1}`,
      objective,
      owner: input.owners?.[index] || inferOwner(objective),
      boundary: input.boundaries?.[index] || inferBoundary(objective),
      dependsOn: input.dependsOn?.[index] || "none",
      verification: input.verifications?.[index] ?? defaultTaskVerification(objective),
      testability,
      requiredEvidence: input.requiredEvidence?.[index] || defaultRequiredEvidenceForTestability(testability),
      testEffortReason: input.testEffortReasons?.[index] || defaultTestEffortReason(objective, strictness),
      risk: risks.length ? "medium" : inferRisk(objective),
    };
  });
  const qaGate = analyzeQaGate(plannedTasks, input.testingStrictness || "medium");
  if (qaGate.blockers.length) nextRoute = "blocked";

  return {
    testingStrictness: input.testingStrictness || "medium",
    contexts: input.contexts,
    requirements: input.requirements,
    research: input.research,
    constraints: input.constraints,
    nonGoals: input.nonGoals,
    assumptions: input.assumptions.length ? input.assumptions : ["Plan is based on the supplied goal and current .projects context."],
    risks,
    qaGate,
    approvalGates,
    tasks: plannedTasks,
    verificationPlan: plannedTasks.map((task) => `${task.id}: ${task.verification} [${task.testability}; evidence: ${task.requiredEvidence}]`),
    nextRoute,
  };
}

function buildPlanPacket(goal, plan) {
  return `# Plan Packet

## Goal

${goal}

## Context Loaded

${formatList(plan.contexts, "Current .projects context.")}

## Requirements

${formatList(plan.requirements, "No explicit requirements supplied; derive from goal.")}

## Research Inputs

${formatList(plan.research, "No research inputs supplied.")}

## Constraints

${formatList(plan.constraints, "Use existing project conventions and keep implementation small.")}

## Non-Goals

${formatList(plan.nonGoals, "No additional non-goals supplied.")}

## Assumptions

${formatList(plan.assumptions, "No assumptions recorded.")}

## Risks

${formatList(plan.risks, "No risks recorded.")}

## Testing Strictness

\`${plan.testingStrictness}\`

## Approval Gates

${formatList(plan.approvalGates, "No approval gates recorded.")}

## Tasks

| ID | Owner | Boundary | Depends On | Objective | Verification | Testability | Required Evidence | Risk |
|---|---|---|---|---|---|---|---|---|
${plan.tasks.map((task) => `| ${task.id} | ${task.owner} | ${task.boundary} | ${escapeTable(task.dependsOn)} | ${escapeTable(task.objective)} | ${escapeTable(task.verification)} | ${task.testability} | ${escapeTable(task.requiredEvidence)} | ${task.risk} |`).join("\n")}

## QA Testability Gate

- Status: \`${plan.qaGate.status}\`
- Rule: QA reviews every planned task before dev execution.

${formatList(plan.qaGate.reviews.map((review) => `${review.task_id}: ${review.testability}; ${review.test_effort_reason}`), "No QA reviews recorded.")}

Blockers:

${formatList(plan.qaGate.blockers, "None.")}

## Verification Plan

${formatList(plan.verificationPlan, "No verification plan recorded.")}

## State/Memory Update Recommendations

STATE.md:

- Current goal: ${goal}
- Current phase: planning complete
- Next route: ${plan.nextRoute}

MEMORY.md:

- Add durable planning decisions only if they affect future workflows.

events.jsonl:

- Append \`plan_created\` if this packet is accepted or written.

## Next Route

\`${plan.nextRoute}\`
`;
}

function defaultTaskVerification(objective) {
  return `Confirm "${objective}" is complete and update .projects state.`;
}

function inferOwner(objective) {
  const text = objective.toLowerCase();
  if (hasAny(text, ["verify", "test", "qa", "regression"])) return "taphelu-qa";
  if (hasAny(text, ["ux", "copy", "usability", "user flow", "journey"])) return "taphelu-ux-analyst";
  if (hasAny(text, ["visual", "screenshot", "responsive", "layout", "browser"])) return "taphelu-visual-qa";
  if (hasAny(text, ["architecture", "schema", "contract", "integration design"])) return "taphelu-architect";
  return "taphelu-dev";
}

function inferBoundary(objective) {
  const text = objective.toLowerCase();
  if (hasAny(text, ["ui", "frontend", "component", "page", "css", "layout", "responsive"])) return "frontend";
  if (hasAny(text, ["api", "server", "backend", "database", "sqlite", "schema"])) return "backend";
  if (hasAny(text, ["ci", "deploy", "docker", "infra", "config", "install"])) return "infra";
  if (hasAny(text, ["contract", "schema", "mcp", "adapter", "interface"])) return "contract";
  return "business";
}

function inferRisk(objective) {
  const text = objective.toLowerCase();
  return hasAny(text, ["memory", "state", "database", "schema", "security", "secret", "delete", "mcp", "config"]) ? "medium" : "low";
}

function defaultTestability(objective, strictness) {
  const text = objective.toLowerCase();
  if (hasAny(text, ["visual", "screenshot", "responsive", "layout"])) return "browser";
  if (hasAny(text, ["ui", "frontend", "component", "page"])) return "browser";
  if (hasAny(text, ["docs", "documentation", "readme", "markdown", "agent", "skill", "manifest"])) return strictness === "deep" ? "integration" : "artifact-check";
  if (hasAny(text, ["memory", "state", "config", "parser", "command", "mcp", "install", "adapter", "database", "sqlite"])) return strictness === "deep" ? "unit" : "integration";
  if (strictness === "deep") return "unit";
  if (strictness === "low") return "artifact-check";
  return "integration";
}

function defaultRequiredEvidenceForTestability(testability) {
  if (testability === "unit") return "Unit or regression test evidence.";
  if (testability === "integration") return "Integration, CLI, or contract smoke evidence.";
  if (testability === "browser") return "Browser/screenshot evidence for user-visible behavior.";
  if (testability === "e2e") return "End-to-end flow evidence.";
  if (testability === "manual") return "Manual acceptance note with reason.";
  if (testability === "not-worth-testing") return "Skipped-test rationale.";
  return "Artifact path plus focused inspection evidence.";
}

function defaultTestEffortReason(objective, strictness) {
  if (strictness === "deep") return "Deep strictness: changed logic needs unit or integration coverage.";
  if (strictness === "low") return "Low strictness: use focused evidence unless the task is critical.";
  const risk = inferRisk(objective);
  return risk === "medium"
    ? "Medium strictness: critical contract/state/infra path needs focused tests."
    : "Medium strictness: main-flow evidence is enough unless risk increases.";
}

function analyzeQaGate(tasks, strictness) {
  const reviews = tasks.map((task) => ({
    task_id: task.id,
    testability: task.testability,
    required_evidence: task.requiredEvidence,
    test_effort_reason: task.testEffortReason,
  }));
  const blockers = [];
  for (const task of tasks) {
    if (strictness === "deep" && task.testability === "not-worth-testing") {
      blockers.push(`${task.id} is not testable under deep strictness.`);
    }
    if (task.risk !== "low" && task.testability === "not-worth-testing") {
      blockers.push(`${task.id} is important but marked not-worth-testing.`);
    }
  }
  return {
    status: blockers.length ? "blocked" : "pass",
    reviews,
    blockers,
  };
}
