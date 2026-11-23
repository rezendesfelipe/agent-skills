import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
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
import { FIXTURE_ROOT, REPO_ROOT, runBin, sandbox } from "./helpers.mjs";
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
    const L = label.replace("+", "\\+");
    // written raw in the file: reported for the frontmatter as written (YAML may read it as a line break)
    const raw = errorsFor("x-agent.md", doc(`name: x-agent\ndescription: a${ch}b\ntools: Read`));
    assert.ok(raw.some((x) => new RegExp(`frontmatter contains the control or line-separator character ${L}`).test(x)), `${label}: ${raw.join("\n")}`);
    // written as an escape inside quotes: the decoded value is reported
    const code = ch.codePointAt(0).toString(16).padStart(4, "0");
    const decoded = errorsFor("x-agent.md", doc(`name: x-agent\ndescription: "a\\u${code}b"\ntools: Read`));
    assert.ok(decoded.some((x) => new RegExp(`description contains the control or line-separator character ${L}`).test(x)), `${label}: ${decoded.join("\n")}`);
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

// ---- forbidden fields written in YAML syntax the reader does not recognize ----------------------
import { agentFromText } from "../src/lib/agents/model.mjs";
import { convertAgent } from "../src/lib/agents/convert.mjs";
import { TOOL_IDS } from "../src/lib/tools.mjs";

const BAD = join(FIXTURE_ROOT, "..", "bad-agents");
const EVASIONS = {
  "bad-hooks-space": "hooks",
  "bad-mcp-quoted": "mcpServers",
  "bad-permission-quoted": "permissionMode",
  "bad-initial-explicit": "initialPrompt",
  "bad-indented-continuation": "permissionMode",
  "bad-flow": "hooks",
};

for (const [file, field] of Object.entries(EVASIONS)) {
  test(`evasion ${file}: validation fails`, () => {
    const errors = validateAgent(join(BAD, `${file}.md`), { root: join(BAD, "..") });
    assert.ok(errors.length >= 1, "must not pass");
    assert.ok(
      errors.some((e) => e.includes(`field "${field}" is not allowed`)) || errors.some((e) => /not in the accepted "key: value" form/.test(e)),
      errors.join("\n"),
    );
  });
  test(`evasion ${file}: the converter refuses it for every tool, claude included`, () => {
    const agent = agentFromText(readFileSync(join(BAD, `${file}.md`), "utf8"));
    for (const tool of TOOL_IDS) {
      const r = convertAgent(agent, tool, { version: "1.0.0", allowBroader: true });
      assert.equal(r.ok, false, `${file} for ${tool}`);
      assert.equal(r.content, undefined);
    }
  });
}

test("evasion: the reviewer's reproduction (`hooks :` after tools) is rejected by validateRepo", () => {
  const root = repo([["a", "one"]], [["a", "spacekey.md", "---\nname: spacekey\ndescription: x\ntools: Read\nhooks :\nPreToolUse: []\n---\nBody.\n"]]);
  const { errors } = validateRepo(root);
  assert.ok(errors.length >= 1, "validateAgent must not return []");
  rmSync(root, { recursive: true });
});

test("a description that merely mentions a field name is not flagged", () => {
  assert.deepEqual(errorsFor("x-agent.md", doc("name: x-agent\ndescription: Explains hooks and permissionMode to users.\ntools: Read")), []);
});

test("unrecognized lines are reported by the reader; comments, blanks and column-0 list items are not", () => {
  const d = parseDocument("---\n# comment\nname: x\n\ntools:\n- Read\n- Grep\n? k\n---\n");
  assert.deepEqual(d.unrecognized, ["? k"]);
  assert.deepEqual(d.list("tools").slice(0, 2), ["Read", "Grep"]);
});

// ---- line-break characters that hide a field (review cycle 2) ------------------------------------
import { frontmatterCharProblems, forbiddenFieldHits } from "../src/lib/agents/rules.mjs";

const BREAK_FIXTURES = {
  "bad-cr-isolated": "\r",
  "bad-cr-description": "\r",
  "bad-cr-model": "\r",
  "bad-cr-extra-key": "\r",
  "bad-nel-hooks": "\u0085",
  "bad-ls-hooks": "\u2028",
  "bad-ps-hooks": "\u2029",
  "bad-nel-plain": "\u0085",
  "bad-ls-plain": "\u2028",
  "bad-ps-plain": "\u2029",
};

