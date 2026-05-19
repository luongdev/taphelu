import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmdirSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { writeTextFileAtomic } from "../project.mjs";

const SOURCE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PACK_DIR = join(SOURCE_DIR, "taphelu-pack");
const MCP_BIN = join(SOURCE_DIR, "bin", "taphelu-mcp.mjs");
const MANAGED_START = "# TAPHELU MANAGED MCP START";
const MANAGED_END = "# TAPHELU MANAGED MCP END";
const JSON_MANAGED_ENV = "TAPHELU_MANAGED";
const INSTRUCTION_BLOCK_START = "<!-- TAPHELU MANAGED INSTRUCTIONS START -->";
const INSTRUCTION_BLOCK_END = "<!-- TAPHELU MANAGED INSTRUCTIONS END -->";
const SUPPORTED_RUNTIMES = ["claude", "kiro", "codex", "gemini"];
const SUPPORTED_PROFILES = ["minimal", "core", "full-auto"];
const SUPPORTED_HOOK_POLICIES = ["off", "observe", "guarded", "strict"];
const SUPPORTED_STATUSLINE = ["off", "on"];
const MCP_HANDSHAKE_TIMEOUT_MS = 5000;
const STATUSLINE_CAPABILITIES = {
  claude: { mode: "native-command", script: true },
  gemini: { mode: "native-footer", script: false },
  kiro: { mode: "native-tui", script: false },
  codex: { mode: "fallback", script: false },
};

