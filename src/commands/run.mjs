import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { EVENT_TYPES } from "../constants.mjs";
import { parseArgs, parseMode, parseConfidence } from "../args.mjs";
import { appendEvent, timestampForId } from "../events.mjs";
import { readProjectFile, withProjectFilesTransaction, writeTextFileAtomic } from "../project.mjs";
import { section, replaceSection, formatList, escapeTable, titleCase } from "../utils.mjs";
import { fail } from "../errors.mjs";
import { COMMAND_MANIFEST } from "../manifest.mjs";
import { analyzeGoal } from "./ask.mjs";
import { analyzeResearch } from "./research.mjs";
import { analyzePlan } from "./plan.mjs";
import { analyzeVerification } from "./verify.mjs";
import { testingStrictness } from "../project-config.mjs";

export function runWorkflow(root, rawArgs) {
  const { options, values } = parseArgs(rawArgs);
  const goal = values.join(" ").trim();

  if (options.resume) {
    const packet = buildResumePacket(root, options.resume, goal);
    console.log(packet);
    if (options.write) {
      appendEvent(root, {
        ts: new Date().toISOString(),
        type: EVENT_TYPES.RUN_RESUMED,
        run_id: options.resume,
        summary: "Run resume packet created by dl run.",
        data: { goal: goal || section(readProjectFile(root, "STATE.md"), "Current Goal") },
      });
    }
    return;
  }

  if (!goal) {
    fail("Missing goal. Usage: dl run [--source text] [--finding text] <goal>");
  }

  const mode = parseMode(options.mode ?? "standard");
  const approvalScope = options["approval-scope"] ?? "";
  const contextPaths = options.context ?? [];
  const strictness = testingStrictness(root, options["testing-strictness"] || "");
  const requirement = analyzeGoal(goal, mode, approvalScope);
  const suppliedResearch = Boolean(
    (options.source && options.source.length) ||
    (options.finding && options.finding.length) ||
    (options.inference && options.inference.length) ||
    (options.risk && options.risk.length)
  );
  const needsResearch = requirement.nextRoute === "research" || suppliedResearch;
  const research = needsResearch
    ? analyzeResearch(goal, {
      sources: options.source ?? [],
      findings: options.finding ?? [],
      inferences: options.inference ?? [],
      risks: options.risk ?? [],
      followUps: options["follow-up"] ?? [],
      impact: options.impact ?? "Use supplied research evidence to shape the plan.",
      approvalScope,
      confidence: parseConfidence(options.confidence ?? (suppliedResearch ? "medium" : "low")),
    })
    : null;
  const canPlan = requirement.nextRoute !== "blocked" &&
    requirement.questions.length === 0 &&
    (!research || research.nextRoute !== "blocked");
  const plan = canPlan
    ? analyzePlan(goal, {
      contexts: contextPaths,
      requirements: [`Goal accepted with ${requirement.ambiguity} ambiguity.`],
      research: research ? research.findings : [],
      tasks: options.task ?? [`Execute the smallest complete workflow for: ${goal}`],
      constraints: options.constraint ?? [],
      nonGoals: options["non-goal"] ?? [],
      assumptions: [
        ...requirement.assumptions,
        ...(options.assumption ?? []),
      ],
      risks: [
        ...(research ? research.risks : []),
        ...(options.risk ?? []),
      ],
      approvalGates: options["approval-gate"] ?? [],
      verifications: options.verification ?? [],
      owners: options.owner ?? [],
      boundaries: options.boundary ?? [],
      dependsOn: options["depends-on"] ?? [],
      testabilities: options.testability ?? [],
      requiredEvidence: options["required-evidence"] ?? [],
      testEffortReasons: options["test-effort-reason"] ?? [],
      testingStrictness: strictness,
    })
    : null;
  const run = analyzeRun(goal, {
    mode,
    approvalScope,
    contextPaths,
    requirement,
    research,
    plan,
    reviewTriggers: options["review-trigger"] ?? [],
    reviewEvidence: options["review-evidence"] ?? [],
    reviewed: Boolean(options.reviewed),
    testingStrictness: strictness,
  });

  console.log(buildRunPacket(run, options.write));

  if (options.write) {
    recordRun(root, run);
  }
}

