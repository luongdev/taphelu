import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { EVENT_TYPES } from "../constants.mjs";
import { parseArgs, parseVerdict } from "../args.mjs";
import { appendEvent, timestampForId } from "../events.mjs";
import { readProjectFile, withProjectFilesTransaction, writeTextFileAtomic } from "../project.mjs";
import { section, replaceSection, formatList, escapeTable, titleCase } from "../utils.mjs";
import { COMMAND_MANIFEST } from "../manifest.mjs";
import { parseTestingStrictness, testingStrictness } from "../project-config.mjs";
import { evaluateCrossAiReview } from "../review-policy.mjs";

const APPROVAL_SENSITIVE_TRIGGERS = [
  "browser",
  "secret",
  "credential",
  "security",
  "destructive",
  "delete",
];

export function runVerify(root, rawArgs) {
  const { options, values } = parseArgs(rawArgs);
  const fallbackGoal = section(readProjectFile(root, "STATE.md"), "Current Goal");
  const goal = values.join(" ").trim() || fallbackGoal || "Verify current workflow state.";
  const verification = analyzeVerification(goal, {
    requirements: options.requirement ?? [],
    constraints: options.constraint ?? [],
    nonGoals: options["non-goal"] ?? [],
    artifacts: options.artifact ?? [],
    tests: options.test ?? [],
    browserChecks: options["browser-check"] ?? [],
    approvalGates: options["approval-gate"] ?? [],
    reviewTriggers: options["review-trigger"] ?? [],
    reviewEvidence: options["review-evidence"] ?? [],
    reviewed: Boolean(options.reviewed),
    crossAiReview: evaluateCrossAiReview(root, {
      triggers: options["review-trigger"] ?? [],
      evidence: options["review-evidence"] ?? [],
      reviewed: Boolean(options.reviewed),
      currentRuntime: options.runtime || "codex",
    }),
    blockers: options.blocker ?? [],
    notes: options.note ?? [],
    evidence: options.evidence ? [options.evidence] : [],
    testingStrictness: testingStrictness(root, options["testing-strictness"] || ""),
    testabilityReview: options.testability ?? [],
    requiredEvidence: options["required-evidence"] ?? [],
    skippedTestRationale: options["skipped-test-rationale"] ?? [],
    nextAction: options["next-action"] ?? "",
    overrideVerdict: options.verdict ? parseVerdict(options.verdict) : "",
  });

  console.log(buildVerificationPacket(verification, options.write));

  if (options.write) {
    recordVerification(root, verification);
  }
}

