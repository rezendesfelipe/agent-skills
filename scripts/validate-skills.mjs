#!/usr/bin/env node
// Validates skills, plugin subagents and the plugin marketplace manifest. No dependencies.
// Usage: node scripts/validate-skills.mjs
import { fileURLToPath } from "node:url";
import { validateRepo } from "../src/lib/validate.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const { errors, skillCount, agentCount } = validateRepo(root);

if (errors.length) {
  console.error(`✗ ${errors.length} problem(s):\n` + errors.map((e) => `  - ${e}`).join("\n"));
  process.exit(1);
}
console.log(`✓ ${skillCount} skill(s)${agentCount ? `, ${agentCount} agent(s)` : ""}, template and marketplace manifest are valid`);
