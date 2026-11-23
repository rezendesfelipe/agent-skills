// Deterministic eval cases: run without a model, as part of `npm test`. A failing case is reported by its ID
// with the expected and the actual result.
import { mkdtempSync, readFileSync, readdirSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { computeConfidence, computeSeverity } from "../scripts/lib/classify.mjs";
import { checkAssessment } from "../scripts/lib/consistency.mjs";
import { buildInventory } from "../scripts/lib/inventory.mjs";
import { renderReport } from "../scripts/lib/render.mjs";
import { checkRoadmap } from "../scripts/lib/roadmap.mjs";
import { verifyAssessment } from "../scripts/lib/verify.mjs";
import { materialize, substituteDeep } from "./fake-secret.mjs";
import { fixtureRoot } from "./keys.mjs";

export const DET_DIR = fileURLToPath(new URL("./cases/deterministic/", import.meta.url));
const readJson = (f) => JSON.parse(readFileSync(join(DET_DIR, f), "utf8"));

export function loadSuites() {
  return readdirSync(DET_DIR).filter((f) => f.endsWith(".json") && f !== "base-assessment.json").sort().map((f) => ({ file: f, ...readJson(f) }));
}

/** Applies [{op: "set"|"delete"|"push", path: "findings.0.evidence", value}] to a copy of the base assessment. */
export function patched(patch = []) {
  const a = structuredClone(readJson("base-assessment.json"));
  for (const p of substituteDeep(patch)) {
    const keys = p.path.split(".");
    const last = keys.pop();
    const target = keys.reduce((n, k) => n[k], a);
    if (p.op === "set") target[last] = p.value;
    else if (p.op === "delete") delete target[last];
    else if (p.op === "push") target[last].push(p.value);
    else throw new Error(`unknown patch op ${p.op}`);
  }
  return a;
}

const sorted = (xs) => [...new Set(xs)].sort();
const strip = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

const RUNNERS = {
  verifier(c) {
    const root = materialize(fixtureRoot(c.fixture ?? "M-01"));
    const inventory = buildInventory(root, {});
    for (const m of c.mutate ?? []) appendFileSync(join(root, m.path), m.append);
    const a = { evidence: [substituteDeep(c.evidence)], findings: [] };
    const r = verifyAssessment(a, { root, outDir: mkdtempSync(join(tmpdir(), "assess-eval-out-")), inventory, maxBytes: c.maxBytes });
    return strip({ status: r.results[0].status, code: r.results[0].code });
  },
  severity(c) {
    return strip(computeSeverity({ impact: c.impact, likelihood: c.likelihood }, c.confidence, c.scale));
  },
  confidence(c) {
    const ev = new Map(c.evidence.map((e) => [e.id, e]));
    const res = new Map(Object.entries(c.results).map(([id, status]) => [id, { evidence: id, status, machineChecked: ["file", "absence", "output", "document"].includes(ev.get(id).kind) }]));
    return { confidence: computeConfidence({ evidence: c.cites }, ev, res) };
  },
  roadmap(c) {
    const r = checkRoadmap({ actions: c.actions ?? [], findings: c.findings ?? [], scope: c.scope ?? {} });
    return { errors: sorted(r.errors.map((e) => e.code)), warnings: sorted(r.warnings.map((w) => w.code)) };
  },
  consistency(c) {
    const r = checkAssessment(patched(c.patch), c.options ?? { acceptRoadmapViolations: false });
    return { codes: sorted(r.errors.map((e) => e.code)) };
  },
  render(c) {
    const files = renderReport(patched(c.patch), c.options ?? {});
    const text = files[c.file ?? "report.md"] ?? "";
    return { missing: (c.contains ?? []).filter((s) => !text.includes(s)), unexpected: (c.notContains ?? []).filter((s) => text.includes(s)) };
  },
};

/** @returns {{id: string, suite: string, ok: boolean, expected: object, actual: object}[]} */
export function runAll() {
  const out = [];
  for (const suite of loadSuites()) {
    for (const c of suite.cases) {
      let actual;
      try {
        actual = RUNNERS[suite.suite](c);
      } catch (e) {
        actual = { error: e.message };
      }
      const expected = suite.suite === "render" ? { missing: [], unexpected: [] } : c.expect;
      out.push({ id: c.id, suite: suite.suite, ok: JSON.stringify(actual) === JSON.stringify(expected), expected, actual });
    }
  }
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const all = runAll();
  const bad = all.filter((r) => !r.ok);
  for (const b of bad) console.log(`FAIL ${b.id}\n  expected ${JSON.stringify(b.expected)}\n  actual   ${JSON.stringify(b.actual)}`);
  console.log(`${all.length - bad.length}/${all.length} deterministic cases pass`);
  process.exitCode = bad.length ? 1 : 0;
}