export function analyzeVerification(goal, input) {
  const blockers = [...input.blockers];
  const notes = [...input.notes];
  const artifacts = input.artifacts;
  const tests = input.tests;
  const browserChecks = input.browserChecks;
  const reviewTriggers = input.reviewTriggers;
  const reviewEvidence = input.reviewEvidence;
  const crossAiReview = input.crossAiReview || null;
  const evidence = input.evidence;
  const strictness = parseTestingStrictness(input.testingStrictness || "medium");
  const testabilityReview = input.testabilityReview || [];
  const requiredEvidence = input.requiredEvidence || [];
  const skippedTestRationale = input.skippedTestRationale || [];
  const approvalSensitiveTriggers = reviewTriggers.filter((trigger) => isApprovalSensitiveTrigger(trigger));
  const hasExecutionEvidence = tests.length || browserChecks.length || evidence.length;
  const hasArtifactEvidence = artifacts.length > 0;
  const hasReviewEvidence = Boolean(input.reviewed || reviewEvidence.length);

  if (!hasExecutionEvidence && !hasArtifactEvidence) {
    blockers.push("Verification needs evidence: add --test, --browser-check, --artifact, or --evidence.");
  }
  if (approvalSensitiveTriggers.length && !input.approvalGates.length) {
    blockers.push(`Approval-sensitive trigger needs an approval gate: ${approvalSensitiveTriggers.join(", ")}.`);
  }
  if (reviewTriggers.length && !hasReviewEvidence) {
    blockers.push("Review trigger is present but no review evidence was recorded.");
  }
  if (crossAiReview?.required && !hasReviewEvidence) {
    blockers.push(crossAiReview.closeout);
  }

  const dimensions = [
    dimension(
      "requirements_covered",
      "Requirements covered",
      input.requirements.length ? "PASS" : "PASS_WITH_NOTES",
      input.requirements.length ? input.requirements : ["No explicit requirements supplied; verifying against the goal."],
    ),
    dimension(
      "constraints_respected",
      "Constraints respected",
      input.constraints.length ? "PASS" : "PASS_WITH_NOTES",
      input.constraints.length ? input.constraints : ["No explicit constraints supplied."],
    ),
    dimension(
      "non_goals_respected",
      "Non-goals respected",
      input.nonGoals.length ? "PASS" : "PASS_WITH_NOTES",
      input.nonGoals.length ? input.nonGoals : ["No explicit non-goals supplied."],
    ),
    dimension(
      "artifacts_updated",
      "Artifacts updated",
      hasArtifactEvidence ? "PASS" : "PASS_WITH_NOTES",
      hasArtifactEvidence ? artifacts : ["No artifact evidence recorded."],
    ),
    dimension(
      "checks_run",
      "Tests or browser checks run",
      hasExecutionEvidence ? "PASS" : "PASS_WITH_NOTES",
      [
        ...tests.map((test) => `test: ${test}`),
        ...browserChecks.map((check) => `browser: ${check}`),
        ...evidence.map((item) => `evidence: ${item}`),
      ].length
        ? [
          ...tests.map((test) => `test: ${test}`),
          ...browserChecks.map((check) => `browser: ${check}`),
          ...evidence.map((item) => `evidence: ${item}`),
        ]
        : ["No execution check recorded; artifact evidence only."],
    ),
    dimension(
      "testing_policy_applied",
      "Testing policy applied",
      "PASS",
      [`testing.strictness=${strictness}`],
    ),
    dimension(
      "task_testability_reviewed",
      "Task testability reviewed",
      testabilityReview.length ? "PASS" : "PASS_WITH_NOTES",
      testabilityReview.length ? testabilityReview : ["No task testability review recorded."],
    ),
    dimension(
      "required_evidence_recorded",
      "Required evidence recorded",
      requiredEvidence.length ? "PASS" : "PASS_WITH_NOTES",
      requiredEvidence.length ? requiredEvidence : ["No explicit required evidence map recorded."],
    ),
    dimension(
      "skipped_tests_justified",
      "Skipped tests justified",
      skippedTestRationale.length ? "PASS" : "PASS_WITH_NOTES",
      skippedTestRationale.length ? skippedTestRationale : ["No skipped-test rationale recorded."],
    ),
    dimension(
      "memory_state_updated",
      "Memory and state updated",
      artifacts.some((artifact) => /(^|\/)(STATE|RUNS|MEMORY)\.md$/.test(artifact)) ? "PASS" : "PASS_WITH_NOTES",
      artifacts.some((artifact) => /(^|\/)(STATE|RUNS|MEMORY)\.md$/.test(artifact))
        ? artifacts.filter((artifact) => /(^|\/)(STATE|RUNS|MEMORY)\.md$/.test(artifact))
        : ["No state or memory artifact recorded."],
    ),
    dimension(
      "approval_gates_satisfied",
      "Approval gates satisfied",
      approvalSensitiveTriggers.length && !input.approvalGates.length ? "BLOCKED" : "PASS",
      input.approvalGates.length ? input.approvalGates : ["No approval-sensitive trigger requiring a gate."],
    ),
    dimension(
      "review_triggers_handled",
      "Review triggers handled",
      (reviewTriggers.length || crossAiReview?.required) && !hasReviewEvidence ? "BLOCKED" : "PASS",
      reviewTriggers.length
        ? [
          `Triggers: ${reviewTriggers.join(", ")}`,
          ...(reviewEvidence.length ? reviewEvidence : input.reviewed ? ["Marked reviewed."] : []),
          ...(crossAiReview ? [`Cross-AI: ${crossAiReview.closeout}`] : []),
        ]
        : [crossAiReview ? `Cross-AI: ${crossAiReview.closeout}` : "No review trigger recorded."],
    ),
    dimension(
      "diff_scope_acceptable",
      "Diff scope acceptable",
      reviewTriggers.some((trigger) => /large|many|runtime|state|schema/i.test(trigger)) ? "PASS_WITH_NOTES" : "PASS",
      reviewTriggers.length ? reviewTriggers : ["No diff-scope trigger recorded."],
    ),
  ];

  let verdict = computeVerdict(dimensions, blockers, notes);
  if (input.overrideVerdict) {
    verdict = input.overrideVerdict;
  }
  if (blockers.length && (verdict === "PASS" || verdict === "PASS_WITH_NOTES")) {
    verdict = "BLOCKED";
  }

  const nextAction = input.nextAction || defaultNextAction(verdict, blockers, reviewTriggers);
  const nextRoute = nextRouteForVerdict(verdict);

  return {
    goal,
    verdict,
    nextRoute,
    nextAction,
    requirements: input.requirements,
    constraints: input.constraints,
    nonGoals: input.nonGoals,
    artifacts,
    tests,
    browserChecks,
    evidence,
    testingStrictness: strictness,
    testabilityReview,
    requiredEvidence,
    skippedTestRationale,
    approvalGates: input.approvalGates,
    reviewTriggers,
    reviewEvidence,
    reviewed: input.reviewed,
    crossAiReview,
    blockers,
    notes,
    dimensions,
  };
}

