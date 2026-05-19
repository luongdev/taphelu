import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { EVENT_TYPES } from "./constants.mjs";
import { appendEvent, timestampForId } from "./events.mjs";
import { fail } from "./errors.mjs";
import { readProjectFile, relativeProjectPath, withProjectFilesTransaction, writeTextFileAtomic } from "./project.mjs";
import { escapeTable, formatList, section, unsafeMemory } from "./utils.mjs";

export const PLAN_STORE_DIR = "plans";
export const PLAN_STATUSES = ["draft", "ready", "in_progress", "blocked", "review", "done", "verified", "archived"];
const TASK_STATUSES = new Set(PLAN_STATUSES);
const DEFAULT_MILESTONE = "M01";
const DEFAULT_STORY_SUFFIX = "S01";

const TASK_TRANSITIONS = {
  draft: ["ready", "blocked"],
  ready: ["in_progress", "blocked"],
  in_progress: ["review", "blocked"],
  review: ["done", "blocked"],
  done: ["verified", "blocked"],
  verified: ["archived"],
  blocked: ["ready", "in_progress"],
  archived: [],
};

const TASK_SECTION_HEADINGS = [
  "Problem",
  "Input Artifacts",
  "References",
  "Source Excerpt",
  "Constraints",
  "In Scope",
  "Out Of Scope",
  "Ownership Boundary",
  "Allowed Paths",
  "Expected Outputs",
  "Acceptance Criteria",
  "Required Evidence",
  "Test Effort Reason",
  "Dev Instructions",
  "QA Checks",
  "UX Checks",
  "Visual Checks",
  "Changed Files",
  "Evidence",
  "Dev Record",
  "QA Record",
  "UX Record",
  "Review Followups",
];

export function analyzeStructuredPlanCreate(root, input = {}) {
  const goal = clean(input.goal || "");
  if (!goal) fail("Missing plan goal.");
  const milestoneId = normalizeMilestoneId(input.milestone || DEFAULT_MILESTONE);
  const storyId = normalizeStoryId(input.story || DEFAULT_STORY_SUFFIX, milestoneId);
  const now = new Date().toISOString();
  const tasks = normalizePlanTasks(input.plan?.tasks || input.tasks || [], storyId, input.plan);
  const milestone = {
    schemaVersion: 1,
    id: milestoneId,
    title: input.title || `Milestone ${milestoneId}`,
    goal,
    status: input.plan?.qaGate?.blockers?.length ? "blocked" : "ready",
    storyIds: [storyId],
    createdAt: now,
    updatedAt: now,
  };
  const story = {
    schemaVersion: 1,
    id: storyId,
    milestoneId,
    title: input.storyTitle || firstSentence(goal),
    goal,
    status: milestone.status,
    taskIds: tasks.map((task) => task.id),
    acceptanceCriteria: unique([
      ...(input.acceptanceCriteria || []),
      ...tasks.flatMap((task) => task.acceptanceCriteria || []),
    ]),
    context: {
      problem: goal,
      inputArtifacts: safeArray(input.plan?.contexts || input.inputArtifacts),
      references: safeArray(input.references),
      constraints: safeArray(input.plan?.constraints || input.constraints),
      nonGoals: safeArray(input.plan?.nonGoals || input.nonGoals),
      assumptions: safeArray(input.plan?.assumptions || input.assumptions),
    },
    createdAt: now,
    updatedAt: now,
  };
  const index = buildPlanIndex(root, { milestone, story, tasks });
  const report = {
    kind: "structured_plan_create",
    milestone,
    story,
    tasks,
    index,
    summary: renderPlanMarkdown({ milestone, stories: [story], tasks }),
    files: planWriteFiles(root, { milestone, story, tasks, index }),
    nextRoute: milestone.status === "blocked" ? "fix_plan" : "execute_tasks_by_id",
  };
  assertSafePlanReport(report);
  return report;
}

export function nextMilestoneId(root, start = 1) {
  const store = loadPlanStore(root);
  for (let index = start; index < 1000; index += 1) {
    const id = `M${String(index).padStart(2, "0")}`;
    if (!store.milestones.has(id)) return id;
  }
  fail("No available milestone id found.");
}

export function applyStructuredPlanCreate(root, report) {
  ensurePlanStore(root);
  withProjectFilesTransaction(root, structuredPlanWriteNames(root, report), () => {
    writeStructuredPlanCreateFiles(root, report);
  });
}

export function structuredPlanWriteNames(root, report) {
  const obsoleteTasks = obsoleteStoryTaskPaths(root, report.story.id, new Set(report.tasks.map((task) => task.id)));
  return [
    milestonePath(report.milestone.id),
    legacyMilestonePath(report.milestone.id),
    storyPath(report.story.id),
    legacyStoryPath(report.story.id),
    ...report.tasks.map((task) => taskPath(task.id)),
    ...report.tasks.map((task) => legacyTaskPath(task.id)),
    ...obsoleteTasks,
    "plans/index.json",
    "PLAN.md",
    "events.jsonl",
  ];
}

export function writeStructuredPlanCreateFiles(root, report) {
  ensurePlanStore(root);
  const obsoleteTasks = obsoleteStoryTaskPaths(root, report.story.id, new Set(report.tasks.map((task) => task.id)));
  const legacyPaths = [
    legacyMilestonePath(report.milestone.id),
    legacyStoryPath(report.story.id),
    ...report.tasks.map((task) => legacyTaskPath(task.id)),
  ];
  for (const rel of [...obsoleteTasks, ...legacyPaths]) {
    const absolute = join(root, ".projects", rel);
    if (existsSync(absolute)) unlinkSync(absolute);
  }
  writeProjectMarkdown(root, milestonePath(report.milestone.id), renderMilestoneArtifact(report.milestone));
  writeProjectMarkdown(root, storyPath(report.story.id), renderStoryArtifact(report.story));
  for (const task of report.tasks) writeProjectMarkdown(root, taskPath(task.id), renderTaskArtifact(task));
  writeJson(root, "plans/index.json", buildPlanIndex(root));
  writeProjectMarkdown(root, "PLAN.md", report.summary);
  appendEvent(root, {
    ts: new Date().toISOString(),
    type: EVENT_TYPES.STRUCTURED_PLAN_CREATED,
    run_id: `run-${timestampForId()}-plan-store`,
    summary: `Structured plan ${report.milestone.id} created.`,
    data: {
      milestone_id: report.milestone.id,
      story_id: report.story.id,
      task_count: report.tasks.length,
      next_route: report.nextRoute,
    },
  });
}

