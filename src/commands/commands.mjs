import { COMMAND_MANIFEST } from "../manifest.mjs";
import { escapeTable } from "../utils.mjs";

export function printCommands() {
  console.log(`# Command Manifest

| Command | Usage | Summary |
|---|---|---|
${COMMAND_MANIFEST.map((command) => `| \`${command.name}\` | \`${escapeTable(command.usage)}\` | ${escapeTable(command.summary)} |`).join("\n")}
`);
}