export function buildVerificationPacket(verification, willWrite) {
  const dimensionRows = verification.dimensions
    .map((item) => `| \`${item.key}\` | ${escapeTable(item.label)} | \`${item.status}\` | ${escapeTable(item.evidence.join("; "))} |`)
    .join("\n");

  return `# Verification Report

## Goal

${verification.goal}

## Verdict

\`${verification.verdict}\`

## Dimensions

| Key | Dimension | Status | Evidence |
|---|---|---|---|
${dimensionRows}

## Artifacts

${formatList(verification.artifacts, "No artifact evidence recorded.")}

## Tests

${formatList(verification.tests, "No test command recorded.")}

## Browser Checks

${formatList(verification.browserChecks, "No browser check recorded.")}

## Evidence

${formatList(verification.evidence, "No extra evidence recorded.")}

## Testing Policy

- Strictness: \`${verification.testingStrictness}\`

Task testability review:

${formatList(verification.testabilityReview, "No task testability review recorded.")}

Required evidence:

${formatList(verification.requiredEvidence, "No required evidence map recorded.")}

Skipped-test rationale:

${formatList(verification.skippedTestRationale, "None.")}

## Review Triggers

${formatList(verification.reviewTriggers, "None.")}

## Review Evidence

${verification.reviewed ? "- Marked reviewed." : formatList(verification.reviewEvidence, "None.")}

## Cross-AI Review

${verification.crossAiReview ? `- Level: \`${verification.crossAiReview.level}\`
- Status: \`${verification.crossAiReview.status}\`
- Closeout: ${verification.crossAiReview.closeout}
- Permission: ${verification.crossAiReview.permissionPrompt || "Not needed."}` : "- Not evaluated."}

## Approval Gates

${formatList(verification.approvalGates, "None required or recorded.")}

## Blockers

${formatList(verification.blockers, "None.")}

## Notes

${formatList(verification.notes, "None.")}

## Write Behavior

${willWrite ? "- This invocation will append a verification event and update STATE.md/RUNS.md." : "- Add `--write` to persist this verification result."}

## Next Action

${verification.nextAction}

## Next Route

\`${verification.nextRoute}\`
`;
}

export function recordVerification(root, verification, runId = `run-${timestampForId()}-verify`) {
  const now = new Date().toISOString();
  withProjectFilesTransaction(root, ["events.jsonl", "RUNS.md", "STATE.md"], () => {
    appendEvent(root, {
      ts: now,
      type: EVENT_TYPES.VERIFICATION_COMPLETED,
      run_id: runId,
      summary: `Verification completed with verdict ${verification.verdict}.`,
      data: {
        goal: verification.goal,
        verdict: verification.verdict,
        next_route: verification.nextRoute,
        next_action: verification.nextAction,
        artifacts: verification.artifacts,
        tests: verification.tests,
        browser_checks: verification.browserChecks,
        evidence: verification.evidence,
        testing_strictness: verification.testingStrictness,
        testability_review: verification.testabilityReview,
        required_evidence: verification.requiredEvidence,
        skipped_test_rationale: verification.skippedTestRationale,
        review_triggers: verification.reviewTriggers,
        review_evidence: verification.reviewEvidence,
        cross_ai_review: verification.crossAiReview,
        blockers: verification.blockers,
        notes: verification.notes,
      },
    });
    appendVerificationRunSummary(root, verification, now, runId);
    updateVerificationState(root, verification, now);
  });
}