export function loadPack() {
  const manifestPath = join(PACK_DIR, "manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  validateManifest(manifest);
  const skills = manifest.skills.map((item) => loadPackItem(item, "skill"));
  const agents = manifest.agents.map((item) => loadPackItem(item, "agent"));
  const commands = manifest.commands.map((item) => loadPackItem(item, "command"));
  const hooks = manifest.hooks.map((item) => loadPackItem(item, "hook"));
  const statusline = loadPackItem(manifest.statusline, "statusline");
  const mcp = JSON.parse(readFileSync(join(PACK_DIR, manifest.mcp), "utf8"));
  return { manifest, skills, agents, commands, hooks, statusline, mcp, packDir: PACK_DIR };
}

export function validateManifest(manifest) {
  if (manifest.schemaVersion !== 1) throw new Error("taphelu-pack manifest schemaVersion must be 1.");
  if (!manifest.name || !manifest.version) throw new Error("taphelu-pack manifest requires name and version.");
  if (!Array.isArray(manifest.skills) || !manifest.skills.length) throw new Error("taphelu-pack manifest requires skills.");
  if (!Array.isArray(manifest.agents) || !manifest.agents.length) throw new Error("taphelu-pack manifest requires agents.");
  if (!Array.isArray(manifest.commands) || !manifest.commands.length) throw new Error("taphelu-pack manifest requires commands.");
  if (!Array.isArray(manifest.hooks) || !manifest.hooks.length) throw new Error("taphelu-pack manifest requires hooks.");
  if (!manifest.statusline?.path) throw new Error("taphelu-pack manifest requires statusline.");
  if (!Array.isArray(manifest.profiles?.core) || !Array.isArray(manifest.profiles?.full)) {
    throw new Error("taphelu-pack manifest requires core and full profiles.");
  }
  for (const runtime of SUPPORTED_RUNTIMES) {
    if (!manifest.runtimes?.[runtime]) throw new Error(`taphelu-pack manifest missing runtime: ${runtime}.`);
  }
  for (const item of [...manifest.skills, ...manifest.agents, ...manifest.commands, ...manifest.hooks, manifest.statusline]) {
    if (!item.name || !item.path) throw new Error("taphelu-pack manifest items require name and path.");
    if (!existsSync(join(PACK_DIR, item.path))) throw new Error(`taphelu-pack item not found: ${item.path}.`);
  }
  if (!manifest.mcp || !existsSync(join(PACK_DIR, manifest.mcp))) throw new Error("taphelu-pack manifest requires mcp.json.");
  return true;
}

export function buildInstallPlan(root, input = {}) {
  const pack = loadPack();
  const runtimes = normalizeRuntime(input.runtime || "all");
  const scope = normalizeScope(input.scope || "local");
  const profile = normalizeProfile(input.profile || "full-auto");
  const hooks = normalizeHooks(input.hooks || (profile === "full-auto" ? "strict" : "off"));
  const statusline = normalizeStatusline(input.statusline || (profile === "full-auto" ? "on" : "off"));
  const files = [];
  const blockers = [];
  const warnings = [];
  const manualActions = [];

  for (const runtime of runtimes) {
    const runtimePlan = buildRuntimeInstallPlan(root, pack, {
      runtime,
      scope,
      configDir: runtimeConfigDir(input.configDir, runtime, runtimes),
      nodeCommand: input.nodeCommand || process.execPath,
      profile,
      hooks,
      statusline,
    });
    files.push(...runtimePlan.files);
    blockers.push(...runtimePlan.blockers);
    warnings.push(...runtimePlan.warnings);
    manualActions.push(...runtimePlan.manualActions);
  }

  return {
    pack: {
      name: pack.manifest.name,
      version: pack.manifest.version,
      skills: pack.skills.map((item) => item.name),
      agents: pack.agents.map((item) => item.name),
      commands: pack.commands.map((item) => item.name),
    },
    runtimes,
    scope,
    profile,
    hooks,
    statusline,
    files,
    blockers,
    warnings,
    manualActions,
  };
}

export function applyInstallPlan(plan) {
  if (plan.blockers.length) {
    throw new Error(`Install blocked: ${plan.blockers.join("; ")}`);
  }
  const snapshots = plan.files.map((file) => snapshotTarget(file.path));
  const directorySnapshots = snapshotMissingDirectories(plan.files.map((file) => dirname(file.path)));
  try {
    for (const file of plan.files) {
      if (file.remove) {
        if (existsSync(file.path)) unlinkSync(file.path);
        continue;
      }
      mkdirSync(dirname(file.path), { recursive: true });
      writeTextFileAtomic(file.path, file.content);
    }
  } catch (error) {
    rollbackTargets(snapshots, error);
    removeCreatedDirectories(directorySnapshots, error);
    throw error;
  }
  return plan.files.length;
}

export function inspectInstall(root, input = {}) {
  const plan = buildInstallPlan(root, input);
  const checks = [
    ...detectLocalShadowing(root, plan),
    ...plan.files.map((file) => {
    if (file.remove) {
      return existsSync(file.path)
        ? { path: file.path, status: "WARN", message: "Obsolete managed statusline script remains; run dl install --write to remove it." }
        : { path: file.path, status: "PASS", message: "Obsolete managed file already removed." };
    }
    if (!existsSync(file.path)) {
      return { path: file.path, status: "FAIL", message: "Missing generated file." };
    }
    const content = readFileSync(file.path, "utf8");
      if (file.kind === "hook" || file.kind === "statusline") {
        return inspectScriptArtifact(file, content);
      }
    if (file.kind === "agent-json") {
      return inspectKiroAgentJson(file, content);
    }
    if (file.kind === "kiro-ide-hook") {
      return inspectKiroIdeHook(file, content);
    }
    if (["skill", "agent", "command", "instruction", "extension-context"].includes(file.kind)) {
      return content.includes(file.marker)
        ? { path: file.path, status: "PASS", message: "Managed adapter file present." }
        : { path: file.path, status: "FAIL", message: "File exists but lacks Taphelu managed marker." };
    }
    if (file.kind === "settings-json") {
      return inspectSettingsJson(file, content);
    }
    if (file.kind === "extension-json") {
      return inspectExtensionJson(file, content);
    }
    if (file.kind === "mcp-toml") {
      return inspectCodexMcpFile(file, content);
    }
    if (file.kind === "mcp-json") {
      return inspectJsonMcpFile(file, content);
    }
    if (file.kind === "mcp-json-cleanup") {
      return inspectNoManagedMcpFile(file, content);
    }
    return { path: file.path, status: "PASS", message: "Present." };
  })];
  if (input.live) {
    checks.push(...runLiveMcpChecks(plan));
  }
  const status = plan.blockers.length || checks.some((check) => check.status === "FAIL") ? "FAIL" : "PASS";
  return { ...plan, checks, status };
}

function buildRuntimeInstallPlan(root, pack, input) {
  const runtimeConfig = pack.manifest.runtimes[input.runtime];
  const targetRoot = runtimeTargetRoot(root, runtimeConfig, input.runtime, input.scope, input.configDir);
  const statuslineCapability = runtimeStatuslineCapability(input.runtime);
  const files = [];
  const blockers = [];
  const warnings = [];
  const manualActions = [];
  const selected = selectPackItems(pack, input.profile);
  const primaryAgents = selected.agents.filter((agent) => isPrimaryAgent(agent));
  const specialistAgents = selected.agents.filter((agent) => !isPrimaryAgent(agent));
  const installCore = selected.skills.length > 0;
  const useGeminiExtensionMcp = input.runtime === "gemini" && installCore;

  if (installCore) {
    for (const skill of selected.skills) {
      addManagedFile(files, blockers, {
        path: join(targetRoot.skillsRoot, skill.name, "SKILL.md"),
        content: renderSkill(skill, pack.manifest.managedMarker, input.runtime),
        marker: pack.manifest.managedMarker,
        kind: "skill",
        runtime: input.runtime,
      });
    }

    if (input.runtime === "kiro") {
      const hook = pack.hooks[0];
      const hookPath = join(targetRoot.hooksRoot, `${hook.name}.mjs`);
      for (const agent of primaryAgents) {
        addManagedFile(files, blockers, {
          path: join(targetRoot.skillsRoot, agent.name, "SKILL.md"),
          content: renderAgentAsSkill(agent, pack.manifest.managedMarker, input.runtime),
          marker: pack.manifest.managedMarker,
          kind: "skill",
          runtime: input.runtime,
        });
        addManagedRemoval(files, blockers, {
          path: join(targetRoot.agentsRoot, `${agent.name}.json`),
          marker: pack.manifest.managedMarker,
          kind: "remove",
          runtime: input.runtime,
        });
        addManagedRemoval(files, blockers, {
          path: join(targetRoot.agentsRoot, `${agent.name}.md`),
          marker: pack.manifest.managedMarker,
          kind: "remove",
          runtime: input.runtime,
        });
      }
      for (const agent of specialistAgents) {
        addManagedFile(files, blockers, {
          path: join(targetRoot.agentsRoot, `${agent.name}.json`),
          content: renderKiroAgent(agent, pack.manifest.managedMarker, input, hookPath),
          marker: pack.manifest.managedMarker,
          kind: "agent-json",
          runtime: input.runtime,
          hooks: input.hooks,
        });
        addManagedRemoval(files, blockers, {
          path: join(targetRoot.agentsRoot, `${agent.name}.md`),
          marker: pack.manifest.managedMarker,
          kind: "remove",
          runtime: input.runtime,
        });
      }
      addManagedFile(files, blockers, {
        path: join(targetRoot.steeringRoot, "taphelu-runtime.md"),
        content: renderKiroSteering(pack.manifest.managedMarker),
        marker: pack.manifest.managedMarker,
        kind: "instruction",
        runtime: input.runtime,
      });
    } else if (runtimeConfig.nativeAgents) {
      for (const agent of primaryAgents) {
        addManagedFile(files, blockers, {
          path: join(targetRoot.skillsRoot, agent.name, "SKILL.md"),
          content: renderAgentAsSkill(agent, pack.manifest.managedMarker, input.runtime),
          marker: pack.manifest.managedMarker,
          kind: "skill",
          runtime: input.runtime,
        });
        addManagedRemoval(files, blockers, {
          path: join(targetRoot.agentsRoot, `${agent.name}.md`),
          marker: pack.manifest.managedMarker,
          kind: "remove",
          runtime: input.runtime,
        });
      }
      for (const agent of specialistAgents) {
        addManagedFile(files, blockers, {
          path: join(targetRoot.agentsRoot, `${agent.name}.md`),
          content: renderAgent(agent, pack.manifest.managedMarker, input.runtime),
          marker: pack.manifest.managedMarker,
          kind: "agent",
          runtime: input.runtime,
        });
      }
    } else {
      for (const agent of selected.agents) {
        addManagedFile(files, blockers, {
          path: join(targetRoot.skillsRoot, agent.name, "SKILL.md"),
          content: renderAgentAsSkill(agent, pack.manifest.managedMarker, input.runtime),
          marker: pack.manifest.managedMarker,
          kind: "skill",
          runtime: input.runtime,
        });
      }
    }

    for (const command of pack.commands) {
      addCommandFile(files, blockers, command, pack.manifest.managedMarker, input.runtime, targetRoot);
    }

    if (input.runtime === "codex") {
      addManagedInstructionBlockFile(files, {
        path: join(targetRoot.base, "AGENTS.md"),
        content: renderCodexInstructionPointer(pack.manifest.managedMarker),
        marker: pack.manifest.managedMarker,
        kind: "instruction",
        runtime: input.runtime,
      });
    }
  }

  const mcp = buildMcpServerConfig(input.nodeCommand, input.runtime);
  if (input.runtime === "codex") {
    const configPath = targetRoot.mcpConfigPath;
    const existing = existsSync(configPath) ? readFileSync(configPath, "utf8") : "";
    const merged = mergeCodexToml(existing, mcp);
    if (merged.blocker) {
      blockers.push(`${configPath}: ${merged.blocker}`);
    } else {
      files.push({ path: configPath, content: merged.content, kind: "mcp-toml", runtime: input.runtime, marker: MANAGED_START, mcp });
    }
  } else if (useGeminiExtensionMcp) {
    const configPath = targetRoot.mcpConfigPath;
    const existing = existsSync(configPath) ? readFileSync(configPath, "utf8") : "";
    const cleaned = removeManagedMcpJson(existing);
    if (cleaned.blocker) {
      blockers.push(`${configPath}: ${cleaned.blocker}`);
    } else if (cleaned.changed) {
      files.push({ path: configPath, content: cleaned.content, kind: "mcp-json-cleanup", runtime: input.runtime, marker: JSON_MANAGED_ENV, mcp });
    }
  } else {
    const configPath = targetRoot.mcpConfigPath;
    const existing = existsSync(configPath) ? readFileSync(configPath, "utf8") : "";
    const merged = mergeMcpJson(existing, mcp);
    if (merged.blocker) {
      blockers.push(`${configPath}: ${merged.blocker}`);
    } else {
      files.push({ path: configPath, content: merged.content, kind: "mcp-json", runtime: input.runtime, marker: JSON_MANAGED_ENV, mcp });
    }
    if (input.runtime === "claude" && input.scope === "global") {
      manualActions.push(`Claude global MCP can also be installed with: claude mcp add -e ${JSON_MANAGED_ENV}=1 --transport stdio --scope user taphelu -- ${input.nodeCommand} ${MCP_BIN}`);
    }
    if (input.runtime === "kiro" && input.scope === "global") {
      manualActions.push(`Kiro global MCP can also be installed with: kiro-cli mcp add --scope global --name taphelu --command ${shellQuote(input.nodeCommand)} --args ${shellQuote(MCP_BIN)} --env ${JSON_MANAGED_ENV}=1 --force`);
    }
  }

  if (input.scope === "global" && input.runtime === "claude" && input.configDir) {
    warnings.push("Claude --config-dir is used for testable generated config; Claude Code user-scope MCP normally lives in ~/.claude.json.");
  }

  if (input.runtime === "gemini" && installCore) {
    const extension = renderGeminiExtension(pack, input.nodeCommand, pack.manifest.managedMarker);
    addManagedFile(files, blockers, {
      path: targetRoot.extensionManifestPath,
      content: extension,
      marker: pack.manifest.managedMarker,
      kind: "extension-json",
      runtime: input.runtime,
      mcp,
    });
    addManagedFile(files, blockers, {
      path: join(targetRoot.extensionRoot, "GEMINI.md"),
      content: renderGeminiExtensionContext(pack.manifest.managedMarker),
      marker: pack.manifest.managedMarker,
      kind: "extension-context",
      runtime: input.runtime,
    });
  }

  if (installCore) {
    const hook = pack.hooks[0];
    if (input.hooks !== "off") {
      addManagedFile(files, blockers, {
        path: join(targetRoot.hooksRoot, `${hook.name}.mjs`),
        content: renderScriptArtifact(hook, pack.manifest.managedMarker),
        marker: pack.manifest.managedMarker,
        kind: "hook",
        runtime: input.runtime,
      });
      if (input.runtime === "kiro") {
        for (const hookFile of renderKiroIdeHooks({
          marker: pack.manifest.managedMarker,
          nodeCommand: input.nodeCommand,
          hookPath: join(targetRoot.hooksRoot, `${hook.name}.mjs`),
          policy: input.hooks,
        })) {
          addManagedFile(files, blockers, {
            path: join(targetRoot.hooksRoot, hookFile.name),
            content: hookFile.content,
            marker: pack.manifest.managedMarker,
            kind: "kiro-ide-hook",
            runtime: input.runtime,
          });
        }
      }
    } else if (input.runtime === "kiro") {
      for (const name of kiroIdeHookNames()) {
        addManagedRemoval(files, blockers, {
          path: join(targetRoot.hooksRoot, name),
          marker: pack.manifest.managedMarker,
          kind: "remove",
          runtime: input.runtime,
        });
      }
    }
    const statuslinePath = join(targetRoot.hooksRoot, `${pack.statusline.name}.mjs`);
    if (input.statusline === "on" && statuslineCapability.script) {
      addManagedFile(files, blockers, {
        path: statuslinePath,
        content: renderScriptArtifact(pack.statusline, pack.manifest.managedMarker),
        marker: pack.manifest.managedMarker,
        kind: "statusline",
        runtime: input.runtime,
      });
    } else {
      addManagedRemoval(files, blockers, {
        path: statuslinePath,
        marker: pack.manifest.managedMarker,
        kind: "remove",
        runtime: input.runtime,
      });
    }
    if (input.hooks !== "off" || input.statusline === "on" || existsSync(targetRoot.settingsPath)) {
      const settingsPath = targetRoot.settingsPath;
      const existing = existsSync(settingsPath) ? readFileSync(settingsPath, "utf8") : "";
      const merged = mergeRuntimeSettings(existing, {
        runtime: input.runtime,
        nodeCommand: input.nodeCommand,
        hookPath: join(targetRoot.hooksRoot, `${hook.name}.mjs`),
        statuslinePath: join(targetRoot.hooksRoot, `${pack.statusline.name}.mjs`),
        hooks: input.hooks,
        statusline: input.statusline,
        statuslineCapability,
      });
      if (merged.blocker) {
        blockers.push(`${settingsPath}: ${merged.blocker}`);
      } else if (merged.content) {
        files.push({ path: settingsPath, content: merged.content, kind: "settings-json", runtime: input.runtime, marker: JSON_MANAGED_ENV, hooks: input.hooks, statusline: input.statusline });
      }
    }
    if (input.statusline === "on" && statuslineCapability.mode === "fallback") {
      warnings.push(`${input.runtime} has no verified native statusline surface; generated /dl-status fallback metadata instead.`);
    }
  }

  return { files, blockers, warnings, manualActions };
}

function runtimeStatuslineCapability(runtime) {
  return STATUSLINE_CAPABILITIES[runtime] || STATUSLINE_CAPABILITIES.codex;
}

function selectPackItems(pack, profile) {
  if (profile === "minimal") return { skills: [], agents: [] };
  const profileKey = profile === "full-auto" ? "full" : profile;
  const skillNames = new Set(pack.manifest.profiles?.[profileKey] || []);
  const skills = pack.skills.filter((skill) => skillNames.has(skill.name));
  const agents = pack.agents.filter((agent) => {
    const required = Array.isArray(agent.requiredSkills) ? agent.requiredSkills : [];
    return required.every((skillName) => skillNames.has(skillName));
  });
  return { skills, agents };
}

function loadPackItem(item, type) {
  const content = readFileSync(join(PACK_DIR, item.path), "utf8");
  const parsed = parseFrontmatter(content);
  return {
    ...item,
    type,
    content,
    body: parsed.body,
    frontmatter: parsed.frontmatter,
    description: parsed.frontmatter.description || "",
  };
}

function addManagedFile(files, blockers, file) {
  if (existsSync(file.path)) {
    const existing = readFileSync(file.path, "utf8");
    if (!existing.includes(file.marker)) {
      blockers.push(`${file.path}: existing file is not Taphelu-managed.`);
    }
  }
  files.push(file);
}

function addManagedInstructionBlockFile(files, file) {
  if (!existsSync(file.path)) {
    files.push(file);
    return;
  }
  const existing = readFileSync(file.path, "utf8");
  files.push({
    ...file,
    content: mergeManagedInstructionBlock(existing, file.content, file.marker),
  });
}

function addManagedRemoval(files, blockers, file) {
  if (!existsSync(file.path)) return;
  const existing = readFileSync(file.path, "utf8");
  if (!existing.includes(file.marker)) {
    blockers.push(`${file.path}: existing file is not Taphelu-managed.`);
    return;
  }
  files.push({ ...file, remove: true, content: "" });
}

function renderSkill(item, marker, runtime) {
  return renderMarkdownWithFrontmatter(item, marker, runtime, item.name, item.description);
}

function renderAgent(item, marker, runtime) {
  const extra = runtime === "claude" && item.requiredSkills?.length
    ? { skills: item.requiredSkills }
    : {};
  return renderMarkdownWithFrontmatter(item, marker, runtime, item.name, item.description, extra);
}

function renderKiroAgent(item, marker, input, hookPath) {
  const prompt = [
    `<!-- ${marker}: do not edit. Source: taphelu-pack/${item.path}. Regenerate with dl install. -->`,
    item.body.trim(),
    "",
    "## Taphelu Runtime Adapter",
    "Use generated Taphelu skills and `/dl-*` entrypoints. Use Taphelu MCP tools when visible.",
  ].join("\n");
  const agent = {
    name: item.name,
    description: item.description,
    prompt,
    tools: ["*"],
    toolAliases: {},
    allowedTools: [],
    resources: ["skill://../skills/**/SKILL.md"],
    hooks: input.hooks === "off" ? {} : kiroCliHooks(input, hookPath),
    toolsSettings: {},
    includeMcpJson: true,
    model: null,
    welcomeMessage: `Taphelu ${item.name} loaded. Start with /dl-status or /dl-init.`,
  };
  return `${JSON.stringify(agent, null, 2)}\n`;
}

function renderAgentAsSkill(item, marker, runtime) {
  const name = item.name;
  const description = isPrimaryAgent(item)
    ? `Use as the main-session ${item.frontmatter.name || item.name} role contract. This is not a sub-agent role. ${item.description}`
    : `Use as the ${item.frontmatter.name || item.name} role contract when this runtime has no native Taphelu subagent adapter. ${item.description}`;
  return renderMarkdownWithFrontmatter(item, marker, runtime, name, description);
}

function isPrimaryAgent(agent) {
  return agent.name === "taphelu-lead";
}

function renderKiroSteering(marker) {
  return `---
inclusion: Always
---

# Taphelu Runtime

<!-- ${marker}: do not edit. Regenerate with dl install. -->

Use Taphelu as the workflow substrate for non-trivial project work.

- Treat \`taphelu-lead\` as the main-session orchestration role.
- Do not spawn or delegate to \`taphelu-lead\` as a sub-agent.
- Delegate only specialist roles: taphelu-analyst, taphelu-planner, taphelu-architect, taphelu-dev, taphelu-qa, taphelu-ux-analyst, taphelu-visual-qa, taphelu-memory-curator, taphelu-context-curator, taphelu-workflow-adapter.
- Start/resume with \`/dl-init\`, \`/dl-resume\`, or visible Taphelu \`dl_*\` MCP tools.
- Keep context compact; prefer \`/dl-status\` and \`dl_context\`.
`;
}

function renderMarkdownWithFrontmatter(item, marker, runtime, name, description, extra = {}) {
  const body = item.body.trim();
  const extraFrontmatter = Object.entries(extra)
    .map(([key, value]) => Array.isArray(value)
      ? `${key}:\n${value.map((entry) => `  - ${yamlString(entry)}`).join("\n")}`
      : `${key}: ${yamlString(value)}`)
    .join("\n");
  return `---
name: ${yamlString(name)}
description: ${yamlString(description)}
taphelu_managed: true
taphelu_runtime: ${yamlString(runtime)}
taphelu_source: ${yamlString(`taphelu-pack/${item.path}`)}
${extraFrontmatter ? `${extraFrontmatter}\n` : ""}role_metadata: ${yamlString(JSON.stringify({
    requiredSkills: item.requiredSkills || [],
    mcpTools: item.mcpTools || [],
    canDelegate: Boolean(item.canDelegate),
    closeoutGate: Boolean(item.closeoutGate),
  }))}
---

<!-- ${marker}: do not edit. Source: taphelu-pack/${item.path}. Regenerate with dl install. -->

${body}

## Taphelu Runtime Adapter

This file is generated from the canonical Taphelu pack. Edit the canonical source, then reinstall adapters.
`;
}

function addCommandFile(files, blockers, command, marker, runtime, targetRoot) {
  const spec = runtimeCommandSpec(command, marker, runtime, targetRoot);
  addManagedFile(files, blockers, {
    path: spec.path,
    content: spec.content,
    marker,
    kind: "command",
    runtime,
  });
}

function runtimeCommandSpec(command, marker, runtime, targetRoot) {
  if (runtime === "gemini") {
    return {
      path: join(targetRoot.commandsRoot, `${command.name}.toml`),
      content: renderCommandToml(command, marker),
    };
  }
  if (runtime === "kiro") {
    return {
      path: join(targetRoot.skillsRoot, command.name, "SKILL.md"),
      content: renderCommandAsSkill(command, marker, runtime),
    };
  }
  return {
    path: join(targetRoot.commandsRoot, `${command.name}.md`),
    content: renderCommandMarkdown(command, marker, runtime),
  };
}

function renderCommandMarkdown(command, marker, runtime) {
  return `---
name: ${yamlString(command.name)}
description: ${yamlString(command.summary || command.description || command.name)}
taphelu_managed: true
taphelu_runtime: ${yamlString(runtime)}
taphelu_source: ${yamlString(`taphelu-pack/${command.path}`)}
---

<!-- ${marker}: do not edit. Source: taphelu-pack/${command.path}. Regenerate with dl install. -->

${command.body.trim()}
`;
}

function renderCommandToml(command, marker) {
  const prompt = `<!-- ${marker}: do not edit. Source: taphelu-pack/${command.path}. Regenerate with dl install. -->\n\n${command.body.trim()}`;
  return `# ${marker}: do not edit. Source: taphelu-pack/${command.path}. Regenerate with dl install.
description = ${tomlString(command.summary || command.description || command.name)}
prompt = ${tomlMultilineString(prompt)}
`;
}

function renderCommandAsSkill(command, marker, runtime) {
  return `---
name: ${yamlString(command.name)}
description: ${yamlString(`${command.summary || command.name} Invoke with /${command.name}.`)}
taphelu_managed: true
taphelu_runtime: ${yamlString(runtime)}
taphelu_source: ${yamlString(`taphelu-pack/${command.path}`)}
---

<!-- ${marker}: do not edit. Source: taphelu-pack/${command.path}. Regenerate with dl install. -->

${command.body.trim()}
`;
}

function renderCodexInstructionPointer(marker) {
  return `${INSTRUCTION_BLOCK_START}
# Taphelu Runtime

<!-- ${marker}: do not edit. Regenerate with dl install. -->

Use Taphelu MCP tools and generated skills for lifecycle work. Start non-trivial work with \`dl_start\` or \`/dl-init\`, use \`dl_context\` before planning, checkpoint with \`dl_checkpoint\`, and close with \`dl_close\` after verification.

Use only visible Taphelu entrypoints: \`/dl-*\`, \`dl_*\`, or host-qualified \`taphelu:dl_*\`. Do not invent host tools as Taphelu entrypoints.

Keep this file compact. Do not paste raw logs, browser content, source dumps, PII, secrets, or roadmap history here.
${INSTRUCTION_BLOCK_END}
`;
}

function mergeManagedInstructionBlock(existing, block, marker) {
  const trimmedBlock = block.trimEnd();
  const start = existing.indexOf(INSTRUCTION_BLOCK_START);
  const end = existing.indexOf(INSTRUCTION_BLOCK_END);
  if (start !== -1 && end !== -1 && end > start) {
    return `${existing.slice(0, start)}${trimmedBlock}${existing.slice(end + INSTRUCTION_BLOCK_END.length)}`.trimEnd() + "\n";
  }
  if (existing.includes(marker) && existing.includes("Use Taphelu MCP tools")) {
    return `${trimmedBlock}\n`;
  }
  return `${existing.trimEnd()}\n\n${trimmedBlock}\n`;
}

function renderScriptArtifact(item, marker) {
  const source = item.content.trimStart();
  const markerLine = `// ${marker}: do not edit. Source: taphelu-pack/${item.path}. Regenerate with dl install.`;
  if (source.startsWith("#!")) {
    const newline = source.indexOf("\n");
    if (newline === -1) return `${source}\n${markerLine}\n`;
    return `${source.slice(0, newline + 1)}${markerLine}\n${source.slice(newline + 1).trimStart()}`;
  }
  return `${markerLine}\n${source}`;
}

function renderGeminiExtension(pack, nodeCommand, marker) {
  return `${JSON.stringify({
    name: "taphelu",
    version: pack.manifest.version,
    mcpServers: {
      taphelu: {
        command: nodeCommand,
        args: [MCP_BIN],
        env: { [JSON_MANAGED_ENV]: "1" },
      },
    },
    contextFileName: "GEMINI.md",
    excludeTools: ["run_shell_command(rm -rf)"],
    tapheluManaged: marker,
  }, null, 2)}\n`;
}

function renderGeminiExtensionContext(marker) {
  return `# Taphelu Gemini Extension

<!-- ${marker}: do not edit. Regenerate with dl install. -->

Taphelu is the workflow substrate for this project. Use these entrypoints exactly; do not invent host tools.

## Taphelu First

- Start status/context requests with \`/dl-status\` or \`mcp_taphelu_dl_context\`.
- Start or resume work with \`/dl-init\`, \`/dl-resume\`, or \`mcp_taphelu_dl_start\`.
- Plan with \`/dl-plan\` after loading compact context.
- Scan/import with \`/dl-scan\` or \`mcp_taphelu_dl_scan_project\`.
- Checkpoint with \`mcp_taphelu_dl_checkpoint\`.
- Close work with \`/dl-close\` or \`mcp_taphelu_dl_close\` after verification evidence exists.

## Tool Rules

- Do not call \`activate_skill\`, \`run_shell_command\`, \`write_file\`, \`list_directory\`, or other guessed tools as Taphelu actions.
- If a Taphelu tool appears with a different visible namespace, use the visible Taphelu \`dl_*\` tool name.
- If no Taphelu tool is visible, say the Taphelu tool is unavailable instead of guessing another tool.

## Context Rules

- Prefer compact context through \`mcp_taphelu_dl_context\` and \`mcp_taphelu_dl_context_store\`.
- Search/get specific artifacts before loading large content.
- Never copy raw logs, raw browser content, source dumps, PII, or secrets into runtime context.
`;
}

function buildMcpServerConfig(nodeCommand, runtime) {
  const config = {
    command: nodeCommand,
    args: [MCP_BIN],
    env: {
      [JSON_MANAGED_ENV]: "1",
    },
  };
  if (runtime === "claude") config.type = "stdio";
  return config;
}

function snapshotTarget(path) {
  return {
    path,
    exists: existsSync(path),
    content: existsSync(path) ? readFileSync(path, "utf8") : "",
  };
}

function rollbackTargets(snapshots, originalError) {
  const failures = [];
  for (const snapshot of snapshots.slice().reverse()) {
    try {
      if (snapshot.exists) {
        writeTextFileAtomic(snapshot.path, snapshot.content);
      } else if (existsSync(snapshot.path)) {
        unlinkSync(snapshot.path);
      }
    } catch (rollbackError) {
      failures.push(`${snapshot.path}: ${rollbackError.message}`);
    }
  }
  if (failures.length) {
    originalError.message = `${originalError.message} (rollback failed: ${failures.join("; ")})`;
  }
}

function snapshotMissingDirectories(paths) {
  const seen = new Set();
  const snapshots = [];
  for (const start of paths) {
    let current = start;
    while (current && !existsSync(current) && !seen.has(current)) {
      seen.add(current);
      snapshots.push({ path: current });
      const parent = dirname(current);
      if (parent === current) break;
      current = parent;
    }
  }
  return snapshots;
}

function removeCreatedDirectories(snapshots, originalError) {
  const failures = [];
  for (const snapshot of snapshots.slice().sort((a, b) => b.path.length - a.path.length)) {
    try {
      if (existsSync(snapshot.path) && !readdirSync(snapshot.path).length) {
        rmdirSync(snapshot.path);
      }
    } catch (rollbackError) {
      failures.push(`${snapshot.path}: ${rollbackError.message}`);
    }
  }
  if (failures.length) {
    originalError.message = `${originalError.message} (directory rollback failed: ${failures.join("; ")})`;
  }
}

function mergeCodexToml(existing, mcp) {
  const stripped = stripManagedBlock(existing);
  if (/\[mcp_servers\.taphelu\]/.test(stripped)) {
    return { blocker: "existing taphelu MCP block is not Taphelu-managed." };
  }
  const block = `${MANAGED_START}
[mcp_servers.taphelu]
command = ${tomlString(mcp.command)}
args = [${mcp.args.map(tomlString).join(", ")}]
[mcp_servers.taphelu.env]
${JSON_MANAGED_ENV} = "1"
${MANAGED_END}
`;
  return { content: `${stripped.trimEnd()}${stripped.trim() ? "\n\n" : ""}${block}` };
}

function mergeMcpJson(existing, mcp) {
  const parsed = existing.trim() ? safeJson(existing) : {};
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { blocker: "existing MCP JSON is invalid or not an object." };
  }
  const next = { ...parsed, mcpServers: { ...(parsed.mcpServers || {}) } };
  const current = next.mcpServers.taphelu;
  if (current && current.env?.[JSON_MANAGED_ENV] !== "1") {
    return { blocker: "existing taphelu MCP entry is not Taphelu-managed." };
  }
  next.mcpServers.taphelu = {
    ...(mcp.type ? { type: mcp.type } : {}),
    command: mcp.command,
    args: mcp.args,
    env: mcp.env,
  };
  return { content: `${JSON.stringify(next, null, 2)}\n` };
}

