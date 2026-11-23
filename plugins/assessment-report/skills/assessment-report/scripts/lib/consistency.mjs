// `check`: consistency of the whole assessment. Every problem is reported with its field path.
import { recompute, tokenValues, unknownTokens } from "./classify.mjs";
import { checkRoadmap } from "./roadmap.mjs";
import { validateAssessment } from "./schema.mjs";
import { scanValue } from "./secrets.mjs";

export const PLACEHOLDER_RE = /\[REPLACE[^\]]*\]/;

/**
 * Computed fields (confidence, severity, severityUncapped) may differ from a fresh computation only when the
 * engine itself wrote them last (`snapshot`). Anything else is a hand edit.
 * @param {Map<string, object>} fresh recompute(assessment)
 * @param {Record<string, object>} snapshot what the engine last wrote, by finding ID
 */
export function computedMismatches(assessment, fresh, snapshot = {}, { strict = false } = {}) {
  const out = [];
  (assessment.findings ?? []).forEach((f, i) => {
    const want = fresh.get(f.id);
    const wrote = snapshot[f.id] ?? {};
    for (const k of ["confidence", "severity", "severityUncapped"]) {
      if (f[k] === undefined) continue;
      const matchesFresh = want && f[k] === want[k];
      const matchesWritten = !strict && f[k] === wrote[k];
      if (!matchesFresh && !matchesWritten)
        out.push({ code: "computed-field-mismatch", where: `findings[${i}].${k}`, message: `${f.id}: ${k} is "${f[k]}" but the engine computes "${want?.[k] ?? "(none)"}"; computed fields cannot be edited by hand` });
    }
  });
  return out;
}

export function snapshotComputed(assessment) {
  return Object.fromEntries((assessment.findings ?? []).map((f) => [f.id, { confidence: f.confidence, severity: f.severity, severityUncapped: f.severityUncapped }]));
}

/**
 * @returns {{errors: {code: string, where: string, message: string, level: "finding"|"roadmap"}[], warnings: {code: string, where?: string, message: string}[], roadmap: object}}
 */
