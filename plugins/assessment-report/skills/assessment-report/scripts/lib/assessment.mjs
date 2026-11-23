// Reading, writing and hashing assessment.json, and the paths of an output folder.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { hashOf, readJson, writeJson } from "./util.mjs";

export const COMPUTED_FINDING_FIELDS = ["confidence", "severity", "severityUncapped"];

export function outPaths(out) {
  return {
    out,
    assessment: join(out, "assessment.json"),
    inventory: join(out, "inventory.json"),
    state: join(out, ".state", "run.json"),
    evidenceDir: join(out, "evidence"),
    captures: join(out, "evidence", ".captures.json"),
    report: join(out, "report"),
  };
}

export function loadAssessment(out) {
  const p = outPaths(out).assessment;
  if (!existsSync(p)) return null;
  return readJson(p);
}

export function saveAssessment(out, assessment) {
  writeJson(outPaths(out).assessment, assessment);
}

const withoutExcerptHash = (e) => {
  const { excerptSha256, ...rest } = e;
  return rest;
};
const withoutComputed = (f) => {
  const copy = { ...f };
  for (const k of COMPUTED_FINDING_FIELDS) delete copy[k];
  return copy;
};

/** Hash gated by `verify`: the evidence and the parts of a finding that evidence depends on. */
export function hashCore(a) {
  return hashOf({
    evidence: (a.evidence ?? []).map(withoutExcerptHash),
    findings: (a.findings ?? []).map((f) => ({ id: f.id, title: f.title, statement: f.statement, evidence: f.evidence, controls: f.controls })),
  });
}

/** Hash gated by `check`: everything except the narrative written afterwards and the engine's computed fields. */
export function hashChecked(a) {
  const { review, ...meta } = a.meta ?? {};
  return hashOf({
    meta,
    scope: a.scope,
    frameworks: a.frameworks,
    evidence: (a.evidence ?? []).map(withoutExcerptHash),
    findings: (a.findings ?? []).map(withoutComputed),
    actions: a.actions,
  });
}

/** Hash gated by `review`: everything a reader sees, narrative included, except computed fields. */
export function hashAll(a) {
  return hashOf({ checked: hashChecked(a), summary: a.summary, decisions: a.decisions ?? [] });
}

export function nextId(prefix, items) {
  const max = items.reduce((m, x) => Math.max(m, Number(String(x.id).slice(2)) || 0), 0);
  return `${prefix}-${String(max + 1).padStart(3, "0")}`;
}

export const SEVERITIES = ["Info", "Low", "Medium", "High", "Critical"];
export const sevRank = (s) => SEVERITIES.indexOf(s);
