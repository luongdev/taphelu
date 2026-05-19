#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const input = readJsonStdin();
const cwd = input.workspace?.current_dir || input.cwd || process.cwd();
const root = findProjectRoot(cwd);
const runtime = runtimeSummary(input);

if (!root) {
  console.log(["taphelu", runtime, "project:none"].filter(Boolean).join(" | "));
  process.exit(0);
}

const state = readSections(path.join(root, ".projects", "STATE.md"));
const roadmap = currentRoadmapStatus(root);
const stateMilestone = summarizeMilestone(firstLine(state["Current Milestone"] || ""));
const milestone = selectMilestone(stateMilestone, roadmap?.milestone);
const stateIsStale = isStateStale(stateMilestone, roadmap?.milestone || "");
const current = summarizeCurrentState({
  stateMilestone,
  roadmapMilestone: roadmap?.milestone || "",
  phase: firstLine(state["Current Phase"] || state["Current Goal"] || "unknown"),
  roadmapStatus: roadmap?.status || "",
});
const next = summarizeNext(firstLine((stateIsStale ? roadmap?.next : state["Next Action"]) || roadmap?.next || "no next action"));
const dirty = gitDirty(root) ? "dirty" : "clean";

console.log([
  "taphelu",
  runtime,
  milestone,
  current,
  `next:${next}`,
  `git:${dirty}`,
].filter(Boolean).join(" | "));