function removeManagedMcpJson(existing) {
  if (!existing.trim()) return { changed: false };
  const parsed = safeJson(existing);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { blocker: "existing MCP JSON is invalid or not an object." };
  }
  const current = parsed.mcpServers?.taphelu;
  if (!current) return { changed: false };
  if (current.env?.[JSON_MANAGED_ENV] !== "1") {
    return { blocker: "existing taphelu MCP entry is not Taphelu-managed." };
  }
  const next = { ...parsed, mcpServers: { ...(parsed.mcpServers || {}) } };
  delete next.mcpServers.taphelu;
  if (!Object.keys(next.mcpServers).length) delete next.mcpServers;
  return { changed: true, content: `${JSON.stringify(next, null, 2)}\n` };
}

function mergeRuntimeSettings(existing, spec) {
  const parsed = existing.trim() ? safeJson(existing) : {};
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { blocker: "existing runtime settings JSON is invalid or not an object." };
  }
  const next = { ...parsed };
  if (spec.runtime === "claude") {
    if (spec.hooks !== "off") {
      next.hooks = mergeClaudeHooks(next.hooks || {}, spec);
    } else if (next.hooks) {
      next.hooks = stripTapheluClaudeHooks(next.hooks);
      if (!Object.keys(next.hooks).length) delete next.hooks;
    }
    if (spec.statusline === "on") {
      const current = next.statusLine;
      if (!current || current.tapheluManaged === "1" || String(current.command || "").includes("taphelu-statusline.mjs")) {
        next.statusLine = {
          type: "command",
          command: `${shellQuote(spec.nodeCommand)} ${shellQuote(spec.statuslinePath)}`,
          padding: 0,
          refreshInterval: 60,
          tapheluManaged: "1",
        };
      } else {
        next.taphelu = {
          ...(next.taphelu || {}),
          statusline: {
            managed: "1",
            status: "skipped_existing_unmanaged",
            fallbackCommand: "/dl-status",
            command: `${shellQuote(spec.nodeCommand)} ${shellQuote(spec.statuslinePath)}`,
          },
        };
      }
    } else if (next.statusLine?.tapheluManaged === "1" || String(next.statusLine?.command || "").includes("taphelu-statusline.mjs")) {
      delete next.statusLine;
    }
    next.taphelu = {
      ...(next.taphelu || {}),
      managed: "1",
      hooks: spec.hooks,
      statusline: spec.statusline,
    };
    return { content: `${JSON.stringify(next, null, 2)}\n` };
  }

  const statusline = runtimeStatuslineSettings(spec);
  if (spec.runtime === "gemini" && spec.statusline === "on") {
    const ui = isPlainObject(next.ui) ? { ...next.ui } : {};
    const footer = isPlainObject(ui.footer) ? { ...ui.footer } : {};
    next.ui = {
      ...ui,
      hideFooter: false,
      footer: {
        ...footer,
        hideModelInfo: false,
        hideContextPercentage: false,
      },
    };
  }

  next.taphelu = {
    managed: "1",
    runtime: spec.runtime,
    hooks: spec.hooks === "off" ? "off" : {
      policy: spec.hooks,
      command: spec.nodeCommand,
      args: [spec.hookPath, "--policy", spec.hooks, "--runtime", spec.runtime],
    },
    statusline,
  };
  return { content: `${JSON.stringify(next, null, 2)}\n` };
}

