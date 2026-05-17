import { readFileSync } from "node:fs";
import { join } from "node:path";
import { EVENT_TYPES, MEMORY_CATEGORIES } from "../constants.mjs";
import { parseArgs, parseLimit } from "../args.mjs";
import { appendEvent, timestampForId } from "../events.mjs";
import { readProjectFile, withProjectFilesTransaction, writeTextFileAtomic } from "../project.mjs";
import { section, replaceSection, formatList, escapeTable, unsafeMemory } from "../utils.mjs";
import { fail } from "../errors.mjs";

export function runMemory(root, rawArgs) {
  const { options, values } = parseArgs(rawArgs);
  if (values.length) {
    fail("Unexpected positional value for dl memory. Use --category, --limit, or --prune.");
  }

  const category = options.category ? normalizeMemoryCategory(options.category) : "";
  const limit = parseLimit(options.limit ?? "5");

  if (options.prune) {
    const result = pruneMemory(root, category);
    console.log(buildMemoryPrunePacket(result, options.write));
    if (options.write) {
      withProjectFilesTransaction(root, ["MEMORY.md", "events.jsonl"], () => {
        writeTextFileAtomic(join(root, ".projects", "MEMORY.md"), result.markdown);
        appendEvent(root, {
          ts: new Date().toISOString(),
          type: EVENT_TYPES.MEMORY_PRUNED,
          run_id: `run-${timestampForId()}-memory`,
          summary: "Curated memory pruned by dl memory.",
          data: {
            category: category || "all",
            before_count: result.beforeCount,
            after_count: result.afterCount,
            removed_count: result.removedCount,
          },
        });
      });
    }
    return;
  }

  const overview = buildMemoryOverview(root, category, limit);
  console.log(overview);
  if (options.write) {
    appendEvent(root, {
      ts: new Date().toISOString(),
      type: EVENT_TYPES.MEMORY_REVIEWED,
      run_id: `run-${timestampForId()}-memory`,
      summary: "Curated memory reviewed by dl memory.",
      data: { category: category || "all", limit },
    });
  }
}

export function runRemember(root, rawArgs) {
  const { options, values } = parseArgs(rawArgs);
  const item = normalizeMemoryItem(values.join(" "));
  if (!item) {
    fail("Missing memory item. Usage: dl remember --category name <memory>");
  }

  const category = normalizeMemoryCategory(options.category ?? "");
  const memory = analyzeMemoryItem(item, {
    category,
    source: options.source ?? [],
    replace: options.replace ?? "",
  });

  console.log(buildRememberPacket(memory, options.write));

  if (options.write && memory.nextRoute !== "blocked") {
    withProjectFilesTransaction(root, ["MEMORY.md", "events.jsonl"], () => {
      const result = upsertMemoryItem(root, memory);
      appendEvent(root, {
        ts: new Date().toISOString(),
        type: EVENT_TYPES.MEMORY_RECORDED,
        run_id: `run-${timestampForId()}-memory`,
        summary: "Durable memory recorded by dl remember.",
        data: {
          category: memory.category,
          heading: result.heading,
          replaced: Boolean(memory.replace),
          source_count: memory.source.length,
        },
      });
    });
  }
}

export function runForget(root, rawArgs) {
  const { options, values } = parseArgs(rawArgs);
  const category = options.category ? normalizeMemoryCategory(options.category) : "";
  const item = normalizeMemoryItem(options.item ?? values.join(" "));
  const pattern = options.pattern ?? "";
  const reset = Boolean(options.reset);

  if (!reset && !category && !item && !pattern) {
    fail("Missing forget selector. Use --category, --pattern, --item, --reset, or a positional exact item.");
  }

  const result = forgetMemory(root, { category, item, pattern, reset });
  console.log(buildForgetPacket(result, options.write));

  if (options.write) {
    withProjectFilesTransaction(root, ["MEMORY.md", "events.jsonl"], () => {
      writeTextFileAtomic(join(root, ".projects", "MEMORY.md"), result.markdown);
      appendEvent(root, {
        ts: new Date().toISOString(),
        type: EVENT_TYPES.MEMORY_FORGOTTEN,
        run_id: `run-${timestampForId()}-memory`,
        summary: "Curated memory removed by dl forget.",
        data: {
          category: category || "all",
          selector: reset ? "reset" : pattern ? "pattern" : item ? "item" : "category",
          removed_count: result.removed.length,
        },
      });
    });
  }
}

