#!/usr/bin/env node
// assessment-report engine. Usage: node scripts/assess.mjs <command> [options]
import { ENGINE_VERSION } from "./lib/version.mjs";

const HELP = `assessment-report engine ${ENGINE_VERSION}

Commands will be listed here as they are implemented.`;

if (process.argv.includes("--help") || process.argv.length < 3) {
  console.log(HELP);
  process.exit(0);
}
if (process.argv.includes("--version")) {
  console.log(ENGINE_VERSION);
  process.exit(0);
}
console.error(HELP);
process.exit(2);
