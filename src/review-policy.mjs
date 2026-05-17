import { readProjectConfig } from "./project-config.mjs";
import { formatList } from "./utils.mjs";

const MEDIUM_PLUS_PATTERNS = [
  /\bmedium\b/i,
  /\bhigh\b/i,
  /\brisk\b/i,
  /\b5\s*files?\b/i,
  /\b[5-9]\s*files?\b/i,
  /\b\d{2,}\s*files?\b/i,
  /\b3\s*commits?\b/i,
  /\bseveral\s+commits?\b/i,
  /\bmany\b/i,
  /\bcontract\b/i,
  /\bstate\b/i,
  /\bsecurity\b/i,
  /\bmcp\b/i,
  /\binstaller\b/i,
  /\bconfig\b/i,
  /\bschema\b/i,
  /\bruntime\b/i,
  /\bmemory\b/i,
];

const LARGE_ONLY_PATTERNS = [
  /\blarge\b/i,
  /\bstory\b/i,
  /\bphase\b/i,
  /\bmajor\b/i,
  /\bwide\b/i,
  /\b10\s*files?\b/i,
  /\b\d{2,}\s*files?\b/i,
];

export function evaluateCrossAiReview(root, input = {}) {
  const config = input.config || readProjectConfig(root);
  const level = input.level || config.review.cross_ai.level;
  const triggers = normalizeArray(input.triggers);
  const evidence = normalizeArray(input.evidence);
  const reviewed = Boolean(input.reviewed || evidence.length);
  const currentRuntime = input.currentRuntime || "codex";
  const explicitRequest = triggers.length > 0;
  const required = reviewRequired(level, triggers);
  const reviewers = recommendedReviewers(config, currentRuntime);
  let status = "not-required";

  if (level === "off") {
    status = "skipped";
  } else if (reviewed) {
    status = "completed";
  } else if (required && reviewers.length) {
    status = "requested";
  } else if (required) {
    status = "blocked";
  }

  return {
    level,
    status,
    required,
    explicitRequest,
    currentRuntime,
    triggers,
    reviewers,
    evidence,
    reviewed,
    permissionPrompt: buildPermissionPrompt(currentRuntime, reviewers),
    closeout: closeoutLine({ level, status, required, reviewers, evidence, reviewed }),
  };
}

export function buildReviewPolicyReport(root, input = {}) {
  const policy = evaluateCrossAiReview(root, input);
  const reviewers = policy.reviewers.length
    ? policy.reviewers.map((item) => `- ${item.runtime}: model=${item.model}${item.effort ? `, effort=${item.effort}` : ""}`).join("\n")
    : "- No enabled cross-AI reviewers for this runtime.";

  return `# Cross-AI Review Policy

## Level

\`${policy.level}\`

## Status

\`${policy.status}\`

## Current Runtime

\`${policy.currentRuntime}\`

## Triggers

${formatList(policy.triggers, "None.")}

## Recommended Reviewers

${reviewers}

## Permission Prompt

${policy.permissionPrompt || "No cross-AI review permission needed."}

## Closeout

${policy.closeout}
`;
}

export function reviewRequired(level, triggers = []) {
  if (level === "off") return false;
  if (level === "always") return true;
  if (level === "requested-only") return triggers.length > 0;
  if (level === "large-only") return matchesAny(triggers, LARGE_ONLY_PATTERNS);
  return matchesAny(triggers, MEDIUM_PLUS_PATTERNS) || matchesAny(triggers, LARGE_ONLY_PATTERNS);
}

function recommendedReviewers(config, currentRuntime) {
  return Object.entries(config.review.cross_ai.reviewers)
    .filter(([runtime, reviewer]) => runtime !== currentRuntime && reviewer.enabled)
    .map(([runtime, reviewer]) => ({
      runtime,
      model: reviewer.model,
      effort: runtime === "gemini" ? "" : reviewer.effort || "medium",
    }));
}

function buildPermissionPrompt(currentRuntime, reviewers) {
  if (!reviewers.length) return "";
  const names = reviewers.map((item) => `${item.runtime} (${item.model}${item.effort ? `, ${item.effort}` : ""})`).join(", ");
  return `Current runtime is ${currentRuntime}. Ask whether cross-AI review may run with: ${names}.`;
}

function closeoutLine(policy) {
  if (policy.status === "completed") return `Cross-AI review completed with evidence: ${policy.evidence.join("; ") || "marked reviewed"}.`;
  if (policy.status === "requested") return `Cross-AI review requested; ask permission before invoking ${policy.reviewers.map((item) => item.runtime).join(", ")}.`;
  if (policy.status === "blocked") return "Cross-AI review required but no enabled reviewer is configured.";
  if (policy.status === "skipped") return `Cross-AI review skipped by level=${policy.level}.`;
  return "Cross-AI review not required by current policy.";
}

function matchesAny(values, patterns) {
  return values.some((value) => patterns.some((pattern) => pattern.test(String(value))));
}

function normalizeArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  return [String(value).trim()].filter(Boolean);
}
