#!/usr/bin/env node

import { main } from "../src/cli.mjs";

try {
  main();
} catch (error) {
  console.error(`dl: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
