import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";
import { REPO_ROOT } from "./helpers.mjs";

test("npm pack ships only bin, src, skills, README, LICENSE and package.json", () => {
  const win = process.platform === "win32";
  // On Windows npm is a .cmd file, which Node only runs through a shell.
  const out = execFileSync(win ? "npm.cmd" : "npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    shell: win,
  });
  const parsed = JSON.parse(out);
  // npm 10 prints an array, npm 11 an object keyed by package name
  const entry = Array.isArray(parsed) ? parsed[0] : Object.values(parsed)[0];
  const files = entry.files.map((f) => f.path);
  const allowed = /^(bin\/|src\/|plugins\/[^/]+\/skills\/|README\.md$|LICENSE$|package\.json$)/;
  assert.deepEqual(files.filter((f) => !allowed.test(f)), []);
  assert.ok(files.includes("bin/agent-skills.mjs"));
  assert.ok(files.includes("src/cli/main.mjs"));
  assert.ok(!files.some((f) => f.includes("node_modules")));
});