function analyzeRun(goal, input) {
  const runId = `run-${timestampForId()}-mvp`;
  const blockers = [];
  let lifecycleState = "completed";
  let nextAction = "Close the run after verification and update project state.";

  if (input.requirement.nextRoute === "blocked") {
    lifecycleState = "blocked";
    blockers.push("Requirement check is blocked by ambiguity or missing permission.");
    nextAction = "Resolve the requirement questions or permission boundary, then rerun `dl run`.";
  } else if (input.requirement.questions.length) {
    lifecycleState = "needs_questions";
    blockers.push("Requirement questions remain unanswered.");
    nextAction = "Answer the requirement questions before planning.";
  } else if (input.research && input.research.nextRoute === "blocked") {
    lifecycleState = "blocked";
    blockers.push("Research evidence is incomplete or permission-gated.");
    nextAction = "Add source-grounded findings or approved research scope, then rerun `dl run`.";
  } else if (input.plan && input.plan.nextRoute === "blocked") {
    lifecycleState = "blocked";
    blockers.push("Plan is blocked by a missing approval gate or unresolved planning risk.");
    nextAction = "Add the missing approval gate or resolve the planning risk, then rerun `dl run`.";
  } else if (!input.plan) {
    lifecycleState = input.research ? "planning" : "researching";
    nextAction = "Produce the missing research or plan packet.";
  }

  const run = {
    runId,
    goal,
    lifecycleState,
    nextAction,
    blockers,
    mode: input.mode,
    approvalScope: input.approvalScope,
    contextPaths: input.contextPaths,
    requirement: input.requirement,
    research: input.research,
    plan: input.plan,
    reviewTriggers: input.reviewTriggers,
    reviewEvidence: input.reviewEvidence,
    reviewed: input.reviewed,
    testingStrictness: input.testingStrictness,
  };

  run.verification = analyzeRunVerification(run);
  if (
    run.lifecycleState === "completed" &&
    !["PASS", "PASS_WITH_NOTES"].includes(run.verification.verdict)
  ) {
    run.lifecycleState = "blocked";
    run.blockers.push("Verification did not produce a passing verdict.");
    run.nextAction = run.verification.nextAction;
    run.verification = analyzeRunVerification(run);
  }

  return run;
}

function buildRunPacket(run, willWrite) {
  const questions = run.requirement.questions.length
    ? run.requirement.questions.map((question) => `- ${question}`).join("\n")
    : "- None.";
  const researchState = run.research
    ? `- Required or supplied: yes\n- Next route: \`${run.research.nextRoute}\`\n- Confidence: \`${run.research.confidence}\`\n- Findings:\n${formatList(run.research.findings, "No findings recorded.")}`
    : "- Required or supplied: no\n- Result: skipped.";
  const planState = run.plan
    ? `- Next route: \`${run.plan.nextRoute}\`\n- Task count: ${run.plan.tasks.length}\n- Testing strictness: \`${run.plan.testingStrictness}\`\n- QA gate: \`${run.plan.qaGate.status}\`\n- Verification:\n${formatList(run.plan.verificationPlan, "No verification plan recorded.")}`
    : "- Plan not created.";
  const writeEffect = willWrite
    ? "- This invocation will append run events, update STATE.md, and append RUNS.md."
    : "- Add `--write` to persist events, STATE.md, and RUNS.md updates.";

  return `# Run Packet

## Run ID

\`${run.runId}\`

## Goal

${run.goal}

## Lifecycle State

\`${run.lifecycleState}\`

## Context Loaded

${formatList(run.contextPaths, "Current .projects context.")}

## Requirement Check

- Ambiguity: \`${run.requirement.ambiguity}\`
- Mode: \`${run.mode}\`
- Next route: \`${run.requirement.nextRoute}\`

Open questions:

${questions}

## Research Check

${researchState}

## Plan Check

${planState}

## Blockers

${formatList(run.blockers, "None.")}

## Verification Verdict

- Verdict: \`${run.verification.verdict}\`
- Next route: \`${run.verification.nextRoute}\`
- Checks: ${run.verification.tests.length + run.verification.browserChecks.length + run.verification.evidence.length}
- Review triggers: ${run.verification.reviewTriggers.length}

## Closeout Checklist

- Goal parsed.
- Requirement check completed.
- Research evidence handled or explicitly blocked.
- Plan created when the run is unblocked.
- Verification plan present when the run is unblocked.
- STATE.md records current position.
- RUNS.md records compact run history.
- MEMORY.md changes only for durable decisions.
- events.jsonl stores structured events.

## Write Behavior

${writeEffect}

## Next Action

${run.nextAction}
`;
}

