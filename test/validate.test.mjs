import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
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

// ---- agent-catalog: location, source format, uniqueness, template -------------------------------
import { cpSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { FIXTURE_ROOT, REPO_ROOT } from "./helpers.mjs";
import { validateAgent } from "../src/lib/validate.mjs";
import { effectiveTools } from "../src/lib/agents/permissions.mjs";
import { parseDocument } from "../src/lib/frontmatter.mjs";

const errorsFor = (file, content, opts = {}) => {
  const root = repo([["a", "alpha"]], [["a", file, content]]);
  const { errors } = validateRepo(root, opts);
  rmSync(root, { recursive: true });
  return errors;
};
const fixt = (rel) => readFileSync(join(FIXTURE_ROOT, "..", rel), "utf8");
const doc = (fm, body = "Prompt.\n") => `---\n${fm}\n---\n${body}`;
const ok = "name: x-agent\ndescription: Does a thing. Use when asked.\ntools: Read, Grep";

test("agent-catalog: nested folders fail", () => {
  const root = repo([["a", "one"]], [["a", "sub/x-agent.md", agent("x-agent")]].slice(0, 0));
  mkdirSync(join(root, "plugins/a/agents/sub"), { recursive: true });
  writeFileSync(join(root, "plugins/a/agents/sub/x-agent.md"), agent("x-agent"));
  const { errors } = validateRepo(root);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /plugins\/a\/agents\/sub\/x-agent\.md: agent files must be directly inside plugins\/a\/agents\//);
  rmSync(root, { recursive: true });
});

test("agent-catalog: valid agent with every optional field passes", () => {
  const fm = `${ok}\ndisallowedTools: Grep\nmodel: inherit\nskills:\n  - alpha\ncolor: blue\nmaxTurns: 3`;
  assert.deepEqual(errorsFor("x-agent.md", doc(fm)), []);
});

test("agent-catalog: model must be inherit, an alias or a model id", () => {
  for (const model of ["inherit", "sonnet", "opus", "haiku", "fable", "claude-opus-4-5-20251101", "opus[1m]"])
    assert.deepEqual(errorsFor("x-agent.md", doc(`${ok}\nmodel: ${model}`)), [], model);
  assert.match(errorsFor("x-agent.md", doc(`${ok}\nmodel: two words`)).join("\n"), /model "two words" must be inherit/);
});

test("agent-catalog: missing description names the file and the field", () => {
  const errors = errorsFor("x-agent.md", doc("name: x-agent\ntools: Read"));
  assert.equal(errors.length, 1);
  assert.match(errors[0], /plugins\/a\/agents\/x-agent\.md: frontmatter is missing "description"/);
});

test("agent-catalog: a specifier removes the whole tool, and no tool left is an error", () => {
  const errors = errorsFor("x-agent.md", doc("name: x-agent\ndescription: d\ntools: Bash\ndisallowedTools: Bash(rm *)"));
  assert.equal(errors.length, 1);
  assert.match(errors[0], /no tool is left after disallowedTools/);
  assert.match(errors[0], /"Bash\(rm \*\)" removes the whole Bash tool/);
  assert.deepEqual(errorsFor("x-agent.md", doc("name: x-agent\ndescription: d\ntools: Read, Bash\ndisallowedTools: Bash(rm *)")), []);
  const e = effectiveTools(["Read", "Grep", "Bash"], ["Bash(rm *)", "Edit(x)"]);
  assert.deepEqual(e.effective, ["Read", "Grep"]);
  assert.deepEqual(e.specifierRemovals, [{ entry: "Bash(rm *)", tool: "Bash" }]);
});

test("agent-catalog: empty or missing prompt fails", () => {
  const errors = errorsFor("x-agent.md", doc(ok, "\n  \n"));
  assert.equal(errors.length, 1);
  assert.match(errors[0], /has no prompt/);
});

test("agent-catalog: a prompt longer than 30,000 characters fails with the length and the limit", () => {
  assert.deepEqual(errorsFor("x-agent.md", doc(ok, "a".repeat(30000))), []);
  const errors = errorsFor("x-agent.md", doc(ok, "a".repeat(30001)));
  assert.equal(errors.length, 1);
  assert.match(errors[0], /30001 characters, over the limit of 30000/);
});

test("agent-catalog: skills must exist in the catalog", () => {
  const errors = errorsFor("x-agent.md", doc(`${ok}\nskills: [alpha, ghost]`));
  assert.equal(errors.length, 1);
  assert.match(errors[0], /skills lists "ghost", which is not a skill/);
});

test("agent-catalog: hooks, mcpServers, permissionMode and initialPrompt are rejected, naming the field", () => {
  for (const f of ["bad-hooks", "bad-mcp", "bad-permission", "bad-initial"]) {
    const file = join(FIXTURE_ROOT, "..", "bad-agents", `${f}.md`);
    const errors = validateAgent(file, { root: join(FIXTURE_ROOT, "..") });
    const field = { "bad-hooks": "hooks", "bad-mcp": "mcpServers", "bad-permission": "permissionMode", "bad-initial": "initialPrompt" }[f];
    assert.equal(errors.length, 1, errors.join("\n"));
    assert.match(errors[0], new RegExp(`field "${field}" is not allowed in repository agents`));
    assert.match(errors[0], /honors it for agents in ~\/\.claude\/agents/);
  }
});

test("agent-catalog: Windows reserved names fail (file-name independent, so it also runs on Windows)", () => {
  const root = join(FIXTURE_ROOT, "..");
  for (const name of ["aux", "con", "prn", "nul", "com1", "com9", "lpt1", "lpt9"]) {
    const dir = mkdtempSync(join(tmpdir(), "agent-skills-reserved-"));
    const file = join(dir, "case.md");
    writeFileSync(file, doc(`name: ${name}\ndescription: d\ntools: Read`));
    const errors = validateAgent(file, { root: dir, expectedName: name });
    assert.equal(errors.length, 1, `${name}: ${errors.join("\n")}`);
    assert.match(errors[0], new RegExp(`name "${name}" is a Windows reserved device name`));
    rmSync(dir, { recursive: true });
  }
  const errors = validateAgent(join(root, "bad-agents", "aux-name.md"), { root });
  assert.match(errors.join("\n"), /Windows reserved device name/);
});

test("agent-catalog: a reserved name as a real file in the repository fails (not on Windows, where it cannot exist)", { skip: process.platform === "win32" }, () => {
  for (const name of ["aux", "con"]) {
    const errors = errorsFor(`${name}.md`, doc(`name: ${name}\ndescription: d\ntools: Read`));
    assert.equal(errors.length, 1);
    assert.match(errors[0], /Windows reserved device name/);
  }
});

test("agent-catalog: newline and separator characters in the description fail, with the file", () => {
  const bad = join(FIXTURE_ROOT, "..", "bad-agents", "newline-description.md");
  const errors = validateAgent(bad, { root: join(FIXTURE_ROOT, "..") });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /bad-agents\/newline-description\.md: description must be on one line/);
  for (const [label, ch] of [["U+2028", "\u2028"], ["U+0085", "\u0085"], ["U+0007", "\u0007"], ["U+007F", "\u007f"]]) {
    const e = errorsFor("x-agent.md", doc(`name: x-agent\ndescription: "a${JSON.stringify(ch).slice(1, -1)}b"\ntools: Read`));
    assert.equal(e.length, 1, `${label}: ${e.join("\n")}`);
    assert.match(e[0], new RegExp(`control character ${label.replace("+", "\\+")}`));
  }
});

