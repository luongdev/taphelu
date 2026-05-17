import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fail } from "./errors.mjs";
import { writeTextFileAtomic } from "./project.mjs";

export const TESTING_STRICTNESS_LEVELS = ["low", "medium", "deep"];
export const CROSS_AI_REVIEW_LEVELS = ["off", "requested-only", "medium-plus", "large-only", "always"];
export const REVIEW_RUNTIMES = ["codex", "claude", "gemini"];

export const DEFAULT_PROJECT_CONFIG = {
  testing: {
    strictness: "medium",
  },
  review: {
    cross_ai: {
      level: "medium-plus",
      reviewers: {
        codex: { enabled: false, model: "gpt-5.4", effort: "medium" },
        claude: { enabled: true, model: "claude-sonnet", effort: "medium" },
        gemini: { enabled: true, model: "gemini-3.1-pro-preview" },
      },
    },
  },
  instructions: {
    max_lines: 80,
    max_chars: 6000,
  },
};

export function readProjectConfig(root) {
  const path = configPath(root);
  if (!existsSync(path)) return cloneDefaultConfig();
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    fail(`Invalid .projects/config.json: ${error.message}`);
  }
  return normalizeProjectConfig(parsed);
}

export function writeProjectConfig(root, config) {
  const normalized = normalizeProjectConfig(config);
  writeTextFileAtomic(configPath(root), `${JSON.stringify(normalized, null, 2)}\n`);
  return normalized;
}

export function getProjectConfigValue(root, key) {
  return getNested(readProjectConfig(root), key);
}

export function setProjectConfigValue(root, key, value) {
  const config = readProjectConfig(root);
  applyConfigValue(config, key, value);
  return writeProjectConfig(root, config);
}

export function testingStrictness(root, override = "") {
  return parseTestingStrictness(override || readProjectConfig(root).testing.strictness);
}

export function parseTestingStrictness(value) {
  if (TESTING_STRICTNESS_LEVELS.includes(value)) return value;
  fail(`Invalid testing.strictness: ${value}. Expected low, medium, or deep.`);
}

export function parseCrossAiReviewLevel(value) {
  if (CROSS_AI_REVIEW_LEVELS.includes(value)) return value;
  fail(`Invalid review.cross_ai.level: ${value}. Expected ${CROSS_AI_REVIEW_LEVELS.join(", ")}.`);
}

function normalizeProjectConfig(config = {}) {
  const strictness = parseTestingStrictness(config.testing?.strictness || DEFAULT_PROJECT_CONFIG.testing.strictness);
  const level = parseCrossAiReviewLevel(config.review?.cross_ai?.level || DEFAULT_PROJECT_CONFIG.review.cross_ai.level);
  const reviewers = {};
  for (const runtime of REVIEW_RUNTIMES) {
    const defaults = DEFAULT_PROJECT_CONFIG.review.cross_ai.reviewers[runtime];
    const supplied = config.review?.cross_ai?.reviewers?.[runtime] || {};
    reviewers[runtime] = normalizeReviewerConfig(runtime, defaults, supplied);
  }
  return {
    testing: {
      strictness,
    },
    review: {
      cross_ai: {
        level,
        reviewers,
      },
    },
    instructions: {
      max_lines: parsePositiveInteger(config.instructions?.max_lines ?? DEFAULT_PROJECT_CONFIG.instructions.max_lines, "instructions.max_lines"),
      max_chars: parsePositiveInteger(config.instructions?.max_chars ?? DEFAULT_PROJECT_CONFIG.instructions.max_chars, "instructions.max_chars"),
    },
  };
}

function applyConfigValue(config, key, value) {
  if (key === "testing.strictness") {
    config.testing.strictness = parseTestingStrictness(value);
    return;
  }
  if (key === "review.cross_ai.level") {
    config.review.cross_ai.level = parseCrossAiReviewLevel(value);
    return;
  }
  if (key === "instructions.max_lines") {
    config.instructions.max_lines = parsePositiveInteger(value, key);
    return;
  }
  if (key === "instructions.max_chars") {
    config.instructions.max_chars = parsePositiveInteger(value, key);
    return;
  }
  const reviewerMatch = key.match(/^review\.cross_ai\.reviewers\.(codex|claude|gemini)\.(enabled|model|effort)$/);
  if (reviewerMatch) {
    const [, runtime, field] = reviewerMatch;
    if (field === "enabled") {
      config.review.cross_ai.reviewers[runtime].enabled = parseBoolean(value, key);
    } else {
      config.review.cross_ai.reviewers[runtime][field] = String(value).trim();
    }
    return;
  }
  fail(`Unsupported config key: ${key}. Supported keys: testing.strictness, review.cross_ai.level, review.cross_ai.reviewers.<codex|claude|gemini>.<enabled|model|effort>, instructions.max_lines, instructions.max_chars.`);
}

function getNested(config, key = "") {
  if (!key) return config;
  return key.split(".").reduce((value, part) => value?.[part], config);
}

function cloneDefaultConfig() {
  return JSON.parse(JSON.stringify(DEFAULT_PROJECT_CONFIG));
}

function configPath(root) {
  return join(root, ".projects", "config.json");
}

function normalizeReviewerConfig(runtime, defaults, supplied) {
  const reviewer = {
    enabled: typeof supplied.enabled === "boolean" ? supplied.enabled : defaults.enabled,
    model: String(supplied.model || defaults.model || "").trim(),
  };
  if (runtime !== "gemini") {
    reviewer.effort = String(supplied.effort || defaults.effort || "medium").trim();
  }
  return reviewer;
}

function parsePositiveInteger(value, key) {
  if (!/^[1-9]\d*$/.test(String(value))) {
    fail(`Invalid ${key}: ${value}. Expected a positive integer.`);
  }
  return Number.parseInt(value, 10);
}

function parseBoolean(value, key) {
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  fail(`Invalid ${key}: ${value}. Expected true or false.`);
}
