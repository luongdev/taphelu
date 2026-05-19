import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { findProjectRoot, readProjectFile, writeTextFileAtomic } from "../project.mjs";
import { gitRootOrCwd, section, replaceSection } from "../utils.mjs";
import { analyzeVerification, recordVerification } from "../commands/verify.mjs";
import { analyzeContextCleanup, applyContextCleanup, publicContextCleanupSummary } from "../commands/cleanup.mjs";
import { analyzeContractsCheck, analyzeContractsCurrent, analyzeContractsDeps, analyzeContractsInit, analyzeContractsLink, analyzeContractsMap, analyzeContractsScan, analyzeContractsSync, applyContractsInit, applyContractsLink, applyContractsMap, applyContractsScan, applyContractsSync } from "../commands/contracts.mjs";
import { analyzeDeepScanPlan, analyzeProjectScan, analyzeScanInterview, analyzeServiceTopology, applyDeepScanPlan, applyProjectScan, applyScanInterview, applyServiceTopology } from "../commands/scan.mjs";
import { analyzeContextIndex, analyzeMilestoneCompaction, analyzePlanCompaction, analyzeRunsCompaction, applyContextIndex, applyMilestoneCompaction, applyPlanCompaction, applyRunsCompaction, getContextArtifact, publicCompactionSummary, publicContextIndexSummary, readExistingContextIndex, searchContextArtifacts } from "../context-store.mjs";
import { evaluateCrossAiReview } from "../review-policy.mjs";
import { analyzePlanMigration, analyzePlanRender, analyzeStructuredPlanCreate, analyzeTaskStatus, applyPlanMigration, applyPlanRender, applyStructuredPlanCreate, applyTaskStatus, buildDevPacket, buildPlanValidationReport, buildQaPacket, buildTaskListReport, buildTaskShowReport, buildTaskStatusReport, buildUxPacket, getTaskPacket, listTasks, validatePlanStore } from "../task-store.mjs";
import { analyzePlan } from "../commands/plan.mjs";
import {
  captureL0,
  closeSession,
  createL1Memory,
  createL2Scene,
  createSession,
  getMemoryStats,
  mirrorL3ProfileToMemory,
  recallMemory,
  searchConversation,
  upsertL3Profile,
} from "../memory/sqlite.mjs";