export function analyzePlanRender(root, input = {}) {
  const store = loadPlanStore(root);
  const milestoneId = input.milestone ? normalizeMilestoneId(input.milestone) : latestMilestoneId(store);
  const milestone = store.milestones.get(milestoneId);
  if (!milestone) fail(`Unknown milestone: ${milestoneId}`);
  const stories = [...store.stories.values()].filter((story) => story.milestoneId === milestoneId);
  const taskIds = new Set(stories.flatMap((story) => story.taskIds || []));
  const tasks = [...store.tasks.values()].filter((task) => task.milestoneId === milestoneId || taskIds.has(task.id));
  return {
    kind: "plan_render",
    milestone,
    stories,
    tasks,
    summary: renderPlanMarkdown({ milestone, stories, tasks }),
    nextRoute: "write_optional",
  };
}

export function applyPlanRender(root, report) {
  writeProjectMarkdown(root, "PLAN.md", report.summary);
}

export function analyzePlanMigration(root, input = {}) {
  const from = input.from || ".projects/PLAN.md";
  const absolute = resolveUnderRoot(root, from);
  if (!existsSync(absolute)) fail(`Plan source not found: ${from}`);
  const content = readFileSync(absolute, "utf8");
  const goal = section(content, "Goal") || section(content, "Current Goal") || heading(content) || "Migrated legacy plan.";
  const sourceExcerpt = content.trim().split(/\r?\n/).slice(0, 40).join("\n");
  const taskTitle = firstBullet(section(content, "Tasks")) || firstBullet(content) || firstSentence(goal);
  return analyzeStructuredPlanCreate(root, {
    goal,
    milestone: input.milestone || DEFAULT_MILESTONE,
    story: input.story || DEFAULT_STORY_SUFFIX,
    references: [relativeProjectPath(root, absolute)],
    tasks: [{
      objective: taskTitle,
      verification: firstBullet(section(content, "Verification Plan")) || "Verify migrated plan acceptance criteria.",
      testability: "artifact-check",
      requiredEvidence: "Migrated plan reviewed and task contract validated.",
      owner: "taphelu-dev",
      boundary: "business",
      references: [relativeProjectPath(root, absolute)],
      sourceExcerpt,
    }],
  });
}

export function applyPlanMigration(root, report) {
  ensurePlanStore(root);
  withProjectFilesTransaction(root, structuredPlanWriteNames(root, report), () => {
    writeStructuredPlanCreateFiles(root, report);
    appendEvent(root, {
      ts: new Date().toISOString(),
      type: EVENT_TYPES.PLAN_MIGRATED,
      run_id: `run-${timestampForId()}-plan-migrate`,
      summary: `Legacy plan migrated into ${report.milestone.id}.`,
      data: {
        milestone_id: report.milestone.id,
        story_id: report.story.id,
        task_count: report.tasks.length,
      },
    });
  });
}

export function validatePlanStore(root, input = {}) {
  const store = loadPlanStore(root);
  const findings = [];
  for (const item of store.malformed || []) {
    findings.push(finding("FAIL", item.path, `Malformed plan artifact: ${item.error}`));
  }
  const taskScope = input.taskId
    ? [readTask(root, input.taskId)]
    : [...store.tasks.values()].filter((task) => !input.milestone || task.milestoneId === normalizeMilestoneId(input.milestone));
  const ids = new Set();
  for (const task of taskScope) {
    if (!task) continue;
    if (ids.has(task.id)) findings.push(finding("FAIL", task.id, "Duplicate task id in validation scope."));
    ids.add(task.id);
    findings.push(...validateTaskObject(task, store));
  }
  if (!taskScope.length) findings.push(finding("WARN", "plan-store", "No tasks found for validation scope."));
  const status = findings.some((item) => item.severity === "FAIL") ? "FAIL" : "PASS";
  return {
    kind: "plan_validation",
    status,
    findings,
    taskCount: taskScope.length,
    nextRoute: status === "PASS" ? "continue" : "fix_plan_store",
  };
}

export function listTasks(root, filters = {}) {
  const store = loadPlanStore(root);
  const milestone = filters.milestone ? normalizeMilestoneId(filters.milestone) : "";
  const story = filters.story ? normalizeStoryId(filters.story, milestone || undefined) : "";
  const status = filters.status ? normalizeStatus(filters.status) : "";
  const tasks = [...store.tasks.values()]
    .filter((task) => !milestone || task.milestoneId === milestone)
    .filter((task) => !story || task.storyId === story)
    .filter((task) => !status || task.status === status)
    .sort((a, b) => a.id.localeCompare(b.id));
  return {
    kind: "task_list",
    filters: { milestone, story, status },
    tasks,
    nextRoute: tasks.length ? "task_show_or_execute" : "plan_create",
  };
}

export function getTaskPacket(root, id) {
  const store = loadPlanStore(root);
  const task = readTask(root, id);
  const story = store.stories.get(task.storyId);
  const milestone = store.milestones.get(task.milestoneId);
  return {
    kind: "task",
    task,
    story,
    milestone,
    dependencies: (task.dependsOn || []).map((dep) => store.tasks.get(dep)).filter(Boolean),
    blockers: taskBlockers(task, store),
    nextRoute: task.status === "blocked" ? "resolve_blockers" : "execute_or_review",
  };
}

export function analyzeTaskStatus(root, id, nextStatus) {
  const task = readTask(root, id);
  const status = normalizeStatus(nextStatus);
  const blockers = statusTransitionBlockers(task.status, status);
  if (status === "verified" && !hasActualEvidence(task)) {
    blockers.push(`${task.id} cannot become verified without evidence, changed files, or QA/dev record.`);
  }
  return {
    kind: "task_status_update",
    taskId: task.id,
    from: task.status,
    to: status,
    blockers,
    updatedTask: blockers.length ? task : { ...task, status, updatedAt: new Date().toISOString() },
    nextRoute: blockers.length ? "blocked" : "write_optional",
  };
}

