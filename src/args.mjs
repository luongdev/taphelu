import { fail } from "./errors.mjs";

export function parseArgs(args) {
  const options = {};
  const values = [];

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--write") {
      options.write = true;
      continue;
    }
    if (arg === "--commit") {
      options.commit = true;
      continue;
    }
    if (arg === "--push") {
      options.push = true;
      continue;
    }
    if (arg === "--strict") {
      options.strict = true;
      continue;
    }
    if (arg === "--dry-run") {
      options["dry-run"] = true;
      continue;
    }
    if (arg === "--live") {
      options.live = true;
      continue;
    }
    if (arg === "--full") {
      options.full = true;
      continue;
    }
    if (arg.startsWith("--start-line=")) {
      options["start-line"] = arg.slice("--start-line=".length);
      continue;
    }
    if (arg === "--start-line") {
      options["start-line"] = requiredValue(args, i, arg);
      i += 1;
      continue;
    }
    if (arg.startsWith("--end-line=")) {
      options["end-line"] = arg.slice("--end-line=".length);
      continue;
    }
    if (arg === "--end-line") {
      options["end-line"] = requiredValue(args, i, arg);
      i += 1;
      continue;
    }
    if (arg === "--global") {
      options.scope = "global";
      continue;
    }
    if (arg === "--local") {
      options.scope = "local";
      continue;
    }
    if (arg.startsWith("--runtime=")) {
      options.runtime = arg.slice("--runtime=".length);
      continue;
    }
    if (arg === "--runtime") {
      options.runtime = requiredValue(args, i, arg);
      i += 1;
      continue;
    }
    if (arg.startsWith("--config-dir=")) {
      options["config-dir"] = arg.slice("--config-dir=".length);
      continue;
    }
    if (arg === "--config-dir") {
      options["config-dir"] = requiredValue(args, i, arg);
      i += 1;
      continue;
    }
    if (arg.startsWith("--profile=")) {
      options.profile = arg.slice("--profile=".length);
      continue;
    }
    if (arg === "--profile") {
      options.profile = requiredValue(args, i, arg);
      i += 1;
      continue;
    }
    if (arg.startsWith("--hooks=")) {
      options.hooks = arg.slice("--hooks=".length);
      continue;
    }
    if (arg === "--hooks") {
      options.hooks = requiredValue(args, i, arg);
      i += 1;
      continue;
    }
    if (arg.startsWith("--statusline=")) {
      options.statusline = arg.slice("--statusline=".length);
      continue;
    }
    if (arg === "--statusline") {
      options.statusline = requiredValue(args, i, arg);
      i += 1;
      continue;
    }
    if (arg.startsWith("--id=")) {
      options.id = arg.slice("--id=".length);
      continue;
    }
    if (arg === "--id") {
      options.id = requiredValue(args, i, arg);
      i += 1;
      continue;
    }
    if (arg.startsWith("--keep=")) {
      options.keep = arg.slice("--keep=".length);
      continue;
    }
    if (arg === "--keep") {
      options.keep = requiredValue(args, i, arg);
      i += 1;
      continue;
    }
    if (arg.startsWith("--mode=")) {
      options.mode = arg.slice("--mode=".length);
      continue;
    }
    if (arg === "--mode") {
      options.mode = requiredValue(args, i, arg);
      i += 1;
      continue;
    }
    if (arg.startsWith("--approval-scope=")) {
      options["approval-scope"] = arg.slice("--approval-scope=".length);
      continue;
    }
    if (arg === "--approval-scope") {
      options["approval-scope"] = requiredValue(args, i, arg);
      i += 1;
      continue;
    }
    if (arg.startsWith("--context=")) {
      pushOption(options, "context", arg.slice("--context=".length));
      continue;
    }
    if (arg === "--context") {
      pushOption(options, "context", requiredValue(args, i, arg));
      i += 1;
      continue;
    }
    if (arg.startsWith("--requirement=")) {
      pushOption(options, "requirement", arg.slice("--requirement=".length));
      continue;
    }
    if (arg === "--requirement") {
      pushOption(options, "requirement", requiredValue(args, i, arg));
      i += 1;
      continue;
    }
    if (arg.startsWith("--research=")) {
      pushOption(options, "research", arg.slice("--research=".length));
      continue;
    }
    if (arg === "--research") {
      pushOption(options, "research", requiredValue(args, i, arg));
      i += 1;
      continue;
    }
    if (arg.startsWith("--task=")) {
      pushOption(options, "task", arg.slice("--task=".length));
      continue;
    }
    if (arg === "--task") {
      pushOption(options, "task", requiredValue(args, i, arg));
      i += 1;
      continue;
    }
    if (arg.startsWith("--constraint=")) {
      pushOption(options, "constraint", arg.slice("--constraint=".length));
      continue;
    }
    if (arg === "--constraint") {
      pushOption(options, "constraint", requiredValue(args, i, arg));
      i += 1;
      continue;
    }
    if (arg.startsWith("--non-goal=")) {
      pushOption(options, "non-goal", arg.slice("--non-goal=".length));
      continue;
    }
    if (arg === "--non-goal") {
      pushOption(options, "non-goal", requiredValue(args, i, arg));
      i += 1;
      continue;
    }
    if (arg.startsWith("--assumption=")) {
      pushOption(options, "assumption", arg.slice("--assumption=".length));
      continue;
    }
    if (arg === "--assumption") {
      pushOption(options, "assumption", requiredValue(args, i, arg));
      i += 1;
      continue;
    }
    if (arg.startsWith("--approval-gate=")) {
      pushOption(options, "approval-gate", arg.slice("--approval-gate=".length));
      continue;
    }
    if (arg === "--approval-gate") {
      pushOption(options, "approval-gate", requiredValue(args, i, arg));
      i += 1;
      continue;
    }
    if (arg.startsWith("--verification=")) {
      pushOption(options, "verification", arg.slice("--verification=".length));
      continue;
    }
    if (arg === "--verification") {
      pushOption(options, "verification", requiredValue(args, i, arg));
      i += 1;
      continue;
    }
    if (arg.startsWith("--owner=")) {
      pushOption(options, "owner", arg.slice("--owner=".length));
      continue;
    }
    if (arg === "--owner") {
      pushOption(options, "owner", requiredValue(args, i, arg));
      i += 1;
      continue;
    }
    if (arg.startsWith("--boundary=")) {
      pushOption(options, "boundary", arg.slice("--boundary=".length));
      continue;
    }
    if (arg === "--boundary") {
      pushOption(options, "boundary", requiredValue(args, i, arg));
      i += 1;
      continue;
    }
    if (arg.startsWith("--depends-on=")) {
      pushOption(options, "depends-on", arg.slice("--depends-on=".length));
      continue;
    }
    if (arg === "--depends-on") {
      pushOption(options, "depends-on", requiredValue(args, i, arg));
      i += 1;
      continue;
    }
    if (arg.startsWith("--testability=")) {
      pushOption(options, "testability", arg.slice("--testability=".length));
      continue;
    }
    if (arg === "--testability") {
      pushOption(options, "testability", requiredValue(args, i, arg));
      i += 1;
      continue;
    }
    if (arg.startsWith("--required-evidence=")) {
      pushOption(options, "required-evidence", arg.slice("--required-evidence=".length));
      continue;
    }
    if (arg === "--required-evidence") {
      pushOption(options, "required-evidence", requiredValue(args, i, arg));
      i += 1;
      continue;
    }
    if (arg.startsWith("--test-effort-reason=")) {
      pushOption(options, "test-effort-reason", arg.slice("--test-effort-reason=".length));
      continue;
    }
    if (arg === "--test-effort-reason") {
      pushOption(options, "test-effort-reason", requiredValue(args, i, arg));
      i += 1;
      continue;
    }
    if (arg.startsWith("--testing-strictness=")) {
      options["testing-strictness"] = arg.slice("--testing-strictness=".length);
      continue;
    }
    if (arg === "--testing-strictness") {
      options["testing-strictness"] = requiredValue(args, i, arg);
      i += 1;
      continue;
    }
    if (arg.startsWith("--artifact=")) {
      pushOption(options, "artifact", arg.slice("--artifact=".length));
      continue;
    }
    if (arg === "--artifact") {
      pushOption(options, "artifact", requiredValue(args, i, arg));
      i += 1;
      continue;
    }
    if (arg.startsWith("--test=")) {
      pushOption(options, "test", arg.slice("--test=".length));
      continue;
    }
    if (arg === "--test") {
      pushOption(options, "test", requiredValue(args, i, arg));
      i += 1;
      continue;
    }
    if (arg.startsWith("--browser-check=")) {
      pushOption(options, "browser-check", arg.slice("--browser-check=".length));
      continue;
    }
    if (arg === "--browser-check") {
      pushOption(options, "browser-check", requiredValue(args, i, arg));
      i += 1;
      continue;
    }
    if (arg.startsWith("--review-trigger=")) {
      pushOption(options, "review-trigger", arg.slice("--review-trigger=".length));
      continue;
    }
    if (arg === "--review-trigger") {
      pushOption(options, "review-trigger", requiredValue(args, i, arg));
      i += 1;
      continue;
    }
    if (arg.startsWith("--review-evidence=")) {
      pushOption(options, "review-evidence", arg.slice("--review-evidence=".length));
      continue;
    }
    if (arg === "--review-evidence") {
      pushOption(options, "review-evidence", requiredValue(args, i, arg));
      i += 1;
      continue;
    }
    if (arg === "--reviewed") {
      options.reviewed = true;
      continue;
    }
    if (arg.startsWith("--note=")) {
      pushOption(options, "note", arg.slice("--note=".length));
      continue;
    }
    if (arg === "--note") {
      pushOption(options, "note", requiredValue(args, i, arg));
      i += 1;
      continue;
    }
    if (arg.startsWith("--verdict=")) {
      options.verdict = arg.slice("--verdict=".length);
      continue;
    }
    if (arg === "--verdict") {
      options.verdict = requiredValue(args, i, arg);
      i += 1;
      continue;
    }
    if (arg.startsWith("--next-action=")) {
      options["next-action"] = arg.slice("--next-action=".length);
      continue;
    }
    if (arg === "--next-action") {
      options["next-action"] = requiredValue(args, i, arg);
      i += 1;
      continue;
    }
    if (arg.startsWith("--source=")) {
      pushOption(options, "source", arg.slice("--source=".length));
      continue;
    }
    if (arg === "--source") {
      pushOption(options, "source", requiredValue(args, i, arg));
      i += 1;
      continue;
    }
    if (arg.startsWith("--finding=")) {
      pushOption(options, "finding", arg.slice("--finding=".length));
      continue;
    }
    if (arg === "--finding") {
      pushOption(options, "finding", requiredValue(args, i, arg));
      i += 1;
      continue;
    }
    if (arg.startsWith("--inference=")) {
      pushOption(options, "inference", arg.slice("--inference=".length));
      continue;
    }
    if (arg === "--inference") {
      pushOption(options, "inference", requiredValue(args, i, arg));
      i += 1;
      continue;
    }
    if (arg.startsWith("--risk=")) {
      pushOption(options, "risk", arg.slice("--risk=".length));
      continue;
    }
    if (arg === "--risk") {
      pushOption(options, "risk", requiredValue(args, i, arg));
      i += 1;
      continue;
    }
    if (arg.startsWith("--files=")) {
      options.files = arg.slice("--files=".length);
      continue;
    }
    if (arg === "--files") {
      options.files = requiredValue(args, i, arg);
      i += 1;
      continue;
    }
    if (arg.startsWith("--commits=")) {
      options.commits = arg.slice("--commits=".length);
      continue;
    }
    if (arg === "--commits") {
      options.commits = requiredValue(args, i, arg);
      i += 1;
      continue;
    }
    if (arg.startsWith("--follow-up=")) {
      pushOption(options, "follow-up", arg.slice("--follow-up=".length));
      continue;
    }
    if (arg === "--follow-up") {
      pushOption(options, "follow-up", requiredValue(args, i, arg));
      i += 1;
      continue;
    }
    if (arg.startsWith("--impact=")) {
      options.impact = arg.slice("--impact=".length);
      continue;
    }
    if (arg === "--impact") {
      options.impact = requiredValue(args, i, arg);
      i += 1;
      continue;
    }
    if (arg.startsWith("--confidence=")) {
      options.confidence = arg.slice("--confidence=".length);
      continue;
    }
    if (arg === "--confidence") {
      options.confidence = requiredValue(args, i, arg);
      i += 1;
      continue;
    }
    if (arg.startsWith("--focus=")) {
      options.focus = arg.slice("--focus=".length);
      continue;
    }
    if (arg === "--focus") {
      options.focus = requiredValue(args, i, arg);
      i += 1;
      continue;
    }
    if (arg.startsWith("--domain=")) {
      options.domain = arg.slice("--domain=".length);
      continue;
    }
    if (arg === "--domain") {
      options.domain = requiredValue(args, i, arg);
      i += 1;
      continue;
    }
    if (arg.startsWith("--objective=")) {
      options.objective = arg.slice("--objective=".length);
      continue;
    }
    if (arg === "--objective") {
      options.objective = requiredValue(args, i, arg);
      i += 1;
      continue;
    }
    if (arg.startsWith("--user=")) {
      pushOption(options, "user", arg.slice("--user=".length));
      continue;
    }
    if (arg === "--user") {
      pushOption(options, "user", requiredValue(args, i, arg));
      i += 1;
      continue;
    }
    if (arg.startsWith("--core-flow=")) {
      pushOption(options, "core-flow", arg.slice("--core-flow=".length));
      continue;
    }
    if (arg === "--core-flow") {
      pushOption(options, "core-flow", requiredValue(args, i, arg));
      i += 1;
      continue;
    }
    if (arg.startsWith("--contract-source=")) {
      pushOption(options, "contract-source", arg.slice("--contract-source=".length));
      continue;
    }
    if (arg === "--contract-source") {
      pushOption(options, "contract-source", requiredValue(args, i, arg));
      i += 1;
      continue;
    }
    if (arg.startsWith("--restricted-area=")) {
      pushOption(options, "restricted-area", arg.slice("--restricted-area=".length));
      continue;
    }
    if (arg === "--restricted-area") {
      pushOption(options, "restricted-area", requiredValue(args, i, arg));
      i += 1;
      continue;
    }
    if (arg.startsWith("--resume=")) {
      options.resume = arg.slice("--resume=".length);
      continue;
    }
    if (arg === "--resume") {
      options.resume = requiredValue(args, i, arg);
      i += 1;
      continue;
    }
    if (arg === "--prune") {
      options.prune = true;
      continue;
    }
    if (arg === "--reset") {
      options.reset = true;
      continue;
    }
    if (arg.startsWith("--category=")) {
      options.category = arg.slice("--category=".length);
      continue;
    }
    if (arg === "--category") {
      options.category = requiredValue(args, i, arg);
      i += 1;
      continue;
    }
    if (arg.startsWith("--limit=")) {
      options.limit = arg.slice("--limit=".length);
      continue;
    }
    if (arg === "--limit") {
      options.limit = requiredValue(args, i, arg);
      i += 1;
      continue;
    }
    if (arg.startsWith("--replace=")) {
      options.replace = arg.slice("--replace=".length);
      continue;
    }
    if (arg === "--replace") {
      options.replace = requiredValue(args, i, arg);
      i += 1;
      continue;
    }
    if (arg.startsWith("--pattern=")) {
      options.pattern = arg.slice("--pattern=".length);
      continue;
    }
    if (arg === "--pattern") {
      options.pattern = requiredValue(args, i, arg);
      i += 1;
      continue;
    }
    if (arg.startsWith("--item=")) {
      options.item = arg.slice("--item=".length);
      continue;
    }
    if (arg === "--item") {
      options.item = requiredValue(args, i, arg);
      i += 1;
      continue;
    }
    if (arg.startsWith("--scope=")) {
      options.scope = arg.slice("--scope=".length);
      continue;
    }
    if (arg === "--scope") {
      options.scope = requiredValue(args, i, arg);
      i += 1;
      continue;
    }
    if (arg.startsWith("--url=")) {
      options.url = arg.slice("--url=".length);
      continue;
    }
    if (arg === "--url") {
      options.url = requiredValue(args, i, arg);
      i += 1;
      continue;
    }
    if (arg.startsWith("--purpose=")) {
      options.purpose = arg.slice("--purpose=".length);
      continue;
    }
    if (arg === "--purpose") {
      options.purpose = requiredValue(args, i, arg);
      i += 1;
      continue;
    }
    if (arg.startsWith("--action=")) {
      pushOption(options, "action", arg.slice("--action=".length));
      continue;
    }
    if (arg === "--action") {
      pushOption(options, "action", requiredValue(args, i, arg));
      i += 1;
      continue;
    }
    if (arg.startsWith("--observation=")) {
      options.observation = arg.slice("--observation=".length);
      continue;
    }
    if (arg === "--observation") {
      options.observation = requiredValue(args, i, arg);
      i += 1;
      continue;
    }
    if (arg.startsWith("--evidence=")) {
      options.evidence = arg.slice("--evidence=".length);
      continue;
    }
    if (arg === "--evidence") {
      options.evidence = requiredValue(args, i, arg);
      i += 1;
      continue;
    }
    if (arg.startsWith("--skipped-test-rationale=")) {
      pushOption(options, "skipped-test-rationale", arg.slice("--skipped-test-rationale=".length));
      continue;
    }
    if (arg === "--skipped-test-rationale") {
      pushOption(options, "skipped-test-rationale", requiredValue(args, i, arg));
      i += 1;
      continue;
    }
    if (arg.startsWith("--precondition=")) {
      pushOption(options, "precondition", arg.slice("--precondition=".length));
      continue;
    }
    if (arg === "--precondition") {
      pushOption(options, "precondition", requiredValue(args, i, arg));
      i += 1;
      continue;
    }
    if (arg.startsWith("--step=")) {
      pushOption(options, "step", arg.slice("--step=".length));
      continue;
    }
    if (arg === "--step") {
      pushOption(options, "step", requiredValue(args, i, arg));
      i += 1;
      continue;
    }
    if (arg.startsWith("--expected=")) {
      options.expected = arg.slice("--expected=".length);
      continue;
    }
    if (arg === "--expected") {
      options.expected = requiredValue(args, i, arg);
      i += 1;
      continue;
    }
    if (arg.startsWith("--actual=")) {
      options.actual = arg.slice("--actual=".length);
      continue;
    }
    if (arg === "--actual") {
      options.actual = requiredValue(args, i, arg);
      i += 1;
      continue;
    }
    if (arg.startsWith("--result=")) {
      options.result = arg.slice("--result=".length);
      continue;
    }
    if (arg === "--result") {
      options.result = requiredValue(args, i, arg);
      i += 1;
      continue;
    }
    if (arg.startsWith("--blocker=")) {
      pushOption(options, "blocker", arg.slice("--blocker=".length));
      continue;
    }
    if (arg === "--blocker") {
      pushOption(options, "blocker", requiredValue(args, i, arg));
      i += 1;
      continue;
    }
    if (arg.startsWith("--path=")) {
      options.path = arg.slice("--path=".length);
      continue;
    }
    if (arg === "--path") {
      options.path = requiredValue(args, i, arg);
      i += 1;
      continue;
    }
    if (arg.startsWith("--remote=")) {
      options.remote = arg.slice("--remote=".length);
      continue;
    }
    if (arg === "--remote") {
      options.remote = requiredValue(args, i, arg);
      i += 1;
      continue;
    }
    if (arg.startsWith("--service=")) {
      options.service = arg.slice("--service=".length);
      continue;
    }
    if (arg === "--service") {
      options.service = requiredValue(args, i, arg);
      i += 1;
      continue;
    }
    if (arg.startsWith("--direction=")) {
      options.direction = arg.slice("--direction=".length);
      continue;
    }
    if (arg === "--direction") {
      options.direction = requiredValue(args, i, arg);
      i += 1;
      continue;
    }
    if (arg.startsWith("--contracts-path=")) {
      options["contracts-path"] = arg.slice("--contracts-path=".length);
      continue;
    }
    if (arg === "--contracts-path") {
      options["contracts-path"] = requiredValue(args, i, arg);
      i += 1;
      continue;
    }
    if (arg.startsWith("--")) {
      fail(`Unknown option: ${arg}`);
    }
    values.push(arg);
  }

  return { options, values };
}

