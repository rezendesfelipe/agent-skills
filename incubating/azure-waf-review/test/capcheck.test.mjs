// PR 1b, task 1.10: `cap-check`, the gate in code that refuses a Critical finding the user did not re-verify (design Decision 7,
// spec "Cap gate and render wrapper"). Uses the REAL assess.mjs for verify and classify, so the string "Critical" is the one it computes.
// Written before the implementation. Reverify files are written by the library with the fixture transport (no terminal, no network).
import assert from "node:assert/strict";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { loadCatalog } from "../scripts/lib/catalog.mjs";
import { sha256 } from "../scripts/lib/util.mjs";
import { assessedRun, completeFixture, doReverify } from "./prod-helpers.mjs";
import { hasAssess, readJson, run, tmp, writeJson } from "./helpers.mjs";

const skip = !hasAssess() && "the assessment-report plugin is not in this checkout";
const cap = (cwd, id = "r1") => run(["cap-check", "--run", id], { cwd });
const summaryFile = (runDir) => join(runDir, "severity-summary.json");
const revFile = (runDir, check) => join(runDir, "reverify", `${check}.json`);
const editRev = (runDir, check, fn) => { const f = revFile(runDir, check); const j = readJson(f); fn(j); writeJson(f, j); };
const libCap = async (runDir, assessmentText) => (await import("../scripts/lib/capcheck.mjs")).capCheck({ runDir, catalog: loadCatalog(), assessmentText });

test("no Critical finding: cap-check passes and writes severity-summary.json with counts and the hash of assessment.json", { skip }, () => {
  const { cwd, runDir } = assessedRun({});
  const r = cap(cwd);
  assert.equal(r.code, 0, r.out);
  const s = readJson(summaryFile(runDir));
  assert.equal(s.assessmentSha256, sha256(readFileSync(join(runDir, "assessment.json"))));
  assert.equal(s.counts.Critical, 0);
  assert.equal(s.counts.Low, 17);
  assert.equal(s.runId, "r1");
});

test("Critical without reverify: exit 1, the finding and its check are listed, no severity-summary.json (a stale one is removed)", { skip }, () => {
  const { cwd, runDir } = assessedRun({ critical: ["SE-STG-001"] });
  writeJson(summaryFile(runDir), { stale: true });
  const r = cap(cwd);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /F-001/);
  assert.match(r.out, /SE-STG-001/);
  assert.match(r.out, /reverify/);
  assert.ok(!existsSync(summaryFile(runDir)), "the diagram must never read a severity that did not pass the gate");
});

test("Critical with a full reverify (match, the recorded part hash equals the cited one): passes and the counts include the Critical", { skip }, async () => {
  const { cwd, runDir, fx } = assessedRun({ critical: ["SE-STG-001"] });
  const rv = await doReverify({ runDir, fx, check: "SE-STG-001" });
  assert.equal(rv.state, "match");
  const r = cap(cwd);
  assert.equal(r.code, 0, r.out);
  assert.equal(readJson(summaryFile(runDir)).counts.Critical, 1);
});

test("Critical with evidence but no map entry: the check is derived from the evidence path, so reverify is still required", { skip }, async () => {
  const probe = assessedRun({ critical: [], only: ["SE-STG-001"] });
  const part = join(probe.runDir, "collected", "SE-STG-001.001.jsonl");
  const line = readFileSync(part, "utf8").split("\n")[0];
  const hand = {
    evidence: [{ id: "E-001", kind: "file", path: "SE-STG-001.001.jsonl", startLine: 1, endLine: 1, quote: line }],
    findings: [{ id: "F-001", title: "Armazenamento publico", statement: "Conta com acesso publico a blobs.", evidence: ["E-001"], controls: [{ framework: "azure-waf", controlId: "SE:06" }], impact: "severe", likelihood: "likely", effort: "M", rationale: { impact: "x", likelihood: "y" } }],
  };
  const { cwd, runDir, fx } = assessedRun({ handFindings: hand, dropMapFindings: true });
  assert.deepEqual(readJson(join(runDir, "map.json")).findings, [], "no map entry for the finding");
  const r = cap(cwd);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /SE-STG-001/);
  await doReverify({ runDir, fx, check: "SE-STG-001" });
  assert.equal(cap(cwd).code, 0, "with a match for the derived check the finding is released");
});

