// The sealed evidence against the REAL assess.mjs of assessment-report (tasks 1.4, 1.7; specs "Evidence of collected data",
// "Sealing, parts and resume"): B1 (parts of at most 1 MiB), `absence` over an empty part, tamper, forged root.
// Skipped with a message when the assessment-report plugin is absent (a copy of this folder alone).
import assert from "node:assert/strict";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { FIX, fixtureCopy, hasAssess, jsonl, planAndCollect, readJson, run, runAssess, tmp, writeJson } from "./helpers.mjs";

const skip = !hasAssess() && "the assessment-report plugin is not in this checkout";
const MIB = 1024 * 1024;

/** init + inventory with the run folder as --out and <run>/collected as the assessed root. */
function startAssessment(runDir) {
  const collected = join(runDir, "collected");
  const r = runAssess(["init", "--out", runDir, "--root", collected, "--model", "test-model", "--client", "Cliente Exemplo", "--title", "Revisão", "--author", "Autor Exemplo", "--version", "1.0", "--date", "2026-11-25", "--lang", "pt-BR"]);
  assert.equal(r.code, 0, r.out);
  const inv = runAssess(["inventory", "--out", runDir]);
  assert.equal(inv.code, 0, inv.out);
}
const completeScope = () => { const d = fixtureCopy(); const s = readJson(join(d, "scope.json")); s.containers = s.visible; s.expected = 2; writeJson(join(d, "scope.json"), s); return d; };

function merge(runDir, extra = {}) {
  const map = readJson(join(runDir, "map.json"));
  const a = readJson(join(runDir, "assessment.json"));
  a.evidence = map.evidence;
  a.findings = map.findings.map((f) => ({ ...f, ...extra }));
  writeJson(join(runDir, "assessment.json"), a);
  return { map, a };
}

test("map: sealed evidence passes the real verifier and the findings are verified", { skip }, () => {
  const { cwd, runDir } = planAndCollect({ fixtures: completeScope() });
  assert.equal(run(["map", "--run", "r1"], { cwd }).code, 0);
  startAssessment(runDir);
  const { map } = merge(runDir, { impact: "moderate", likelihood: "possible", effort: "M", rationale: { impact: "synthetic", likelihood: "synthetic" } });
  assert.ok(map.findings.length >= 15, "one finding stub per failing check");
  for (const e of map.evidence.filter((x) => x.kind === "file")) {
    assert.match(e.path, /^[A-Z]{2}-[A-Z]+-\d{3}\.\d{3}\.jsonl$/);
    assert.ok(e.endLine - e.startLine + 1 <= 5);
    assert.ok(!e.path.includes("/") && !e.path.includes("\\"));
  }
  const v = runAssess(["verify", "--out", runDir, "--json"]);
  const out = JSON.parse(v.out.slice(v.out.indexOf("{")));
  assert.equal(out.ok, true, v.out);
  assert.equal(out.failures.length, 0);
  assert.equal(runAssess(["classify", "--out", runDir]).code, 0);
  const a = readJson(join(runDir, "assessment.json"));
  assert.ok(a.findings.every((f) => f.confidence === "verified"), JSON.stringify(a.findings.map((f) => [f.id, f.confidence])));
  assert.equal(run(["seal-check", "--run", "r1"], { cwd }).code, 0);
});

test("map: the finding text carries the check, the query hash, the time, the part and the doesNotProve sentence; rationale is untouched", { skip: false }, () => {
  const { cwd, runDir } = planAndCollect({});
  run(["map", "--run", "r1"], { cwd });
  const map = readJson(join(runDir, "map.json"));
  const f = map.findings.find((x) => x.id === map.checks["SE-STG-001"].finding);
  assert.ok(f);
  assert.match(f.statement, /SE-STG-001/);
  assert.match(f.statement, /[0-9a-f]{12}/);
  assert.match(f.statement, /SE-STG-001\.001\.jsonl/);
  assert.match(f.statement, /2026|\d{4}-\d{2}-\d{2}T/);
  assert.match(f.statement, /does not prove|não prova|That a container is public/i);
  assert.ok(!("rationale" in f));
  assert.deepEqual(f.controls, [{ framework: "azure-waf", controlId: "SE:06" }]);
  assert.ok(Array.isArray(map.capTable) && map.capTable.length >= 5);
  assert.ok(map.checks["SE-STG-001"].parts.every((p) => /^[0-9a-f]{64}$/.test(p.sha256)));
});