export const TAPHELU_MCP_TOOLS = [
  tool("dl_start", "Initialize or resume an agent session and return compact working context.", {
    cwd: stringSchema("Workspace directory. Defaults to server cwd."),
    session_id: stringSchema("Optional stable session id to resume."),
    agent_id: stringSchema("Agent identity, such as codex, claude, or gemini."),
    platform: stringSchema("Host platform. Defaults to mcp."),
    goal: stringSchema("Current goal for this session."),
  }),
  tool("dl_context", "Return compact project context for prompt injection without raw history.", {
    cwd: stringSchema("Workspace directory. Defaults to server cwd."),
    query: stringSchema("Optional recall query to include relevant memory."),
    limit: numberSchema("Maximum memory records per layer."),
  }),
  tool("dl_context_store", "Index, search, fetch, or compact project context artifacts with preview-first writes.", {
    cwd: stringSchema("Workspace directory. Defaults to server cwd."),
    action: stringSchema("Action: index, search, get, or compact."),
    query: stringSchema("Search query for action=search."),
    id: stringSchema("Artifact id for action=get or milestone id for compact kind=milestone."),
    kind: stringSchema("Compaction kind: milestone, runs, or plan."),
    keep: numberSchema("Number of recent runs to keep for compact kind=runs."),
    write: booleanSchema("Whether to write changes. Defaults to false preview."),
    full: booleanSchema("For action=get, return full artifact content instead of a compact preview."),
    start_line: numberSchema("For action=get, first 1-based line to return."),
    end_line: numberSchema("For action=get, last 1-based line to return."),
  }),
  tool("dl_task_store", "Create, render, validate, query, and packetize structured milestone/story/task plans.", {
    cwd: stringSchema("Workspace directory. Defaults to server cwd."),
    action: stringSchema("Action: plan_create, plan_render, plan_validate, task_list, task_get, task_status, dev_packet, qa_packet, ux_packet, or migrate."),
    milestone: stringSchema("Milestone id, e.g. M32."),
    story: stringSchema("Story id or suffix, e.g. S01 or M32-S01."),
    task_id: stringSchema("Task id, e.g. M32-S01-T01."),
    goal: stringSchema("Goal for action=plan_create."),
    status: stringSchema("Task status for action=task_status."),
    set: stringSchema("Task status for action=task_status."),
    from: stringSchema("Legacy plan path for action=migrate."),
    write: booleanSchema("Whether to write changes. Defaults to false preview."),
    task: arraySchema("Task objective strings for action=plan_create."),
    verification: arraySchema("Verification intent per task."),
    context: arraySchema("Context artifact paths for action=plan_create."),
    requirement: arraySchema("Requirements for action=plan_create."),
    research: arraySchema("Research inputs for action=plan_create."),
    constraint: arraySchema("Constraints for action=plan_create."),
    non_goal: arraySchema("Non-goals for action=plan_create."),
    assumption: arraySchema("Assumptions for action=plan_create."),
    risk: arraySchema("Risks for action=plan_create."),
    approval_gate: arraySchema("Approval gates for action=plan_create."),
    owner: arraySchema("Owner role per task."),
    boundary: arraySchema("Ownership boundary per task."),
    depends_on: arraySchema("Dependencies per task."),
    testability: arraySchema("Testability class per task."),
    required_evidence: arraySchema("Required evidence per task."),
    test_effort_reason: arraySchema("Test effort reason per task."),
    testing_strictness: stringSchema("Testing strictness for action=plan_create: low, medium, or deep."),
    json: booleanSchema("Return task packet as structured JSON when applicable."),
  }),
  tool("dl_observe", "Record an agent/user/tool observation into L0 memory.", {
    cwd: stringSchema("Workspace directory. Defaults to server cwd."),
    session_id: stringSchema("Session id returned by dl_start."),
    role: stringSchema("Observation role: user, agent, tool, system."),
    source: stringSchema("Observation source, e.g. user_message, tool_result, checkpoint."),
    content: stringSchema("Observation content to sanitize and store in L0."),
    metadata: objectSchema("Optional structured metadata for the L0 record."),
  }, ["content"]),
  tool("dl_recall", "Recall relevant L1/L2/L3 memory for the current task.", {
    cwd: stringSchema("Workspace directory. Defaults to server cwd."),
    query: stringSchema("Recall query."),
    limit: numberSchema("Maximum memory records per layer."),
  }, ["query"]),
  tool("dl_checkpoint", "Record resumable progress during long-running work.", {
    cwd: stringSchema("Workspace directory. Defaults to server cwd."),
    session_id: stringSchema("Session id returned by dl_start."),
    progress: stringSchema("Compact progress summary."),
    next_action: stringSchema("Next action to restore later."),
  }, ["progress"]),
  tool("dl_close", "Close an agent work unit only after verification passes or passes with notes.", {
    cwd: stringSchema("Workspace directory. Defaults to server cwd."),
    session_id: stringSchema("Session id returned by dl_start."),
    goal: stringSchema("Goal being closed. Defaults to STATE.md current goal."),
    verdict: stringSchema("PASS, PASS_WITH_NOTES, BLOCKED, or FAILED."),
    requirement: arraySchema("Requirement statements verified during closeout."),
    constraint: arraySchema("Constraints checked during closeout."),
    non_goal: arraySchema("Non-goals checked during closeout."),
    artifact: arraySchema("Artifact evidence paths."),
    test: arraySchema("Test or check evidence."),
    browser_check: arraySchema("Browser or E2E check evidence."),
    testing_strictness: stringSchema("Testing strictness used: low, medium, or deep."),
    testability: arraySchema("Task testability review entries."),
    required_evidence: arraySchema("Required evidence entries from QA testability gate."),
    skipped_test_rationale: arraySchema("Rationale for intentionally skipped tests."),
    approval_gate: arraySchema("Approval gates satisfied before closeout."),
    review_trigger: arraySchema("Review triggers."),
    review_evidence: arraySchema("Review evidence."),
    reviewed: booleanSchema("Whether required review has already happened."),
    blocker: arraySchema("Blocking issues."),
    note: arraySchema("Notes."),
    evidence: arraySchema("Additional verification evidence."),
    next_action: stringSchema("Next action if closeout is blocked or needs follow-up."),
    current_runtime: stringSchema("Current AI runtime: codex, claude, or gemini."),
  }),
  tool("dl_cleanup_context", "Preview or write compact project context cleanup after closeout.", {
    cwd: stringSchema("Workspace directory. Defaults to server cwd."),
    limit: numberSchema("Number of RUNS detail sections to keep."),
    write: booleanSchema("Whether to write cleanup. Defaults to false preview."),
  }),
  tool("dl_review_status", "Evaluate permission-gated cross-AI review policy.", {
    cwd: stringSchema("Workspace directory. Defaults to server cwd."),
    current_runtime: stringSchema("Current AI runtime: codex, claude, or gemini."),
    review_trigger: arraySchema("Review triggers such as medium risk, 5 files, MCP, state, security."),
    review_evidence: arraySchema("Review evidence already collected."),
    reviewed: booleanSchema("Whether review has already happened."),
  }),
  tool("dl_scan_project", "Scan an existing project, ask domain interview questions, create deep-scan packets, or map services/contracts without source dumps.", {
    cwd: stringSchema("Workspace directory. Defaults to server cwd."),
    action: stringSchema("Action: scan, interview, plan, or map. Defaults to scan."),
    focus: stringSchema("For action=map: services, contracts, topology, or all. Defaults to all."),
    path: stringSchema("Path under workspace to scan. Defaults to current project root."),
    mode: stringSchema("Scan mode: quick, standard, or deep."),
    write: booleanSchema("Whether to write .projects scan context. Defaults to false preview."),
    domain: stringSchema("Domain/business answer for interview or plan context."),
    user: arraySchema("Primary users, actors, or operators."),
    core_flow: arraySchema("Core workflows that agents should preserve."),
    objective: stringSchema("Scan objective: onboarding, refactor, bugfix, migration, architecture review, testing, etc."),
    contract_source: arraySchema("Source of truth for API/service contracts."),
    restricted_area: arraySchema("Sensitive, generated, off-limits, or low-value areas for deep scan."),
  }),
  tool("dl_contracts", "Manage a shared polyrepo service interaction registry with preview-first init, link, scan, map, check, current, deps, and gated git sync.", {
    cwd: stringSchema("Workspace directory. Defaults to server cwd."),
    action: stringSchema("Action: init, link, scan, map, check, current, deps, or sync. Defaults to check."),
    path: stringSchema("Registry path for init/link/map/check/sync, or service scan path for action=scan/current/deps. Defaults to .projects/contracts for registry actions and . for service actions."),
    contracts_path: stringSchema("Registry path for action=scan/current/deps. Defaults to .projects/contracts."),
    remote: stringSchema("Remote URL for action=init when cloning the registry under .projects/contracts."),
    mode: stringSchema("Service scan mode for action=scan: quick, standard, or deep."),
    service: stringSchema("Service id for action=current/deps. Defaults to current repo service."),
    direction: stringSchema("For action=deps: outbound, inbound, or all."),
    strict: booleanSchema("For action=check: fail on unknown dependencies/providers instead of warning."),
    write: booleanSchema("Whether to write registry files for init/link/scan/map. Defaults to false preview."),
    commit: booleanSchema("Whether action=sync may commit registry changes. Defaults to false preview."),
    push: booleanSchema("Whether action=sync may push after commit. Requires commit=true."),
  }),
  tool("dl_memory_search", "Search L1/L2 structured memory with source IDs.", {
    cwd: stringSchema("Workspace directory. Defaults to server cwd."),
    query: stringSchema("Memory search query."),
    limit: numberSchema("Maximum results per layer."),
  }, ["query"]),
  tool("dl_conversation_search", "Search L0 conversation/observation records for drill-down.", {
    cwd: stringSchema("Workspace directory. Defaults to server cwd."),
    query: stringSchema("Conversation search query."),
    limit: numberSchema("Maximum L0 results."),
  }, ["query"]),
  tool("dl_memory_promote", "Promote source-traceable L0/project evidence into L1/L2/L3 memory.", {
    cwd: stringSchema("Workspace directory. Defaults to server cwd."),
    layer: stringSchema("Target layer: l1, l2, or l3."),
    content: stringSchema("L1/L3 content or L2 summary."),
    source_ids: arraySchema("L0 record IDs or verified artifact IDs."),
    type: stringSchema("L1 memory type."),
    confidence: stringSchema("L1 confidence: low, medium, high."),
    title: stringSchema("L2 scene title."),
    memory_ids: arraySchema("L2 linked L1 memory IDs."),
    key: stringSchema("L3 profile key."),
    metadata: objectSchema("Optional structured metadata for L1 memories."),
    mirror: booleanSchema("Mirror L3 profile into .projects/MEMORY.md."),
  }, ["layer", "content"]),
];

