import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { readText } from "./helpers.mjs";

const SKILL = fileURLToPath(new URL("..", import.meta.url));
const skillMd = readText(join(SKILL, "SKILL.md"));

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
    const text = readText(join(SKILL, "references", f));
    const hits = text.match(tech) ?? [];
    assert.ok(hits.length <= 6, `${f} mentions technologies ${hits.length} times; references hold method, not per-technology checks`);
    assert.ok(!/^- \[ \]/m.test(text), `${f} contains a checkbox checklist`);
  }
});

test("relative links in references resolve", () => {
  for (const f of readdirSync(join(SKILL, "references"))) {
    const dir = join(SKILL, "references");
    for (const m of readText(join(dir, f)).matchAll(/\]\((?!https?:)([^)#]+)\)/g)) assert.ok(existsSync(resolve(dirname(join(dir, f)), m[1])), `${f} links to ${m[1]}`);
  }
});

// ---- the reference describes the scanner as it behaves (task 6.1) ----------------------------------------------
import { PLACEHOLDER_SOURCE, MAX_SCAN_LINE_CHARS, SCAN_WINDOW_OVERLAP } from "../scripts/lib/secrets.mjs";

/** The written forms of every placeholder prefix the code accepts, from the pattern source. */
export function placeholderPrefixes(source = PLACEHOLDER_SOURCE) {
  const out = [];
  for (const alt of source.replace(/^\(\?:/, "").replace(/\)$/, "").split("|")) {
    let forms = [alt.replace(/\\b$/, "")];
    forms = forms.flatMap((f) => (f.includes("[_-]") ? [f.replace("[_-]", "_"), f.replace("[_-]", "-")] : [f]));
    forms = forms.flatMap((f) => (f.includes("s?") ? [f.replace("s?", ""), f.replace("s?", "s")] : [f]));
    out.push(...forms.map((f) => f.replace(/x\{3,\}/, "xxx").replace(/\\\*\{3,\}/, "***").replace(/\\(.)/g, "$1")));
  }
  return out;
}

test("the reference names every placeholder prefix the code accepts, the window values and the false negatives", () => {
  const ref = readText(join(SKILL, "references", "read-only-and-untrusted-input.md"));
  const missing = placeholderPrefixes().filter((p) => !ref.includes(`\`${p}\``));
  assert.deepEqual(missing, [], "placeholder prefixes the code accepts but the reference does not name");
  assert.ok(placeholderPrefixes().length >= 28);
  assert.ok(ref.includes(MAX_SCAN_LINE_CHARS.toLocaleString("en-US")) && ref.includes(String(SCAN_WINDOW_OVERLAP)), "window and overlap are stated");
  assert.match(ref, /resource type with an underscore and two or more identifier segments/);
  assert.match(ref, /Measured, estimated and extrapolated/);
  assert.match(ref, /never "no secrets"/);
  assert.ok(!ref.includes("exactly a tag"), "a stale statement about tags remains");
});

test("the documentation test fails when a prefix is added to the code only", () => {
  const ref = readText(join(SKILL, "references", "read-only-and-untrusted-input.md"));
  const extra = placeholderPrefixes(`${PLACEHOLDER_SOURCE.slice(0, -1)}|zzprefix)`);
  assert.ok(extra.includes("zzprefix") && !ref.includes("`zzprefix`"));
});
