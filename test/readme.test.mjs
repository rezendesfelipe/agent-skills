import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { TOOLS, TOOL_IDS } from "../src/lib/tools.mjs";
import { REPO_ROOT } from "./helpers.mjs";

const readme = readFileSync(join(REPO_ROOT, "README.md"), "utf8");

test("the README install table matches the CLI's skills and agents paths and file extensions", () => {
  for (const id of TOOL_IDS) {
    const row = readme.split("\n").find((l) => l.includes(`| \`${id}\` |`));
    assert.ok(row, `install table row for ${id}`);
    for (const path of [`~/${TOOLS[id].user}/`, `${TOOLS[id].project}/`, `~/${TOOLS[id].agents.user}/`, `${TOOLS[id].agents.project}/`])
      assert.ok(row.includes(`\`${path}\``), `${id}: ${path}`);
    assert.ok(row.includes(`\`${TOOLS[id].agents.ext}\``), `${id} extension`);
  }
});
