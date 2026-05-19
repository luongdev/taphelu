import { findProjectRoot } from "./project.mjs";
import { gitRootOrCwd } from "./utils.mjs";
import { fail } from "./errors.mjs";
import { printStatus } from "./commands/status.mjs";
import { printCommands } from "./commands/commands.mjs";
import { runAsk } from "./commands/ask.mjs";
import { runResearch } from "./commands/research.mjs";
import { runPlan } from "./commands/plan.mjs";
import { runWorkflow } from "./commands/run.mjs";
import { runVerify } from "./commands/verify.mjs";
import { runMemory, runRemember, runForget } from "./commands/memory.mjs";
import { runBrowser } from "./commands/browser.mjs";
import { runImport } from "./commands/import.mjs";
import { runInstall } from "./commands/install.mjs";
import { runDoctor } from "./commands/doctor.mjs";
import { runConfig } from "./commands/config.mjs";
import { runReview } from "./commands/review.mjs";
import { runCleanup } from "./commands/cleanup.mjs";
import { runScan } from "./commands/scan.mjs";
import { runContext } from "./commands/context.mjs";
import { runCompact } from "./commands/compact.mjs";
import { runRuntime } from "./commands/runtime.mjs";
import { runContracts } from "./commands/contracts.mjs";

export function main(argv = process.argv, cwd = process.cwd()) {
  const [, , command, ...args] = argv;

  if (!command || command === "help" || command === "--help" || command === "-h") {
    printHelp();
    return;
  }

  const root = findProjectRoot(cwd) || bootstrapCommandRoot(command, args, cwd);
  if (!root) {
    fail("No .projects/PROJECT.md found from current directory upward.");
  }

  if (command === "status") return printStatus(root);
  if (command === "commands") return printCommands();
  if (command === "ask") return runAsk(root, args);
  if (command === "research") return runResearch(root, args);
  if (command === "plan") return runPlan(root, args);
  if (command === "run") return runWorkflow(root, args);
  if (command === "verify") return runVerify(root, args);
  if (command === "memory") return runMemory(root, args);
  if (command === "remember") return runRemember(root, args);
  if (command === "forget") return runForget(root, args);
  if (command === "browser") return runBrowser(root, args);
  if (command === "import") return runImport(root, args);
  if (command === "install") return runInstall(root, args);
  if (command === "doctor") return runDoctor(root, args);
  if (command === "config") return runConfig(root, args);
  if (command === "review") return runReview(root, args);
  if (command === "cleanup") return runCleanup(root, args);
  if (command === "scan") return runScan(root, args);
  if (command === "context") return runContext(root, args);
  if (command === "compact") return runCompact(root, args);
  if (command === "runtime") return runRuntime(root, args);
  if (command === "contracts") return runContracts(root, args);

  fail(`Unknown command: ${command}`);
}

function bootstrapCommandRoot(command, args, cwd) {
  if (command === "commands" || command === "install" || command === "doctor" || command === "runtime") return cwd;
  if (command === "scan") return cwd;
  if (command === "contracts") return gitRootOrCwd(cwd);
  if (command === "import" && args[0] === "project") return cwd;
  return null;
}

export function printHelp() {
  console.log(`taphelu command surface

Usage:
  dl status
  dl commands
  dl ask [--mode quick|standard|deep] [--approval-scope text] [--context path] [--write] <goal>
  dl research [--source text] [--finding text] [--confidence low|medium|high] [--approval-scope text] [--write] <question>
  dl plan [--task text] [--verification text] [--context path] [--write] <goal>
  dl run [--source text] [--finding text] [--task text] [--verification text] [--write] <goal>
  dl run --resume run-id [--write]
  dl verify [--artifact path] [--test text] [--review-trigger text] [--reviewed] [--write] <goal>
  dl memory [--category name] [--limit number] [--prune] [--write]
  dl remember --category name [--source path] [--replace text] [--write] <memory>
  dl forget [--category name] [--pattern text | --item text | --reset] [--write]
  dl browser research --approval-scope text --url url --purpose text --observation text [--write]
  dl browser verify --approval-scope text --url url --step text --expected text --actual text --result pass|fail|blocked [--write] <flow>
  dl import bmad [--path _bmad-output] [--write]
  dl import gsd [--path .planning] [--write]
  dl import superpower [--path superpowers] [--write]
  dl import project [--path .] [--mode quick|standard|deep] [--write]
  dl scan [--path .] [--mode quick|standard|deep] [--dry-run|--write]
  dl scan interview [--path .] [--mode quick|standard|deep] [--domain text] [--user text] [--core-flow text] [--objective text] [--write]
  dl scan plan [--path .] [--mode quick|standard|deep] [--domain text] [--objective text] [--write]
  dl scan map [--path .] [--mode quick|standard|deep] [--focus services|contracts|topology|all] [--write]
  dl scan --focus services|contracts|topology|all [--path .] [--mode quick|standard|deep] [--write]
  dl contracts init --path .taphelu/contracts [--remote url] [--write]
  dl contracts link --path .taphelu/contracts [--write]
  dl contracts scan [--path .] [--contracts-path .taphelu/contracts] [--write]
  dl contracts current [--path .] [--contracts-path .taphelu/contracts]
  dl contracts deps [--service id] [--direction outbound|inbound|all] [--path .] [--contracts-path .taphelu/contracts]
  dl contracts map [--path .taphelu/contracts] [--write]
  dl contracts check [--path .taphelu/contracts] [--strict]
  dl contracts sync [--path .taphelu/contracts] [--commit] [--push]
  dl review status|plan [--runtime codex|claude|gemini] [--review-trigger text] [--files n] [--commits n]
  dl cleanup context [--limit n] [--dry-run|--write]
  dl context index [--write]
  dl context search <query>
  dl context get <id> [--full] [--start-line n] [--end-line n]
  dl compact milestone --id M23 [--write]
  dl compact runs [--keep n] [--write]
  dl compact plan [--write]
  dl install --runtime claude|kiro|codex|gemini|all --scope local|global [--profile minimal|core|full-auto] [--hooks off|observe|guarded|strict] [--statusline off|on] [--config-dir path] [--dry-run|--write]
  dl doctor --runtime claude|kiro|codex|gemini|all --scope local|global [--config-dir path] [--live]
  dl doctor instructions
  dl runtime status --runtime claude|kiro|codex|gemini|all --scope local|global [--live]
  dl config get [key]
  dl config set testing.strictness low|medium|deep

Commands:
  status    Show current .projects state.
  commands  Show stable command manifest.
  ask       Produce a requirement packet from a goal.
  research  Produce a research packet from findings and sources.
  plan      Produce an executable plan packet.
  run       Produce or record an end-to-end workflow run.
  verify    Produce or record a verification verdict.
  memory    Review or prune curated project memory.
  remember  Add or update a durable memory item.
  forget    Remove memory by category, exact item, pattern, or reset.
  browser   Produce gated browser research or E2E verification reports.
  import    Import external workflow context.
  scan      Scan an existing project into Taphelu context.
  contracts Manage a shared polyrepo service contract registry.
  review    Evaluate permission-gated cross-AI review policy.
  cleanup   Preview or write compact project context cleanup.
  context   Index, search, or fetch project context artifacts.
  compact   Compact milestone, run, or plan artifacts after closeout.
  install   Generate Taphelu agent pack adapters for AI runtimes.
  doctor    Validate generated Taphelu runtime adapters and MCP config.
  runtime   Show runtime adapter and live MCP health.
  config    Read or update project-local Taphelu config.
`);
}