export function listTapheluTools() {
  return TAPHELU_MCP_TOOLS;
}

export function callTapheluTool(name, args = {}, serverCwd = process.cwd()) {
  name = normalizeToolName(name);
  const root = resolveRootForTool(name, args.cwd || serverCwd);

  if (name === "dl_start") {
    const session = createSession(root, {
      sessionId: args.session_id,
      agentId: args.agent_id || "agent",
      platform: args.platform || "mcp",
      workspace: root,
      goal: args.goal || "",
    });
    if (args.goal) {
      captureL0(root, {
        sessionId: session.id,
        role: "system",
        source: "agent_start",
        content: `Agent session started for goal: ${args.goal}`,
      });
    }
    return {
      session,
      context: buildCompactContext(root, args.goal || ""),
      memory: getMemoryStats(root),
      nextRoute: "work",
    };
  }

  if (name === "dl_context") {
    return buildCompactContext(root, args.query || "", args.limit);
  }

  if (name === "dl_observe") {
    const record = captureL0(root, {
      sessionId: args.session_id || "session-default",
      role: args.role || "agent",
      source: args.source || "observation",
      content: args.content,
      metadata: args.metadata || {},
    });
    return { record, nextRoute: "continue" };
  }

  if (name === "dl_recall" || name === "dl_memory_search") {
    return {
      memory: recallMemory(root, { query: args.query, limit: args.limit }),
      nextRoute: "continue",
    };
  }

  if (name === "dl_checkpoint") {
    const content = [
      `Progress: ${args.progress || "No progress supplied."}`,
      args.next_action ? `Next action: ${args.next_action}` : "",
    ].filter(Boolean).join("\n");
    const record = captureL0(root, {
      sessionId: args.session_id || "session-default",
      role: "agent",
      source: "checkpoint",
      content,
    });
    if (args.next_action) {
      updateStateSection(root, "Next Action", args.next_action);
    }
    return { record, nextRoute: "resume_later" };
  }

  if (name === "dl_close") {
    const goal = args.goal || section(readProjectFile(root, "STATE.md"), "Current Goal") || "Close agent work unit.";
    const crossAiReview = evaluateCrossAiReview(root, {
      triggers: normalizeArray(args.review_trigger),
      evidence: normalizeArray(args.review_evidence),
      reviewed: Boolean(args.reviewed || normalizeArray(args.review_evidence).length),
      currentRuntime: args.current_runtime || args.platform || args.agent_id || "codex",
    });
    const verification = analyzeVerification(goal, {
      requirements: normalizeArray(args.requirement),
      constraints: normalizeArray(args.constraint),
      nonGoals: normalizeArray(args.non_goal),
      artifacts: normalizeArray(args.artifact),
      tests: normalizeArray(args.test),
      browserChecks: normalizeArray(args.browser_check),
      testingStrictness: args.testing_strictness || "",
      testabilityReview: normalizeArray(args.testability),
      requiredEvidence: normalizeArray(args.required_evidence),
      skippedTestRationale: normalizeArray(args.skipped_test_rationale),
      approvalGates: normalizeArray(args.approval_gate),
      reviewTriggers: normalizeArray(args.review_trigger),
      reviewEvidence: normalizeArray(args.review_evidence),
      reviewed: Boolean(args.reviewed || normalizeArray(args.review_evidence).length),
      crossAiReview,
      blockers: normalizeArray(args.blocker),
      notes: normalizeArray(args.note),
      evidence: normalizeArray(args.evidence),
      nextAction: args.next_action || "",
      currentNextAction: section(readProjectFile(root, "STATE.md"), "Next Action"),
      overrideVerdict: args.verdict ? normalizeVerdict(args.verdict) : "",
    });
    if (!["PASS", "PASS_WITH_NOTES"].includes(verification.verdict)) {
      const record = captureL0(root, {
        sessionId: args.session_id || "session-default",
        role: "agent",
        source: "close_blocked",
        content: `Close blocked for goal "${goal}" with verdict ${verification.verdict}. Next action: ${verification.nextAction}`,
      });
      return { closed: false, verification, record, nextRoute: verification.nextRoute };
    }
    recordVerification(root, verification, args.session_id || undefined);
    if (args.session_id) closeSession(root, args.session_id);
    const record = captureL0(root, {
      sessionId: args.session_id || "session-default",
      role: "agent",
      source: "close",
      content: `Closed goal "${goal}" with verdict ${verification.verdict}.`,
    });
    return {
      closed: true,
      verification,
      record,
      cleanupRecommendation: publicContextCleanupSummary(analyzeContextCleanup(root, { limit: 5 })),
      contextCompactionRecommendation: {
        command: "dl compact milestone --id <milestone-id> --write",
        mode: "suggest",
        reason: "Closeout passed; compact completed work into indexed context before the next session.",
      },
      nextRoute: "done",
    };
  }

  if (name === "dl_cleanup_context") {
    const report = analyzeContextCleanup(root, { limit: args.limit || 5 });
    if (args.write) applyContextCleanup(root, report);
    return {
      report: publicContextCleanupSummary(report),
      wrote: Boolean(args.write),
      nextRoute: args.write ? "done" : "write_optional",
    };
  }

  if (name === "dl_review_status") {
    return {
      review: evaluateCrossAiReview(root, {
        triggers: normalizeArray(args.review_trigger),
        evidence: normalizeArray(args.review_evidence),
        reviewed: Boolean(args.reviewed),
        currentRuntime: args.current_runtime || "codex",
      }),
      nextRoute: "continue",
    };
  }

  if (name === "dl_context_store") {
    const action = String(args.action || "index").trim() || "index";
    if (action === "index") {
      const report = analyzeContextIndex(root);
      if (args.write) applyContextIndex(root, report);
      return {
        action,
        report: publicContextIndexSummary(report),
        wrote: Boolean(args.write),
        nextRoute: args.write ? "done" : "write_optional",
      };
    }
    if (action === "search") {
      const report = searchContextArtifacts(root, args.query || "");
      return { action, report, nextRoute: report.nextRoute };
    }
    if (action === "get") {
      const report = getContextArtifact(root, args.id || "", {
        full: Boolean(args.full),
        start_line: args.start_line,
        end_line: args.end_line,
      });
      return { action, report, nextRoute: report.nextRoute };
    }
    if (action === "compact") {
      const kind = String(args.kind || "").trim();
      let report;
      if (kind === "milestone") report = analyzeMilestoneCompaction(root, { id: args.id });
      else if (kind === "runs") report = analyzeRunsCompaction(root, { keep: args.keep });
      else if (kind === "plan") report = analyzePlanCompaction(root);
      else userError("Invalid dl_context_store compact kind. Expected milestone, runs, or plan.");
      if (args.write) {
        if (kind === "milestone") applyMilestoneCompaction(root, report);
        if (kind === "runs") applyRunsCompaction(root, report);
        if (kind === "plan") applyPlanCompaction(root, report);
      }
      return {
        action,
        kind,
        report: publicCompactionSummary(report),
        wrote: Boolean(args.write),
        nextRoute: args.write ? "done" : report.nextRoute,
      };
    }
    userError("Invalid dl_context_store action. Expected index, search, get, or compact.");
  }

  if (name === "dl_task_store") {
    const action = String(args.action || "task_list").trim() || "task_list";
    if (action === "plan_create") {
      const goal = String(args.goal || "").trim();
      if (!goal) userError("dl_task_store action=plan_create requires goal.");
      const plan = analyzePlan(goal, {
        contexts: normalizeArray(args.context),
        requirements: normalizeArray(args.requirement),
        research: normalizeArray(args.research),
        tasks: normalizeArray(args.task),
        constraints: normalizeArray(args.constraint),
        nonGoals: normalizeArray(args.non_goal),
        assumptions: normalizeArray(args.assumption),
        risks: normalizeArray(args.risk),
        approvalGates: normalizeArray(args.approval_gate),
        verifications: normalizeArray(args.verification),
        owners: normalizeArray(args.owner),
        boundaries: normalizeArray(args.boundary),
        dependsOn: normalizeArray(args.depends_on || args["depends-on"]),
        testabilities: normalizeArray(args.testability),
        requiredEvidence: normalizeArray(args.required_evidence || args["required-evidence"]),
        testEffortReasons: normalizeArray(args.test_effort_reason || args["test-effort-reason"]),
        testingStrictness: args.testing_strictness || args["testing-strictness"] || "medium",
      });
      const report = analyzeStructuredPlanCreate(root, {
        goal,
        milestone: args.milestone,
        story: args.story,
        plan,
      });
      if (args.write) applyStructuredPlanCreate(root, report);
      return { action, report: compactPlanCreateReport(report), wrote: Boolean(args.write), nextRoute: args.write ? "done" : report.nextRoute };
    }
    if (action === "plan_render") {
      const report = analyzePlanRender(root, { milestone: args.milestone });
      if (args.write) applyPlanRender(root, report);
      return {
        action,
        report: {
          kind: report.kind,
          milestone: compactMilestone(report.milestone),
          storyCount: report.stories.length,
          taskCount: report.tasks.length,
          summary: report.summary,
          nextRoute: report.nextRoute,
        },
        wrote: Boolean(args.write),
        nextRoute: args.write ? "done" : report.nextRoute,
      };
    }
    if (action === "plan_validate") {
      const report = validatePlanStore(root, { milestone: args.milestone });
      return { action, report: { ...report, summary: buildPlanValidationReport(report) }, nextRoute: report.nextRoute };
    }
    if (action === "task_list") {
      const report = listTasks(root, {
        milestone: args.milestone,
        story: args.story,
        status: args.status,
      });
      return {
        action,
        report: {
          kind: report.kind,
          filters: report.filters,
          tasks: report.tasks.map(compactTask),
          summary: buildTaskListReport(report),
          nextRoute: report.nextRoute,
        },
        nextRoute: report.nextRoute,
      };
    }
    if (action === "task_get") {
      const report = getTaskPacket(root, args.task_id || args.id);
      return {
        action,
        report: args.json ? report : compactTaskPacket(report),
        nextRoute: report.nextRoute,
      };
    }
    if (action === "task_status") {
      const report = analyzeTaskStatus(root, args.task_id || args.id, args.set || args.status);
      if (args.write && !report.blockers.length) applyTaskStatus(root, report);
      return {
        action,
        report: args.json ? report : {
          kind: report.kind,
          taskId: report.taskId,
          from: report.from,
          to: report.to,
          blockers: report.blockers,
          summary: buildTaskStatusReport(report, Boolean(args.write && !report.blockers.length)),
          nextRoute: report.nextRoute,
        },
        wrote: Boolean(args.write && !report.blockers.length),
        nextRoute: args.write && !report.blockers.length ? "done" : report.nextRoute,
      };
    }
    if (action === "dev_packet") return { action, packet: buildDevPacket(root, args.task_id || args.id), nextRoute: "implement_task" };
    if (action === "qa_packet") return { action, packet: buildQaPacket(root, args.task_id || args.id), nextRoute: "review_task" };
    if (action === "ux_packet") return { action, packet: buildUxPacket(root, args.task_id || args.id), nextRoute: "verify_ux" };
    if (action === "migrate") {
      const report = analyzePlanMigration(root, {
        from: args.from,
        milestone: args.milestone,
        story: args.story,
      });
      if (args.write) applyPlanMigration(root, report);
      return { action, report, wrote: Boolean(args.write), nextRoute: args.write ? "done" : report.nextRoute };
    }
    userError("Invalid dl_task_store action. Expected plan_create, plan_render, plan_validate, task_list, task_get, task_status, dev_packet, qa_packet, ux_packet, or migrate.");
  }

  if (name === "dl_scan_project") {
    const action = String(args.action || "scan").trim() || "scan";
    if (action === "scan") {
      const report = analyzeProjectScan(root, {
        path: args.path || ".",
        mode: args.mode || "standard",
      });
      if (args.write) applyProjectScan(root, report);
      return {
        action,
        report,
        wrote: Boolean(args.write),
        nextRoute: report.nextRoute,
      };
    }
    if (action === "interview") {
      const report = analyzeScanInterview(root, args);
      if (args.write) applyScanInterview(root, report);
      return {
        action,
        report,
        wrote: Boolean(args.write),
        nextRoute: report.nextRoute,
      };
    }
    if (action === "plan") {
      const report = analyzeDeepScanPlan(root, args);
      if (args.write) applyDeepScanPlan(root, report);
      return {
        action,
        report,
        wrote: Boolean(args.write),
        nextRoute: report.nextRoute,
      };
    }
    if (action === "map") {
      const report = analyzeServiceTopology(root, args);
      if (args.write) applyServiceTopology(root, report);
      return {
        action,
        report,
        wrote: Boolean(args.write),
        nextRoute: report.nextRoute,
      };
    }
    userError("Invalid dl_scan_project action. Expected scan, interview, plan, or map.");
  }

  if (name === "dl_contracts") {
    const action = String(args.action || "check").trim() || "check";
    const input = {
      ...args,
      path: args.path || (action === "scan" || action === "current" || action === "deps" ? "." : ".projects/contracts"),
      "contracts-path": args.contracts_path || args["contracts-path"] || ".projects/contracts",
    };
    if (action === "init") {
      const report = analyzeContractsInit(root, input);
      if (args.write) applyContractsInit(root, report);
      return { action, report, wrote: Boolean(args.write), nextRoute: report.nextRoute };
    }
    if (action === "link") {
      const report = analyzeContractsLink(root, input);
      if (args.write) applyContractsLink(root, report);
      return { action, report, wrote: Boolean(args.write), nextRoute: report.nextRoute };
    }
    if (action === "scan") {
      const report = analyzeContractsScan(root, input);
      if (args.write) applyContractsScan(root, report);
      return { action, report, wrote: Boolean(args.write), nextRoute: report.nextRoute };
    }
    if (action === "map") {
      const report = analyzeContractsMap(root, input);
      if (args.write) applyContractsMap(root, report);
      return { action, report, wrote: Boolean(args.write), nextRoute: report.nextRoute };
    }
    if (action === "check") {
      const report = analyzeContractsCheck(root, input);
      return { action, report, nextRoute: report.nextRoute };
    }
    if (action === "current") {
      const report = analyzeContractsCurrent(root, input);
      return { action, report, nextRoute: report.nextRoute };
    }
    if (action === "deps") {
      const report = analyzeContractsDeps(root, input);
      return { action, report, nextRoute: report.nextRoute };
    }
    if (action === "sync") {
      if (args.push && !args.commit) userError("dl_contracts action=sync requires commit=true when push=true.");
      const report = analyzeContractsSync(root, input);
      if (args.commit || args.push) applyContractsSync(root, report);
      return {
        action,
        report,
        wrote: Boolean(args.commit || args.push),
        nextRoute: report.nextRoute,
      };
    }
    userError("Invalid dl_contracts action. Expected init, link, scan, map, check, current, deps, or sync.");
  }

  if (name === "dl_conversation_search") {
    return {
      records: searchConversation(root, { query: args.query, limit: args.limit }),
      nextRoute: "continue",
    };
  }

  if (name === "dl_memory_promote") {
    return promoteMemory(root, args);
  }

  userError(`Unknown dl MCP tool: ${name}`);
}