test("a Critical resting on a file that is not a sealed part (a summary, a note) has an empty derived set and is refused", { skip }, () => {
  const probe = assessedRun({ critical: [], only: ["SE-STG-001"] });
  const first = readFileSync(join(probe.runDir, "collected", "summary", "security.md"), "utf8").split("\n")[0];
  const hand = {
    evidence: [{ id: "E-001", kind: "file", path: "summary/security.md", startLine: 1, endLine: 1, quote: first }],
    findings: [{ id: "F-001", title: "Achado sem parte selada", statement: "Cita apenas o resumo.", evidence: ["E-001"], controls: [{ framework: "azure-waf", controlId: "SE:06" }], impact: "severe", likelihood: "likely", effort: "M", rationale: { impact: "x", likelihood: "y" } }],
  };
  const { cwd, runDir } = assessedRun({ handFindings: hand, dropMapFindings: true });
  assert.equal(readJson(join(runDir, "assessment.json")).findings[0].severity, "Critical", "the real classify says Critical for machine-checked evidence");
  const r = cap(cwd);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /F-001/);
  assert.match(r.out, /no sealed check|empty|not a sealed part/i);
});

test("a Critical resting only on absence evidence derives no sealed check and is refused", { skip }, () => {
  const hand = {
    evidence: [{ id: "E-001", kind: "absence", scope: ["SE-NET-002.*.jsonl"], pattern: '^\\{"id":' }],
    findings: [{ id: "F-001", title: "Nada encontrado", statement: "Not found in SE-NET-002.*.jsonl.", evidence: ["E-001"], controls: [{ framework: "azure-waf", controlId: "SE:06" }], impact: "severe", likelihood: "likely", effort: "M", rationale: { impact: "x", likelihood: "y" } }],
  };
  const { cwd } = assessedRun({ handFindings: hand, dropMapFindings: true });
  const r = cap(cwd);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /F-001/);
});

test("reverify of another version: a part hash that differs from the cited part, or from the manifest, refuses", { skip }, async () => {
  const { cwd, runDir, fx } = assessedRun({ critical: ["SE-STG-001"] });
  await doReverify({ runDir, fx, check: "SE-STG-001" });
  editRev(runDir, "SE-STG-001", (j) => { j.parts[0].sha256 = "0".repeat(64); });
  const r = cap(cwd);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /hash|version/i);
  assert.ok(!existsSync(summaryFile(runDir)));
});

test("reverify files that name another check, run, catalog, query or part are refused", { skip }, async () => {
  const mutations = [
    (j) => { j.checkId = "SE-STG-002"; },
    (j) => { j.runId = "other"; },
    (j) => { j.catalogSha256 = "1".repeat(64); },
    (j) => { j.querySha256 = { evaluated: "2".repeat(64), violations: "3".repeat(64) }; },
    (j) => { j.parts = []; },
    (j) => { j.parts = [{ name: "SE-STG-002.001.jsonl", sha256: j.parts[0].sha256 }]; },
    (j) => { delete j.parts; },
    (j) => { j.schema = "other/1"; },
    (j) => { j.state = "MATCH"; },
    (j) => { j.state = " match"; },
    (j) => { j.state = ["match"]; },
  ];
  for (const m of mutations) {
    const { cwd, runDir, fx } = assessedRun({ critical: ["SE-STG-001"] });
    await doReverify({ runDir, fx, check: "SE-STG-001" });
    editRev(runDir, "SE-STG-001", m);
    assert.equal(cap(cwd).code, 1, m.toString());
  }
});

test("any state other than match refuses: changed, gone, partial, error, and a file that is not JSON", { skip }, async () => {
  for (const state of ["changed", "gone", "partial", "error", "mismatch", "unknown"]) {
    const { cwd, runDir, fx } = assessedRun({ critical: ["SE-STG-001"] });
    await doReverify({ runDir, fx, check: "SE-STG-001" });
    editRev(runDir, "SE-STG-001", (j) => { j.state = state; });
    const r = cap(cwd);
    assert.equal(r.code, 1, state);
    assert.match(r.out, new RegExp(state));
  }
  const { cwd, runDir, fx } = assessedRun({ critical: ["SE-STG-001"] });
  await doReverify({ runDir, fx, check: "SE-STG-001" });
  writeFileSync(revFile(runDir, "SE-STG-001"), "{ not json");
  assert.equal(cap(cwd).code, 1);
});

