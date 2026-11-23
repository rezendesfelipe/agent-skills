import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildMatrix, CONFIDENCE_CAP, classify, computeConfidence, computeSeverity, DEFAULT_SEVERITY_TABLE, expandTokens,
  IMPACTS, LIKELIHOODS, quickWins, recompute, tokenValues, unknownTokens, verifyFirst,
} from "../scripts/lib/classify.mjs";
import { file, finding, rationale } from "./helpers.mjs";

const SEV = ["Info", "Low", "Medium", "High", "Critical"];
const res = (id, status, machineChecked = true) => ({ evidence: id, kind: "file", status, machineChecked });

/** An assessment whose verification results are given directly, as `verify` would leave them. */
function build({ evidence, results, findings, actions = [] }) {
  return { evidence, findings, actions, scope: {}, verification: { results, controls: [], problems: [] } };
}
const stmt = (id, source) => ({ id, kind: "statement", source, date: "2026-11-01", text: `by ${source}` });

test("severity table: every cell, for a verified finding", () => {
  const expected = {
    low: ["Info", "Info", "Low", "Low"],
    moderate: ["Low", "Low", "Medium", "Medium"],
    high: ["Low", "Medium", "High", "High"],
    severe: ["Medium", "High", "Critical", "Critical"],
  };
  for (const impact of IMPACTS)
    LIKELIHOODS.forEach((likelihood, i) => {
      assert.equal(DEFAULT_SEVERITY_TABLE[impact][likelihood], expected[impact][i]);
      assert.deepEqual(computeSeverity({ impact, likelihood }, "verified"), { severity: expected[impact][i], severityUncapped: undefined });
    });
});

test("confidence cap: corroborated and reported stop at Medium and keep the uncapped value; unverified is n/a", () => {
  for (const confidence of ["corroborated", "reported"])
    for (const impact of IMPACTS)
      for (const likelihood of LIKELIHOODS) {
        const base = DEFAULT_SEVERITY_TABLE[impact][likelihood];
        const r = computeSeverity({ impact, likelihood }, confidence);
        const capped = SEV.indexOf(base) > SEV.indexOf("Medium");
        assert.equal(r.severity, capped ? "Medium" : base, `${confidence} ${impact}/${likelihood}`);
        assert.equal(r.severityUncapped, capped ? base : undefined);
      }
  assert.deepEqual(computeSeverity({ impact: "severe", likelihood: "likely" }, "unverified"), { severity: "n/a", severityUncapped: "Critical" });
  assert.deepEqual(CONFIDENCE_CAP, { verified: null, corroborated: "Medium", reported: "Medium", unverified: "n/a" });
});

test("a client scale overrides cells of the default table", () => {
  const scale = { note: "Client scale", severity: { high: { likely: "Critical" } } };
  assert.equal(computeSeverity({ impact: "high", likelihood: "likely" }, "verified", scale).severity, "Critical");
  assert.equal(computeSeverity({ impact: "high", likelihood: "rare" }, "verified", scale).severity, "Low");
});

test("confidence rules", () => {
  const ev = [file("E-001", "a", 1, 1, "x"), file("E-002", "b", 1, 1, "x"), stmt("E-003", "CTO"), stmt("E-004", "CTO"), stmt("E-005", "SRE"),
    { id: "E-006", kind: "url", url: "https://example.com/a", accessed: "2026-11-01", quote: "q" }];
  const conf = (ids, results) => {
    const a = build({ evidence: ev, results, findings: [finding("F-001", ids)] });
    return recompute(a).get("F-001").confidence;
  };
  const R = [res("E-001", "pass"), res("E-002", "fail"), res("E-003", "unchecked", false), res("E-004", "unchecked", false), res("E-005", "unchecked", false), res("E-006", "unchecked", false)];
  assert.equal(conf(["E-001"], R), "verified");
  assert.equal(conf(["E-001", "E-002"], R), "verified", "one passing item is enough");
  assert.equal(conf(["E-003", "E-005"], R), "corroborated", "two different sources");
  assert.equal(conf(["E-003", "E-006"], R), "corroborated", "a url counts as its own source");
  assert.equal(conf(["E-003"], R), "reported");
  assert.equal(conf(["E-003", "E-004"], R), "reported", "two statements of one source count once");
  assert.equal(conf(["E-002", "E-003"], R), "reported", "a failed item does not count as a source");
  assert.equal(conf(["E-002"], R), "unverified", "every cited item failed");
  assert.equal(conf([], R), "unverified", "no evidence");
});