export function applyTaskStatus(root, report) {
  if (report.blockers?.length) fail(`Task status blocked: ${report.blockers.join("; ")}`);
  withProjectFilesTransaction(root, [taskPath(report.taskId), legacyTaskPath(report.taskId), "plans/index.json", "events.jsonl"], () => {
    const legacyPath = join(root, ".projects", legacyTaskPath(report.taskId));
    const markdownPath = join(root, ".projects", taskPath(report.taskId));
    if (existsSync(legacyPath)) unlinkSync(legacyPath);
    if (existsSync(markdownPath)) {
      const current = readFileSync(markdownPath, "utf8");
      writeProjectMarkdown(root, taskPath(report.taskId), updateMarkdownFrontmatter(current, `plans/tasks/${report.taskId}.md`, {
        status: report.updatedTask.status,
        updatedAt: report.updatedTask.updatedAt,
      }));
    } else {
      writeProjectMarkdown(root, taskPath(report.taskId), renderTaskArtifact(report.updatedTask));
    }
    refreshPlanIndex(root);
    appendEvent(root, {
      ts: new Date().toISOString(),
      type: EVENT_TYPES.TASK_STATUS_UPDATED,
      run_id: `run-${timestampForId()}-task-status`,
      summary: `${report.taskId} moved from ${report.from} to ${report.to}.`,
      data: {
        task_id: report.taskId,
        from: report.from,
        to: report.to,
      },
    });
  });
}

export function buildDevPacket(root, id) {
  const packet = getTaskPacket(root, id);
  const { task, story, milestone, blockers } = packet;
  return `# Dev Packet: ${task.id}

## Task

- Title: ${task.title}
- Status: \`${task.status}\`
- Owner: \`${task.owner}\`
- Boundary: ${task.ownershipBoundary || task.boundary || "Not recorded."}
- Milestone: ${milestone?.id || task.milestoneId}
- Story: ${story?.id || task.storyId}

## Problem

${task.problem || story?.goal || milestone?.goal || "No problem recorded."}

## Input Artifacts

${formatList(task.inputArtifacts || [], "None.")}

## References

${formatList(task.references || [], "None.")}

## Scope

In:

${formatList(task.in || [], "No explicit in-scope items.")}

Out:

${formatList(task.out || [], "No explicit out-of-scope items.")}

Allowed paths:

${formatList(task.allowedPaths || [], "Use ownership boundary and existing code patterns.")}

## Expected Outputs

${formatList(task.expectedOutputs || [], "Implementation matching acceptance criteria.")}

## Acceptance Criteria

${formatList(task.acceptanceCriteria || [], "No acceptance criteria recorded.")}

## Required Evidence

${formatList(task.requiredEvidence || [], "No evidence requirement recorded.")}

## Dev Instructions

${formatList(task.devInstructions || [], "Implement only this task. Update dev record, changed files, and evidence before marking done.")}

## Dependency Blockers

${formatList(blockers, "None.")}

## Next Route

\`${blockers.length ? "resolve_blockers" : "implement_task"}\`
`;
}

export function buildQaPacket(root, id) {
  const packet = getTaskPacket(root, id);
  const { task, story, milestone } = packet;
  return `# QA Packet: ${task.id}

## Parent Context

- Milestone: ${milestone?.id || task.milestoneId} - ${milestone?.title || "Untitled"}
- Story: ${story?.id || task.storyId} - ${story?.title || "Untitled"}

## Acceptance Criteria

${formatList(task.acceptanceCriteria || [], "No acceptance criteria recorded.")}

## Testability

- Class: \`${task.testability || "artifact-check"}\`
- Reason: ${task.testEffortReason || "No test effort reason recorded."}
- Risk: \`${task.risk || "medium"}\`

## Required Evidence

${formatList(task.requiredEvidence || [], "No evidence requirement recorded.")}

## Changed Files

${formatList(task.changedFiles || [], "No changed files recorded yet.")}

## Checkpoints

${formatList(task.devRecord?.checkpoints || [], "No checkpoints recorded yet.")}

## QA Checks

${formatList(task.qaChecks || [], "Verify AC, required evidence, regressions, and skipped-test rationale.")}

## Current Evidence

${formatList(task.evidence || [], "No evidence recorded yet.")}
`;
}

export function buildUxPacket(root, id) {
  const packet = getTaskPacket(root, id);
  const { task, story } = packet;
  return `# UX Packet: ${task.id}

## Story

${story?.goal || task.problem || "No story goal recorded."}

## User Visible

\`${Boolean(task.ux?.userVisible || task.uxChecks?.length || task.visualChecks?.length)}\`

## UX Checks

${formatList(task.uxChecks || [], "No UX checks required.")}

## Visual Checks

${formatList(task.visualChecks || [], "No visual checks required.")}

## References

${formatList([...(task.references || []), ...(task.inputArtifacts || [])], "None.")}

## Evidence

${formatList(task.evidence || [], "No UI evidence recorded yet.")}
`;
}

export function buildTaskListReport(report) {
  return `# Task List

| ID | Status | Owner | Story | Parallel | Title |
|---|---|---|---|---|---|
${report.tasks.length ? report.tasks.map((task) => `| ${task.id} | ${task.status} | ${task.owner} | ${task.storyId} | ${escapeTable(task.parallelGroup || "main")} | ${escapeTable(task.title)} |`).join("\n") : "| None | - | - | - | - | No tasks found. |"}

## Next Route

\`${report.nextRoute}\`
`;
}

export function buildTaskShowReport(packet) {
  return `# Task ${packet.task.id}

## Status

\`${packet.task.status}\`

## Title

${packet.task.title}

## Parent

- Milestone: \`${packet.milestone?.id || packet.task.milestoneId}\`
- Story: \`${packet.story?.id || packet.task.storyId}\`

## Scope

- Owner: \`${packet.task.owner}\`
- Boundary: ${packet.task.ownershipBoundary || packet.task.boundary || "Not recorded."}
- Parallel group: \`${packet.task.parallelGroup || "main"}\`

## Acceptance Criteria

${formatList(packet.task.acceptanceCriteria || [], "No acceptance criteria recorded.")}

## Required Evidence

${formatList(packet.task.requiredEvidence || [], "No evidence requirement recorded.")}

## Blockers

${formatList(packet.blockers, "None.")}

## Next Route

\`${packet.nextRoute}\`
`;
}

export function buildTaskStatusReport(report, didWrite = false) {
  return `# Task Status

- Task: \`${report.taskId}\`
- From: \`${report.from}\`
- To: \`${report.to}\`
- Mode: ${didWrite ? "write" : "preview"}

## Blockers

${formatList(report.blockers || [], "None.")}

## Next Route

\`${didWrite ? "done" : report.nextRoute}\`
`;
}