function runtimeStatuslineSettings(spec) {
  if (spec.statusline !== "on") return "off";
  if (spec.statuslineCapability?.mode === "native-footer") {
    return {
      mode: "native-footer",
      displays: ["model", "context_percentage"],
      fallbackCommand: "/dl-status",
    };
  }
  if (spec.statuslineCapability?.mode === "native-tui") {
    return {
      mode: "native-tui",
      displays: ["runtime_status_bar"],
      fallbackCommand: "/dl-status",
    };
  }
  return { mode: "fallback", command: "/dl-status" };
}

function mergeClaudeHooks(existingHooks, spec) {
  const next = stripTapheluClaudeHooks(existingHooks);
  const hookCommand = {
    type: "command",
    command: spec.nodeCommand,
    args: [spec.hookPath, "--policy", spec.hooks, "--runtime", "claude"],
  };
  const events = [
    ["SessionStart", "startup|resume"],
    ["UserPromptSubmit", ""],
    ["PreToolUse", "Bash|Edit|Write|MultiEdit"],
    ["PostToolUse", "Bash|Edit|Write|MultiEdit"],
    ["Stop", ""],
    ["SubagentStop", ""],
    ["PreCompact", ""],
    ["PostCompact", ""],
  ];
  for (const [event, matcher] of events) {
    const current = Array.isArray(next[event]) ? next[event] : [];
    current.push({
      ...(matcher ? { matcher } : {}),
      hooks: [hookCommand],
    });
    next[event] = current;
  }
  return next;
}

