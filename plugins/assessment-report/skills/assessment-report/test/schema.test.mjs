import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { computedMismatches } from "../scripts/lib/consistency.mjs";
import { recompute } from "../scripts/lib/classify.mjs";
import { validateAssessment } from "../scripts/lib/schema.mjs";
import { file, finding, rationale } from "./helpers.mjs";

const skeleton = JSON.parse(readFileSync(fileURLToPath(new URL("../templates/assessment.skeleton.json", import.meta.url)), "utf8"));

function valid() {
  const a = structuredClone(skeleton);
  a.frameworks.push({ id: "cis-azure", name: "CIS Azure Foundations", version: "2.0.0", date: "2024-01-01", url: "https://example.com/cis" });
  a.evidence.push(file("E-001", "infra/main.tf", 1, 2, "x"));
  a.findings.push(finding("F-001", ["E-001"], { impact: "high", likelihood: "likely", effort: "S", rationale }));
  a.actions.push({ id: "A-001", title: "Fix it", addresses: ["F-001"], wave: 1, effort: "S", risk: "low", dependsOn: [] });
  return a;
}
const paths = (a) => validateAssessment(a).map((e) => e.path);

test("the skeleton and a complete assessment are valid", () => {
  assert.deepEqual(validateAssessment(skeleton), []);
  assert.deepEqual(validateAssessment(valid()), []);
});

const FIXTURES = [
  ["finding without an evidence list", (a) => delete a.findings[0].evidence, "findings[0].evidence"],
  ["unknown evidence kind", (a) => (a.evidence[0].kind = "screenshot"), "evidence[0].kind"],
  ["bad finding ID", (a) => (a.findings[0].id = "F1"), "findings[0].id"],
  ["bad evidence ID", (a) => (a.evidence[0].id = "E-1"), "evidence[0].id"],
  ["bad action ID", (a) => (a.actions[0].id = "A-01"), "actions[0].id"],
  ["framework without version", (a) => delete a.frameworks[0].version, "frameworks[0].version"],
  ["framework without date", (a) => delete a.frameworks[0].date, "frameworks[0].date"],
  ["framework with a free-text date", (a) => (a.frameworks[0].date = "last year"), "frameworks[0].date"],
  ["file evidence without a quote", (a) => delete a.evidence[0].quote, "evidence[0].quote"],
  ["file evidence without lines", (a) => delete a.evidence[0].startLine, "evidence[0].startLine"],
  ["redacted evidence that keeps a quote", (a) => Object.assign(a.evidence[0], { redacted: true, secretKind: "private-key" }), "evidence[0].quote"],
  ["redacted evidence without a kind", (a) => { delete a.evidence[0].quote; a.evidence[0].redacted = true; }, "evidence[0].secretKind"],
  ["absence evidence without a scope", (a) => (a.evidence[0] = { id: "E-001", kind: "absence", pattern: "x" }), "evidence[0].scope"],
  ["statement without a source", (a) => (a.evidence[0] = { id: "E-001", kind: "statement", date: "2026-01-01", text: "t" }), "evidence[0].source"],
  ["unknown impact", (a) => (a.findings[0].impact = "huge"), "findings[0].impact"],
  ["rationale for only one input", (a) => delete a.findings[0].rationale.likelihood, "findings[0].rationale.likelihood"],
  ["unknown finding field", (a) => (a.findings[0].likelyhood = "likely"), "findings[0].likelyhood"],
  ["action without a wave", (a) => delete a.actions[0].wave, "actions[0].wave"],
  ["wave 5", (a) => (a.actions[0].wave = 5), "actions[0].wave"],
  ["bad language", (a) => (a.meta.lang = "fr"), "meta.lang"],
  ["wrong schemaVersion", (a) => (a.schemaVersion = "2.0"), "schemaVersion"],
  ["potentialSeverity Low", (a) => (a.findings[0].potentialSeverity = "Low"), "findings[0].potentialSeverity"],
];
for (const [name, mutate, path] of FIXTURES) {
  test(`schema rejects: ${name}`, () => {
    const a = valid();
    mutate(a);
    const got = paths(a);
    assert.ok(got.some((p) => p === path), `expected ${path} in ${JSON.stringify(got)}`);
  });
}

test("schema rejects a computed field with a wrong value (the engine's tamper check)", () => {
  const a = valid();
  a.findings[0].confidence = "verified";
  a.verification = { results: [{ evidence: "E-001", kind: "file", status: "fail", machineChecked: true, code: "quote-mismatch" }], controls: [], problems: [] };
  const mismatches = computedMismatches(a, recompute(a));
  assert.equal(mismatches.length, 1);
  assert.equal(mismatches[0].where, "findings[0].confidence");
});