export function parseMode(mode) {
  if (mode === "quick" || mode === "standard" || mode === "deep") return mode;
  fail(`Invalid mode: ${mode}. Expected quick, standard, or deep.`);
}

export function parseConfidence(confidence) {
  if (confidence === "low" || confidence === "medium" || confidence === "high") return confidence;
  fail(`Invalid confidence: ${confidence}. Expected low, medium, or high.`);
}

export function parseBrowserResult(result) {
  if (result === "pass" || result === "fail" || result === "blocked") return result;
  fail(`Invalid result: ${result}. Expected pass, fail, or blocked.`);
}

export function parseVerdict(verdict) {
  const normalized = String(verdict).trim().toUpperCase().replaceAll("-", "_");
  if (["PASS", "PASS_WITH_NOTES", "BLOCKED", "FAILED"].includes(normalized)) return normalized;
  fail(`Invalid verdict: ${verdict}. Expected PASS, PASS_WITH_NOTES, BLOCKED, or FAILED.`);
}

export function parseTestability(value) {
  const allowed = ["unit", "integration", "e2e", "browser", "manual", "artifact-check", "not-worth-testing"];
  if (allowed.includes(value)) return value;
  fail(`Invalid testability: ${value}. Expected ${allowed.join(", ")}.`);
}

export function parseLimit(limit) {
  if (!/^[1-9]\d*$/.test(String(limit))) {
    fail(`Invalid limit: ${limit}. Expected a positive integer.`);
  }
  const parsed = Number.parseInt(limit, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    fail(`Invalid limit: ${limit}. Expected a positive integer.`);
  }
  return parsed;
}

function requiredValue(args, index, flag) {
  const value = args[index + 1];
  if (value === undefined || value === "") {
    fail(`Missing value for ${flag}.`);
  }
  return value;
}

function pushOption(options, key, value) {
  if (!value) fail(`Missing value for --${key}.`);
  if (!options[key]) options[key] = [];
  options[key].push(value);
}