test("map: no stub for a check that did not fail, and no evidence from an unsealed check", () => {
  const { cwd, runDir } = planAndCollect({});
  run(["map", "--run", "r1"], { cwd });
  const map = readJson(join(runDir, "map.json"));
  const manifest = readJson(join(runDir, "collected", "manifest.json"));
  for (const [id, c] of Object.entries(map.checks)) assert.equal(manifest.checks[id].state, "fail", id);
  assert.equal(Object.values(map.checks).filter((c) => c.finding).length, map.findings.length);
  assert.ok(!("SE-NET-002" in map.checks), "an incomplete scope is not a pass and not a finding");
});

test("absence evidence over an empty .001.jsonl is accepted by the real verifier (a pass check)", { skip }, () => {
  const { cwd, runDir } = planAndCollect({ fixtures: completeScope() });
  run(["map", "--run", "r1"], { cwd });
  const part = join(runDir, "collected", "SE-NET-002.001.jsonl");
  assert.equal(statSync(part).size, 0);
  startAssessment(runDir);
  const map = readJson(join(runDir, "map.json"));
  const abs = map.evidence.find((e) => e.kind === "absence" && e.scope[0] === "SE-NET-002.*.jsonl");
  assert.ok(abs, "absence entry for the passing check");
  assert.match(abs.pattern, /\^\\\{"id":|\^\{"id":/);
  const a = readJson(join(runDir, "assessment.json"));
  a.evidence = [abs];
  a.findings = [{ id: "F-001", title: "Sem achados em SQL", statement: `Not found in ${abs.scope[0]}.`, evidence: [abs.id] }];
  writeJson(join(runDir, "assessment.json"), a);
  const v = runAssess(["verify", "--out", runDir, "--json"]);
  const out = JSON.parse(v.out.slice(v.out.indexOf("{")));
  assert.equal(out.ok, true, v.out);
});

test("tampered line: seal-check names the part and the real verifier reports drift or a mismatch", { skip }, () => {
  const { cwd, runDir } = planAndCollect({ fixtures: completeScope() });
  run(["map", "--run", "r1"], { cwd });
  startAssessment(runDir);
  merge(runDir);
  const part = join(runDir, "collected", "SE-STG-001.001.jsonl");
  writeFileSync(part, readFileSync(part, "utf8").replace("stcontosoprod01", "stcontosoprod0x"));
  const s = run(["seal-check", "--run", "r1"], { cwd });
  assert.equal(s.code, 1);
  assert.match(s.out, /SE-STG-001\.001\.jsonl/);
  const v = runAssess(["verify", "--out", runDir, "--json"]);
  const out = JSON.parse(v.out.slice(v.out.indexOf("{")));
  assert.equal(out.ok, false);
  assert.ok(out.failures.some((f) => ["drift", "quote-mismatch"].includes(f.code)), v.out);
});

test("B1: 5,000 violating rows are split into parts of at most 1 MiB; one part verifies, the same data in one file is too-large", { skip }, () => {
  const fx = fixtureCopy();
  const f = join(fx, "arg", "SE-DEF-002.json");
  const j = readJson(f);
  const rows = Array.from({ length: 5000 }, (_, i) => ({ id: `/subscriptions/00000000-0000-0000-0000-000000000001/providers/Microsoft.Security/assessments/00000000-0000-0000-0000-${String(i).padStart(12, "0")}`, subscriptionId: "00000000-0000-0000-0000-000000000001", displayName: `Recommendation number ${i} with a reasonably long display name to give the line some weight`, severity: "High" }));
  const pages = [];
  for (let i = 0; i < rows.length; i += 1000) pages.push({ rows: rows.slice(i, i + 1000), ...(i + 1000 < rows.length ? { $skipToken: `p${i / 1000 + 2}` } : {}) });
  j.violations.pages = pages;
  j.evaluated.pages = [{ rows: [{ n: 5200 }] }];
  writeJson(f, j);
  const { cwd, runDir } = planAndCollect({ fixtures: fx, collectExtra: ["--check", "SE-DEF-002"] });
  const parts = readdirSync(join(runDir, "collected")).filter((n) => /^SE-DEF-002\.\d{3}\.jsonl$/.test(n)).sort();
  assert.ok(parts.length >= 2, `parts: ${parts}`);
  assert.equal(parts[0], "SE-DEF-002.001.jsonl");
  let total = 0;
  let lines = 0;
  for (const p of parts) {
    const size = statSync(join(runDir, "collected", p)).size;
    assert.ok(size <= MIB, `${p} is ${size} bytes`);
    total += size;
    lines += jsonl(join(runDir, "collected", p)).length;
  }
  assert.ok(total > MIB, "the data must be over 1 MiB for the control to mean something");
  assert.equal(lines, 5000);
  const m = readJson(join(runDir, "collected", "manifest.json")).checks["SE-DEF-002"];
  assert.equal(m.parts.length, parts.length);
  assert.equal(m.parts.reduce((a, p) => a + p.lines, 0), 5000);
  assert.equal(run(["seal-check", "--run", "r1"], { cwd }).code, 0);
  // part 1 verifies in the real engine
  run(["map", "--run", "r1"], { cwd });
  startAssessment(runDir);
  const map = readJson(join(runDir, "map.json"));
  const a = readJson(join(runDir, "assessment.json"));
  a.evidence = map.evidence.filter((e) => e.path === "SE-DEF-002.001.jsonl");
  assert.ok(a.evidence.length >= 1);
  a.findings = [{ id: "F-001", title: "t", statement: "s", evidence: a.evidence.map((e) => e.id) }];
  writeJson(join(runDir, "assessment.json"), a);
  const ok = JSON.parse((() => { const v = runAssess(["verify", "--out", runDir, "--json"]); return v.out.slice(v.out.indexOf("{")); })());
  assert.equal(ok.ok, true);
  // control: the same data in a single file is refused by the verifier with too-large
  const ctl = tmp("waf-ctl-");
  const root = join(ctl, "collected");
  mkdirSync(root);
  writeFileSync(join(root, "SE-DEF-002.001.jsonl"), parts.map((p) => readFileSync(join(runDir, "collected", p), "utf8")).join(""));
  const out = join(ctl, "out");
  assert.equal(runAssess(["init", "--out", out, "--root", root, "--model", "t", "--client", "c", "--title", "t", "--author", "a", "--version", "1", "--date", "2026-11-25", "--lang", "en"]).code, 0);
  runAssess(["inventory", "--out", out]);
  const first = readFileSync(join(root, "SE-DEF-002.001.jsonl"), "utf8").split("\n")[0];
  const ca = readJson(join(out, "assessment.json"));
  ca.evidence = [{ id: "E-001", kind: "file", path: "SE-DEF-002.001.jsonl", startLine: 1, endLine: 1, quote: first }];
  ca.findings = [{ id: "F-001", title: "t", statement: "s", evidence: ["E-001"] }];
  writeJson(join(out, "assessment.json"), ca);
  const bad = runAssess(["verify", "--out", out, "--json"]);
  assert.match(bad.out, /too-large/);
});

test("B2: a model-written scope.root that points to a folder with a forged line is refused by seal-check", { skip }, () => {
  const { cwd, runDir } = planAndCollect({ fixtures: completeScope() });
  startAssessment(runDir);
  const forgedRoot = join(tmp("waf-forged-"), "collected");
  mkdirSync(forgedRoot);
  copyFileSync(join(runDir, "collected", "SE-STG-001.001.jsonl"), join(forgedRoot, "SE-STG-001.001.jsonl"));
  const a = readJson(join(runDir, "assessment.json"));
  a.scope.root = forgedRoot;
  writeJson(join(runDir, "assessment.json"), a);
  const r = run(["seal-check", "--run", "r1"], { cwd });
  assert.equal(r.code, 1);
  assert.match(r.out, /scope\.root/);
});