test("the sealed part edited after reverify: the cited hash no longer matches the reverify, and seal-check also fails", { skip }, async () => {
  const { cwd, runDir, fx } = assessedRun({ critical: ["SE-STG-001"] });
  await doReverify({ runDir, fx, check: "SE-STG-001" });
  const part = join(runDir, "collected", "SE-STG-001.001.jsonl");
  writeFileSync(part, readFileSync(part, "utf8").replace("stcontosoprod01", "stcontosoprod0x"));
  assert.equal(cap(cwd).code, 1);
});

// ------------------------------------------------------------------------------------------------ partial reverify
function manyOffenders() {
  const fx = completeFixture();
  const f = join(fx, "arg", "SE-DEF-002.json");
  const j = readJson(f);
  const sub = "00000000-0000-0000-0000-000000000001";
  const rows = Array.from({ length: 8 }, (_, i) => ({ id: `/subscriptions/${sub}/providers/Microsoft.Security/assessments/00000000-0000-0000-0000-${String(i + 1).padStart(12, "0")}`, subscriptionId: sub, displayName: `Recommendation ${i}`, severity: "High" }));
  j.violations.pages = [{ rows }];
  j.evaluated.pages = [{ rows: [{ n: 20 }] }];
  writeJson(f, j);
  return { fx, ids: rows.map((r) => r.id) };
}

test("partial reverify: --resource of one of five cited ARM IDs is partial and does not release the Critical", { skip }, async () => {
  const { fx, ids } = manyOffenders();
  const { cwd, runDir } = assessedRun({ fixtures: fx, critical: ["SE-DEF-002"] });
  const rv = await doReverify({ runDir, fx, check: "SE-DEF-002", resource: ids[0] });
  assert.equal(rv.state, "partial");
  assert.equal(rv.scope, "resource");
  const r = cap(cwd);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /partial/i);
});

test("partial reverify that covers every cited ARM ID releases; covering four of five does not; a full reverify (no --resource) does", { skip }, async () => {
  const { fx, ids } = manyOffenders();
  const run1 = assessedRun({ fixtures: fx, critical: ["SE-DEF-002"] });
  const cited = ids.slice(0, 5);
  const ev = readJson(join(run1.runDir, "assessment.json")).evidence.find((e) => e.kind === "file" && e.path.startsWith("SE-DEF-002"));
  assert.equal(ev.endLine - ev.startLine + 1, 5, "the stub cites five lines");
  await doReverify({ runDir: run1.runDir, fx, check: "SE-DEF-002", resource: cited.slice(0, 4) });
  assert.equal(cap(run1.cwd).code, 1, "four of five");
  const all5 = await doReverify({ runDir: run1.runDir, fx, check: "SE-DEF-002", resource: cited });
  assert.equal(all5.state, "partial", "five of eight offenders is still partial by the file's own state");
  const r = cap(run1.cwd);
  assert.equal(r.code, 0, r.out);
  const full = assessedRun({ fixtures: fx, critical: ["SE-DEF-002"] });
  assert.equal((await doReverify({ runDir: full.runDir, fx, check: "SE-DEF-002" })).state, "match");
  assert.equal(cap(full.cwd).code, 0);
});

test("a resource-scope reverify whose covered list was edited to look complete is refused when a covered resource did not match", { skip }, async () => {
  const { fx, ids } = manyOffenders();
  const { cwd, runDir } = assessedRun({ fixtures: fx, critical: ["SE-DEF-002"] });
  await doReverify({ runDir, fx, check: "SE-DEF-002", resource: ids.slice(0, 5) });
  editRev(runDir, "SE-DEF-002", (j) => { j.resources[0].state = "changed"; });
  assert.equal(cap(cwd).code, 1);
  editRev(runDir, "SE-DEF-002", (j) => { j.resources[0].state = "match"; j.covered = ids.slice(0, 4); j.resources = j.resources.slice(0, 4); });
  assert.equal(cap(cwd).code, 1, "covered no longer includes every cited id");
});