export function buildCompactContext(root, query = "", limit = 5) {
  const state = readProjectFile(root, "STATE.md");
  const memory = readProjectFile(root, "MEMORY.md");
  const codebase = readProjectFile(root, "CODEBASE.md");
  const contextDocument = readProjectFile(root, "CONTEXT.md");
  const contextIndex = readExistingContextIndex(root) || { artifacts: [] };
  const recall = query ? recallMemory(root, { query, limit }) : recallMemory(root, { limit: 3 });
  return {
    contextDocument,
    contextArtifacts: contextIndex.artifacts.slice(0, 12),
    currentGoal: section(state, "Current Goal") || "",
    currentMilestone: section(state, "Current Milestone") || "",
    currentPhase: section(state, "Current Phase") || "",
    blockers: section(state, "Blockers") || "",
    nextAction: section(state, "Next Action") || "",
    productDecisions: section(memory, "Product Decisions") || "",
    architectureDecisions: section(memory, "Architecture Decisions") || "",
    layeredProfile: section(memory, "Layered Memory Profile") || "",
    codebaseSummary: section(codebase, "Summary") || "",
    codebaseStack: section(codebase, "Stack") || "",
    recall,
  };
}

function promoteMemory(root, args) {
  const layer = String(args.layer || "").toLowerCase();
  if (layer === "l1") {
    const memory = createL1Memory(root, {
      content: args.content,
      sourceIds: normalizeArray(args.source_ids),
      type: args.type || "fact",
      confidence: args.confidence || "medium",
      metadata: args.metadata || {},
    });
    return { memory, nextRoute: "continue" };
  }
  if (layer === "l2") {
    const scene = createL2Scene(root, {
      title: args.title || "Workflow scene",
      summary: args.content,
      sourceIds: normalizeArray(args.source_ids),
      memoryIds: normalizeArray(args.memory_ids),
    });
    return { scene, nextRoute: "continue" };
  }
  if (layer === "l3") {
    const profile = upsertL3Profile(root, {
      key: args.key || "profile",
      content: args.content,
      sourceIds: normalizeArray(args.source_ids),
    });
    const mirrored = args.mirror ? mirrorL3ProfileToMemory(root) : [];
    return { profile, mirrored, nextRoute: "continue" };
  }
  userError("Invalid memory layer. Expected l1, l2, or l3.");
}

