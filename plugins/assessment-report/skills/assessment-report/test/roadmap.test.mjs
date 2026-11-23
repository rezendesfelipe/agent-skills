import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { checkAssessment } from "../scripts/lib/consistency.mjs";
import { checkRoadmap, findCycles, waveTotals } from "../scripts/lib/roadmap.mjs";
import { edit, file, finding, rationale, readJson, run, startRun } from "./helpers.mjs";

const act = (id, wave, extra = {}) => ({ id, title: `Action ${id}`, addresses: ["F-001"], wave, effort: "S", risk: "low", dependsOn: [], ...extra });
const withActions = (actions, findings = [{ id: "F-001", severity: "High", confidence: "verified" }], scope = {}) => ({ actions, findings, scope });
const codes = (r) => r.errors.map((e) => e.code);

test("a dependency in a later wave fails and names both actions", () => {
  const r = checkRoadmap(withActions([act("A-003", 1, { dependsOn: ["A-004"] }), act("A-004", 2)]));
  assert.deepEqual(codes(r), ["wave-order"]);
  assert.match(r.errors[0].message, /A-003 is in wave 1 but depends on A-004 in wave 2/);
});

test("a cycle fails and prints the cycle", () => {
  const r = checkRoadmap(withActions([act("A-001", 1, { dependsOn: ["A-002"] }), act("A-002", 1, { dependsOn: ["A-001"] })]));
  assert.ok(codes(r).includes("cycle"));
  assert.match(r.errors.find((e) => e.code === "cycle").message, /A-001 -> A-002 -> A-001/);
  assert.deepEqual(findCycles([act("A-001", 1), act("A-002", 1, { dependsOn: ["A-001"] })]), []);
});

test("a Medium-or-above finding needs an action or a disposition with reason and owner", () => {
  let r = checkRoadmap({ actions: [], findings: [{ id: "F-001", severity: "High", confidence: "verified" }], scope: {} });
  assert.deepEqual(codes(r), ["unaddressed"]);
  assert.match(r.errors[0].message, /F-001 \(High\)/);
  r = checkRoadmap({ actions: [], findings: [{ id: "F-001", severity: "High", disposition: { status: "accepted", reason: "Legacy system retires in March", owner: "CTO" } }], scope: {} });
  assert.deepEqual(codes(r), []);
  r = checkRoadmap({ actions: [], findings: [{ id: "F-002", severity: "Low" }, { id: "F-003", severity: "n/a" }], scope: {} });
  assert.deepEqual(codes(r), [], "Low and n/a need no action");
});

test("a Critical finding addressed only after wave 1 needs a recorded reason", () => {
  const f = [{ id: "F-001", severity: "Critical", confidence: "verified" }];
  let r = checkRoadmap(withActions([act("A-001", 2)], f));
  assert.deepEqual(codes(r), ["critical-late"]);
  r = checkRoadmap(withActions([act("A-001", 2, { reason: "Needs the vendor's maintenance window in week 6" })], f));
  assert.deepEqual(codes(r), []);
  r = checkRoadmap(withActions([act("A-001", 1)], f));
  assert.deepEqual(codes(r), []);
});

test("wave totals and the capacity warning (a warning, not an error)", () => {
  const actions = [act("A-001", 1, { effort: "M" }), act("A-002", 1, { effort: "L" }), act("A-003", 2, { effort: "XL" })];
  const t = waveTotals(actions);
  assert.deepEqual(t[1], { actions: 2, min: 14, max: 40 });
  assert.deepEqual(t[2], { actions: 1, min: 31, max: null });
  const r = checkRoadmap(withActions(actions, [], { capacity: { 1: 10, 2: 100 } }));
  assert.deepEqual(r.errors, []);
  assert.equal(r.warnings.length, 2);
  assert.match(r.warnings[0].message, /wave 1 needs at least 14 person-days and the stated capacity is 10/);
  assert.match(r.warnings[1].message, /wave 2 may exceed/);
});

// ---- the check command ---------------------------------------------------------------------------------
function classifiedRun() {
  const { out } = startRun();
  edit(out, (a) => {
    a.evidence.push(file("E-001", "infra/main.tf", 11, 11, '  min_tls_version          = "TLS1_0"'));
    a.findings.push(finding("F-001", ["E-001"], { impact: "high", likelihood: "likely", effort: "S", rationale }));
  });
  assert.equal(run(["verify", "--out", out]).code, 0);
  assert.equal(run(["classify", "--out", out]).code, 0);
  return out;
}

test("check: two roadmap retries, then the remaining violations are listed in the report data and the flow continues", () => {
  const out = classifiedRun();
  edit(out, (a) => a.actions.push(act("A-001", 1, { dependsOn: ["A-002"] }), act("A-002", 1, { addresses: ["F-001"], dependsOn: ["A-001"] })));
  let r = run(["check", "--out", out]);
  assert.equal(r.code, 1);
  assert.match(r.out, /retry 1 of 2/);
  assert.match(r.out, /dependency cycle/);
  r = run(["check", "--out", out]);
  assert.equal(r.code, 1);
  assert.match(r.out, /retry 2 of 2/);
  r = run(["check", "--out", out]);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /Roadmap violations remain after 2 retries/);
  assert.ok(readJson(join(out, "assessment.json")).roadmapViolations[0].includes("dependency cycle"));
  assert.match(run(["status", "--out", out]).out, /Current node: narrate/);
});