test("a resource-scope reverify whose state is changed, gone or error is refused even when every covered resource looks fine", { skip }, async () => {
  const { fx, ids } = manyOffenders();
  const { cwd, runDir } = assessedRun({ fixtures: fx, critical: ["SE-DEF-002"] });
  await doReverify({ runDir, fx, check: "SE-DEF-002", resource: ids.slice(0, 5) });
  assert.equal(cap(cwd).code, 0, "the untouched file releases the finding");
  for (const state of ["changed", "gone", "error", "match-ish", ""]) {
    editRev(runDir, "SE-DEF-002", (j) => { j.state = state; });
    const r = cap(cwd);
    assert.equal(r.code, 1, JSON.stringify(state));
  }
});

// ------------------------------------------------------------------------------------------------ each redundant rule proved alone
function manyParts() {
  const fx = completeFixture();
  const f = join(fx, "arg", "SE-DEF-002.json");
  const j = readJson(f);
  const rows = Array.from({ length: 5000 }, (_, i) => ({ id: `/subscriptions/00000000-0000-0000-0000-000000000001/providers/Microsoft.Security/assessments/00000000-0000-0000-0000-${String(i).padStart(12, "0")}`, subscriptionId: "00000000-0000-0000-0000-000000000001", displayName: `Recommendation number ${i} with a reasonably long display name to give the line some weight`, severity: "High" }));
  const pages = [];
  for (let i = 0; i < rows.length; i += 1000) pages.push({ rows: rows.slice(i, i + 1000), ...(i + 1000 < rows.length ? { $skipToken: `p${i / 1000 + 2}` } : {}) });
  j.violations.pages = pages;
  j.evaluated.pages = [{ rows: [{ n: 5200 }] }];
  writeJson(f, j);
  return fx;
}
function citeFirstPartOnly(fx) {
  const probe = assessedRun({ fixtures: fx, critical: [], only: ["SE-STG-001"] });
  const line = readFileSync(join(probe.runDir, "collected", "SE-DEF-002.001.jsonl"), "utf8").split("\n")[0];
  const hand = {
    evidence: [{ id: "E-001", kind: "file", path: "SE-DEF-002.001.jsonl", startLine: 1, endLine: 1, quote: line }],
    findings: [{ id: "F-001", title: "Muitas recomendacoes", statement: "Cita so a primeira parte.", evidence: ["E-001"], controls: [{ framework: "azure-waf", controlId: "SE:10" }], impact: "severe", likelihood: "likely", effort: "M", rationale: { impact: "x", likelihood: "y" } }],
  };
  return assessedRun({ fixtures: fx, handFindings: hand, dropMapFindings: true });
}

test("rule alone: a check-scope reverify that records only the cited part, with the right hash, does not cover the check and is refused", { skip }, async () => {
  const fx = manyParts();
  const { cwd, runDir } = citeFirstPartOnly(fx);
  const rv = await doReverify({ runDir, fx, check: "SE-DEF-002" });
  assert.equal(rv.state, "match");
  assert.ok(rv.parts.length >= 2, "the data spans several parts");
  assert.equal(cap(cwd).code, 0, "the full reverify releases it");
  editRev(runDir, "SE-DEF-002", (j) => { j.parts = j.parts.slice(0, 1); });
  const r = cap(cwd);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /does not cover every part/);
});

test("rule alone: a reverify taken against another catalog than the shipped one is refused although it equals the manifest entry", { skip }, async () => {
  const { runDir, fx } = assessedRun({ critical: ["SE-STG-001"] });
  await doReverify({ runDir, fx, check: "SE-STG-001" });
  const catalog = loadCatalog();
  assert.equal((await (await import("../scripts/lib/capcheck.mjs")).capCheck({ runDir, catalog })).ok, true);
  const other = { ...catalog, sha256: "e".repeat(64) };
  const r = (await import("../scripts/lib/capcheck.mjs")).capCheck({ runDir, catalog: other });
  assert.equal(r.ok, false);
  assert.match(r.problems.join("\n"), /another catalog/);
});

test("rule alone: a check-scope reverify with a bad state is refused when the resource branch is not involved, and the reverse for a resource scope", { skip }, async () => {
  const a = assessedRun({ critical: ["SE-STG-001"] });
  await doReverify({ runDir: a.runDir, fx: a.fx, check: "SE-STG-001" });
  editRev(a.runDir, "SE-STG-001", (j) => { j.state = "partial"; });
  const r = cap(a.cwd);
  assert.equal(r.code, 1, "scope check needs match, partial is not enough");
  assert.match(r.out, /not match/);
});

