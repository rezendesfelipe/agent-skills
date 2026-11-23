import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { matrixMarkdown, renderReport, scanRendered } from "../scripts/lib/render.mjs";
import { loadLabels } from "../scripts/lib/locales.mjs";
import { checkAssessment } from "../scripts/lib/consistency.mjs";
import { fakeSecret, tmp } from "./helpers.mjs";
import { fullAssessment } from "./fixture-assessment.mjs";

const GOLDEN = fileURLToPath(new URL("./golden/", import.meta.url));
const UPDATE = Boolean(process.env.UPDATE_GOLDEN);

function expectGolden(rel, text) {
  const p = join(GOLDEN, rel);
  if (UPDATE) {
    mkdirSync(join(p, ".."), { recursive: true });
    writeFileSync(p, text);
  }
  assert.equal(text, readFileSync(p, "utf8"), `${rel} differs from its golden file; run with UPDATE_GOLDEN=1 after an intended change`);
}

test("the fixture assessment is clean for check (so golden files show a valid report)", () => {
  const { assessment } = fullAssessment();
  const errors = checkAssessment(assessment, { acceptRoadmapViolations: true, requireSummary: true }).errors;
  assert.deepEqual(errors.map((e) => `${e.code}: ${e.message}`), []);
});

for (const lang of ["en", "pt-BR", "es"]) {
  test(`golden files for ${lang}`, () => {
    const { assessment } = fullAssessment({ lang });
    const files = renderReport(assessment);
    assert.deepEqual(Object.keys(files).sort(), ["annex-evidence.md", "annex-findings.md", "annex-frameworks.md", "annex-method.md", "report.json", "report.md"]);
    for (const [name, text] of Object.entries(files)) if (name.endsWith(".md")) expectGolden(`render-${lang}/${name}`, text);
    const L = loadLabels(lang);
    assert.ok(files["report.md"].includes(`lang: "${lang}"`), "frontmatter lang follows meta.lang");
    assert.ok(files["report.md"].includes(`# ${L.headline}`));
    assert.ok(files["report.md"].includes(`| ${L.id} | ${L.finding} | ${L.severity} | ${L.confidence} | ${L.effort} |`));
    assert.ok(files["annex-method.md"].includes(`# ${L.methodRun}`));
  });
}

test("Portuguese and Spanish reports show no English fixed labels", () => {
  for (const [lang, banned] of [["pt-BR", ["Headline assessment", "Main findings", "Roadmap:"]], ["es", ["Headline assessment", "Main findings", "Roadmap:"]]]) {
    const { assessment } = fullAssessment({ lang });
    const text = renderReport(assessment)["report.md"];
    for (const b of banned) assert.ok(!text.includes(b), `${lang}: ${b}`);
  }
});

test("the summary counts come from computed tokens", () => {
  const { assessment } = fullAssessment();
  const md = renderReport(assessment)["report.md"];
  assert.match(md, /\*\*7 findings are backed by evidence\*\* and 1 of them are Critical\./);
  assert.match(md, /1 claim could not be verified/);
  assert.ok(!md.includes("{{"));
});

test("the unverified finding appears only under Not verified, with its failure code and its collect-evidence action", () => {
  const { assessment } = fullAssessment();
  const files = renderReport(assessment);
  const md = files["report.md"];
  const nv = md.slice(md.indexOf("# What could not be verified"));
  assert.match(nv, /\| F-005 \| A variable that does not exist \| quote-mismatch \| A-006 \|/);
  assert.ok(!md.slice(0, md.indexOf("# What could not be verified")).includes("A variable that does not exist"), "not among the findings");
  assert.ok(!files["annex-findings.md"].includes("A variable that does not exist"), "not in the finding register");
  assert.match(files["annex-evidence.md"], /E-007 \\\[quote-mismatch\\\]/, "the failure stays in the verification log");
});