test("check exit codes: 0 clean, 1 findings, 2 usage", () => {
  const out = classifiedRun();
  edit(out, (a) => a.actions.push(act("A-001", 1)));
  assert.equal(run(["check", "--out", out]).code, 0);
  assert.equal(run(["check", "--out", out, "--json"]).code, 0);
  assert.equal(run(["check", "--out", out + "-nowhere"]).code, 2);
  assert.equal(run(["bogus"]).code, 2);
  edit(out, (a) => (a.actions[0].addresses = ["F-099"]));
  const r = run(["check", "--out", out, "--json"]);
  assert.equal(r.code, 1);
  const j = JSON.parse(r.stdout);
  assert.equal(j.ok, false);
  assert.ok(j.errors.some((e) => e.code === "dangling-reference" && /A-001 addresses F-099/.test(e.message)));
});

// ---- consistency rules, one failing fixture each --------------------------------------------------------
function good() {
  const a = {
    schemaVersion: "1.0",
    meta: { title: "T", client: "C", author: "A", version: "1.0", date: "2026-11-20", lang: "en", skillVersion: "0.1.0", engineVersion: "0.1.0", model: { id: "m", reportedBy: "agent" }, revision: "r" },
    scope: { in: [], out: [], questions: [], assumptions: [], root: "/x" },
    frameworks: [{ id: "cis", name: "CIS", version: "2.0", date: "2024-01-01", url: "https://example.com" }],
    evidence: [file("E-001", "a", 1, 1, "x")],
    findings: [finding("F-001", ["E-001"], { impact: "high", likelihood: "likely", effort: "S", rationale, controls: [{ framework: "cis", controlId: "1.1" }], confidence: "verified", severity: "High" })],
    actions: [act("A-001", 1)],
    summary: "We found {{count.high}} high finding.",
    verification: { results: [{ evidence: "E-001", kind: "file", status: "pass", machineChecked: true }], controls: [], problems: [] },
  };
  return a;
}
const errs = (a, opts) => checkAssessment(a, opts).errors;
const has = (a, code, re, opts) => errs(a, opts).some((e) => e.code === code && re.test(`${e.where} ${e.message}`));

test("consistency: a clean assessment has no errors", () => {
  assert.deepEqual(errs(good()), []);
});

const RULES = [
  ["finding without evidence", (a) => { a.findings[0].evidence = []; }, "missing-evidence", /F-001 lists no evidence/],
  ["finding without rationale", (a) => delete a.findings[0].rationale, "missing-rationale", /F-001/],
  ["finding without severity", (a) => delete a.findings[0].severity, "missing-field", /findings\[0\]\.severity/],
  ["finding without confidence", (a) => delete a.findings[0].confidence, "missing-field", /findings\[0\]\.confidence/],
  ["dangling evidence reference", (a) => { a.findings[0].evidence = ["E-099"]; }, "dangling-reference", /F-001 cites evidence E-099/],
  ["dangling finding reference", (a) => { a.actions[0].addresses = ["F-099"]; }, "dangling-reference", /A-001 addresses F-099/],
  ["dangling dependency", (a) => { a.actions[0].dependsOn = ["A-099"]; }, "dangling-reference", /A-001 depends on A-099/],
  ["action without a wave", (a) => delete a.actions[0].wave, "schema", /actions\[0\]\.wave/],
  ["unknown summary token", (a) => { a.summary = "{{count.bogus}}"; }, "unknown-token", /count\.bogus/],
  ["summary with a heading", (a) => { a.summary = "# Title"; }, "summary-heading", /headings/],
  ["control of an unregistered framework", (a) => { a.findings[0].controls[0].framework = "nist"; }, "unregistered-framework", /"nist"/],
  ["framework without version", (a) => delete a.frameworks[0].version, "framework-incomplete", /frameworks\[0\]\.version/],
  ["framework without date", (a) => delete a.frameworks[0].date, "framework-incomplete", /frameworks\[0\]\.date/],
  ["duplicate finding ID", (a) => a.findings.push(structuredClone(a.findings[0])), "duplicate-id", /F-001 is used more than once/],
  ["placeholder left by init", (a) => { a.meta.author = "[REPLACE: author]"; }, "placeholder", /meta\.author/],
  ["schema violation", (a) => { a.findings[0].impact = "huge"; }, "schema", /findings\[0\]\.impact/],
  ["unverified finding with a severity", (a) => { a.findings[0].confidence = "unverified"; a.verification.results[0].status = "fail"; }, "unverified-severity", /n\/a/],
  ["hand-edited severity", (a) => { a.findings[0].severity = "Critical"; }, "computed-field-mismatch", /findings\[0\]\.severity/],
  ["a secret in a free-text field", (a) => { a.findings[0].statement = "key AKIA" + "IOSFODNN7" + "EXAMPLE leaked"; }, "secret-in-quote", /statement/],
  ["unaddressed High finding", (a) => { a.actions = []; }, "unaddressed", /F-001 \(High\)/],
];
for (const [name, mutate, code, re] of RULES)
  test(`consistency fails: ${name}`, () => {
    const a = good();
    mutate(a);
    assert.ok(has(a, code, re), JSON.stringify(errs(a).map((e) => `${e.code}:${e.where}:${e.message}`), null, 1));
  });

test("an unverified finding without evidence is allowed (it is shown only under Not verified)", () => {
  const a = good();
  a.findings.push({ id: "F-002", title: "t", statement: "s", evidence: [], confidence: "unverified", severity: "n/a" });
  a.actions.push(act("A-002", 1, { addresses: ["F-002"], generated: "collect-evidence" }));
  assert.deepEqual(errs(a), []);
});

test("the summary may be empty at check but not at review or render", () => {
  const a = good();
  a.summary = "";
  assert.deepEqual(errs(a), []);
  assert.ok(has(a, "missing-summary", /empty/, { requireSummary: true }));
});
