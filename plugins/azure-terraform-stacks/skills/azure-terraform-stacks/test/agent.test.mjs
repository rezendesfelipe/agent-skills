// The stacks-auditor subagent is read-only by design. These tests pin the properties that make it so,
// because the file is the only enforcement a plugin subagent has (it cannot carry hooks or permissionMode).
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import YAML from "yaml";
import { HERE } from "./helpers.mjs";

const PLUGIN = join(HERE, "..", "..", "..");
const FILE = join(PLUGIN, "agents", "stacks-auditor.md");
const raw = readFileSync(FILE, "utf8");
const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(raw);
const fm = YAML.parse(m[1]);
const body = m[2];
const list = (v) => (Array.isArray(v) ? v : String(v ?? "").split(",")).map((x) => x.trim()).filter(Boolean);

// Commands that change state or write files, taken from the spec (requirement "Auditor subagent").
const REQUIRED_DENY = ["terraform *", "kubectl *", "az *", "gh *", "git commit *", "git push *", "git checkout *", "git reset *", "git clean *", "rm *", "mv *", "cp *", "tee *", "sed -i *"];

test("frontmatter: name equals the file name, third-person description, tools allowlist", () => {
  assert.equal(fm.name, "stacks-auditor");
  assert.match(fm.description, /^Audits /, "third person, says what it does");
  assert.match(fm.description, /Use when/);
  assert.ok(fm.description.length <= 1024);
  assert.deepEqual(list(fm.tools), ["Read", "Grep", "Glob", "Bash"]);
});

test("no tool that writes or edits files", () => {
  for (const t of list(fm.tools)) assert.ok(!["Write", "Edit", "NotebookEdit"].includes(t), t);
});

test("disallowedTools removes every state-changing command of the spec", () => {
  const denied = list(fm.disallowedTools);
  for (const c of REQUIRED_DENY) assert.ok(denied.includes(`Bash(${c})`), `Bash(${c}) is not disallowed`);
});

test("does not rely on fields that Claude Code ignores for plugin subagents", () => {
  for (const k of ["hooks", "mcpServers", "permissionMode"]) assert.equal(k in fm, false, k);
});

test("the instructions state the rules, the steps and the report sections", () => {
  for (const phrase of [
    "Do not change the audited repository",
    "Never print the value of a secret",
    "test -f",
    "the skill's folder, the folder that contains `scripts/`",
    "audit --root",
    "--json",
    "Exit code 1 means errors were found",
    "Not evaluated",
    "Not covered",
    "My reading",
    "Next step",
    "No file in the repository was changed.",
  ]) assert.ok(body.includes(phrase), `missing: ${phrase}`);
  assert.match(body, /not "compliant"|Do not write "compliant"/);
});

test("the engine is looked up in the three documented places, in order", () => {
  const i1 = body.indexOf("scripts/stacks.mjs");
  const paths = [...body.matchAll(/`([^`]*skills\/azure-terraform-stacks\/scripts\/stacks\.mjs)`/g)].map((x) => x[1]);
  assert.ok(i1 > 0);
  assert.equal(paths.length, 3);
  assert.ok(paths[0].startsWith("${CLAUDE_PLUGIN_ROOT}/"));
  assert.match(paths[1], /^<audited repository>\/\.claude\//);
  assert.match(paths[2], /^~\/\.claude\//);
});

test("the plugin variable appears exactly once, so substituting it cannot garble the instructions", () => {
  assert.equal(body.split("${CLAUDE_PLUGIN_ROOT}").length - 1, 1);
});

test("the plugin path points at the engine that exists in this plugin", () => {
  const path = /`(\$\{CLAUDE_PLUGIN_ROOT\}\/[^`]+)`/.exec(body)[1].replace("${CLAUDE_PLUGIN_ROOT}", PLUGIN);
  assert.ok(existsSync(path), path);
});

test("when the engine is missing it stops instead of auditing by hand", () => {
  assert.match(body, /\*\*stop\*\*/);
  assert.match(body, /Do not audit by reading files by hand/);
  assert.match(body, /\/plugin install azure-terraform-stacks@rezendesfelipe-agent-skills/);
});

test("the only permitted write is the engine's own dependency install, outside the audited repository", () => {
  assert.match(body, /npm ci --omit=dev/);
  assert.match(body, /never in the audited repository/);
  assert.match(body, /This is the only write you may make/);
});