test("agent-catalog: bidirectional control characters anywhere in the file fail", () => {
  for (const cp of [0x202a, 0x202e, 0x2066, 0x2069]) {
    const ch = String.fromCodePoint(cp);
    const label = "U+" + cp.toString(16).toUpperCase();
    for (const content of [doc(ok, `Prompt ${ch} text.\n`), doc(`${ok}\ncolor: a${ch}b`)]) {
      const errors = errorsFor("x-agent.md", content);
      assert.equal(errors.length, 1, errors.join("\n"));
      assert.match(errors[0], new RegExp(`bidirectional control character ${label.replace("+", "\\+")}`));
    }
  }
});

test("agent-catalog: an agent and a skill with the same name fail and name both paths", () => {
  const root = repo([["a", "reviewer"]], [["b", "reviewer.md", agent("reviewer")]]);
  const { errors } = validateRepo(root);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /name "reviewer" is used by a skill and an agent/);
  assert.match(errors[0], /plugins\/a\/skills\/reviewer/);
  assert.match(errors[0], /plugins\/b\/agents\/reviewer\.md/);
  rmSync(root, { recursive: true });
});

test("agent-catalog: duplicate frontmatter keys fail", () => {
  const errors = errorsFor("x-agent.md", doc(`${ok}\ntools: Read`));
  assert.match(errors.join("\n"), /key "tools" appears more than once/);
});