function kiroCliHooks(input, hookPath) {
  const command = `${shellQuote(input.nodeCommand)} ${shellQuote(hookPath)} --policy ${shellQuote(input.hooks)} --runtime kiro`;
  return {
    agentSpawn: [{ command }],
    userPromptSubmit: [{ command }],
    preToolUse: [
      { matcher: "execute_bash", command },
      { matcher: "fs_write", command },
      { matcher: "@taphelu", command },
    ],
    postToolUse: [
      { matcher: "execute_bash", command },
      { matcher: "fs_write", command },
      { matcher: "@taphelu", command },
    ],
    stop: [{ command }],
  };
}

function renderKiroIdeHooks({ marker, nodeCommand, hookPath, policy }) {
  const baseCommand = `${shellQuote(nodeCommand)} ${shellQuote(hookPath)} --policy ${shellQuote(policy)} --runtime kiro`;
  const hookSpecs = [
    {
      file: "taphelu-prompt-context.kiro.hook",
      name: "Taphelu prompt context",
      description: "Inject compact Taphelu context and lifecycle guidance when a prompt is submitted.",
      when: { type: "promptSubmit" },
      then: { type: "shellCommand", command: `${baseCommand} --event promptSubmit` },
    },
    {
      file: "taphelu-pre-tool-guard.kiro.hook",
      name: "Taphelu pre-tool guard",
      description: "Block destructive shell/write actions and unsafe Taphelu memory promotion before tools run.",
      when: { type: "preToolUse", tools: ["shell", "write", "@mcp"] },
      then: { type: "shellCommand", command: `${baseCommand} --event preToolUse` },
    },
    {
      file: "taphelu-post-tool-observe.kiro.hook",
      name: "Taphelu post-tool observe",
      description: "Record compact observations after meaningful shell/write/MCP tool usage.",
      when: { type: "postToolUse", tools: ["shell", "write", "@mcp"] },
      then: { type: "shellCommand", command: `${baseCommand} --event postToolUse` },
    },
    {
      file: "taphelu-agent-stop.kiro.hook",
      name: "Taphelu agent stop",
      description: "Record turn completion and remind the agent to close through Taphelu verification gates.",
      when: { type: "agentStop" },
      then: { type: "shellCommand", command: `${baseCommand} --event agentStop` },
    },
  ];
  return hookSpecs.map((spec) => ({
    name: spec.file,
    content: `${JSON.stringify({
      enabled: true,
      name: spec.name,
      description: spec.description,
      version: "1",
      when: spec.when,
      then: spec.then,
      tapheluManaged: marker,
    }, null, 2)}\n`,
  }));
}