function updateStateSection(root, heading, body) {
  const path = join(root, ".projects", "STATE.md");
  if (!existsSync(path)) return;
  const content = readFileSync(path, "utf8");
  writeTextFileAtomic(path, replaceSection(content, heading, body));
}

function resolveRootForTool(name, cwd) {
  const root = findProjectRoot(cwd);
  if (!root && name === "dl_scan_project") return cwd;
  if (!root && name === "dl_contracts") return gitRootOrCwd(cwd);
  if (!root) userError("No .projects/PROJECT.md found from current directory upward.");
  return root;
}

function normalizeVerdict(verdict) {
  const normalized = String(verdict).trim().toUpperCase().replaceAll("-", "_");
  if (["PASS", "PASS_WITH_NOTES", "BLOCKED", "FAILED"].includes(normalized)) return normalized;
  userError(`Invalid verdict: ${verdict}. Expected PASS, PASS_WITH_NOTES, BLOCKED, or FAILED.`);
}

function userError(message) {
  throw new Error(message);
}

function tool(name, description, properties, required = []) {
  return {
    name,
    description,
    inputSchema: {
      type: "object",
      properties,
      required,
      additionalProperties: true,
    },
  };
}

function stringSchema(description) {
  return { type: "string", description };
}

function numberSchema(description) {
  return { type: "number", description };
}