// ------------------------------------------------------------------------------------------------ the severity string and the map
test("the Critical string is compared without case, spaces or invisible characters (fail closed)", { skip }, async () => {
  const { runDir } = assessedRun({ critical: ["SE-STG-001"] });
  const text = readFileSync(join(runDir, "assessment.json"), "utf8");
  for (const variant of ["critical", "CRITICAL", "Critical ", " Critical", "Critical​", "Critıcal".replace("ı", "i")]) {
    const a = JSON.parse(text);
    a.findings[0].severity = variant;
    const r = await libCap(runDir, JSON.stringify(a));
    assert.equal(r.ok, false, JSON.stringify(variant));
  }
});

test("a finding that was never classified (no severity) is refused: classify must run first", { skip }, async () => {
  const { runDir } = assessedRun({ critical: [] });
  const a = readJson(join(runDir, "assessment.json"));
  delete a.findings[0].severity;
  const r = await libCap(runDir, JSON.stringify(a));
  assert.equal(r.ok, false);
  assert.match(r.problems.join("\n"), /classify/i);
});

test("evidence paths that are not the canonical part name are refused even when a reverify matches", { skip }, async () => {
  const { runDir, fx } = assessedRun({ critical: ["SE-STG-001"] });
  await doReverify({ runDir, fx, check: "SE-STG-001" });
  const text = readFileSync(join(runDir, "assessment.json"), "utf8");
  for (const p of ["./SE-STG-001.001.jsonl", "x/../SE-STG-001.001.jsonl", "se-stg-001.001.jsonl", "SE-STG-001.001.jsonl ", "SE-STG-001.001.jsonl\u0000", "..\\SE-STG-001.001.jsonl"]) {
    const a = JSON.parse(text);
    for (const e of a.evidence) if (e.kind === "file") e.path = p;
    assert.equal((await libCap(runDir, JSON.stringify(a))).ok, false, JSON.stringify(p));
  }
});

test("map.json is part of the gate: the finding recorded there for another check adds that check to the derived set", { skip }, async () => {
  const { cwd, runDir, fx } = assessedRun({ critical: ["SE-STG-001"] });
  await doReverify({ runDir, fx, check: "SE-STG-001" });
  assert.equal(cap(cwd).code, 0);
  const map = readJson(join(runDir, "map.json"));
  map.checks["SE-STG-002"].finding = map.checks["SE-STG-001"].finding;
  writeJson(join(runDir, "map.json"), map);
  const r = cap(cwd);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /SE-STG-002/);
});

test("map.json that is not valid, or whose part hashes differ from the manifest, refuses", { skip }, async () => {
  const { cwd, runDir, fx } = assessedRun({ critical: ["SE-STG-001"] });
  await doReverify({ runDir, fx, check: "SE-STG-001" });
  const map = readJson(join(runDir, "map.json"));
  map.checks["SE-STG-001"].parts[0].sha256 = "f".repeat(64);
  writeJson(join(runDir, "map.json"), map);
  assert.equal(cap(cwd).code, 1);
  writeFileSync(join(runDir, "map.json"), "{ nope");
  assert.equal(cap(cwd).code, 1);
});

test("cap-check needs a known run", () => {
  const cwd = tmp();
  assert.equal(run(["cap-check", "--run", "nope"], { cwd }).code, 2);
  assert.equal(run(["cap-check"], { cwd }).code, 2);
});

test("cap-check without assessment.json refuses (exit 1)", { skip }, () => {
  const { cwd, runDir } = assessedRun({});
  rmSync(join(runDir, "assessment.json"));
  assert.equal(cap(cwd).code, 1);
});

test("the exact Critical string and the empty .001.jsonl case against the real assess.mjs", { skip }, () => {
  const { runDir } = assessedRun({ critical: ["SE-STG-001"] });
  const a = readJson(join(runDir, "assessment.json"));
  assert.ok(a.findings.some((f) => f.severity === "Critical"));
  const sevs = new Set(a.findings.map((f) => f.severity));
  assert.deepEqual([...sevs].sort(), ["Critical", "Low"]);
  const empty = join(runDir, "collected", "SE-NET-002.001.jsonl");
  assert.equal(readFileSync(empty).length, 0, "a passing check writes an empty .001.jsonl, which cap-check must treat as a sealed part with no offenders");
});