function kiroIdeHookNames() {
  return [
    "taphelu-prompt-context.kiro.hook",
    "taphelu-pre-tool-guard.kiro.hook",
    "taphelu-post-tool-observe.kiro.hook",
    "taphelu-agent-stop.kiro.hook",
  ];
}

function stripTapheluClaudeHooks(existingHooks) {
  const next = {};
  for (const [event, groups] of Object.entries(existingHooks || {})) {
    if (!Array.isArray(groups)) {
      next[event] = groups;
      continue;
    }
    const cleaned = groups
      .map((group) => ({
        ...group,
        hooks: Array.isArray(group.hooks)
          ? group.hooks.filter((hook) => !isTapheluHookCommand(hook))
          : group.hooks,
      }))
      .filter((group) => !Array.isArray(group.hooks) || group.hooks.length);
    if (cleaned.length) next[event] = cleaned;
  }
  return next;
}

function isTapheluHookCommand(hook) {
  return String(hook.command || "").includes("taphelu-runtime-hook.mjs")
    || (Array.isArray(hook.args) && hook.args.some((arg) => String(arg).includes("taphelu-runtime-hook.mjs")));
}

function inspectCodexMcpFile(file, content) {
  if (!content.includes(MANAGED_START) || !content.includes("[mcp_servers.taphelu]")) {
    return { path: file.path, status: "FAIL", message: "Codex MCP block missing." };
  }
  const block = managedCodexBlock(content);
  const command = block.match(/^\s*command\s*=\s*"([^"]+)"/m)?.[1];
  const argsRaw = block.match(/^\s*args\s*=\s*\[(.*?)\]/m)?.[1] || "";
  const args = [...argsRaw.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
  return inspectMcpCommand(file, command, args);
}

function inspectJsonMcpFile(file, content) {
  const parsed = safeJson(content);
  const entry = parsed?.mcpServers?.taphelu;
  if (entry?.env?.[JSON_MANAGED_ENV] !== "1") {
    return { path: file.path, status: "FAIL", message: "MCP server entry missing or unmanaged." };
  }
  return inspectMcpCommand(file, entry.command, entry.args);
}

function inspectNoManagedMcpFile(file, content) {
  const parsed = safeJson(content);
  if (!parsed) return { path: file.path, status: "FAIL", message: "Runtime MCP JSON is invalid." };
  if (parsed.mcpServers?.taphelu?.env?.[JSON_MANAGED_ENV] === "1") {
    return { path: file.path, status: "FAIL", message: "Duplicate managed Taphelu MCP entry should be removed from runtime settings." };
  }
  return { path: file.path, status: "PASS", message: "Duplicate managed MCP entry absent from runtime settings." };
}

function inspectMcpCommand(file, command, args = []) {
  if (!command || !isAbsolute(command)) {
    return { path: file.path, status: "FAIL", message: `MCP command must be an absolute executable path; found ${command || "missing"}.` };
  }
  if (!existsSync(command)) {
    return { path: file.path, status: "FAIL", message: `MCP command does not exist: ${command}.` };
  }
  if (command !== file.mcp.command) {
    return { path: file.path, status: "FAIL", message: `MCP command drift: expected ${file.mcp.command}, found ${command || "missing"}.` };
  }
  const [mcpPath] = Array.isArray(args) ? args : [];
  if (mcpPath !== file.mcp.args[0]) {
    return { path: file.path, status: "FAIL", message: `MCP server path drift: expected ${file.mcp.args[0]}, found ${mcpPath || "missing"}.` };
  }
  if (!existsSync(mcpPath)) {
    return { path: file.path, status: "FAIL", message: `MCP server path does not exist: ${mcpPath}.` };
  }
  return { path: file.path, status: "PASS", message: "Managed MCP server entry points to installed taphelu-mcp." };
}