function buildResumePacket(root, runId, goal) {
  const state = readProjectFile(root, "STATE.md");
  const runs = readProjectFile(root, "RUNS.md");
  const knownRun = runs.includes(runId);
  const currentGoal = goal || section(state, "Current Goal") || "No current goal recorded.";
  const currentPhase = section(state, "Current Phase") || "No current phase recorded.";
  const nextAction = section(state, "Next Action") || "No next action recorded.";

  return `# Resume Packet

## Run ID

\`${runId}\`

## Known Run

${knownRun ? "- Found in RUNS.md." : "- Not found in RUNS.md; resume from current STATE.md only."}

## Goal

${currentGoal}

## Current Phase

${currentPhase}

## Resume Inputs

- PROJECT.md
- AGENT-PRINCIPLES.md
- ROADMAP.md
- STATE.md
- MEMORY.md
- RUNS.md

## Next Action

${nextAction}

## Next Route

\`resume\`
`;
}

function recordRun(root, run) {
  const now = new Date().toISOString();
  withProjectFilesTransaction(root, ["events.jsonl", "RUNS.md", "STATE.md"], () => {
    appendEvent(root, {
      ts: now,
      type: EVENT_TYPES.RUN_STARTED,
      run_id: run.runId,
      summary: "End-to-end workflow run started.",
      data: {
        goal: run.goal,
        lifecycle_state: run.lifecycleState,
        task_objectives: run.plan ? run.plan.tasks.map((task) => task.objective) : [],
        verification_plan: run.plan ? run.plan.verificationPlan : [],
      },
    });
    appendEvent(root, {
      ts: now,
      type: EVENT_TYPES.GOAL_RECEIVED,
      run_id: run.runId,
      summary: "Run goal received.",
      data: { goal: run.goal, mode: run.mode, context_paths: run.contextPaths },
    });
    appendEvent(root, {
      ts: now,
      type: EVENT_TYPES.REQUIREMENT_PACKET_CREATED,
      run_id: run.runId,
      summary: "Run requirement check completed.",
      data: {
        ambiguity: run.requirement.ambiguity,
        next_route: run.requirement.nextRoute,
        question_count: run.requirement.questions.length,
      },
    });
    if (run.research) {
      appendEvent(root, {
        ts: now,
        type: EVENT_TYPES.RESEARCH_RECORDED,
        run_id: run.runId,
        summary: "Run research check completed.",
        data: {
          source_count: run.research.sources.length,
          finding_count: run.research.findings.length,
          confidence: run.research.confidence,
          next_route: run.research.nextRoute,
        },
      });
    }
    if (run.plan) {
      appendEvent(root, {
        ts: now,
        type: EVENT_TYPES.PLAN_CREATED,
        run_id: run.runId,
        summary: "Run plan created.",
        data: {
          task_count: run.plan.tasks.length,
          task_objectives: run.plan.tasks.map((task) => task.objective),
          verification_plan: run.plan.verificationPlan,
          next_route: run.plan.nextRoute,
        },
      });
    }
    appendEvent(root, {
      ts: now,
      type: EVENT_TYPES.VERIFICATION_COMPLETED,
      run_id: run.runId,
      summary: `Run verification completed with verdict ${run.verification.verdict}.`,
      data: {
        verification_count: run.plan ? run.plan.verificationPlan.length : 0,
        result: run.verification.verdict,
        next_route: run.verification.nextRoute,
        review_triggers: run.verification.reviewTriggers,
        blockers: run.verification.blockers,
      },
    });
    appendEvent(root, {
      ts: now,
      type: run.lifecycleState === "completed" ? EVENT_TYPES.RUN_CLOSED : EVENT_TYPES.RUN_BLOCKED,
      run_id: run.runId,
      summary: run.lifecycleState === "completed"
        ? "End-to-end workflow run completed."
        : "End-to-end workflow run stopped before completion.",
      data: { outcome: run.lifecycleState, next_action: run.nextAction },
    });
    appendRunSummary(root, run, now);
    updateStateFile(root, run, now);
  });
}

