import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { estimateTokens, measure } from "../scripts/context-budget.mjs";

const SCRIPT = fileURLToPath(new URL("../scripts/context-budget.mjs", import.meta.url));

function write(root, path, content) {
  const file = join(root, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
}

// Content of exactly `bytes` bytes: the frontmatter, then padding.
function sized(front, bytes, pad) {
  return front + pad.repeat(bytes - front.length);
}

// A fixture catalog: skill `big` (4000 bytes), skill `small` (400 bytes), agent `pre` (800 bytes) that pre-loads `small`.
function fixture(budgets) {
  const root = mkdtempSync(join(tmpdir(), "context-budget-"));
  write(root, "plugins/p/skills/big/SKILL.md", sized("---\nname: big\ndescription: d\n---\n", 4000, "x"));
  write(root, "plugins/p/skills/small/SKILL.md", sized("---\nname: small\ndescription: d\n---\n", 400, "x"));
  write(root, "plugins/p/agents/pre.md", sized("---\nname: pre\ndescription: d\ntools: Read\nskills: small\n---\n", 800, "y"));
  write(root, "docs/aep/context-budgets.json", JSON.stringify({ margin: 0, capabilities: budgets }));
  return root;
}

const run = (root) => {
  const r = spawnSync(process.execPath, [SCRIPT, "--root", root], { encoding: "utf8" });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
};

test("--help lists the options", () => {
  const r = spawnSync(process.execPath, [SCRIPT, "--help"], { encoding: "utf8" });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /--root/);
  assert.match(r.stdout, /--budgets/);
  assert.match(r.stdout, /approximation/);
});

test("the estimate is bytes divided by 4, rounded up", () => {
  assert.equal(estimateTokens(12258), 3065);
  assert.equal(estimateTokens(1), 1);
});

test("under budget passes and every number carries its method, labeled as an approximation", () => {
  const root = fixture({ "skill:big": { budget: 2000 }, "skill:small": { budget: 200 }, "agent:pre": { budget: 500 } });
  const r = run(root);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /skill:big: ~1000 tokens \[estimate:bytes\/4 \(approximation\)\]/);
  assert.match(r.out, /Estimates are approximations/);
  rmSync(root, { recursive: true });
});

test("over budget fails and names the capability, the cost, the budget and the method", () => {
  const root = fixture({ "skill:big": { budget: 999 }, "skill:small": { budget: 200 }, "agent:pre": { budget: 500 } });
  const r = run(root);
  assert.equal(r.code, 1);
  assert.match(r.out, /over budget: skill:big: cost 1000 tokens \(estimate:bytes\/4 \(approximation\)\) > budget 999/);
  rmSync(root, { recursive: true });
});

test("an agent that pre-loads skills counts them", () => {
  // pre = 800 bytes + small 400 bytes = 1200 bytes = 300 tokens. Without the pre-loaded skill it would be 200.
  const over = fixture({ "skill:big": { budget: 2000 }, "skill:small": { budget: 200 }, "agent:pre": { budget: 299 } });
  assert.equal(run(over).code, 1);
  const ok = fixture({ "skill:big": { budget: 2000 }, "skill:small": { budget: 200 }, "agent:pre": { budget: 300 } });
  const r = run(ok);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /agent:pre: ~300 tokens/);
  assert.match(r.out, /pre-loads small/);
  rmSync(over, { recursive: true });
  rmSync(ok, { recursive: true });
});

test("the declared margin is applied to an estimate", () => {
  const root = fixture({ "skill:big": { budget: 1200 }, "skill:small": { budget: 200 }, "agent:pre": { budget: 500 } });
  write(root, "docs/aep/context-budgets.json", JSON.stringify({ margin: 0.3, capabilities: { "skill:big": { budget: 1200 }, "skill:small": { budget: 200 }, "agent:pre": { budget: 500 } } }));
  const r = run(root); // 1000 * 1.3 = 1300 > 1200
  assert.equal(r.code, 1);
  assert.match(r.out, /cost 1300 tokens/);
  rmSync(root, { recursive: true });
});