test("classify writes computed fields, keeps severityUncapped, and adds one wave-1 action per unverified finding (idempotent)", () => {
  const a = build({
    evidence: [file("E-001", "a", 1, 1, "x"), stmt("E-002", "CTO"), file("E-003", "c", 1, 1, "x")],
    results: [res("E-001", "pass"), res("E-002", "unchecked", false), res("E-003", "fail")],
    findings: [
      finding("F-001", ["E-001"], { impact: "severe", likelihood: "likely", effort: "S", rationale }),
      finding("F-002", ["E-002"], { impact: "severe", likelihood: "likely", effort: "M", rationale }),
      finding("F-003", ["E-003"], { impact: "high", likelihood: "likely" }),
    ],
    actions: [{ id: "A-001", title: "x", addresses: ["F-001"], wave: 1, effort: "S", risk: "low", dependsOn: [] }],
  });
  const r = classify(a);
  assert.deepEqual(r.errors, []);
  const f = Object.fromEntries(r.assessment.findings.map((x) => [x.id, x]));
  assert.deepEqual([f["F-001"].confidence, f["F-001"].severity, f["F-001"].severityUncapped], ["verified", "Critical", undefined]);
  assert.deepEqual([f["F-002"].confidence, f["F-002"].severity, f["F-002"].severityUncapped], ["reported", "Medium", "Critical"]);
  assert.deepEqual([f["F-003"].confidence, f["F-003"].severity], ["unverified", "n/a"]);
  assert.deepEqual(r.assessment.actions.map((x) => x.id), ["A-001", "A-002"]);
  assert.equal(r.assessment.actions[1].title, "Collect evidence for F-003");
  const again = classify(r.assessment);
  assert.deepEqual(again.assessment.actions.map((x) => x.id), ["A-001", "A-002"], "running classify twice does not duplicate actions");
});

test("classify refuses a finding that lacks impact, likelihood or effort, and writes nothing", () => {
  const a = build({ evidence: [file("E-001", "a", 1, 1, "x")], results: [res("E-001", "pass")], findings: [finding("F-001", ["E-001"], { impact: "high" })] });
  const r = classify(a);
  assert.match(r.errors[0], /F-001: needs likelihood, effort/);
  assert.equal(a.findings[0].confidence, undefined);
});

test("quick wins are derived: High or Critical with effort S or M; verify-first lists potentialSeverity", () => {
  const a = build({
    evidence: [file("E-001", "a", 1, 1, "x")],
    results: [res("E-001", "pass")],
    findings: [
      finding("F-001", ["E-001"], { impact: "high", likelihood: "likely", effort: "S", rationale }),
      finding("F-002", ["E-001"], { impact: "severe", likelihood: "likely", effort: "M", rationale }),
      finding("F-003", ["E-001"], { impact: "severe", likelihood: "likely", effort: "L", rationale }),
      finding("F-004", ["E-001"], { impact: "moderate", likelihood: "likely", effort: "S", rationale, potentialSeverity: "High" }),
    ],
  });
  const c = classify(a).assessment;
  assert.deepEqual(quickWins(c).map((f) => f.id), ["F-002", "F-001"]);
  assert.deepEqual(verifyFirst(c).map((f) => f.id), ["F-004"]);
  const m = buildMatrix(c);
  assert.deepEqual(m.rows.map((r) => r.severity), ["Critical", "High", "Medium", "Low"]);
  assert.deepEqual(m.rows[0].cells, { S: [], M: ["F-002"], L: ["F-003"], XL: [] });
  assert.deepEqual(m.rows[1].cells.S, ["F-001"]);
  assert.deepEqual(m.rows[2].cells.S, ["F-004"]);
});

test("summary tokens come from computed counts; unknown tokens are reported", () => {
  const a = build({
    evidence: [file("E-001", "a", 1, 1, "x")],
    results: [res("E-001", "pass")],
    findings: [finding("F-001", ["E-001"], { impact: "severe", likelihood: "likely", effort: "S", rationale }), finding("F-002", [], {})],
  });
  const c = classify(a).assessment;
  const v = tokenValues(c);
  assert.equal(v["count.critical"], 1);
  assert.equal(v["count.unverified"], 1);
  assert.equal(v["count.findings"], 1);
  assert.equal(expandTokens("{{count.critical}} critical, {{ count.unverified }} not verified", v), "1 critical, 1 not verified");
  assert.deepEqual(unknownTokens("{{count.bogus}} {{count.high}}", v), ["count.bogus"]);
});