function readJsonStdin() {
  if (process.stdin.isTTY) return {};
  try {
    const raw = fs.readFileSync(0, "utf8").trim();
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function readSections(file) {
  if (!fs.existsSync(file)) return {};
  const sections = {};
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
  let current = "";
  for (const line of lines) {
    const heading = /^##\s+(.+)$/.exec(line);
    if (heading) {
      current = heading[1].trim();
      sections[current] = "";
    } else if (current) {
      sections[current] += `${line}\n`;
    }
  }
  return sections;
}

function firstLine(text) {
  return String(text).split(/\r?\n/).map((line) => line.trim()).find(Boolean) || "unknown";
}

function runtimeSummary(payload) {
  return [
    modelSummary(payload),
    effortSummary(payload),
    contextWindowSummary(payload),
  ].filter(Boolean).join(" ");
}

function modelSummary(payload) {
  const raw = payload.model?.display_name || payload.model?.id || payload.model || process.env.CLAUDE_MODEL || "?";
  return `model:${shortModel(raw)}`;
}

function shortModel(value) {
  const text = String(value || "?").trim();
  if (!text || text === "?") return "?";
  const lower = text.toLowerCase();
  const family = lower.includes("opus") ? "opus"
    : lower.includes("sonnet") ? "sonnet"
      : lower.includes("haiku") ? "haiku"
        : lower.includes("claude") ? "claude"
          : text;
  const version = lower.match(/\b([0-9]+(?:[.-][0-9]+)?)\b/)?.[1]?.replace("-", ".");
  if (typeof family === "string" && ["opus", "sonnet", "haiku", "claude"].includes(family)) {
    return version ? `${family}-${version}` : family;
  }
  return truncate(text.replace(/^claude[-\s]*/i, ""), 18);
}

function effortSummary(payload) {
  const level = payload.effort?.level || payload.reasoning_effort || payload.reasoningEffort;
  return level ? `effort:${String(level).toLowerCase()}` : "";
}

function contextWindowSummary(payload) {
  const window = payload.context_window || payload.contextWindow || {};
  const used = finiteNumber(window.used_percentage ?? window.usedPercentage);
  if (used != null) return `ctx:${formatPercent(used)}`;
  const remaining = finiteNumber(window.remaining_percentage ?? window.remainingPercentage);
  if (remaining != null) return `ctx:${formatPercent(100 - remaining)}`;
  const currentUsage = window.current_usage || window.currentUsage || {};
  const size = finiteNumber(window.context_window_size ?? window.contextWindowSize);
  const inputTokens = [
    currentUsage.input_tokens,
    currentUsage.cache_creation_input_tokens,
    currentUsage.cache_read_input_tokens,
  ].map(finiteNumber).filter((value) => value != null).reduce((sum, value) => sum + value, 0);
  if (size && inputTokens) return `ctx:~${formatPercent((inputTokens / size) * 100)}`;
  return "ctx:?";
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function formatPercent(value) {
  const clamped = Math.max(0, Math.min(999, value));
  if (clamped < 10 && !Number.isInteger(clamped)) return `${clamped.toFixed(1)}%`;
  return `${Math.round(clamped)}%`;
}

function summarizeMilestone(value) {
  const match = /\bMilestone\s+(\d+)\b/i.exec(value);
  return match ? `M${match[1]}` : "";
}

function selectMilestone(stateMilestone, roadmapMilestone) {
  const stateNumber = milestoneNumber(stateMilestone);
  const roadmapNumber = milestoneNumber(roadmapMilestone);
  if (roadmapNumber && (!stateNumber || roadmapNumber >= stateNumber)) return roadmapMilestone;
  return stateMilestone || roadmapMilestone || "";
}

function summarizeCurrentState({ stateMilestone, roadmapMilestone, phase, roadmapStatus }) {
  if (isStateStale(stateMilestone, roadmapMilestone)) {
    return `state:stale:${stateMilestone}`;
  }
  if (roadmapStatus && /current|active|next/i.test(roadmapStatus)) return `status:${cleanStateText(roadmapStatus).replace(/[.。]+$/g, "").toLowerCase()}`;
  return `phase:${summarizePhase(phase)}`;
}

function isStateStale(stateMilestone, roadmapMilestone) {
  const stateNumber = milestoneNumber(stateMilestone);
  const roadmapNumber = milestoneNumber(roadmapMilestone);
  return Boolean(roadmapNumber && stateNumber && roadmapNumber > stateNumber);
}

function milestoneNumber(label) {
  return Number.parseInt(/^M(\d+)$/i.exec(label || "")?.[1] || "", 10) || 0;
}

function summarizePhase(value) {
  const text = cleanStateText(value);
  const verdict = /\b(PASS_WITH_NOTES|PASS|BLOCKED|FAILED)\b/i.exec(text)?.[1]?.toLowerCase();
  if (/\bverify\b/i.test(text) && verdict) return `verify:${verdict.replace("pass_with_notes", "notes")}`;
  if (/\brun\b/i.test(text) && verdict) return `run:${verdict.replace("pass_with_notes", "notes")}`;
  return truncate(text, 32);
}

function summarizeNext(value) {
  const text = cleanStateText(value)
    .replace(/\bComplete Milestone\s+(\d+)\s+with\b/i, "M$1")
    .replace(/\bMilestone\s+(\d+)\b/i, "M$1")
    .replace(/\breview evidence is recorded\b/i, "review")
    .replace(/\bClose the run after\b/i, "close after")
    .replace(/\bNo next action\b/i, "none");
  return truncate(text, 28);
}

function cleanStateText(value) {
  return String(value || "unknown")
    .replace(/[`$]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function currentRoadmapStatus(rootPath) {
  const roadmapPath = path.join(rootPath, ".projects", "ROADMAP.md");
  if (!fs.existsSync(roadmapPath)) return null;
  const text = fs.readFileSync(roadmapPath, "utf8");
  const sections = [...text.matchAll(/^##\s+Milestone\s+(\d+):\s*(.+)$/gim)].map((match, index, all) => {
    const start = match.index + match[0].length;
    const end = all[index + 1]?.index ?? text.length;
    const body = text.slice(start, end);
    return {
      milestone: `M${match[1]}`,
      title: match[2].trim(),
      status: /^Status:\s*(.+)$/im.exec(body)?.[1]?.trim() || "",
      next: currentRecommendedNext(text),
    };
  });
  const explicit = sections.find((section) => /current|active|next/i.test(section.status));
  if (explicit) return explicit;
  for (let index = 0; index < sections.length; index += 1) {
    if (!/implemented/i.test(sections[index].status)) return sections[index];
  }
  return null;
}

function currentRecommendedNext(markdown) {
  const match = /^##\s+Current Recommended Next Step\s*$/im.exec(markdown);
  if (!match) return "";
  const rest = markdown.slice(match.index + match[0].length);
  const nextHeading = /^##\s+/m.exec(rest);
  return firstLine(nextHeading ? rest.slice(0, nextHeading.index) : rest);
}

function truncate(value, limit) {
  const text = String(value || "unknown");
  return text.length <= limit ? text : `${text.slice(0, Math.max(0, limit - 1))}…`;
}

function gitDirty(root) {
  try {
    return execFileSync("git", ["status", "--short"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 1000 }).trim().length > 0;
  } catch {
    return false;
  }
}

function findProjectRoot(start) {
  let current = path.resolve(start || process.cwd());
  while (true) {
    if (fs.existsSync(path.join(current, ".projects", "PROJECT.md"))) return current;
    const parent = path.dirname(current);
    if (parent === current) return "";
    current = parent;
  }
}