export function buildPlanValidationReport(report) {
  return `# Plan Validation

- Status: \`${report.status}\`
- Tasks checked: ${report.taskCount}

## Findings

${formatList(report.findings.map((item) => `${item.severity}: ${item.id} - ${item.message}`), "None.")}

## Next Route

\`${report.nextRoute}\`
`;
}

function normalizePlanTasks(tasks, storyId, plan = {}) {
  const milestoneId = storyId.split("-S")[0];
  const sourceTasks = tasks.length ? tasks : [{ objective: `Complete ${plan.goal || storyId}` }];
  return sourceTasks.map((task, index) => {
    const localId = task.id && /^T\d+$/i.test(task.id)
      ? `T${String(Number(task.id.slice(1))).padStart(2, "0")}`
      : `T${String(index + 1).padStart(2, "0")}`;
    const id = task.id && /^M\d+-S\d+-T\d+$/i.test(task.id)
      ? task.id.toUpperCase()
      : `${storyId}-${localId}`;
    const objective = clean(task.objective || task.title || `Task ${index + 1}`);
    const verification = clean(task.verification || `Verify ${objective}`);
    const testability = clean(task.testability || "artifact-check");
    const requiredEvidence = safeArray(task.requiredEvidence || task.required_evidence || verification);
    return {
      schemaVersion: 1,
      id,
      title: firstSentence(objective),
      status: task.status && TASK_STATUSES.has(task.status) ? task.status : "ready",
      milestoneId,
      storyId,
      owner: clean(task.owner || "taphelu-dev"),
      parallelGroup: clean(task.parallelGroup || task.parallel_group || "main"),
      dependsOn: normalizeDependsOn(task.dependsOn || task.depends_on, storyId),
      blockedBy: safeArray(task.blockedBy || task.blocked_by),
      problem: clean(task.problem || objective),
      inputArtifacts: safeArray(task.inputArtifacts || task.input_artifacts || plan.contexts),
      references: safeArray(task.references || plan.research),
      sourceExcerpt: clean(task.sourceExcerpt || task.source_excerpt || ""),
      constraints: safeArray(task.constraints || plan.constraints),
      in: safeArray(task.in || objective),
      out: safeArray(task.out || plan.nonGoals),
      ownershipBoundary: clean(task.ownershipBoundary || task.boundary || "business"),
      expectedOutputs: safeArray(task.expectedOutputs || task.expected_outputs || objective),
      allowedPaths: safeArray(task.allowedPaths || task.allowed_paths),
      changedFiles: safeArray(task.changedFiles || task.changed_files),
      acceptanceCriteria: safeArray(task.acceptanceCriteria || task.acceptance_criteria || verification),
      testability,
      requiredEvidence,
      testEffortReason: clean(task.testEffortReason || task.test_effort_reason || "Evidence should match risk and project testing strictness."),
      risk: clean(task.risk || "medium"),
      devInstructions: safeArray(task.devInstructions || task.dev_instructions || `Implement ${id} only. Do not broaden scope.`),
      qaChecks: safeArray(task.qaChecks || task.qa_checks || `Verify ${id} acceptance criteria and required evidence.`),
      uxChecks: safeArray(task.uxChecks || task.ux_checks),
      visualChecks: safeArray(task.visualChecks || task.visual_checks),
      devRecord: task.devRecord || {},
      qaRecord: task.qaRecord || {},
      uxRecord: task.uxRecord || {},
      evidence: safeArray(task.evidence),
      reviewFollowups: safeArray(task.reviewFollowups || task.review_followups),
      extraSections: clean(task.extraSections || task.extra_sections || ""),
      createdAt: task.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  });
}

function validateTaskObject(task, store) {
  const findings = [];
  if (!task.id) findings.push(finding("FAIL", "unknown", "Task id is missing."));
  if (task.id && task.storyId && !String(task.id).startsWith(`${task.storyId}-T`)) {
    findings.push(finding("FAIL", task.id, `Task id does not match story id: ${task.storyId}`));
  }
  if (task.storyId && task.milestoneId && !String(task.storyId).startsWith(`${task.milestoneId}-S`)) {
    findings.push(finding("FAIL", task.id, `Story id does not match milestone id: ${task.milestoneId}`));
  }
  if (!TASK_STATUSES.has(task.status)) findings.push(finding("FAIL", task.id, `Invalid status: ${task.status}`));
  if (!store.milestones.has(task.milestoneId)) findings.push(finding("FAIL", task.id, `Missing parent milestone: ${task.milestoneId}`));
  if (!store.stories.has(task.storyId)) findings.push(finding("FAIL", task.id, `Missing parent story: ${task.storyId}`));
  if (!task.acceptanceCriteria?.length) findings.push(finding("FAIL", task.id, "Missing acceptance criteria."));
  if (!task.requiredEvidence?.length) findings.push(finding("FAIL", task.id, "Missing required evidence."));
  for (const dep of task.dependsOn || []) {
    if (!store.tasks.has(dep)) findings.push(finding("FAIL", task.id, `Missing dependency: ${dep}`));
  }
  if (task.status === "verified" && !hasActualEvidence(task)) {
    findings.push(finding("FAIL", task.id, "Verified task has no evidence, changed files, or QA/dev record."));
  }
  return findings;
}

function loadPlanStore(root) {
  const malformed = [];
  const milestones = readPlanArtifactDir(root, "plans/milestones", parseMilestoneArtifact, malformed);
  const stories = readPlanArtifactDir(root, "plans/stories", parseStoryArtifact, malformed);
  const tasks = readPlanArtifactDir(root, "plans/tasks", parseTaskArtifact, malformed);
  return { milestones, stories, tasks, malformed };
}

function readTask(root, id) {
  const normalized = normalizeTaskId(id);
  let path = join(root, ".projects", taskPath(normalized));
  const legacyPath = join(root, ".projects", "plans", "tasks", `${normalized}.json`);
  const isLegacy = !existsSync(path) && existsSync(legacyPath);
  if (isLegacy) path = legacyPath;
  if (!existsSync(path)) fail(`Unknown task id: ${normalized}`);
  try {
    const content = readFileSync(path, "utf8");
    return isLegacy ? normalizeLegacyTask(JSON.parse(content), normalized) : parseTaskArtifact(content, `plans/tasks/${normalized}.md`);
  } catch (error) {
    fail(`Malformed task file for ${normalized}: ${error.message}`);
  }
}

function readPlanArtifactDir(root, rel, parser, malformed = []) {
  const dir = join(root, ".projects", rel);
  const map = new Map();
  if (!existsSync(dir)) return map;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile() || (!entry.name.endsWith(".md") && !entry.name.endsWith(".json"))) continue;
    if (entry.name.endsWith(".json") && existsSync(join(dir, entry.name.replace(/\.json$/i, ".md")))) continue;
    let item;
    try {
      const content = readFileSync(join(dir, entry.name), "utf8");
      item = entry.name.endsWith(".json")
        ? normalizeLegacyArtifact(rel, JSON.parse(content), entry.name)
        : parser(content, `${rel}/${entry.name}`);
    } catch (error) {
      malformed.push({ path: `${rel}/${entry.name}`, error: error.message });
      continue;
    }
    if (item?.id) map.set(item.id, item);
  }
  return map;
}