test("an official count is used with its model as the method, and a stale one is ignored", () => {
  const official = { model: "model-x", tokens: 1500, date: "2026-11-23", bytes: 4000 };
  const root = fixture({ "skill:big": { budget: 2000, official }, "skill:small": { budget: 200 }, "agent:pre": { budget: 500 } });
  const r = run(root);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /skill:big: 1500 tokens \[official:model-x \(2026-11-23\)\]/);
  const stale = fixture({ "skill:big": { budget: 2000, official: { ...official, bytes: 3999 } }, "skill:small": { budget: 200 }, "agent:pre": { budget: 500 } });
  const s = run(stale);
  assert.match(s.out, /official count ignored/);
  assert.match(s.out, /estimate:bytes\/4/);
  rmSync(root, { recursive: true });
  rmSync(stale, { recursive: true });
});

test("a capability without a declared budget, and a stale declaration, fail", () => {
  const root = fixture({ "skill:big": { budget: 2000 }, "skill:ghost": { budget: 10 } });
  const r = run(root);
  assert.equal(r.code, 1);
  assert.match(r.out, /skill:small: no declared budget/);
  assert.match(r.out, /skill:ghost: declared .* no such skill or agent/);
  rmSync(root, { recursive: true });
});

test("measure reads no network and the repository's committed budgets pass", () => {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const { errors, rows } = measure(root);
  assert.deepEqual(errors, []);
  assert.ok(rows.length >= 3);
  assert.ok(rows.every((r) => !r.over));
});

// ---- Line endings are a checkout artifact, not content ----

test("the same content with LF, CRLF or lone CR line endings gives the same estimate", () => {
  const body = Array.from({ length: 50 }, (_, i) => `line ${i}`);
  const make = (eol) => {
    const root = fixture({ "skill:big": { budget: 2000 }, "skill:small": { budget: 200 }, "agent:pre": { budget: 500 } });
    write(root, "plugins/p/skills/big/SKILL.md", `---${eol}name: big${eol}description: d${eol}---${eol}${body.join(eol)}${eol}`);
    return root;
  };
  const tokens = (root) => measure(root).rows.find((r) => r.id === "skill:big").tokens;
  const roots = ["\n", "\r\n", "\r"].map(make);
  const [lf, crlf, cr] = roots.map(tokens);
  assert.equal(crlf, lf);
  assert.equal(cr, lf);
  for (const r of roots) rmSync(r, { recursive: true });
});

test("the committed budgets keep at least 10 percent of headroom over the margin-adjusted estimate", () => {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const { rows } = measure(root);
  for (const r of rows.filter((x) => x.method.startsWith("estimate:")))
    assert.ok(r.budget >= r.compared * 1.1, `${r.id}: budget ${r.budget} < 110% of ${r.compared}`);
});

test("measuring a copy of the committed catalog with CRLF line endings gives the same numbers (Windows checkout)", () => {
  const src = fileURLToPath(new URL("..", import.meta.url));
  const dst = mkdtempSync(join(tmpdir(), "context-budget-crlf-"));
  const copy = (rel) => {
    const text = readFileSync(join(src, rel), "utf8");
    write(dst, rel, text.replace(/\r\n/g, "\n").replace(/\n/g, "\r\n"));
  };
  for (const rel of [
    "plugins/azure-terraform-stacks/skills/azure-terraform-stacks/SKILL.md",
    "plugins/docs-generator/skills/docs-generator/SKILL.md",
    "plugins/azure-terraform-stacks/agents/stacks-auditor.md",
    "docs/aep/context-budgets.json",
  ])
    copy(rel);
  const a = measure(src).rows.map((r) => [r.id, r.tokens, r.compared]);
  const b = measure(dst);
  assert.deepEqual(b.errors, []);
  assert.deepEqual(b.rows.map((r) => [r.id, r.tokens, r.compared]), a);
  rmSync(dst, { recursive: true });
});
