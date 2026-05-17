import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { readProjectConfig } from "./project-config.mjs";

const ROOT_INSTRUCTION_FILES = ["AGENTS.md", "CLAUDE.md", "GEMINI.md"];
const NOISY_PATTERNS = [
  { pattern: /^## run-/m, reason: "contains run history" },
  { pattern: /\bevents\.jsonl\b/i, reason: "references raw event history" },
  { pattern: /\braw log\b|\bfull log\b|\braw browser content\b/i, reason: "mentions raw logs/browser content" },
  { pattern: /^# taphelu Roadmap/m, reason: "contains roadmap dump" },
  { pattern: /TAPHELU-GENERATED[\s\S]{6000,}/, reason: "generated adapter is too large" },
];

export function inspectInstructionHygiene(root, input = {}) {
  const config = input.config || readProjectConfig(root);
  const budget = config.instructions;
  const targets = instructionTargets(root);
  const checks = targets.map((target) => inspectTarget(target, budget));
  return {
    budget,
    checks,
    status: checks.some((check) => check.status === "WARN") ? "WARN" : "PASS",
  };
}

function instructionTargets(root) {
  const targets = ROOT_INSTRUCTION_FILES.map((name) => ({ path: join(root, name), kind: "root-instruction" }));
  for (const runtimeDir of [".codex", ".claude", ".gemini"]) {
    for (const subdir of ["skills", "agents"]) {
      const dir = join(root, runtimeDir, subdir);
      if (!existsSync(dir)) continue;
      collectMarkdown(dir, targets, "generated-adapter");
    }
  }
  return targets;
}

function collectMarkdown(dir, targets, kind) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      collectMarkdown(path, targets, kind);
    } else if (entry.name.endsWith(".md")) {
      targets.push({ path, kind });
    }
  }
}

function inspectTarget(target, budget) {
  if (!existsSync(target.path)) {
    return {
      ...target,
      status: "SKIP",
      lines: 0,
      chars: 0,
      reason: "File not present.",
    };
  }
  const content = readFileSync(target.path, "utf8");
  const lines = content.trimEnd() ? content.trimEnd().split(/\r?\n/).length : 0;
  const reasons = [];
  if (lines > budget.max_lines) reasons.push(`line budget exceeded (${lines}/${budget.max_lines})`);
  if (content.length > budget.max_chars) reasons.push(`char budget exceeded (${content.length}/${budget.max_chars})`);
  for (const noisy of NOISY_PATTERNS) {
    if (noisy.pattern.test(content)) reasons.push(noisy.reason);
  }
  if (target.kind === "generated-adapter" && !content.includes("TAPHELU-GENERATED")) {
    reasons.push("generated adapter path lacks managed marker");
  }
  return {
    ...target,
    status: reasons.length ? "WARN" : "PASS",
    lines,
    chars: content.length,
    reason: reasons.join("; ") || "Compact instruction file.",
  };
}
