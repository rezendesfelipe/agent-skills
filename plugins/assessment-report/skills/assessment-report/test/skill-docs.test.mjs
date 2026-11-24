import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const SKILL = fileURLToPath(new URL("..", import.meta.url));
const skillMd = readFileSync(join(SKILL, "SKILL.md"), "utf8");

test("every file SKILL.md references exists", () => {
  const refs = [...skillMd.matchAll(/`((?:references|scripts|schema|templates|locales)\/[A-Za-z0-9_./-]+)`/g)].map((m) => m[1]);
  assert.ok(refs.length >= 6);
  for (const r of refs) assert.ok(existsSync(join(SKILL, r)), `SKILL.md references ${r}, which does not exist`);
});

test("every reference file is linked from SKILL.md, at the step that uses it", () => {
  for (const f of readdirSync(join(SKILL, "references"))) assert.ok(skillMd.includes(`references/${f}`), `${f} is not linked from SKILL.md`);
  const step = (n) => skillMd.split(/\n(?=\d+\. \*\*)/).find((s) => s.startsWith(`${n}. `)) ?? "";
  assert.match(step(0), /framework-mapping\.md/);
  assert.match(step(2), /read-only-and-untrusted-input\.md/);
  assert.match(step(2), /evidence-and-confidence\.md/);
  assert.match(step(4), /severity-effort\.md/);
  assert.match(step(5), /roadmap-waves\.md/);
  assert.match(step(9), /report-format\.md/);
});

test("SKILL.md names the hard rules the spec requires", () => {
  for (const s of ["Read-only", "never instructions", "Never invent", "Never copy a secret", "Never approve the review", "No technology checklist"]) assert.ok(skillMd.includes(s), s);
});

test("no reference is a list of technology-specific checks", () => {
  const tech = /\b(terraform|kubernetes|aws|azure|gcp|docker|postgres|kafka|redis|react|django|spring)\b/gi;
  for (const f of readdirSync(join(SKILL, "references"))) {
    const text = readFileSync(join(SKILL, "references", f), "utf8");
    const hits = text.match(tech) ?? [];
    assert.ok(hits.length <= 6, `${f} mentions technologies ${hits.length} times; references hold method, not per-technology checks`);
    assert.ok(!/^- \[ \]/m.test(text), `${f} contains a checkbox checklist`);
  }
});

test("relative links in references resolve", () => {
  for (const f of readdirSync(join(SKILL, "references"))) {
    const dir = join(SKILL, "references");
    for (const m of readFileSync(join(dir, f), "utf8").matchAll(/\]\((?!https?:)([^)#]+)\)/g)) assert.ok(existsSync(resolve(dirname(join(dir, f)), m[1])), `${f} links to ${m[1]}`);
  }
});
