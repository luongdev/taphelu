import { readProjectFile } from "../project.mjs";
import { section } from "../utils.mjs";

export function printStatus(root) {
  const state = readProjectFile(root, "STATE.md");
  const memory = readProjectFile(root, "MEMORY.md");

  const fields = [
    ["Current Goal", section(state, "Current Goal")],
    ["Current Milestone", section(state, "Current Milestone")],
    ["Current Phase", section(state, "Current Phase")],
    ["Next Action", section(state, "Next Action")],
    ["Blockers", section(state, "Blockers")],
    ["Last Verification", section(state, "Last Verification")],
  ];

  console.log("# taphelu status\n");
  for (const [label, value] of fields) {
    console.log(`## ${label}\n`);
    console.log(`${value || "_Not recorded._"}\n`);
  }

  const decisions = section(memory, "Product Decisions");
  if (decisions) {
    console.log("## Product Decisions\n");
    console.log(decisions);
    console.log();
  }
}