test("reported findings are labelled and capped; Verify first lists potentialSeverity", () => {
  const { assessment } = fullAssessment();
  const md = renderReport(assessment)["report.md"];
  assert.match(md, /\| F-003 \| Restores are not tested \| Medium \| Corroborated \| M \|/);
  assert.match(md, /\| F-004 \| Admin access review is yearly \| Medium \| Reported, verify before acting \| S \|/);
  assert.match(md, /## Verify first[\s\S]*\| F-003 \| Restores are not tested \| Critical \| Corroborated \|/);
  assert.match(renderReport(assessment)["annex-findings.md"], /Severity before the confidence cap: Critical\./);
});

test("the matrix and the quick wins are derived", () => {
  const { assessment } = fullAssessment();
  const m = matrixMarkdown(assessment, loadLabels("en"));
  expectGolden("matrix-en.md", `${m}\n`);
  assert.match(m, /\| Critical \| F-006 \| - \| - \| - \|/);
  assert.match(m, /\| High \| F-001 \| - \| - \| - \|/);
  const md = renderReport(assessment)["report.md"];
  assert.match(md, /## Quick wins[\s\S]*- F-006: The private key is committed|- F-006: A private key is committed \(Critical, Effort S\)/);
});

test("the roadmap shows a table and a total per wave, and the capacity warning", () => {
  const { assessment } = fullAssessment();
  const md = renderReport(assessment)["report.md"];
  assert.match(md, /## Wave 1: days 0-30/);
  assert.match(md, /Estimated effort of this wave: 3-6 person-days\./);
  assert.match(md, /Warning: wave 1 may exceed the stated capacity of 5 person-days \(estimate 3-6\)/);
  assert.match(md, /## Wave 3: days 61-90/);
  assert.ok(!md.includes("## Wave 4"), "wave 4 appears only when it has actions");
  const w1 = { ...assessment, scope: { ...assessment.scope, capacity: { 1: 1 } } };
  assert.match(renderReport(w1)["report.md"], /Warning: wave 1 needs at least 3 person-days and the stated capacity is 1/);
});

test("a quote with a code fence and markup is escaped and visibly marked", () => {
  const { assessment } = fullAssessment();
  const a = renderReport(assessment)["annex-findings.md"];
  assert.match(a, /‵‵‵bash/);
  assert.match(a, /\(escaped\)/);
  const open = (a.match(/^```$/gm) ?? []).length;
  assert.equal(open % 2, 0, "every fence opens and closes");
  assert.ok(!/^<script>/m.test(a));
});

test("table cells and prose are escaped so model text cannot become markup", () => {
  const { assessment } = fullAssessment();
  assessment.findings[0].title = "A | B <script>alert(1)</script> *bold* [link](http://x)";
  const md = renderReport(assessment)["report.md"];
  assert.ok(!md.includes("<script>alert"), "no raw HTML");
  assert.match(md, /A \\\| B \\<script\\>alert\(1\)\\<\/script\\> \\\*bold\\\* \\\[link\\\]\(http:\/\/x\)/);
});

test("redacted evidence shows the location and kind, never the value", () => {
  const { assessment } = fullAssessment();
  const files = renderReport(assessment);
  const all = Object.values(files).join("\n");
  assert.match(files["annex-findings.md"], /`infra\/key\.pem:1-2`, redacted secret of kind private-key; only the location is shown/);
  assert.ok(!all.includes(fakeSecret.privateKeyHeader()));
  assert.ok(!all.includes("MIIBOgIBAAJB"));
  assert.deepEqual(scanRendered(files), []);
});

test("render scans its output for secrets (secret-in-output)", () => {
  const leaks = scanRendered({ "report.md": `token ${fakeSecret.githubToken()}` });
  assert.deepEqual(leaks.map((l) => [l.code, l.where]), [["secret-in-output", "report.md"]]);
});

test("--unreviewed stamps the report; a reviewed report names the reviewer", () => {
  const { assessment } = fullAssessment({ reviewed: false });
  const files = renderReport(assessment, { unreviewed: true });
  assert.match(files["report.md"], /> \*\*This report was not human-reviewed\./);
  assert.match(files["annex-method.md"], /not human-reviewed/);
  const reviewed = renderReport(fullAssessment().assessment);
  assert.ok(!reviewed["report.md"].includes("not human-reviewed"));
  assert.match(reviewed["annex-method.md"], /Marcos Lima, 2026-11-21/);
});

test("the method annex records versions, model, revision and the verifier's limits; an unknown model is stated", () => {
  const { assessment } = fullAssessment();
  const m = renderReport(assessment)["annex-method.md"];
  for (const s of ["Skill version", "Engine version", "test-model", "inventory:", "does not prove that an excerpt supports the claim", "heuristic scan"]) assert.ok(m.includes(s), s);
  assessment.meta.model.id = "unknown";
  assert.match(renderReport(assessment)["annex-method.md"], /unknown \(the model identifier was not given\)/);
});

test("no framework annex and no sources when no framework is used; frameworks become sources", () => {
  const none = renderReport(fullAssessment({ withFramework: false }).assessment);
  assert.ok(!("annex-frameworks.md" in none));
  assert.ok(!none["report.md"].includes("\nsources:"));
  assert.ok(!none["report.md"].includes("annex-frameworks"));
  const some = renderReport(fullAssessment().assessment);
  assert.match(some["report.md"], /sources:\n {2}- title: "CIS Microsoft Azure Foundations Benchmark \(2\.0\.0\)"\n {4}url: "https:\/\/example\.com\/cis"\n {4}date: "2023-02-23"/);
  assert.match(some["annex-frameworks.md"], /\| F-001 \| cis-azure \| 3\.15 \| Unchecked \|/);
  assert.match(some["annex-frameworks.md"], /Control IDs without a supplied catalog are unchecked/);
});

test("report.json is the assessment, and no SARIF file is produced", () => {
  const { assessment } = fullAssessment();
  const files = renderReport(assessment);
  assert.deepEqual(JSON.parse(files["report.json"]), JSON.parse(JSON.stringify(assessment)));
  assert.ok(!Object.keys(files).some((f) => f.endsWith(".sarif")));
});

test("the report folder is not created by rendering alone (the CLI writes the files)", () => {
  const dir = tmp();
  renderReport(fullAssessment().assessment);
  assert.ok(!existsSync(join(dir, "report")));
});