function booleanSchema(description) {
  return { type: "boolean", description };
}

function objectSchema(description) {
  return {
    type: "object",
    additionalProperties: true,
    description,
  };
}

function arraySchema(description) {
  return {
    type: "array",
    items: { type: "string" },
    description,
  };
}

function normalizeArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  return [String(value).trim()].filter(Boolean);
}

function compactPlanCreateReport(report) {
  return {
    kind: report.kind,
    milestone: compactMilestone(report.milestone),
    story: compactStory(report.story),
    tasks: report.tasks.map(compactTask),
    files: report.files,
    nextRoute: report.nextRoute,
  };
}

function compactTaskPacket(packet) {
  return {
    kind: packet.kind,
    task: compactTask(packet.task),
    story: compactStory(packet.story),
    milestone: compactMilestone(packet.milestone),
    dependencies: (packet.dependencies || []).map(compactTask),
    blockers: packet.blockers || [],
    summary: buildTaskShowReport(packet),
    nextRoute: packet.nextRoute,
  };
}

function compactMilestone(milestone) {
  if (!milestone) return null;
  return {
    id: milestone.id,
    title: milestone.title,
    status: milestone.status,
    storyIds: milestone.storyIds || [],
    updatedAt: milestone.updatedAt,
  };
}

function compactStory(story) {
  if (!story) return null;
  return {
    id: story.id,
    title: story.title,
    status: story.status,
    milestoneId: story.milestoneId,
    taskIds: story.taskIds || [],
    acceptanceCriteriaCount: story.acceptanceCriteria?.length || 0,
    updatedAt: story.updatedAt,
  };
}

