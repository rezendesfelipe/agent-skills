import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { validateRepo } from "../src/lib/validate.mjs";

function repo(skills) {
  const root = mkdtempSync(join(tmpdir(), "agent-skills-validate-"));
  const plugins = [...new Set(skills.map(([p]) => p))];
  for (const [plugin, skill] of skills) {
    const dir = join(root, "plugins", plugin, "skills", skill);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "SKILL.md"), `---\nname: ${skill}\ndescription: Test skill.\n---\n`);
  }
  mkdirSync(join(root, ".claude-plugin"));
  writeFileSync(
    join(root, ".claude-plugin", "marketplace.json"),
    JSON.stringify({ name: "t", owner: { name: "t" }, plugins: plugins.map((p) => ({ name: p, source: `./plugins/${p}` })) }),
  );
  return root;
}

test("unique names across plugins pass", () => {
  const root = repo([["a", "one"], ["b", "two"]]);
  assert.deepEqual(validateRepo(root).errors, []);
  rmSync(root, { recursive: true });
});

test("same skill name in two plugins fails and names both folders", () => {
  const root = repo([["a", "pdf-tools"], ["b", "pdf-tools"]]);
  const { errors } = validateRepo(root);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /pdf-tools/);
  assert.match(errors[0], /plugins\/a\/skills\/pdf-tools/);
  assert.match(errors[0], /plugins\/b\/skills\/pdf-tools/);
  rmSync(root, { recursive: true });
});

test("the repository itself is valid", async () => {
  const { fileURLToPath } = await import("node:url");
  assert.deepEqual(validateRepo(fileURLToPath(new URL("..", import.meta.url))).errors, []);
});
