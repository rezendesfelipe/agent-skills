// The stacks-auditor subagent is read-only by design. These tests pin the properties that make it so,
// because the file is the only enforcement a plugin subagent has (it cannot carry hooks or permissionMode).
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import YAML from "yaml";
import { HERE } from "./helpers.mjs";

const PLUGIN = join(HERE, "..", "..", "..");
const FILE = join(PLUGIN, "agents", "stacks-auditor.md");
// Checkouts on Windows may have CRLF: every versioned file is read with LF line endings.
const lf = (t) => t.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
const raw = lf(readFileSync(FILE, "utf8"));
const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(raw);
const fm = YAML.parse(m[1]);
const body = m[2];
const list = (v) => (Array.isArray(v) ? v : String(v ?? "").split(",")).map((x) => x.trim()).filter(Boolean);

const REPO = join(PLUGIN, "..", "..");
const SKILL = "azure-terraform-stacks";
const baseOf = (entry) => entry.replace(/\(.*$/s, "").trim();

test("frontmatter: name equals the file name, third-person description, tools allowlist, preloaded skill", () => {
  assert.equal(fm.name, "stacks-auditor");
  assert.match(fm.description, /^Audits /, "third person, says what it does");
  assert.match(fm.description, /Use when/);
  assert.ok(fm.description.length <= 1024);
  assert.deepEqual(list(fm.tools), ["Read", "Grep", "Glob", "Bash"]);
  assert.deepEqual(list(fm.skills), [SKILL]);
  assert.ok(existsSync(join(PLUGIN, "skills", SKILL, "SKILL.md")), "the skill listed in `skills` exists in this plugin");
});

test("no tool that writes or edits files", () => {
  for (const t of list(fm.tools)) assert.ok(!["Write", "Edit", "NotebookEdit"].includes(t), t);
});

test("no disallowedTools entry has a specifier (Claude Code removes the whole tool for such an entry) and Bash stays effective", () => {
  const denied = list(fm.disallowedTools);
  for (const e of denied) assert.ok(!e.includes("("), `${e}: a specifier removes the whole tool`);
  const removed = new Set(denied.map(baseOf));
  const effective = list(fm.tools).filter((t) => !removed.has(baseOf(t)));
  assert.ok(effective.includes("Bash"), `effective tools: ${effective.join(", ")}`);
  assert.equal("disallowedTools" in fm, false, "the agent relies on the guard and the instructions, not on disallowedTools");
});

test("does not rely on fields that Claude Code ignores for plugin subagents", () => {
  for (const k of ["hooks", "mcpServers", "permissionMode"]) assert.equal(k in fm, false, k);
});

test("the instructions say \"your shell tool\" style: no harness-specific tool name for the shell", () => {
  assert.ok(!/\bBash\b/.test(body), "the converted agent runs in tools whose shell has another name");
});

test("the instructions state the rules, the steps and the report sections", () => {
  for (const phrase of [
    "Do not change the audited repository",
    "Never print the value of a secret",
    "the skill's folder, the folder that contains `scripts/`",
    "audit [--root <path>]",
    "--root <audited repository>",
    "--json",
    "Exit code 1 means errors were found",
    "Not verified",
    "Not evaluated",
    "Not covered",
    "My reading",
    "Next step",
    "No file in the repository was changed.",
  ]) assert.ok(body.includes(phrase), `missing: ${phrase}`);
  assert.match(body, /not "compliant"|Do not write "compliant"/);
});

// The single `ls -d` line of step 2: the plugin path, then the USER skills folders of every tool. The project-scope folders
// (inside the audited repository, which is untrusted) are not looked in: the guard would not run an engine from there.
const lsLine = () => body.split("\n").map((l) => l.trim()).find((l) => l.startsWith("ls -d ${CLAUDE_PLUGIN_ROOT}"));
const ENGINE_TAIL = `${SKILL}/scripts/stacks.mjs`;

test("the engine is looked up with one ls -d call: the plugin path first, then user folders, never a project folder", () => {
  const line = lsLine();
  assert.ok(line, "step 2 has an `ls -d ${CLAUDE_PLUGIN_ROOT}...` line");
  const paths = line.slice("ls -d ".length).split(/\s+/);
  assert.ok(paths[0].startsWith("${CLAUDE_PLUGIN_ROOT}/skills/") && paths[0].endsWith(ENGINE_TAIL));
  assert.ok(paths.slice(1).every((p) => p.startsWith("~/") && p.endsWith(`/${ENGINE_TAIL}`)));
  assert.ok(!line.includes("<repo>"));
  assert.match(body, /Never use an engine that is inside the audited repository/);
});

test("the user skills folders in the agent are exactly the user folders of src/lib/tools.mjs, in the tools' order", async () => {
  const { TOOLS } = await import(pathToFileURL(join(REPO, "src", "lib", "tools.mjs")).href);
  const expected = [...new Set(Object.values(TOOLS).map((t) => t.user))].map((f) => `~/${f}/${ENGINE_TAIL}`);
  assert.deepEqual(lsLine().split(/\s+/).slice(3), expected);
});

test("the plugin variable appears exactly once, so substituting it cannot garble the instructions", () => {
  assert.equal(body.split("${CLAUDE_PLUGIN_ROOT}").length - 1, 1);
});

test("the plugin path points at the engine that exists in this plugin", () => {
  const path = /(\$\{CLAUDE_PLUGIN_ROOT\}\/\S+)/.exec(body)[1].replace("${CLAUDE_PLUGIN_ROOT}", PLUGIN);
  assert.ok(existsSync(path), path);
});

test("when the engine is missing it stops instead of auditing by hand", () => {
  assert.match(body, /\*\*stop\*\*/);
  assert.match(body, /Do not audit by reading files by hand/);
  assert.match(body, /\/plugin install azure-terraform-stacks@rezendesfelipe-agent-skills/);
});

test("the only permitted write is the engine's own dependency install, outside the audited repository", () => {
  assert.match(body, /npm ci --prefix <skill folder> --omit=dev --ignore-scripts/);
  assert.match(body, /never the audited repository/);
  assert.match(body, /This is the only write you may make/);
});

test("SKILL.md is honest about the auditor: preloaded, layered read-only, deny snippet, no claim that disallowedTools filters commands", () => {
  const skill = lf(readFileSync(join(PLUGIN, "skills", SKILL, "SKILL.md"), "utf8"));
  assert.match(skill, /preloaded into the auditor/);
  assert.match(skill, /not for the auditor/);
  assert.match(skill, /fails open/);
  assert.match(skill, /--allow-broader-access/);
  for (const c of ["terraform *", "kubectl *", "az *", "gh *", "git push *", "git commit *", "rm *", "mv *", "cp *", "tee *", "sed -i *"]) assert.ok(skill.includes(`"Bash(${c})"`), `permissions.deny snippet lacks Bash(${c})`);
  assert.ok(!/removes state-changing commands with `disallowedTools`/.test(skill));
  assert.ok(!/\*\*not\*\* by the `agent-skills` CLI/.test(skill));
});

test("the agent's text states the limits of the guard", () => {
  for (const phrase of ["fails open", "administrator disables plugin hooks", "permissions.deny", "read-only checkout", "Codex, Gemini CLI, Cursor and Copilot only these instructions apply"])
    assert.ok(body.includes(phrase), `missing: ${phrase}`);
});

test("the commands the agent is told to run carry no quote and no backslash (the guard denies both)", () => {
  const block = /## Commands you may run[\s\S]*?```text\n([\s\S]*?)```/.exec(body)[1];
  assert.ok(!/["'\\]/.test(block), block);
  assert.ok(!/["'\\]/.test(lsLine()), lsLine());
  assert.match(body, /Write every path bare: no quotes, no backslashes/);
});