function inspectSettingsJson(file, content) {
  const parsed = safeJson(content);
  if (!parsed) return { path: file.path, status: "FAIL", message: "Runtime settings JSON is invalid." };
  if (file.runtime === "claude") {
    const hasHook = Object.values(parsed.hooks || {}).some((groups) => Array.isArray(groups) && groups.some((group) => Array.isArray(group.hooks) && group.hooks.some((hook) => String(hook.command || "").includes(process.execPath) || (Array.isArray(hook.args) && hook.args.some((arg) => String(arg).includes("taphelu-runtime-hook.mjs"))))));
    const statusline = parsed.statusLine?.tapheluManaged === "1" || parsed.taphelu?.statusline?.managed === "1";
    if (file.hooks !== "off" && !hasHook) return { path: file.path, status: "FAIL", message: "Claude Taphelu hooks are missing." };
    if (file.statusline === "on" && !statusline) return { path: file.path, status: "WARN", message: "Claude Taphelu statusline is not active; /dl-status fallback may still work." };
    return { path: file.path, status: "PASS", message: "Claude hooks/statusline settings present." };
  }
  if (parsed.taphelu?.managed !== "1") {
    return { path: file.path, status: "FAIL", message: "Runtime settings missing Taphelu managed metadata." };
  }
  if (file.statusline === "on" && file.runtime === "gemini") {
    const footer = parsed.ui?.footer;
    if (parsed.ui?.hideFooter !== false || footer?.hideModelInfo !== false || footer?.hideContextPercentage !== false) {
      return { path: file.path, status: "FAIL", message: "Gemini native footer must show model info and context percentage." };
    }
    if (parsed.taphelu.statusline?.mode !== "native-footer") {
      return { path: file.path, status: "FAIL", message: "Gemini Taphelu status metadata must use native-footer mode." };
    }
    return { path: file.path, status: "PASS", message: "Gemini native footer status is enabled with model and context percentage." };
  }
  if (file.statusline === "on" && file.runtime === "kiro") {
    if (parsed.taphelu.statusline?.mode !== "native-tui") {
      return { path: file.path, status: "FAIL", message: "Kiro Taphelu status metadata must use native-tui mode." };
    }
    return { path: file.path, status: "PASS", message: "Kiro native TUI status is declared; /dl-status fallback metadata present." };
  }
  if (file.statusline === "on" && parsed.taphelu.statusline?.mode !== "fallback") {
    return { path: file.path, status: "FAIL", message: "Runtime without native Taphelu statusline must use /dl-status fallback metadata." };
  }
  return { path: file.path, status: "PASS", message: "Runtime hooks/status settings present." };
}

function inspectScriptArtifact(file, content) {
  if (!content.includes(file.marker)) {
    return { path: file.path, status: "FAIL", message: "File exists but lacks Taphelu managed marker." };
  }
  const result = spawnSync(process.execPath, ["--check", file.path], { encoding: "utf8" });
  if (result.status !== 0) {
    return { path: file.path, status: "FAIL", message: `Generated script syntax check failed: ${String(result.stderr || result.stdout || "").trim()}` };
  }
  return { path: file.path, status: "PASS", message: "Managed adapter script present and syntax-valid." };
}

function inspectKiroAgentJson(file, content) {
  const parsed = safeJson(content);
  if (!parsed) return { path: file.path, status: "FAIL", message: "Kiro agent JSON is invalid." };
  if (!String(parsed.prompt || "").includes(file.marker)) {
    return { path: file.path, status: "FAIL", message: "Kiro agent prompt lacks Taphelu managed marker." };
  }
  if (parsed.includeMcpJson !== true) {
    return { path: file.path, status: "FAIL", message: "Kiro agent must include MCP JSON." };
  }
  if (!Array.isArray(parsed.tools) || !parsed.tools.includes("*")) {
    return { path: file.path, status: "FAIL", message: "Kiro agent must declare tools so it can use skills and MCP." };
  }
  if (file.runtime === "kiro" && file.hooks !== "off" && (!parsed.hooks || !Object.keys(parsed.hooks).length)) {
    return { path: file.path, status: "FAIL", message: "Kiro CLI agent hooks are missing." };
  }
  return { path: file.path, status: "PASS", message: "Kiro CLI agent config includes MCP, tools, and hooks." };
}

function inspectKiroIdeHook(file, content) {
  const parsed = safeJson(content);
  if (!parsed) return { path: file.path, status: "FAIL", message: "Kiro IDE hook JSON is invalid." };
  if (parsed.tapheluManaged !== file.marker) {
    return { path: file.path, status: "FAIL", message: "Kiro IDE hook lacks Taphelu managed marker." };
  }
  if (parsed.enabled !== true || !parsed.when?.type || parsed.then?.type !== "shellCommand") {
    return { path: file.path, status: "FAIL", message: "Kiro IDE hook must be enabled shellCommand hook." };
  }
  return { path: file.path, status: "PASS", message: "Kiro IDE hook is present." };
}

function inspectExtensionJson(file, content) {
  const parsed = safeJson(content);
  if (!parsed || parsed.tapheluManaged !== file.marker) {
    return { path: file.path, status: "FAIL", message: "Gemini extension manifest missing Taphelu managed metadata." };
  }
  return inspectMcpCommand(file, parsed.mcpServers?.taphelu?.command, parsed.mcpServers?.taphelu?.args);
}