test("agent-catalog: the agent template passes under its placeholder name and is read-only", () => {
  const root = repo([["a", "one"]]);
  mkdirSync(join(root, "templates/agent"), { recursive: true });
  cpSync(join(REPO_ROOT, "templates/agent/agent-name.md"), join(root, "templates/agent/agent-name.md"));
  assert.deepEqual(validateRepo(root).errors, []);
  rmSync(root, { recursive: true });

  // copying it to plugins/<plugin>/agents/<agent>.md with the name set is enough
  const copy = repo([["a", "one"]]);
  mkdirSync(join(copy, "plugins/a/agents"), { recursive: true });
  const text = readFileSync(join(REPO_ROOT, "templates/agent/agent-name.md"), "utf8").replace("name: agent-name", "name: my-agent");
  writeFileSync(join(copy, "plugins/a/agents/my-agent.md"), text);
  assert.deepEqual(validateRepo(copy).errors, []);
  rmSync(copy, { recursive: true });

  const fm = parseDocument(readFileSync(join(REPO_ROOT, "templates/agent/agent-name.md"), "utf8"));
  const { effective } = effectiveTools(fm.list("tools"), fm.has("disallowedTools") ? fm.list("disallowedTools") : []);
  assert.deepEqual(effective, ["Read", "Grep", "Glob"]);
  for (const tool of ["Edit", "Write", "Bash", "NotebookEdit"]) assert.ok(!effective.includes(tool), `template must not allow ${tool}`);
  assert.match(fm.body, /Rules you never break/);
  assert.match(fm.body, /file:line/);
  assert.match(fm.body, /Not verified/);
});

test("agent-catalog: a template that is not valid fails the repository check", () => {
  const root = repo([["a", "one"]]);
  mkdirSync(join(root, "templates/agent"), { recursive: true });
  writeFileSync(join(root, "templates/agent/agent-name.md"), doc("name: wrong\ndescription: d\ntools: Read"));
  const { errors } = validateRepo(root);
  assert.match(errors.join("\n"), /templates\/agent\/agent-name\.md: name "wrong" does not match/);
  rmSync(root, { recursive: true });
});

test("validate-skills prints the path and the rule of each problem on a bad repository", () => {
  const root = repo([["a", "one"]], [["a", "x-agent.md", doc("name: x-agent\ndescription: d\nhooks:\n  a: b")]]);
  const r = spawnSync(process.execPath, [join(REPO_ROOT, "scripts/validate-skills.mjs"), root], { encoding: "utf8" });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /plugins\/a\/agents\/x-agent\.md: frontmatter is missing "tools"/);
  assert.match(r.stderr, /plugins\/a\/agents\/x-agent\.md: field "hooks" is not allowed/);
  rmSync(root, { recursive: true });
});

test("the fixture demo agents are valid", () => {
  const dir = join(FIXTURE_ROOT, "plugins/demo/agents");
  const skillNames = new Set(["alpha", "beta"]);
  for (const f of readdirSync(dir)) assert.deepEqual(validateAgent(join(dir, f), { root: FIXTURE_ROOT, skillNames }), [], f);
});