function normalizeLegacyArtifact(rel, value, fileName) {
  if (rel.endsWith("/tasks")) return normalizeLegacyTask(value, fileName.replace(/\.json$/i, ""));
  return value;
}

function normalizeLegacyTask(value, fallbackId) {
  const raw = value && typeof value === "object" ? value : {};
  const id = normalizeTaskId(raw.id || fallbackId);
  const storyId = normalizeStoryId(raw.storyId || raw.story_id || id.replace(/-T\d+$/i, ""));
  return normalizePlanTasks([{ ...raw, id }], storyId, {})[0];
}

function buildPlanIndex(root, next = {}) {
  const store = loadPlanStore(root);
  if (next.milestone) store.milestones.set(next.milestone.id, next.milestone);
  if (next.story) store.stories.set(next.story.id, next.story);
  for (const task of next.tasks || []) store.tasks.set(task.id, task);
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    milestones: [...store.milestones.values()].map((item) => indexItem(item, "milestone")),
    stories: [...store.stories.values()].map((item) => indexItem(item, "story")),
    tasks: [...store.tasks.values()].map((item) => indexItem(item, "task")),
  };
}

function refreshPlanIndex(root) {
  writeJson(root, "plans/index.json", buildPlanIndex(root));
}

function indexItem(item, type) {
  return {
    id: item.id,
    type,
    status: item.status,
    title: item.title,
    milestoneId: item.milestoneId || item.id,
    storyId: item.storyId,
    updatedAt: item.updatedAt,
  };
}

function renderPlanMarkdown({ milestone, stories, tasks }) {
  const taskRows = tasks.length
    ? tasks.map((task) => `| ${task.id} | ${task.status} | ${task.owner} | ${escapeTable(task.ownershipBoundary || "business")} | ${escapeTable((task.dependsOn || []).join(", ") || "none")} | ${escapeTable(task.title)} | ${task.testability} |`).join("\n")
    : "| None | - | - | - | - | No tasks recorded. | - |";
  return `# Plan: ${milestone.id} ${milestone.title}

> Generated view. Source of truth: \`.projects/plans/\`.

## Goal

${milestone.goal || "No goal recorded."}

## Stories

${formatList(stories.map((story) => `${story.id}: ${story.title} [${story.status}]`), "No stories recorded.")}

## Tasks

| ID | Status | Owner | Boundary | Depends On | Title | Testability |
|---|---|---|---|---|---|---|
${taskRows}

## Acceptance Criteria

${formatList(unique(stories.flatMap((story) => story.acceptanceCriteria || []).concat(tasks.flatMap((task) => task.acceptanceCriteria || []))), "No acceptance criteria recorded.")}

## Execution

- Dev entrypoint: \`dl dev implement <task-id>\`
- QA entrypoint: \`dl qa review <task-id>\`
- UX entrypoint: \`dl ux verify <task-id>\`
- Validate: \`dl plan validate --milestone ${milestone.id}\`
`;
}

function planWriteFiles(root, { milestone, story, tasks, index }) {
  return [
    { path: `.projects/${milestonePath(milestone.id)}`, exists: existsSync(join(root, ".projects", milestonePath(milestone.id))) },
    { path: `.projects/${storyPath(story.id)}`, exists: existsSync(join(root, ".projects", storyPath(story.id))) },
    ...tasks.map((task) => ({ path: `.projects/${taskPath(task.id)}`, exists: existsSync(join(root, ".projects", taskPath(task.id))) })),
    { path: ".projects/plans/index.json", exists: existsSync(join(root, ".projects", "plans/index.json")), entries: index.tasks.length },
    { path: ".projects/PLAN.md", exists: existsSync(join(root, ".projects", "PLAN.md")) },
  ];
}

function ensurePlanStore(root) {
  for (const rel of ["plans", "plans/milestones", "plans/stories", "plans/tasks", "plans/runs"]) {
    mkdirSync(join(root, ".projects", rel), { recursive: true });
  }
}

function writeJson(root, rel, value) {
  const path = join(root, ".projects", rel);
  mkdirSync(dirname(path), { recursive: true });
  writeTextFileAtomic(path, `${JSON.stringify(value, null, 2)}\n`);
}

function writeProjectMarkdown(root, rel, content) {
  const path = join(root, ".projects", rel);
  mkdirSync(dirname(path), { recursive: true });
  writeTextFileAtomic(path, content.endsWith("\n") ? content : `${content}\n`);
}

function renderMilestoneArtifact(milestone) {
  return `${frontmatter({
    schemaVersion: milestone.schemaVersion || 1,
    id: milestone.id,
    status: milestone.status,
    storyIds: milestone.storyIds || [],
    createdAt: milestone.createdAt,
    updatedAt: milestone.updatedAt,
  })}# Milestone ${milestone.id}: ${milestone.title}

## Goal

${milestone.goal || "No goal recorded."}

## Stories

${formatArtifactList(milestone.storyIds || [], "No stories recorded.")}
`;
}

function renderStoryArtifact(story) {
  const context = story.context || {};
  return `${frontmatter({
    schemaVersion: story.schemaVersion || 1,
    id: story.id,
    milestoneId: story.milestoneId,
    status: story.status,
    taskIds: story.taskIds || [],
    createdAt: story.createdAt,
    updatedAt: story.updatedAt,
  })}# Story ${story.id}: ${story.title}

## Goal

${story.goal || "No goal recorded."}

## Acceptance Criteria

${formatArtifactList(story.acceptanceCriteria || [], "No acceptance criteria recorded.")}

## Problem

${context.problem || story.goal || "No problem recorded."}

## Input Artifacts

${formatArtifactList(context.inputArtifacts || [], "None.")}

## References

${formatArtifactList(context.references || [], "None.")}

## Constraints

${formatArtifactList(context.constraints || [], "None.")}

## Non Goals

${formatArtifactList(context.nonGoals || [], "None.")}

## Assumptions

${formatArtifactList(context.assumptions || [], "None.")}
`;
}

