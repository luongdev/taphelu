#!/usr/bin/env node

const emitWarning = process.emitWarning;
process.emitWarning = function tapheluEmitWarning(warning, ...args) {
  const text = typeof warning === "string" ? warning : warning?.message || "";
  if (text.includes("SQLite is an experimental feature")) return;
  return emitWarning.call(this, warning, ...args);
};

const { startMcpServer } = await import("../src/mcp/server.mjs");
startMcpServer();