function buildMemoryOverview(root, category, limit) {
  const markdown = readProjectFile(root, "MEMORY.md");
  const categories = category ? [category] : Object.keys(MEMORY_CATEGORIES);
  const rows = categories.map((key) => {
    const heading = MEMORY_CATEGORIES[key];
    const bullets = memoryBullets(markdown, heading);
    const sample = bullets.slice(0, limit).map((item) => `  - ${item}`).join("\n") || "  - None recorded.";
    return { key, heading, count: bullets.length, sample };
  });

  return `# Memory Overview

## Categories

| Category | Heading | Items |
|---|---|---:|
${rows.map((row) => `| \`${row.key}\` | ${escapeTable(row.heading)} | ${row.count} |`).join("\n")}

## Items

${rows.map((row) => `### ${row.heading}\n\n${row.sample}`).join("\n\n")}

## Review Checklist

- Keep only durable facts, preferences, decisions, constraints, and reusable lessons.
- Move task-local status to STATE.md.
- Move run history to RUNS.md.
- Keep raw logs, raw browser content, PII, and secrets out of memory by default.
- Use \`dl memory --prune --write\` after duplicates accumulate.
`;
}

function analyzeMemoryItem(item, input) {
  const risks = [];
  let nextRoute = "write";

  if (unsafeMemory(item)) {
    risks.push("Memory item appears to contain secrets, PII, raw logs, or raw browser content.");
    nextRoute = "blocked";
  }
  if (input.source.some((source) => unsafeMemory(source))) {
    risks.push("Source reference appears to contain sensitive data.");
    nextRoute = "blocked";
  }

  return {
    item,
    category: input.category,
    heading: MEMORY_CATEGORIES[input.category],
    source: input.source,
    replace: normalizeMemoryItem(input.replace),
    risks,
    nextRoute,
  };
}

function buildRememberPacket(memory, willWrite) {
  const writeEffect = willWrite
    ? memory.nextRoute === "blocked"
      ? "- This invocation will not write because the memory item is blocked."
      : "- This invocation will update MEMORY.md and append a memory_recorded event."
    : "- Add `--write` to persist this memory item.";

  return `# Remember Packet

## Category

\`${memory.category}\` -> ${memory.heading}

## Memory Item

- ${memory.item}

## Source References

${formatList(memory.source, "No source reference recorded.")}

## Replace

${memory.replace ? `- ${memory.replace}` : "- No replacement target."}

## Risks

${formatList(memory.risks, "None.")}

## Write Behavior

${writeEffect}

## Next Route

\`${memory.nextRoute}\`
`;
}

function upsertMemoryItem(root, memory) {
  const path = join(root, ".projects", "MEMORY.md");
  let markdown = readProjectFile(root, "MEMORY.md");
  const existing = memoryBullets(markdown, memory.heading);
  const next = existing
    .filter((item) => item !== memory.item)
    .filter((item) => !memory.replace || item !== memory.replace);
  next.push(memory.item);
  markdown = replaceSection(markdown, memory.heading, next.map((item) => `- ${item}`).join("\n"));
  writeTextFileAtomic(path, markdown);
  return { heading: memory.heading, count: next.length };
}

function forgetMemory(root, input) {
  const markdown = readProjectFile(root, "MEMORY.md");
  const categories = input.category ? [input.category] : Object.keys(MEMORY_CATEGORIES);
  const removed = [];
  let nextMarkdown = markdown;

  for (const key of categories) {
    const heading = MEMORY_CATEGORIES[key];
    const bullets = memoryBullets(nextMarkdown, heading);
    const kept = [];

    for (const item of bullets) {
      const shouldRemove = input.reset ||
        (!input.item && !input.pattern && input.category) ||
        (input.item && item === input.item) ||
        (input.pattern && item.toLowerCase().includes(input.pattern.toLowerCase()));
      if (shouldRemove) {
        removed.push({ category: key, item });
      } else {
        kept.push(item);
      }
    }

    if (removed.some((entry) => entry.category === key) || input.reset || (input.category && !input.item && !input.pattern)) {
      nextMarkdown = replaceSection(nextMarkdown, heading, kept.map((item) => `- ${item}`).join("\n"));
    }
  }

  return {
    markdown: nextMarkdown,
    category: input.category || "all",
    selector: input.reset ? "reset" : input.pattern ? input.pattern : input.item ? input.item : input.category,
    removed,
  };
}

