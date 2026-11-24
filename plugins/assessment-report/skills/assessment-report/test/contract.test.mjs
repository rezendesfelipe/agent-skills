// Contract test: the Markdown this engine renders must pass the repository's docs-generator `check`
// (and build a DOCX). docs-generator needs `npm ci` in its own folder; without it these tests are skipped
// and say so, because this skill itself has no dependencies to install. In CI the job sets
// ASSESSMENT_REPORT_REQUIRE_CONTRACT=1, and then a missing install is a failure, never a skip.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { renderReport } from "../scripts/lib/render.mjs";
import { tmp } from "./helpers.mjs";
import { fullAssessment } from "./fixture-assessment.mjs";

const DOCS = fileURLToPath(new URL("../../../../docs-generator/skills/docs-generator", import.meta.url));
const DOCS_CLI = join(DOCS, "scripts", "docs.mjs");
const available = process.env.ASSESSMENT_REPORT_HIDE_DOCS !== "1" && existsSync(DOCS_CLI) && existsSync(join(DOCS, "node_modules", "yaml"));
const hint = "docs-generator dependencies are not installed (run npm ci in plugins/docs-generator/skills/docs-generator)";
const required = process.env.ASSESSMENT_REPORT_REQUIRE_CONTRACT === "1";
const skip = available || required ? false : hint;
/** In CI (variable set) a missing install fails the test with the install hint instead of skipping it. */
const needDocs = () => assert.ok(available, hint);

function writeReport(assessment, opts) {
  const dir = join(tmp(), "report");
  mkdirSync(dir, { recursive: true });
  for (const [name, text] of Object.entries(renderReport(assessment, opts))) writeFileSync(join(dir, name), text);
  return dir;
}
const docs = (args) => spawnSync(process.execPath, [DOCS_CLI, ...args], { cwd: DOCS, encoding: "utf8" });

for (const lang of ["en", "pt-BR", "es"]) {
  test(`docs-generator check passes on the ${lang} report`, { skip }, () => {
  needDocs();
    const { assessment } = fullAssessment({ lang });
    const dir = writeReport(assessment);
    const r = docs(["check", join(dir, "report.md"), "--json"]);
    assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
    const out = JSON.parse(r.stdout);
    assert.deepEqual(out.errors, []);
    assert.deepEqual(out.warnings, [], "no warnings either");
  });
}

test("docs-generator check passes with no framework annex and with an unreviewed stamp", { skip }, () => {
  needDocs();
  const { assessment } = fullAssessment({ withFramework: false, reviewed: false });
  const dir = writeReport(assessment, { unreviewed: true });
  const r = docs(["check", join(dir, "report.md"), "--json"]);
  assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
});

test("a quote with three backticks and <script>, a title with markup and a pipe still pass docs-generator check", { skip }, () => {
  needDocs();
  const { assessment } = fullAssessment();
  assessment.findings[0].title = "Pipes | and <b>markup</b> and `ticks` in a title";
  assessment.findings[0].statement = "Line one\n# not a heading\n- not a list\n\nLine two <img src=x>";
  const dir = writeReport(assessment);
  const r = docs(["check", join(dir, "report.md"), "--json"]);
  assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
});

test("docs-generator builds a DOCX from the report", { skip, timeout: 120000 }, () => {
  needDocs();
  const { assessment } = fullAssessment();
  const dir = writeReport(assessment);
  const outDir = tmp();
  const r = docs(["build", join(dir, "report.md"), "--format", "docx", "--theme", "clean-modern", "--out", outDir, "--json"]);
  assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
  assert.ok(statSync(join(outDir, "report.docx")).size > 5000);
});

test("the contract test reports why it was skipped", () => {
  if (!available) console.log(`# skipped: ${skip || hint}`);
  assert.ok(true);
});

test("with the CI variable set, a missing docs-generator install is a failure with the install hint, not a skip", () => {
  // run this file again, in a clean child, with the install hidden; NODE_TEST_CONTEXT would make the runner skip the child
  const child = (required) => {
    const env = { ...process.env, ASSESSMENT_REPORT_REQUIRE_CONTRACT: required, ASSESSMENT_REPORT_HIDE_DOCS: "1" };
    delete env.NODE_TEST_CONTEXT;
    const r = spawnSync(process.execPath, ["--test-name-pattern=docs-generator check passes on the en report", fileURLToPath(import.meta.url)], { encoding: "utf8", env });
    return { status: r.status, out: `${r.stdout}${r.stderr}` };
  };
  const ci = child("1");
  assert.notEqual(ci.status, 0, ci.out);
  assert.match(ci.out, /npm ci in plugins\/docs-generator/);
  const local = child("");
  assert.equal(local.status, 0, local.out);
  assert.match(local.out, /skipped 1|# skipped 1|skip/i);
});
