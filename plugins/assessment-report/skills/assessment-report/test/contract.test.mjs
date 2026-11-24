// Contract test: the Markdown this engine renders must pass the repository's docs-generator `check`
// (and build a DOCX). docs-generator needs `npm ci` in its own folder; without it these tests are skipped
// and say so, because this skill itself has no dependencies to install.
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
const available = existsSync(DOCS_CLI) && existsSync(join(DOCS, "node_modules", "yaml"));
const skip = available ? false : "docs-generator dependencies are not installed (run npm ci in plugins/docs-generator/skills/docs-generator)";

function writeReport(assessment, opts) {
  const dir = join(tmp(), "report");
  mkdirSync(dir, { recursive: true });
  for (const [name, text] of Object.entries(renderReport(assessment, opts))) writeFileSync(join(dir, name), text);
  return dir;
}
const docs = (args) => spawnSync(process.execPath, [DOCS_CLI, ...args], { cwd: DOCS, encoding: "utf8" });

for (const lang of ["en", "pt-BR", "es"]) {
  test(`docs-generator check passes on the ${lang} report`, { skip }, () => {
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
  const { assessment } = fullAssessment({ withFramework: false, reviewed: false });
  const dir = writeReport(assessment, { unreviewed: true });
  const r = docs(["check", join(dir, "report.md"), "--json"]);
  assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
});

test("a quote with three backticks and <script>, a title with markup and a pipe still pass docs-generator check", { skip }, () => {
  const { assessment } = fullAssessment();
  assessment.findings[0].title = "Pipes | and <b>markup</b> and `ticks` in a title";
  assessment.findings[0].statement = "Line one\n# not a heading\n- not a list\n\nLine two <img src=x>";
  const dir = writeReport(assessment);
  const r = docs(["check", join(dir, "report.md"), "--json"]);
  assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
});

test("docs-generator builds a DOCX from the report", { skip, timeout: 120000 }, () => {
  const { assessment } = fullAssessment();
  const dir = writeReport(assessment);
  const outDir = tmp();
  const r = docs(["build", join(dir, "report.md"), "--format", "docx", "--theme", "clean-modern", "--out", outDir, "--json"]);
  assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
  assert.ok(statSync(join(outDir, "report.docx")).size > 5000);
});

test("the contract test reports why it was skipped", () => {
  if (!available) console.log(`# skipped: ${skip}`);
  assert.ok(true);
});
