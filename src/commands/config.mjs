import { parseArgs } from "../args.mjs";
import { fail } from "../errors.mjs";
import { getProjectConfigValue, readProjectConfig, setProjectConfigValue } from "../project-config.mjs";

export function runConfig(root, rawArgs) {
  const [subcommand, ...rest] = rawArgs;
  if (!subcommand) {
    fail("Missing config subcommand. Usage: dl config get [key] | dl config set testing.strictness low|medium|deep");
  }
  if (subcommand === "get") return runConfigGet(root, rest);
  if (subcommand === "set") return runConfigSet(root, rest);
  fail(`Unknown config subcommand: ${subcommand}`);
}

function runConfigGet(root, rawArgs) {
  const { values } = parseArgs(rawArgs);
  if (values.length > 1) fail("Usage: dl config get [key]");
  const key = values[0] || "";
  const value = key ? getProjectConfigValue(root, key) : readProjectConfig(root);
  if (value === undefined) fail(`Unknown config key: ${key}`);
  console.log(formatConfigValue(key, value));
}

function runConfigSet(root, rawArgs) {
  const { values } = parseArgs(rawArgs);
  if (values.length !== 2) fail("Usage: dl config set testing.strictness low|medium|deep");
  const [key, value] = values;
  const config = setProjectConfigValue(root, key, value);
  console.log(`# Config Updated

## Key

\`${key}\`

## Value

\`${getProjectConfigValue(root, key)}\`

## Current Config

\`\`\`json
${JSON.stringify(config, null, 2)}
\`\`\`
`);
}

function formatConfigValue(key, value) {
  if (!key) {
    return `# Project Config

\`\`\`json
${JSON.stringify(value, null, 2)}
\`\`\`
`;
  }
  if (typeof value === "object") {
    return `# Config Value

## Key

\`${key}\`

\`\`\`json
${JSON.stringify(value, null, 2)}
\`\`\`
`;
  }
  return `# Config Value

## Key

\`${key}\`

## Value

\`${value}\`
`;
}