function buildForgetPacket(result, willWrite) {
  return `# Forget Packet

## Scope

- Category: \`${result.category}\`
- Selector: ${result.selector}

## Removed Items

${formatList(result.removed.map((entry) => `${entry.category}: ${entry.item}`), "None matched.")}

## Write Behavior

${willWrite ? "- This invocation will update MEMORY.md and append a memory_forgotten event." : "- Add `--write` to apply this removal."}

## Next Route

\`${willWrite ? "written" : "review"}\`
`;
}

function pruneMemory(root, category) {
  const markdown = readProjectFile(root, "MEMORY.md");
  const categories = category ? [category] : Object.keys(MEMORY_CATEGORIES);
  let nextMarkdown = markdown;
  let beforeCount = 0;
  let afterCount = 0;

  for (const key of categories) {
    const heading = MEMORY_CATEGORIES[key];
    const bullets = memoryBullets(nextMarkdown, heading);
    beforeCount += bullets.length;
    const seen = new Set();
    const unique = [];
    for (const item of bullets) {
      const normalized = item.toLowerCase();
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      unique.push(item);
    }
    afterCount += unique.length;
    nextMarkdown = replaceSection(nextMarkdown, heading, unique.map((item) => `- ${item}`).join("\n"));
  }

  return {
    markdown: nextMarkdown,
    category: category || "all",
    beforeCount,
    afterCount,
    removedCount: beforeCount - afterCount,
  };
}

function buildMemoryPrunePacket(result, willWrite) {
  return `# Memory Prune Packet

## Scope

\`${result.category}\`

## Counts

- Before: ${result.beforeCount}
- After: ${result.afterCount}
- Removed: ${result.removedCount}

## Write Behavior

${willWrite ? "- This invocation will update MEMORY.md and append a memory_pruned event." : "- Add `--write` to apply this prune."}

## Next Route

\`${willWrite ? "written" : "review"}\`
`;
}

function normalizeMemoryCategory(category) {
  const normalized = String(category)
    .trim()
    .toLowerCase()
    .replaceAll("-", "_")
    .replaceAll(" ", "_");
  const aliases = {
    user: "user_preferences",
    users: "user_preferences",
    preference: "user_preferences",
    preferences: "user_preferences",
    user_preference: "user_preferences",
    decision: "project_decisions",
    decisions: "project_decisions",
    product_decisions: "project_decisions",
    project_decision: "project_decisions",
    architecture: "architecture_constraints",
    architecture_decisions: "architecture_constraints",
    architecture_decision: "architecture_constraints",
    constraint: "architecture_constraints",
    constraints: "architecture_constraints",
    workflow: "workflow_preferences",
    workflow_principles: "workflow_preferences",
    workflow_preference: "workflow_preferences",
    integration: "integration_constraints",
    integration_constraint: "integration_constraints",
    repo: "repo_facts",
    repo_fact: "repo_facts",
    fact: "repo_facts",
    facts: "repo_facts",
    lesson: "reusable_lessons",
    lessons: "reusable_lessons",
    reusable_lesson: "reusable_lessons",
  };
  const key = aliases[normalized] ?? normalized;
  if (MEMORY_CATEGORIES[key]) return key;
  fail(`Invalid memory category: ${category}. Expected one of: ${Object.keys(MEMORY_CATEGORIES).join(", ")}.`);
}

export function memoryBullets(markdown, heading) {
  return section(markdown, heading)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "))
    .map((line) => line.slice(2).trim())
    .filter((line) => line && line !== "None recorded.");
}

function normalizeMemoryItem(value) {
  return String(value)
    .replace(/\s+/g, " ")
    .replace(/^- /, "")
    .trim();
}