function appendVerificationRunSummary(root, verification, now, runId) {
  const path = join(root, ".projects", "RUNS.md");
  if (!existsSync(path)) return;

  const row = `| ${runId} | ${now.slice(0, 10)} | ${escapeTable(verification.goal)} | ${titleCase(verification.verdict.toLowerCase())} |\n`;
  let content = readFileSync(path, "utf8");
  const tableMarker = content.match(/\|[-\s]+\|[-\s]+\|[-\s]+\|[-\s]+\|\r?\n/);
  if (tableMarker && !content.includes(`| ${runId} |`)) {
    const insertAt = tableMarker.index + tableMarker[0].length;
    content = content.slice(0, insertAt) + row + content.slice(insertAt);
  }

  content += `
## ${runId}

Goal: ${verification.goal}

Verdict: ${verification.verdict}

Artifacts:

${formatList(verification.artifacts, "No artifact evidence recorded.")}

Checks:

${formatList([...verification.tests, ...verification.browserChecks, ...verification.evidence], "No execution evidence recorded.")}

Testing policy:

- Strictness: ${verification.testingStrictness}
- Testability review: ${verification.testabilityReview.length ? verification.testabilityReview.join("; ") : "not recorded"}

Review triggers:

${formatList(verification.reviewTriggers, "None.")}

Blockers:

${formatList(verification.blockers, "None.")}

Follow-up:

- ${verification.nextAction}
`;
  writeTextFileAtomic(path, content);
}

function updateVerificationState(root, verification, now) {
  const path = join(root, ".projects", "STATE.md");
  if (!existsSync(path)) return;

  let content = readFileSync(path, "utf8");
  content = replaceSection(content, "Current Goal", verification.goal);
  content = replaceSection(
    content,
    "Current Phase",
    `\`$dl verify\` completed with verdict \`${verification.verdict}\`.\n\nImplemented commands: ${implementedCommands()}.`
  );
  content = replaceSection(content, "Blockers", verification.blockers.length ? formatList(verification.blockers, "") : "None.");
  content = replaceSection(content, "Next Action", verification.nextAction);
  content = replaceSection(
    content,
    "Last Verification",
    `${now}: \`dl verify --write\` recorded verdict \`${verification.verdict}\` for ${verification.artifacts.length} artifact(s), ${verification.tests.length + verification.browserChecks.length + verification.evidence.length} check(s), and ${verification.reviewTriggers.length} review trigger(s).`
  );
  writeTextFileAtomic(path, content);
}

function implementedCommands() {
  return COMMAND_MANIFEST.map((command) => `\`${command.name}\``).join(", ");
}

function dimension(key, label, status, evidence) {
  return {
    key,
    label,
    status,
    evidence,
  };
}

function computeVerdict(dimensions, blockers, notes) {
  if (blockers.length || dimensions.some((item) => item.status === "BLOCKED")) return "BLOCKED";
  if (dimensions.some((item) => item.status === "FAILED")) return "FAILED";
  if (notes.length || dimensions.some((item) => item.status === "PASS_WITH_NOTES")) return "PASS_WITH_NOTES";
  return "PASS";
}

function nextRouteForVerdict(verdict) {
  if (verdict === "PASS" || verdict === "PASS_WITH_NOTES") return "done";
  if (verdict === "FAILED") return "fix";
  return "blocked";
}

function defaultNextAction(verdict, blockers, reviewTriggers) {
  if (verdict === "FAILED") {
    return "Fix failed verification evidence and rerun `dl verify`.";
  }
  if (verdict === "BLOCKED") {
    return blockers[0] || "Resolve verification blockers and rerun `dl verify`.";
  }
  if (reviewTriggers.length) {
    return "Close the run after review evidence is recorded.";
  }
  if (verdict === "PASS_WITH_NOTES") {
    return "Record any notes that should influence the next workflow step.";
  }
  return "Close the run and continue to the next planned action.";
}

function isApprovalSensitiveTrigger(trigger) {
  const normalized = String(trigger).toLowerCase();
  return APPROVAL_SENSITIVE_TRIGGERS.some((needle) => normalized.includes(needle));
}