function renderTaskArtifact(task) {
  return `${frontmatter({
    schemaVersion: task.schemaVersion || 1,
    id: task.id,
    status: task.status,
    milestoneId: task.milestoneId,
    storyId: task.storyId,
    owner: task.owner,
    parallelGroup: task.parallelGroup || "main",
    dependsOn: task.dependsOn || [],
    blockedBy: task.blockedBy || [],
    testability: task.testability || "artifact-check",
    risk: task.risk || "medium",
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  })}# Task ${task.id}: ${task.title}

## Problem

${task.problem || "No problem recorded."}

## Input Artifacts

${formatArtifactList(task.inputArtifacts || [], "None.")}

## References

${formatArtifactList(task.references || [], "None.")}

## Source Excerpt

${task.sourceExcerpt || "None."}

## Constraints

${formatArtifactList(task.constraints || [], "None.")}

## In Scope

${formatArtifactList(task.in || [], "No explicit in-scope items.")}

## Out Of Scope

${formatArtifactList(task.out || [], "No explicit out-of-scope items.")}

## Ownership Boundary

${task.ownershipBoundary || "business"}

## Allowed Paths

${formatArtifactList(task.allowedPaths || [], "Use ownership boundary and existing code patterns.")}

## Expected Outputs

${formatArtifactList(task.expectedOutputs || [], "Implementation matching acceptance criteria.")}

## Acceptance Criteria

${formatArtifactList(task.acceptanceCriteria || [], "No acceptance criteria recorded.")}

## Required Evidence

${formatArtifactList(task.requiredEvidence || [], "No evidence requirement recorded.")}

## Test Effort Reason

${task.testEffortReason || "Evidence should match risk and project testing strictness."}

## Dev Instructions

${formatArtifactList(task.devInstructions || [], "Implement only this task. Update dev record, changed files, and evidence before marking done.")}

## QA Checks

${formatArtifactList(task.qaChecks || [], "Verify acceptance criteria, evidence, regressions, and skipped-test rationale.")}

## UX Checks

${formatArtifactList(task.uxChecks || [], "No UX checks required.")}

## Visual Checks

${formatArtifactList(task.visualChecks || [], "No visual checks required.")}

## Changed Files

${formatArtifactList(task.changedFiles || [], "No changed files recorded yet.")}

## Evidence

${formatArtifactList(task.evidence || [], "No evidence recorded yet.")}

## Dev Record

${jsonFence(task.devRecord || {})}

## QA Record

${jsonFence(task.qaRecord || {})}

## UX Record

${jsonFence(task.uxRecord || {})}

## Review Followups

${formatArtifactList(task.reviewFollowups || [], "None.")}
${renderExtraSections(task.extraSections)}
`;
}

function parseMilestoneArtifact(markdown, sourcePath) {
  const { data, body } = parseFrontmatter(markdown, sourcePath);
  const id = normalizeMilestoneId(data.id || sourcePath.match(/([^/]+)\.md$/)?.[1]);
  return {
    schemaVersion: numberValue(data.schemaVersion, 1),
    id,
    title: heading(body).replace(/^Milestone\s+[^:]+:\s*/i, "") || `Milestone ${id}`,
    goal: textSection(body, "Goal"),
    status: normalizeStoredStatus(data.status || "draft"),
    storyIds: arrayValue(data.storyIds),
    createdAt: data.createdAt || "",
    updatedAt: data.updatedAt || "",
  };
}

function parseStoryArtifact(markdown, sourcePath) {
  const { data, body } = parseFrontmatter(markdown, sourcePath);
  const id = normalizeStoryId(data.id || sourcePath.match(/([^/]+)\.md$/)?.[1]);
  return {
    schemaVersion: numberValue(data.schemaVersion, 1),
    id,
    milestoneId: normalizeMilestoneId(data.milestoneId || id.split("-S")[0]),
    title: heading(body).replace(/^Story\s+[^:]+:\s*/i, "") || id,
    goal: textSection(body, "Goal"),
    status: normalizeStoredStatus(data.status || "draft"),
    taskIds: arrayValue(data.taskIds),
    acceptanceCriteria: bulletList(section(body, "Acceptance Criteria")),
    context: {
      problem: textSection(body, "Problem"),
      inputArtifacts: bulletList(section(body, "Input Artifacts")),
      references: bulletList(section(body, "References")),
      constraints: bulletList(section(body, "Constraints")),
      nonGoals: bulletList(section(body, "Non Goals")),
      assumptions: bulletList(section(body, "Assumptions")),
    },
    createdAt: data.createdAt || "",
    updatedAt: data.updatedAt || "",
  };
}

function parseTaskArtifact(markdown, sourcePath) {
  const { data, body } = parseFrontmatter(markdown, sourcePath);
  const id = normalizeTaskId(data.id || sourcePath.match(/([^/]+)\.md$/)?.[1]);
  const storyId = normalizeStoryId(data.storyId || id.replace(/-T\d+$/i, ""));
  return {
    schemaVersion: numberValue(data.schemaVersion, 1),
    id,
    title: heading(body).replace(/^Task\s+[^:]+:\s*/i, "") || id,
    status: normalizeStoredStatus(data.status || "draft"),
    milestoneId: normalizeMilestoneId(data.milestoneId || storyId.split("-S")[0]),
    storyId,
    owner: clean(data.owner || "taphelu-dev"),
    parallelGroup: clean(data.parallelGroup || "main"),
    dependsOn: arrayValue(data.dependsOn),
    blockedBy: arrayValue(data.blockedBy),
    problem: textSection(body, "Problem"),
    inputArtifacts: bulletList(section(body, "Input Artifacts")),
    references: bulletList(section(body, "References")),
    sourceExcerpt: textSection(body, "Source Excerpt"),
    constraints: bulletList(section(body, "Constraints")),
    in: bulletList(section(body, "In Scope")),
    out: bulletList(section(body, "Out Of Scope")),
    ownershipBoundary: textSection(body, "Ownership Boundary") || "business",
    expectedOutputs: bulletList(section(body, "Expected Outputs")),
    allowedPaths: bulletList(section(body, "Allowed Paths")),
    changedFiles: bulletList(section(body, "Changed Files")),
    acceptanceCriteria: bulletList(section(body, "Acceptance Criteria")),
    testability: clean(data.testability || "artifact-check"),
    requiredEvidence: bulletList(section(body, "Required Evidence")),
    testEffortReason: textSection(body, "Test Effort Reason"),
    risk: clean(data.risk || "medium"),
    devInstructions: bulletList(section(body, "Dev Instructions")),
    qaChecks: bulletList(section(body, "QA Checks")),
    uxChecks: bulletList(section(body, "UX Checks")),
    visualChecks: bulletList(section(body, "Visual Checks")),
    devRecord: parseJsonFence(section(body, "Dev Record")),
    qaRecord: parseJsonFence(section(body, "QA Record")),
    uxRecord: parseJsonFence(section(body, "UX Record")),
    evidence: bulletList(section(body, "Evidence")),
    reviewFollowups: bulletList(section(body, "Review Followups")),
    extraSections: extraMarkdownSections(body, TASK_SECTION_HEADINGS),
    createdAt: data.createdAt || "",
    updatedAt: data.updatedAt || "",
  };
}

