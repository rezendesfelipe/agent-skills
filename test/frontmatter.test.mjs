import assert from "node:assert/strict";
import { test } from "node:test";
import { FIXTURE_ROOT, REPO_ROOT } from "./helpers.mjs";
import { findAgents, findCatalog, findSkills } from "../src/lib/catalog.mjs";
import { normalizeText, parseDocument, splitList } from "../src/lib/frontmatter.mjs";

const doc = (fm, body = "Body.\n") => parseDocument(`---\n${fm}\n---\n${body}`);

test("a comma-separated string, a flow list and a block list read the same", () => {
  const forms = ["tools: Read, Grep, Glob", "tools: [Read, Grep, Glob]", 'tools: ["Read", \'Grep\', Glob]', "tools:\n  - Read\n  - Grep\n  - Glob"];
  for (const fm of forms) assert.deepEqual(doc(fm).list("tools"), ["Read", "Grep", "Glob"], fm);
});

test("commas inside parentheses do not split a tool entry", () => {
  assert.deepEqual(splitList("Read, Bash(git log, git diff), Grep"), ["Read", "Bash(git log, git diff)", "Grep"]);
  assert.deepEqual(doc("tools: Read, Bash(git push *)").list("tools"), ["Read", "Bash(git push *)"]);
});

test("a flow list may span lines and an empty list is empty", () => {
  assert.deepEqual(doc("tools: [Read,\n  Grep]").list("tools"), ["Read", "Grep"]);
  assert.deepEqual(doc("tools: []").list("tools"), []);
  assert.deepEqual(doc("tools:").list("tools"), []);
  assert.equal(doc("name: x").list("tools"), undefined);
});

test("top-level keys include nested ones' parents but not their children", () => {
  const d = doc("name: x\nhooks:\n  PreToolUse:\n    - matcher: Bash\nmcpServers:\n  a:\n    command: npx\ncolor: blue");
  assert.deepEqual(d.keys, ["name", "hooks", "mcpServers", "color"]);
});

test("duplicate keys are reported", () => {
  assert.deepEqual(doc("name: a\nname: b").duplicates, ["name"]);
});

test("scalars: quoted, escaped, folded and plain with a comment", () => {
  assert.equal(doc('description: "a \\"b\\" c"').scalar("description"), 'a "b" c');
  assert.equal(doc("description: 'it''s'").scalar("description"), "it's");
  assert.equal(doc('description: "x\\ny"').scalar("description"), "x\ny");
  assert.equal(doc("description: >\n  one\n  two\nname: z").scalar("description"), "one two");
  assert.equal(doc("description: one # not part of it").scalar("description"), "one");
  assert.equal(doc("description: one\n  two").scalar("description"), "one two");
  assert.equal(doc("description: a: b").scalar("description"), "a: b");
});

test("raw frontmatter text and body are returned", () => {
  const d = parseDocument("---\nname: x\n---\n\nPrompt line.\n");
  assert.equal(d.raw, "name: x");
  assert.equal(d.body, "\nPrompt line.\n");
  assert.equal(parseDocument("no frontmatter"), null);
  assert.equal(parseDocument("---\n---\nonly body").body, "only body");
});

test("a CRLF file with a BOM gives the same result as the LF file", () => {
  const lf = "---\nname: x\ndescription: d\ntools:\n  - Read\n  - Grep\n---\nBody line 1.\nBody line 2.\n";
  const crlf = "\uFEFF" + lf.replace(/\n/g, "\r\n");
  const a = parseDocument(lf);
  const b = parseDocument(crlf);
  assert.deepEqual([b.raw, b.body, b.keys, b.list("tools"), b.scalar("name")], [a.raw, a.body, a.keys, a.list("tools"), a.scalar("name")]);
  assert.equal(normalizeText(crlf), lf);
});

test("the catalog lists skills and agents with their kinds", () => {
  const items = findCatalog(REPO_ROOT);
  const auditor = items.find((i) => i.name === "stacks-auditor");
  assert.equal(auditor.kind, "agent");
  assert.equal(auditor.plugin, "azure-terraform-stacks");
  assert.equal(items.find((i) => i.name === "docs-generator").kind, "skill");
  const skills = findSkills(REPO_ROOT);
  assert.ok(skills.length >= 2 && skills.every((s) => s.kind === "skill"), "every entry of findSkills is a skill");
});

test("the fixture catalog finds the demo agents, named after their files", () => {
  assert.deepEqual(
    findAgents(FIXTURE_ROOT).map((a) => a.name),
    ["full-access", "mcp-agent", "quick-scout", "readonly-reviewer", "shell-limited", "skilled-agent"],
  );
});

test("an agent whose frontmatter name differs from the file name is left out of the catalog", async () => {
  const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const root = mkdtempSync(join(tmpdir(), "agent-skills-catalog-"));
  mkdirSync(join(root, "plugins/p/agents/nested"), { recursive: true });
  writeFileSync(join(root, "plugins/p/agents/good.md"), "---\nname: good\ndescription: d\ntools: Read\n---\nBody\n");
  writeFileSync(join(root, "plugins/p/agents/bad.md"), "---\nname: other\ndescription: d\ntools: Read\n---\nBody\n");
  writeFileSync(join(root, "plugins/p/agents/nested/deep.md"), "---\nname: deep\ndescription: d\ntools: Read\n---\nBody\n");
  assert.deepEqual(findAgents(root).map((a) => a.name), ["good"]);
  rmSync(root, { recursive: true, force: true });
});
