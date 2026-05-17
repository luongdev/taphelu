import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { findProjectRoot, readProjectFile, writeTextFileAtomic } from "../project.mjs";
import { section, replaceSection } from "../utils.mjs";
import { analyzeVerification, recordVerification } from "../commands/verify.mjs";
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
  const root = resolveRoot(args.cwd || serverCwd);

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
      blockers: normalizeArray(args.blocker),
      notes: normalizeArray(args.note),
      evidence: normalizeArray(args.evidence),
      nextAction: args.next_action || "",
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
    return { closed: true, verification, record, nextRoute: "done" };
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
  const recall = query ? recallMemory(root, { query, limit }) : recallMemory(root, { limit: 3 });
  return {
    currentGoal: section(state, "Current Goal") || "",
    currentMilestone: section(state, "Current Milestone") || "",
    currentPhase: section(state, "Current Phase") || "",
    blockers: section(state, "Blockers") || "",
    nextAction: section(state, "Next Action") || "",
    productDecisions: section(memory, "Product Decisions") || "",
    architectureDecisions: section(memory, "Architecture Decisions") || "",
    layeredProfile: section(memory, "Layered Memory Profile") || "",
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

function resolveRoot(cwd) {
  const root = findProjectRoot(cwd);
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
  };
  return aliases[name] || name;
}
