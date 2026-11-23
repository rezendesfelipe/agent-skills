// The whole flow through the CLI, from init to render.
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { edit, fakeSecret, file, finding, rationale, readJson, repoCopy, run, snapshot, startRun } from "./helpers.mjs";

const TLS = '  min_tls_version          = "TLS1_0"';
function toReview({ lang = "en" } = {}) {
  const repo = repoCopy();
  writeFileSync(join(repo, "infra", "key.pem"), `${fakeSecret.privateKeyHeader()}\n${fakeSecret.keyBody()}\n`);
  const { out } = startRun(repo, ["--lang", lang]);
  edit(out, (a) => {
    a.evidence.push(file("E-001", "infra/main.tf", 11, 11, TLS));
    a.evidence.push(file("E-002", "infra/key.pem", 1, 2, undefined, { redacted: true, secretKind: "private-key" }));
    a.findings.push(finding("F-001", ["E-001"], { impact: "high", likelihood: "likely", effort: "S", rationale, recommendation: "Raise TLS." }));
    a.findings.push(finding("F-002", ["E-002"], { title: "A key is committed", impact: "severe", likelihood: "likely", effort: "S", rationale }));
  });
  assert.equal(run(["verify", "--out", out]).code, 0);
  assert.equal(run(["classify", "--out", out]).code, 0);
  edit(out, (a) => {
    a.actions.push({ id: "A-001", title: "Raise TLS", addresses: ["F-001"], wave: 1, effort: "S", risk: "low", dependsOn: [] });
    a.actions.push({ id: "A-002", title: "Rotate the key", addresses: ["F-002"], wave: 1, effort: "S", risk: "medium", dependsOn: [] });
  });
  assert.equal(run(["check", "--out", out]).code, 0);
  edit(out, (a) => (a.summary = "We found {{count.findings}} findings, {{count.critical}} Critical."));
  return { repo, out };
}

test("init to render: review is required, approval is recorded, and the report is written only inside --out", () => {
  const { repo, out } = toReview();
  const before = snapshot(repo);
  let r = run(["review", "--out", out]);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /REVIEW PACKET/);
  assert.match(r.out, /F-002 \[Critical, verified\]/);
  assert.match(r.out, /redacted/);
  assert.match(r.out, /We found 2 findings, 1 Critical\./);
  assert.equal(run(["render", "--out", out]).code, 1, "render before approval is refused");
  r = run(["review", "--approve", "--out", out]);
  assert.equal(r.code, 2, "approval needs --by");
  r = run(["review", "--approve", "--by", "Marcos Lima", "--date", "2026-11-21", "--out", out]);
  assert.equal(r.code, 0, r.out);
  r = run(["render", "--out", out]);
  assert.equal(r.code, 0, r.out);
  const files = readdirSync(join(out, "report")).sort();
  assert.deepEqual(files, ["annex-evidence.md", "annex-findings.md", "annex-method.md", "report.json", "report.md"]);
  const md = readFileSync(join(out, "report", "report.md"), "utf8");
  assert.match(md, /We found 2 findings, 1 Critical\./);
  assert.ok(!md.includes("not human-reviewed"));
  assert.match(readFileSync(join(out, "report", "annex-method.md"), "utf8"), /Marcos Lima, 2026-11-21/);
  assert.deepEqual(snapshot(repo), before, "the assessed folder is untouched");
  assert.ok(!readdirSync(out, { recursive: true }).some((f) => String(f).endsWith(".sarif")));
  r = run(["finish", "--out", out]);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /Reviewed by Marcos Lima/);
  assert.match(r.out, /Not verified \(0\)/);
});

test("the planted secret never appears in assessment.json or in any rendered file", () => {
  const { out } = toReview();
  run(["review", "--approve", "--by", "A", "--date", "2026-11-21", "--out", out]);
  assert.equal(run(["render", "--out", out]).code, 0);
  const all = readdirSync(out, { recursive: true })
    .map((f) => join(out, String(f)))
    .filter((p) => existsSync(p) && !readdirSync(join(p, "..")).includes(`${p}/`) && /\.(json|md)$/.test(p))
    .map((p) => readFileSync(p, "utf8"))
    .join("\n");
  assert.ok(all.length > 1000);
  assert.ok(!all.includes(fakeSecret.keyBody().slice(0, 12)));
  assert.ok(!all.includes(fakeSecret.privateKeyHeader()));
});

test("a change after approval refuses render; --unreviewed stamps the report", () => {
  const { out } = toReview();
  run(["review", "--approve", "--by", "A", "--date", "2026-11-21", "--out", out]);
  edit(out, (a) => (a.summary = "A different summary."));
  let r = run(["render", "--out", out]);
  assert.equal(r.code, 1);
  assert.match(r.out, /not approved after its last change/);
  r = run(["render", "--unreviewed", "--out", out]);
  assert.equal(r.code, 0, r.out);
  const md = readFileSync(join(out, "report", "report.md"), "utf8");
  assert.match(md, /not human-reviewed/);
  assert.match(run(["finish", "--out", out]).out, /NOT human-reviewed/);
});

test("render refuses while a placeholder is left (author never inferred)", () => {
  const repo = repoCopy();
  const { out } = startRun(repo);
  edit(out, (a) => {
    a.meta.author = "[REPLACE: author]";
    a.evidence.push(file("E-001", "infra/main.tf", 11, 11, TLS));
    a.findings.push(finding("F-001", ["E-001"], { impact: "high", likelihood: "likely", effort: "S", rationale }));
  });
  run(["verify", "--out", out]);
  run(["classify", "--out", out]);
  edit(out, (a) => a.actions.push({ id: "A-001", title: "x", addresses: ["F-001"], wave: 1, effort: "S", risk: "low", dependsOn: [] }));
  const r = run(["check", "--out", out]);
  assert.equal(r.code, 1);
  assert.match(r.out, /meta\.author: still a placeholder/);
});

test("Portuguese report through the CLI", () => {
  const { out } = toReview({ lang: "pt-BR" });
  run(["review", "--approve", "--by", "A", "--date", "2026-11-21", "--out", out]);
  assert.equal(run(["render", "--out", out]).code, 0);
  const md = readFileSync(join(out, "report", "report.md"), "utf8");
  assert.match(md, /lang: "pt-BR"/);
  assert.match(md, /# Principais achados/);
  assert.match(md, /\| ID \| Achado \| Severidade \| Confiança \| Esforço \|/);
});

test("the model is recorded in assessment.json and the method annex", () => {
  const { out } = toReview();
  assert.equal(readJson(join(out, "assessment.json")).meta.model.id, "test-model");
  run(["review", "--approve", "--by", "A", "--date", "2026-11-21", "--out", out]);
  run(["render", "--out", out]);
  assert.match(readFileSync(join(out, "report", "annex-method.md"), "utf8"), /test-model/);
});

test("schema --validate accepts a fixture output and rejects a broken file", () => {
  const { out } = toReview();
  assert.equal(run(["schema", "--validate", join(out, "assessment.json")]).code, 0);
  edit(out, (a) => (a.findings[0].impact = "huge"));
  const r = run(["schema", "--validate", join(out, "assessment.json")]);
  assert.equal(r.code, 1);
  assert.match(r.out, /findings\[0\]\.impact/);
  assert.equal(run(["schema", "--validate", join(out, "nope.json")]).code, 2);
});
