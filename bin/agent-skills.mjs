#!/usr/bin/env node
const major = Number(process.versions.node.split(".")[0]);
if (major < 20) {
  console.error(`agent-skills requires Node.js 20 or later (found ${process.version}).`);
  process.exit(1);
}
const { main } = await import("../src/cli/main.mjs");
process.exitCode = await main(process.argv.slice(2));