function frontmatter(value) {
  return `---\n${yamlDump(value)}---\n\n`;
}

function yamlDump(value) {
  return Object.entries(value)
    .filter(([, item]) => item !== undefined && item !== null && item !== "")
    .map(([key, item]) => {
      if (Array.isArray(item)) {
        if (!item.length) return `${key}: []\n`;
        return `${key}:\n${item.map((entry) => `  - ${yamlScalar(entry)}`).join("\n")}\n`;
      }
      return `${key}: ${yamlScalar(item)}\n`;
    })
    .join("");
}

function yamlScalar(value) {
  const text = String(value ?? "");
  if (/^(true|false|null|\d+)$/.test(text) || /[:#\n\r[\]{}]|^\s|\s$/.test(text)) {
    return JSON.stringify(text);
  }
  return text;
}

function parseFrontmatter(markdown, sourcePath) {
  const start = markdown.match(/^---\r?\n/);
  if (!start) fail(`Missing YAML frontmatter in ${sourcePath}`);
  const end = markdown.search(/\r?\n---/);
  if (end === -1 || end === 0) fail(`Unclosed YAML frontmatter in ${sourcePath}`);
  const close = markdown.slice(end).match(/^\r?\n---/)[0];
  return {
    data: yamlParse(markdown.slice(start[0].length, end)),
    body: markdown.slice(end + close.length).trimStart(),
  };
}

function updateMarkdownFrontmatter(markdown, sourcePath, patch = {}) {
  const { data, body } = parseFrontmatter(markdown, sourcePath);
  return `${frontmatter({ ...data, ...patch })}${body}`;
}

function yamlParse(yaml) {
  const data = {};
  const lines = yaml.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim()) continue;
    const match = /^([A-Za-z0-9_]+):(?:\s*(.*))?$/.exec(line);
    if (!match) fail(`Unsupported frontmatter line: ${line}`);
    const key = match[1];
    const rest = match[2] || "";
    if (rest === "") {
      const items = [];
      while (index + 1 < lines.length && /^\s+-\s+/.test(lines[index + 1])) {
        index += 1;
        items.push(parseYamlScalar(lines[index].replace(/^\s+-\s+/, "")));
      }
      data[key] = items;
    } else if (rest === "[]") {
      data[key] = [];
    } else {
      data[key] = parseYamlScalar(rest);
    }
  }
  return data;
}

function parseYamlScalar(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  if ((text.startsWith("\"") && text.endsWith("\"")) || (text.startsWith("'") && text.endsWith("'"))) {
    try {
      return JSON.parse(text);
    } catch {
      return text.slice(1, -1);
    }
  }
  return text;
}

function bulletList(markdown) {
  const items = [];
  let current = [];
  for (const rawLine of String(markdown || "").split(/\r?\n/)) {
    const bullet = rawLine.match(/^[-*]\s+(.+?)\s*$/);
    if (bullet) {
      pushMarkdownListItem(items, current);
      current = [bullet[1]];
      continue;
    }
    if (!rawLine.trim() && !current.length) continue;
    current.push(rawLine.trimEnd());
  }
  pushMarkdownListItem(items, current);
  return items.filter((line) => !placeholderListItem(line));
}

function pushMarkdownListItem(items, lines) {
  const item = lines.join("\n").trim();
  if (item) items.push(item);
}

function formatArtifactList(items, emptyText) {
  if (!items.length) return `- ${emptyText}`;
  return items.map((item) => {
    const lines = String(item).split(/\r?\n/);
    return lines.map((line, index) => index === 0 ? `- ${line}` : `  ${line}`).join("\n");
  }).join("\n");
}

function renderExtraSections(value) {
  const text = String(value || "").trim();
  return text ? `\n${text}\n` : "";
}

function extraMarkdownSections(markdown, knownHeadings) {
  const known = new Set(knownHeadings.map((item) => item.toLowerCase()));
  const sections = splitH2Sections(markdown);
  return sections
    .filter((item) => !known.has(item.heading.toLowerCase()))
    .map((item) => `## ${item.heading}\n\n${item.body.trim()}`)
    .join("\n\n")
    .trim();
}

function splitH2Sections(markdown) {
  const lines = String(markdown || "").split(/\r?\n/);
  const sections = [];
  let current = null;
  for (const line of lines) {
    const match = /^##\s+(.+?)\s*$/.exec(line);
    if (match) {
      if (current) sections.push(current);
      current = { heading: match[1], bodyLines: [] };
      continue;
    }
    if (current) current.bodyLines.push(line);
  }
  if (current) sections.push(current);
  return sections.map((item) => ({
    heading: item.heading,
    body: item.bodyLines.join("\n"),
  }));
}

function placeholderListItem(value) {
  const text = String(value || "").trim();
  return /^none\.?$/i.test(text) ||
    /^no .* recorded/i.test(text) ||
    /^no explicit/i.test(text) ||
    /^use ownership boundary/i.test(text) ||
    /^implementation matching acceptance criteria/i.test(text);
}

function textSection(markdown, headingName) {
  const text = section(markdown, headingName).trim();
  return /^none\.?$/i.test(text) || /^no .* recorded\.?$/i.test(text) ? "" : text;
}

function jsonFence(value) {
  const json = JSON.stringify(value || {}, null, 2);
  return `\`\`\`json\n${json}\n\`\`\``;
}