function appendRunSummary(root, run, now) {
  const path = join(root, ".projects", "RUNS.md");
  if (!existsSync(path)) return;

  const outcome = run.lifecycleState === "completed" ? "Completed" : titleCase(run.lifecycleState);
  const row = `| ${run.runId} | ${now.slice(0, 10)} | ${escapeTable(run.goal)} | ${outcome} |\n`;
  let content = readFileSync(path, "utf8");
  const tableMarker = content.match(/\|[-\s]+\|[-\s]+\|[-\s]+\|[-\s]+\|\r?\n/);
  if (tableMarker && !content.includes(`| ${run.runId} |`)) {
    const insertAt = tableMarker.index + tableMarker[0].length;
    content = content.slice(0, insertAt) + row + content.slice(insertAt);
  }

  content += `
## ${run.runId}

Goal: ${run.goal}

Lifecycle state: ${run.lifecycleState}

Actions taken:

- Parsed goal.
- Checked requirements.
- ${run.research ? "Checked supplied research evidence." : "Skipped research because it was not required or supplied."}
- ${run.plan ? "Created a plan and verification checklist." : "Stopped before plan creation."}

Tasks:

${run.plan ? formatList(run.plan.tasks.map((task) => `${task.id}: ${task.objective}`), "No tasks recorded.") : "- Run did not reach planning."}

Verification:

${run.plan ? formatList(run.plan.verificationPlan, "No verification plan recorded.") : "- Run did not reach verification planning."}

Verdict:

- ${run.verification.verdict}.

Outcome:

- ${outcome}.

Follow-up:

- ${run.nextAction}
`;
  writeTextFileAtomic(path, content);
}

function updateStateFile(root, run, now) {
  const path = join(root, ".projects", "STATE.md");
  if (!existsSync(path)) return;

  let content = readFileSync(path, "utf8");
  const currentMilestone = section(content, "Current Milestone") || "Milestone 5: End-to-End MVP Run.";
  content = replaceSection(content, "Current Goal", run.goal);
  content = replaceSection(content, "Current Milestone", currentMilestone);
  content = replaceSection(
    content,
    "Current Phase",
    `\`$dl run\` executed with lifecycle \`${run.lifecycleState}\` and verification verdict \`${run.verification.verdict}\`.\n\nImplemented commands: ${implementedCommands()}.`
  );
  content = replaceSection(content, "Blockers", run.blockers.length ? formatList(run.blockers, "") : "None.");
  content = replaceSection(content, "Next Action", run.nextAction);
  content = replaceSection(
    content,
    "Last Verification",
    `${now}: \`dl run --write\` recorded lifecycle \`${run.lifecycleState}\` with verdict \`${run.verification.verdict}\` and ${run.plan ? run.plan.verificationPlan.length : 0} verification item(s).`
  );
  writeTextFileAtomic(path, content);
}

function implementedCommands() {
  return COMMAND_MANIFEST.map((command) => `\`${command.name}\``).join(", ");
}

function analyzeRunVerification(run) {
  const artifacts = ["Run packet"];
  if (run.plan) {
    artifacts.push("Plan packet");
  }
  if (run.lifecycleState === "completed") {
    artifacts.push("STATE.md", "RUNS.md", "events.jsonl");
  }

  const evidence = [
    `Requirement check route: ${run.requirement.nextRoute}.`,
    run.research ? `Research check route: ${run.research.nextRoute}.` : "Research check skipped because it was not required or supplied.",
    run.plan ? `Plan check route: ${run.plan.nextRoute}.` : "Plan was not created.",
  ];

  return analyzeVerification(run.goal, {
    requirements: [`Goal accepted with ${run.requirement.ambiguity} ambiguity.`],
    constraints: run.plan ? run.plan.constraints : [],
    nonGoals: run.plan ? run.plan.nonGoals : [],
    artifacts,
    tests: run.plan ? run.plan.verificationPlan : [],
    browserChecks: [],
    testingStrictness: run.testingStrictness,
    testabilityReview: run.plan ? run.plan.qaGate.reviews.map((review) => `${review.task_id}: ${review.testability}; evidence: ${review.required_evidence}`) : [],
    requiredEvidence: run.plan ? run.plan.tasks.map((task) => `${task.id}: ${task.requiredEvidence}`) : [],
    skippedTestRationale: run.plan ? run.plan.tasks
      .filter((task) => task.testability === "not-worth-testing")
      .map((task) => `${task.id}: ${task.testEffortReason}`) : [],
    approvalGates: run.plan ? run.plan.approvalGates : [],
    reviewTriggers: run.reviewTriggers,
    reviewEvidence: run.reviewEvidence,
    reviewed: run.reviewed,
    blockers: run.blockers,
    notes: [],
    evidence,
    nextAction: run.nextAction,
    overrideVerdict: "",
  });
}