function runLiveMcpChecks(plan) {
  const checks = [];
  const seen = new Set();
  for (const file of plan.files.filter((item) => item.kind === "mcp-toml" || item.kind === "mcp-json" || item.kind === "extension-json")) {
    const key = `${file.runtime}:${file.mcp.command}:${file.mcp.args.join("\0")}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const input = [
      mcpFrame({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "dl-doctor", version: "0.1.0" },
        },
      }),
      mcpFrame({ jsonrpc: "2.0", method: "notifications/initialized" }),
      mcpFrame({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
    ].join("");
    const result = spawnSync(file.mcp.command, file.mcp.args, {
      cwd: process.cwd(),
      input,
      encoding: "utf8",
      timeout: MCP_HANDSHAKE_TIMEOUT_MS,
    });
    if (result.error) {
      checks.push({ path: file.path, status: "FAIL", message: `Live MCP smoke failed: ${result.error.message}` });
      continue;
    }
    if (result.status !== 0) {
      checks.push({ path: file.path, status: "FAIL", message: `Live MCP smoke exited ${result.status}: ${String(result.stderr || "").trim()}` });
      continue;
    }
    const responses = parseMcpOutput(result.stdout);
    const tools = responses.find((response) => response.id === 2)?.result?.tools || [];
    if (!tools.some((tool) => tool.name === "dl_start")) {
      checks.push({ path: file.path, status: "FAIL", message: "Live MCP smoke did not return dl_start." });
      continue;
    }
    checks.push({ path: file.path, status: "PASS", message: "Live MCP handshake and tools/list passed." });
  }
  return checks;
}

function mcpFrame(message) {
  const json = JSON.stringify(message);
  return `Content-Length: ${Buffer.byteLength(json, "utf8")}\r\n\r\n${json}`;
}

function parseMcpOutput(output) {
  const framed = parseMcpHeaderFrames(output);
  if (framed.length) return framed;
  return output.split(/\r?\n/).filter(Boolean).map((line) => safeJson(line)).filter(Boolean);
}

function parseMcpHeaderFrames(output) {
  const buffer = Buffer.from(output, "utf8");
  const messages = [];
  let cursor = 0;
  while (cursor < buffer.length) {
    while (cursor < buffer.length && [9, 10, 13, 32].includes(buffer[cursor])) cursor += 1;
    const boundary = findMcpHeaderBoundary(buffer, cursor);
    if (!boundary) break;
    const header = buffer.subarray(cursor, boundary.index).toString("utf8");
    const match = /Content-Length:\s*(\d+)/i.exec(header);
    if (!match) break;
    const start = boundary.index + boundary.length;
    const end = start + Number.parseInt(match[1], 10);
    if (buffer.length < end) break;
    const parsed = safeJson(buffer.subarray(start, end).toString("utf8"));
    if (parsed) messages.push(parsed);
    cursor = end;
  }
  return messages;
}

function findMcpHeaderBoundary(buffer, start) {
  const crlf = buffer.indexOf("\r\n\r\n", start);
  const lf = buffer.indexOf("\n\n", start);
  if (crlf === -1 && lf === -1) return null;
  if (crlf !== -1 && (lf === -1 || crlf < lf)) return { index: crlf, length: 4 };
  return { index: lf, length: 2 };
}

function detectLocalShadowing(root, plan) {
  if (plan.scope !== "global") return [];
  const checks = [];
  for (const runtime of plan.runtimes) {
    const runtimeConfig = loadPack().manifest.runtimes[runtime];
    const local = runtimeTargetRoot(root, runtimeConfig, runtime, "local", "");
    const paths = [local.mcpConfigPath];
    for (const path of paths) {
      if (!existsSync(path)) continue;
      const content = readFileSync(path, "utf8");
      const hasTaphelu = runtime === "codex"
        ? /\[mcp_servers\.taphelu\]/.test(content)
        : Boolean(safeJson(content)?.mcpServers?.taphelu);
      if (hasTaphelu) {
        checks.push({
          path,
          status: "WARN",
          message: `Local ${runtime} Taphelu MCP config exists and may shadow global config.`,
        });
      }
    }
  }
  return checks;
}

function managedCodexBlock(content) {
  const start = content.indexOf(MANAGED_START);
  const end = content.indexOf(MANAGED_END);
  if (start === -1 || end === -1 || end < start) return "";
  return content.slice(start, end + MANAGED_END.length);
}

function runtimeTargetRoot(root, runtimeConfig, runtime, scope, configDir) {
  if (scope === "local") {
    const base = join(root, runtimeConfig.configDir);
    const extensionRoot = runtime === "gemini" ? join(base, "extensions", "taphelu") : "";
    return {
      base,
      skillsRoot: join(base, runtimeConfig.skillsDir),
      agentsRoot: runtimeConfig.agentsDir ? join(base, runtimeConfig.agentsDir) : join(base, "agents"),
      commandsRoot: runtime === "gemini" ? join(extensionRoot, "commands") : join(base, "commands"),
      hooksRoot: join(base, "hooks"),
      steeringRoot: join(base, "steering"),
      settingsPath: runtimeSettingsPath(base, runtime),
      extensionRoot,
      extensionManifestPath: runtime === "gemini" ? join(extensionRoot, "gemini-extension.json") : "",
      mcpConfigPath: runtime === "claude" ? join(root, ".mcp.json") : join(base, runtimeConfig.mcpConfig),
    };
  }

  const base = resolveGlobalDir(runtimeConfig, configDir);
  const extensionRoot = runtime === "gemini" ? join(base, "extensions", "taphelu") : "";
  return {
    base,
    skillsRoot: join(base, runtimeConfig.skillsDir),
    agentsRoot: runtimeConfig.agentsDir ? join(base, runtimeConfig.agentsDir) : join(base, "agents"),
    commandsRoot: runtime === "gemini" ? join(extensionRoot, "commands") : join(base, "commands"),
    hooksRoot: join(base, "hooks"),
    steeringRoot: join(base, "steering"),
    settingsPath: runtimeSettingsPath(base, runtime),
    extensionRoot,
    extensionManifestPath: runtime === "gemini" ? join(extensionRoot, "gemini-extension.json") : "",
    mcpConfigPath: runtime === "claude" && !configDir ? join(homedir(), ".claude.json") : join(base, runtime === "codex" ? "config.toml" : runtimeConfig.mcpConfig),
  };
}

function runtimeSettingsPath(base, runtime) {
  if (runtime === "claude") return join(base, "settings.json");
  if (runtime === "kiro") return join(base, "settings", "taphelu.json");
  if (runtime === "gemini") return join(base, "extensions", "taphelu", "taphelu-runtime.json");
  return join(base, "taphelu-runtime.json");
}

function resolveGlobalDir(runtimeConfig, configDir) {
  if (configDir) return resolve(configDir);
  if (runtimeConfig.globalEnv && process.env[runtimeConfig.globalEnv]) return resolve(process.env[runtimeConfig.globalEnv]);
  return join(homedir(), runtimeConfig.defaultGlobalDir);
}

function runtimeConfigDir(configDir, runtime, runtimes) {
  if (!configDir || runtimes.length === 1) return configDir;
  return join(configDir, runtime);
}

function normalizeRuntime(runtime) {
  if (runtime === "all") return SUPPORTED_RUNTIMES;
  const runtimes = String(runtime).split(",").map((item) => item.trim()).filter(Boolean);
  if (!runtimes.length) throw new Error("Missing runtime.");
  for (const item of runtimes) {
    if (!SUPPORTED_RUNTIMES.includes(item)) {
      throw new Error(`Invalid runtime: ${item}. Expected ${SUPPORTED_RUNTIMES.join(", ")}, or all.`);
    }
  }
  return [...new Set(runtimes)];
}

function normalizeScope(scope) {
  if (scope === "local" || scope === "global") return scope;
  throw new Error(`Invalid scope: ${scope}. Expected local or global.`);
}

function normalizeProfile(profile) {
  if (SUPPORTED_PROFILES.includes(profile)) return profile;
  throw new Error(`Invalid profile: ${profile}. Expected ${SUPPORTED_PROFILES.join(", ")}.`);
}

function normalizeHooks(hooks) {
  if (SUPPORTED_HOOK_POLICIES.includes(hooks)) return hooks;
  throw new Error(`Invalid hooks policy: ${hooks}. Expected ${SUPPORTED_HOOK_POLICIES.join(", ")}.`);
}

function normalizeStatusline(statusline) {
  if (SUPPORTED_STATUSLINE.includes(statusline)) return statusline;
  throw new Error(`Invalid statusline: ${statusline}. Expected ${SUPPORTED_STATUSLINE.join(", ")}.`);
}

function parseFrontmatter(content) {
  const lines = content.split(/\r?\n/);
  if (lines[0] !== "---") return { frontmatter: {}, body: content };
  const end = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
  if (end === -1) return { frontmatter: {}, body: content };
  const raw = lines.slice(1, end).join("\n").trim();
  const body = lines.slice(end + 1).join("\n").trimStart();
  const frontmatter = {};
  for (const line of raw.split(/\r?\n/)) {
    const match = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line.trim());
    if (match) frontmatter[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
  return { frontmatter, body };
}

function stripManagedBlock(content) {
  const start = content.indexOf(MANAGED_START);
  const end = content.indexOf(MANAGED_END);
  if (start === -1 || end === -1 || end < start) return content;
  return `${content.slice(0, start)}${content.slice(end + MANAGED_END.length)}`.trimEnd();
}

function safeJson(content) {
  try {
    return JSON.parse(content || "{}");
  } catch {
    return null;
  }
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function yamlString(value) {
  return JSON.stringify(String(value));
}

function tomlString(value) {
  return JSON.stringify(String(value));
}

function tomlMultilineString(value) {
  return `"""\n${String(value).replace(/"""/g, '\\"\\"\\"')}\n"""`;
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}