function parseJsonFence(markdown) {
  const match = String(markdown || "").match(/```json\s*([\s\S]*?)```/i);
  if (!match) return {};
  try {
    return JSON.parse(match[1]);
  } catch {
    return {};
  }
}

function arrayValue(value) {
  if (Array.isArray(value)) return value.map((item) => clean(item)).filter(Boolean);
  return safeArray(value);
}

function numberValue(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizeStoredStatus(value) {
  const status = String(value || "").trim().toLowerCase();
  return TASK_STATUSES.has(status) ? status : "draft";
}

function milestonePath(id) {
  return `plans/milestones/${normalizeMilestoneId(id)}.md`;
}

function legacyMilestonePath(id) {
  return `plans/milestones/${normalizeMilestoneId(id)}.json`;
}

function storyPath(id) {
  return `plans/stories/${normalizeStoryId(id)}.md`;
}

function legacyStoryPath(id) {
  return `plans/stories/${normalizeStoryId(id)}.json`;
}

function taskPath(id) {
  return `plans/tasks/${normalizeTaskId(id)}.md`;
}

function legacyTaskPath(id) {
  return `plans/tasks/${normalizeTaskId(id)}.json`;
}

function latestMilestoneId(store) {
  return [...store.milestones.keys()].sort().at(-1) || fail("No structured milestones found.");
}

function normalizeMilestoneId(value) {
  const id = String(value || "").trim().toUpperCase();
  if (/^M\d+$/.test(id)) return id;
  fail(`Invalid milestone id: ${value}. Expected M32 style.`);
}

function normalizeStoryId(value, milestoneId = DEFAULT_MILESTONE) {
  const raw = String(value || "").trim().toUpperCase();
  if (/^M\d+-S\d+$/.test(raw)) return raw;
  if (/^S\d+$/.test(raw)) return `${normalizeMilestoneId(milestoneId)}-${raw}`;
  fail(`Invalid story id: ${value}. Expected S01 or M32-S01.`);
}

function normalizeTaskId(value) {
  const id = String(value || "").trim().toUpperCase();
  if (/^M\d+-S\d+-T\d+$/.test(id)) return id;
  fail(`Invalid task id: ${value}. Expected M32-S01-T01.`);
}

function normalizeDependsOn(value, storyId) {
  const deps = safeArray(value)
    .flatMap((item) => item.split(","))
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item) => item.toLowerCase() !== "none");
  return deps.map((dep) => {
    const upper = dep.toUpperCase();
    if (/^M\d+-S\d+-T\d+$/.test(upper)) return upper;
    if (/^T\d+$/.test(upper)) return `${storyId}-T${String(Number(upper.slice(1))).padStart(2, "0")}`;
    return upper;
  });
}

function normalizeStatus(value) {
  const status = String(value || "").trim().toLowerCase();
  if (TASK_STATUSES.has(status)) return status;
  fail(`Invalid status: ${value}. Expected ${PLAN_STATUSES.join(", ")}.`);
}

function statusTransitionBlockers(from, to) {
  if (from === to) return [];
  const allowed = TASK_TRANSITIONS[from] || [];
  return allowed.includes(to) ? [] : [`Invalid status transition: ${from} -> ${to}.`];
}

function taskBlockers(task, store) {
  const blockers = [...(task.blockedBy || [])];
  for (const depId of task.dependsOn || []) {
    const dep = store.tasks.get(depId);
    if (!dep) blockers.push(`Missing dependency: ${depId}`);
    else if (!["done", "verified", "archived"].includes(dep.status)) blockers.push(`Dependency ${depId} is ${dep.status}.`);
  }
  return blockers;
}

function hasActualEvidence(task) {
  return Boolean(
    task.evidence?.length ||
    task.changedFiles?.length ||
    Object.keys(task.devRecord || {}).length ||
    Object.keys(task.qaRecord || {}).length,
  );
}

function obsoleteStoryTaskPaths(root, storyId, keepIds) {
  const dir = join(root, ".projects", "plans", "tasks");
  if (!existsSync(dir)) return [];
  const obsolete = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile() || (!entry.name.endsWith(".md") && !entry.name.endsWith(".json"))) continue;
    try {
      const content = readFileSync(join(dir, entry.name), "utf8");
      const task = entry.name.endsWith(".json")
        ? normalizeLegacyTask(JSON.parse(content), entry.name.replace(/\.json$/i, ""))
        : parseTaskArtifact(content, `plans/tasks/${entry.name}`);
      if (task.storyId === storyId && !keepIds.has(task.id)) {
        obsolete.push(`plans/tasks/${entry.name}`);
      }
    } catch {
      const id = entry.name.replace(/\.(json|md)$/i, "").toUpperCase();
      if (id.startsWith(`${storyId}-T`) && !keepIds.has(id)) obsolete.push(`plans/tasks/${entry.name}`);
    }
  }
  return obsolete;
}

function resolveUnderRoot(root, inputPath) {
  const absolute = resolve(root, inputPath);
  const rel = relative(resolve(root), absolute);
  if (rel.startsWith("..") || isAbsolute(rel)) fail(`Path must stay inside project root: ${inputPath}`);
  return absolute;
}

function assertSafePlanReport(report) {
  const unsafe = [];
  walkStrings(report, (value) => {
    if (unsafeMemory(value)) unsafe.push(value.slice(0, 80));
  });
  if (unsafe.length) fail(`Unsafe task-store content rejected: ${unsafe[0]}`);
}

function walkStrings(value, visit) {
  if (typeof value === "string") return visit(value);
  if (Array.isArray(value)) {
    for (const item of value) walkStrings(item, visit);
    return;
  }
  if (value && typeof value === "object") {
    for (const item of Object.values(value)) walkStrings(item, visit);
  }
}

function finding(severity, id, message) {
  return { severity, id, message };
}

function safeArray(value) {
  if (!value) return [];
  const array = Array.isArray(value) ? value : [value];
  return array.map((item) => clean(item)).filter(Boolean);
}

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function firstSentence(value) {
  const text = clean(value);
  return text.split(/(?<=[.!?])\s+/)[0]?.slice(0, 120) || "Untitled";
}

function heading(markdown) {
  return markdown.match(/^#\s+(.+?)\s*$/m)?.[1] || "";
}

function firstBullet(markdown) {
  return markdown.match(/^\s*[-*]\s+(.+?)\s*$/m)?.[1] || "";
}

function unique(items) {
  return [...new Set(safeArray(items))];
}