export function checkAssessment(assessment, { acceptRoadmapViolations = false, requireSummary = false } = {}) {
  const errors = [];
  const warnings = [];
  const add = (level, code, where, message) => errors.push({ level, code, where, message });

  // 1. Schema (framework fields get a clearer message below)
  for (const e of validateAssessment(assessment)) {
    if (/^frameworks\[\d+\]\.(version|date|url|name)$/.test(e.path) && e.message === "is required") continue;
    const level = e.path.startsWith("actions") || e.path.startsWith("decisions") ? "roadmap" : "finding";
    add(level, "schema", e.path, e.message);
  }
  // A wrong top-level shape would crash the rules below; the schema errors already say what to fix.
  const isObj = (x) => x && typeof x === "object" && !Array.isArray(x);
  const shapeOk = ["evidence", "findings", "actions", "frameworks"].every((k) => Array.isArray(assessment[k]) && assessment[k].every(isObj)) && isObj(assessment.meta) && isObj(assessment.scope);
  if (!shapeOk) return { errors, warnings, roadmap: null };

  const evidence = assessment.evidence ?? [];
  const findings = assessment.findings ?? [];
  const actions = assessment.actions ?? [];
  const frameworks = assessment.frameworks ?? [];
  const evIds = new Set(evidence.map((e) => e.id));
  const findingIds = new Set(findings.map((f) => f.id));
  const actionIds = new Set(actions.map((a) => a.id));

  // 2. IDs unique
  for (const [list, name, level] of [[evidence, "evidence", "finding"], [findings, "findings", "finding"], [actions, "actions", "roadmap"]]) {
    const seen = new Set();
    list.forEach((x, i) => {
      if (seen.has(x.id)) add(level, "duplicate-id", `${name}[${i}].id`, `${x.id} is used more than once`);
      seen.add(x.id);
    });
  }

  // 3. Placeholders left by `init`
  for (const k of ["title", "client", "author", "version", "date"]) {
    if (PLACEHOLDER_RE.test(assessment.meta?.[k] ?? "")) add("finding", "placeholder", `meta.${k}`, `still a placeholder: ${assessment.meta[k]}`);
  }
  if (assessment.meta?.date && !PLACEHOLDER_RE.test(assessment.meta.date) && !/^\d{4}-\d{2}-\d{2}$/.test(assessment.meta.date))
    add("finding", "date", "meta.date", `"${assessment.meta.date}" must be an ISO date like 2026-11-20`);
  if (assessment.meta?.model?.id === "unknown") warnings.push({ code: "model-unknown", where: "meta.model.id", message: "the model identifier is unknown; the report will say so" });

  // 4. Frameworks registered with version and date
  const fwIds = new Set();
  frameworks.forEach((fw, i) => {
    fwIds.add(fw.id);
    for (const k of ["name", "version", "date", "url"])
      if (!fw[k]) add("finding", "framework-incomplete", `frameworks[${i}].${k}`, `framework ${fw.id ?? `#${i}`} is missing ${k}`);
  });

  // 5. Findings
  const fresh = recompute(assessment);
  findings.forEach((f, i) => {
    const w = `findings[${i}]`;
    const unverified = f.confidence === "unverified";
    if (!f.confidence) add("finding", "missing-field", `${w}.confidence`, `${f.id} has no confidence; run classify`);
    if (!f.severity) add("finding", "missing-field", `${w}.severity`, `${f.id} has no severity; run classify`);
    if (!f.evidence?.length && !unverified) add("finding", "missing-evidence", `${w}.evidence`, `${f.id} lists no evidence`);
    if (!f.rationale && (!unverified || f.impact || f.likelihood))
      add("finding", "missing-rationale", `${w}.rationale`, `${f.id} needs a rationale for both impact and likelihood`);
    if (unverified && f.severity && f.severity !== "n/a") add("finding", "unverified-severity", `${w}.severity`, `${f.id} is unverified, so its severity must be n/a`);
    (f.evidence ?? []).forEach((id, j) => {
      if (!evIds.has(id)) add("finding", "dangling-reference", `${w}.evidence[${j}]`, `${f.id} cites evidence ${id}, which does not exist`);
    });
    (f.controls ?? []).forEach((c, j) => {
      if (!fwIds.has(c.framework)) add("finding", "unregistered-framework", `${w}.controls[${j}].framework`, `${f.id} maps to framework "${c.framework}", which is not registered with its version and date`);
    });
    if (f.potentialSeverity && f.confidence === "verified")
      warnings.push({ code: "potential-severity-on-verified", where: `${w}.potentialSeverity`, message: `${f.id} is verified; potentialSeverity is meant for findings that are not` });
  });

  // 6. Actions
  actions.forEach((a, i) => {
    const w = `actions[${i}]`;
    for (const [j, id] of (a.addresses ?? []).entries())
      if (!findingIds.has(id)) add("roadmap", "dangling-reference", `${w}.addresses[${j}]`, `${a.id} addresses ${id}, which does not exist`);
    for (const [j, id] of (a.dependsOn ?? []).entries()) {
      if (!actionIds.has(id)) add("roadmap", "dangling-reference", `${w}.dependsOn[${j}]`, `${a.id} depends on ${id}, which does not exist`);
      if (id === a.id) add("roadmap", "cycle", `${w}.dependsOn[${j}]`, `${a.id} depends on itself`);
    }
  });
  (assessment.decisions ?? []).forEach((d, i) => {
    for (const [j, id] of (d.relatesTo ?? []).entries())
      if (!findingIds.has(id) && !actionIds.has(id)) add("roadmap", "dangling-reference", `decisions[${i}].relatesTo[${j}]`, `decision ${i + 1} refers to ${id}, which does not exist`);
  });

  // 7. Summary tokens and headings
  const values = tokenValues(assessment);
  for (const t of unknownTokens(assessment.summary ?? "", values)) add("finding", "unknown-token", "summary", `unknown summary token {{${t}}}; known tokens: ${Object.keys(values).map((k) => `{{${k}}}`).join(", ")}`);
  if (/^\s{0,3}#{1,6}\s/m.test(assessment.summary ?? "")) add("finding", "summary-heading", "summary", "the summary cannot contain headings (docs-generator rejects them)");
  if (requireSummary && !String(assessment.summary ?? "").trim()) add("finding", "missing-summary", "summary", "the summary is empty; write it after check passes, then run review");

  // 8. Computed fields were not edited by hand (strict: classify must be fresh by now)
  for (const m of computedMismatches(assessment, fresh, {}, { strict: true })) add("finding", m.code, m.where, m.message);

  // 9. Secrets in any string
  const { verification: _v, ...content } = assessment;
  for (const hit of scanValue(content)) add("finding", "secret-in-quote", hit.path, `looks like a secret (${hit.kind}); remove it or use redacted evidence`);

  // 10. Roadmap
  const roadmap = checkRoadmap(assessment);
  if (!acceptRoadmapViolations) for (const e of roadmap.errors) add("roadmap", e.code, e.where, e.message);
  warnings.push(...roadmap.warnings);

  return { errors, warnings, roadmap };
}
