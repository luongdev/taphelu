import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fail } from "./errors.mjs";
import { writeTextFileAtomic } from "./project.mjs";

export const TESTING_STRICTNESS_LEVELS = ["low", "medium", "deep"];

export const DEFAULT_PROJECT_CONFIG = {
  testing: {
    strictness: "medium",
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
  if (key !== "testing.strictness") {
    fail(`Unsupported config key: ${key}. Supported keys: testing.strictness.`);
  }
  const config = readProjectConfig(root);
  config.testing.strictness = parseTestingStrictness(value);
  return writeProjectConfig(root, config);
}

export function testingStrictness(root, override = "") {
  return parseTestingStrictness(override || readProjectConfig(root).testing.strictness);
}

export function parseTestingStrictness(value) {
  if (TESTING_STRICTNESS_LEVELS.includes(value)) return value;
  fail(`Invalid testing.strictness: ${value}. Expected low, medium, or deep.`);
}

function normalizeProjectConfig(config = {}) {
  const strictness = parseTestingStrictness(config.testing?.strictness || DEFAULT_PROJECT_CONFIG.testing.strictness);
  return {
    testing: {
      strictness,
    },
  };
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
