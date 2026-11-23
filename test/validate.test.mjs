import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { validateRepo } from "../src/lib/validate.mjs";

function repo(skills, agents = []) {
  const root = mkdtempSync(join(tmpdir(), "agent-skills-validate-"));
  const plugins = [...new Set(skills.map(([p]) => p))];
  for (const [plugin, skill] of skills) {
    const dir = join(root, "plugins", plugin, "skills", skill);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "SKILL.md"), `---\nname: ${skill}\ndescription: Test skill.\n---\n`);
  }
  for (const [plugin, file, content] of agents) {
    mkdirSync(join(root, "plugins", plugin, "agents"), { recursive: true });
    writeFileSync(join(root, "plugins", plugin, "agents", file), content);
    if (!plugins.includes(plugin)) plugins.push(plugin);
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

const agent = (name, extra = "tools: Read, Grep, Glob, Bash\n") => `---\nname: ${name}\ndescription: Audits things. Use when asked to audit.\n${extra}---\nBody.\n`;

test("a valid subagent passes", () => {
  const root = repo([["a", "one"]], [["a", "stacks-auditor.md", agent("stacks-auditor")]]);
  const r = validateRepo(root);
  assert.deepEqual(r.errors, []);
  assert.equal(r.agentCount, 1);
  rmSync(root, { recursive: true });
});

test("a tools list written as a YAML list passes", () => {
  const root = repo([["a", "one"]], [["a", "x-agent.md", agent("x-agent", "tools:\n  - Read\n  - Grep\n")]]);
  assert.deepEqual(validateRepo(root).errors, []);
  rmSync(root, { recursive: true });
});

test("a subagent whose name does not match the file fails and reports both", () => {
  const root = repo([["a", "one"]], [["a", "stacks-auditor.md", agent("auditor")]]);
  const { errors } = validateRepo(root);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /plugins\/a\/agents\/stacks-auditor\.md/);
  assert.match(errors[0], /name "auditor" does not match the file name "stacks-auditor"/);
  rmSync(root, { recursive: true });
});

test("a subagent without tools fails, because it would inherit every tool", () => {
  const root = repo([["a", "one"]], [["a", "x-agent.md", agent("x-agent", "")]]);
  const { errors } = validateRepo(root);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /missing "tools"/);
  rmSync(root, { recursive: true });
});

test("a subagent without frontmatter or description fails", () => {
  const root = repo([["a", "one"]], [["a", "bare.md", "no frontmatter\n"], ["a", "nodesc.md", "---\nname: nodesc\ntools: Read\n---\n"]]);
  const { errors } = validateRepo(root);
  assert.ok(errors.some((e) => /bare\.md: missing YAML frontmatter/.test(e)));
  assert.ok(errors.some((e) => /nodesc\.md: frontmatter is missing "description"/.test(e)));
  rmSync(root, { recursive: true });
});

test("the same subagent name in two plugins fails and names both files", () => {
  const root = repo([["a", "one"], ["b", "two"]], [["a", "stacks-auditor.md", agent("stacks-auditor")], ["b", "stacks-auditor.md", agent("stacks-auditor")]]);
  const { errors } = validateRepo(root);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /agent name "stacks-auditor" is used more than once/);
  assert.match(errors[0], /plugins\/a\/agents\/stacks-auditor\.md/);
  assert.match(errors[0], /plugins\/b\/agents\/stacks-auditor\.md/);
  rmSync(root, { recursive: true });
});