for (const [file, ch] of Object.entries(BREAK_FIXTURES)) {
  const label = "U+" + ch.codePointAt(0).toString(16).toUpperCase().padStart(4, "0");
  test(`line-break fixture ${file}: validation fails and names ${label}`, () => {
    const errors = validateAgent(join(BAD, `${file}.md`), { root: join(BAD, "..") });
    assert.ok(errors.some((e) => e.includes(`control or line-separator character ${label}`)), errors.join("\n"));
  });
  test(`line-break fixture ${file}: the converter refuses it for all five tools`, () => {
    const agent = agentFromText(readFileSync(join(BAD, `${file}.md`), "utf8"));
    for (const tool of TOOL_IDS) {
      const r = convertAgent(agent, tool, { version: "1.0.0", allowBroader: true });
      assert.equal(r.ok, false, `${file} for ${tool}`);
      assert.equal(r.content, undefined);
    }
  });
}

test("line-break fixtures: add installs nothing for any tool", () => {
  const root = mkdtempSync(join(tmpdir(), "agent-skills-breaks-"));
  const dir = join(root, "plugins/p/agents");
  mkdirSync(dir, { recursive: true });
  for (const file of Object.keys(BREAK_FIXTURES)) cpSync(join(BAD, `${file}.md`), join(dir, `${file}.md`));
  const box = sandbox();
  for (const file of Object.keys(BREAK_FIXTURES)) {
    const r = runBin(["add", file, "--tool", "claude,codex,gemini,cursor,copilot", "--yes", "--allow-broader-access"], { ...box, root });
    assert.equal(r.code, 1, `${file}: ${r.stdout}`);
    assert.ok(!existsSync(join(box.home, ".claude")) && !existsSync(join(box.home, ".gemini")) && !existsSync(join(box.home, ".codex")), file);
  }
  box.cleanup();
  rmSync(root, { recursive: true, force: true });
});

test("reader: a lone CR, NEL, U+2028 and U+2029 are line breaks in the frontmatter, so the hidden key is seen", () => {
  for (const ch of ["\r", "\u0085", "\u2028", "\u2029"]) {
    const d = parseDocument(`---\nname: x\ntools: Read${ch}hooks: {}\n---\nBody\u2028stays\n`);
    assert.deepEqual(d.keys, ["name", "tools", "hooks"], JSON.stringify(ch));
    assert.equal(d.body, "Body\u2028stays\n", "the body is not altered");
  }
  assert.deepEqual(parseDocument("---\nname: x\r---\nBody\n").keys, ["name"], "a lone CR can close the frontmatter, as in YAML");
});

test("forbiddenFieldHits splits on every YAML line break", () => {
  for (const ch of ["\r", "\u0085", "\u2028", "\u2029"]) assert.deepEqual(forbiddenFieldHits(`tools: Read${ch}hooks: {}`), ["hooks"], JSON.stringify(ch));
  assert.deepEqual(forbiddenFieldHits("tools: Read hooks"), []);
});

test("frontmatterCharProblems covers decoded values of every field the converter reads", () => {
  const p = (fm) => frontmatterCharProblems(parseDocument(`---\n${fm}\n---\nBody\n`));
  assert.deepEqual(p("name: x\ndescription: d\ntools: Read"), []);
  assert.match(p('name: "a\\u0007b"')[0], /name contains the control or line-separator character U\+0007/);
  assert.match(p('model: "a\\u2029b"')[0], /model contains/);
  assert.match(p('tools: ["Read\\u0085x"]')[0], /entry of "tools" contains .*U\+0085/);
  assert.match(p('skills: ["a\\u000bb"]')[0], /entry of "skills" contains/);
  assert.match(p('disallowedTools: ["a\\nb"]')[0], /entry of "disallowedTools" contains/);
  assert.match(p('description: "a\\nb"')[0], /description must be on one line/);
  assert.deepEqual(p("description: a\tb"), [], "a tab is allowed");
});