function compactTask(task) {
  if (!task) return null;
  return {
    id: task.id,
    title: task.title,
    status: task.status,
    milestoneId: task.milestoneId,
    storyId: task.storyId,
    owner: task.owner,
    parallelGroup: task.parallelGroup || "main",
    dependsOn: task.dependsOn || [],
    blockedBy: task.blockedBy || [],
    testability: task.testability,
    risk: task.risk,
    acceptanceCriteriaCount: task.acceptanceCriteria?.length || 0,
    requiredEvidenceCount: task.requiredEvidence?.length || 0,
    changedFilesCount: task.changedFiles?.length || 0,
    evidenceCount: task.evidence?.length || 0,
    updatedAt: task.updatedAt,
  };
}

function normalizeToolName(name) {
  const aliases = {
    taphelu_start: "dl_start",
    taphelu_context: "dl_context",
    taphelu_observe: "dl_observe",
    taphelu_recall: "dl_recall",
    taphelu_checkpoint: "dl_checkpoint",
    taphelu_close: "dl_close",
    taphelu_memory_search: "dl_memory_search",
    taphelu_conversation_search: "dl_conversation_search",
    taphelu_memory_promote: "dl_memory_promote",
    taphelu_cleanup_context: "dl_cleanup_context",
    taphelu_context_store: "dl_context_store",
    taphelu_task_store: "dl_task_store",
    taphelu_review_status: "dl_review_status",
    taphelu_scan_project: "dl_scan_project",
    taphelu_contracts: "dl_contracts",
  };
  return aliases[name] || name;
}
