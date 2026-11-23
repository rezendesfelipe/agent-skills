// Confidence, severity, the severity x effort matrix, quick wins, counts and the demotion bookkeeping.
// The model proposes impact, likelihood and effort; this module computes everything else.
import { nextId, sevRank } from "./assessment.mjs";

export const DEFAULT_SEVERITY_TABLE = {
  low: { rare: "Info", possible: "Info", likely: "Low", "almost-certain": "Low" },
  moderate: { rare: "Low", possible: "Low", likely: "Medium", "almost-certain": "Medium" },
  high: { rare: "Low", possible: "Medium", likely: "High", "almost-certain": "High" },
  severe: { rare: "Medium", possible: "High", likely: "Critical", "almost-certain": "Critical" },
};
export const IMPACTS = Object.keys(DEFAULT_SEVERITY_TABLE);
export const LIKELIHOODS = ["rare", "possible", "likely", "almost-certain"];

/** Highest severity each confidence level allows. `null` means no cap. */
export const CONFIDENCE_CAP = { verified: null, corroborated: "Medium", reported: "Medium", unverified: "n/a" };

export const DEFAULT_EFFORT_DAYS = { S: [1, 2], M: [3, 10], L: [11, 30], XL: [31, null] };
export const EFFORTS = ["S", "M", "L", "XL"];

export function severityTable(scale) {
  const table = {};
  for (const impact of IMPACTS) table[impact] = { ...DEFAULT_SEVERITY_TABLE[impact], ...(scale?.severity?.[impact] ?? {}) };
  return table;
}

export function effortDays(scale) {
  return { ...DEFAULT_EFFORT_DAYS, ...(scale?.effortDays ?? {}) };
}

/** Independent non-machine sources of one finding. A source is compared trimmed, lower-case and with single spaces: "CTO" and " cto " are one source. */
function sourceOf(e) {
  if (e.source) return String(e.source).trim().toLowerCase().replace(/\s+/g, " ");
  if (e.url) {
    try {
      return new URL(e.url).origin;
    } catch {
      return e.url;
    }
  }
  return e.id;
}

/** @returns {"verified"|"corroborated"|"reported"|"unverified"} */
export function computeConfidence(finding, evidenceById, resultById) {
  let machinePass = 0;
  const sources = new Set();
  for (const id of finding.evidence ?? []) {
    const ev = evidenceById.get(id);
    const res = resultById.get(id);
    if (!ev || !res) continue;
    if (res.status === "pass" && res.machineChecked) machinePass++;
    else if (res.status === "unchecked") sources.add(sourceOf(ev));
  }
  if (machinePass > 0) return "verified";
  if (sources.size >= 2) return "corroborated";
  if (sources.size === 1) return "reported";
  return "unverified";
}

export function computeSeverity(finding, confidence, scale) {
  const base = finding.impact && finding.likelihood ? severityTable(scale)[finding.impact]?.[finding.likelihood] : undefined;
  if (confidence === "unverified") return { severity: "n/a", severityUncapped: base };
  if (!base) return { severity: undefined, severityUncapped: undefined };
  const cap = CONFIDENCE_CAP[confidence];
  const severity = cap && sevRank(base) > sevRank(cap) ? cap : base;
  return { severity, severityUncapped: severity === base ? undefined : base };
}

/** Maps each evidence ID to its latest verification result. */
export function resultMap(assessment) {
  return new Map((assessment.verification?.results ?? []).map((r) => [r.evidence, r]));
}

/** Fresh confidence and severity for every finding, without touching the assessment. */
export function recompute(assessment) {
  const evidenceById = new Map((assessment.evidence ?? []).map((e) => [e.id, e]));
  const results = resultMap(assessment);
  const out = new Map();
  for (const f of assessment.findings ?? []) {
    const confidence = computeConfidence(f, evidenceById, results);
    out.set(f.id, { confidence, ...computeSeverity(f, confidence, assessment.scope?.scale) });
  }
  return out;
}

/**
 * Writes confidence, severity and severityUncapped, and keeps one wave-1 "Collect evidence" action per
 * unverified finding. Findings that cannot be classified are returned as errors and nothing is written.
 * @returns {{errors: string[], assessment: object}}
 */
export function classify(assessment) {
  const fresh = recompute(assessment);
  const errors = [];
  for (const f of assessment.findings ?? []) {
    const c = fresh.get(f.id);
    if (c.confidence === "unverified") continue;
    const missing = ["impact", "likelihood", "effort"].filter((k) => !f[k]);
    if (missing.length) errors.push(`${f.id}: needs ${missing.join(", ")} before it can be classified`);
  }
  if (errors.length) return { errors, assessment };

  const next = structuredClone(assessment);
  for (const f of next.findings) {
    const c = fresh.get(f.id);
    f.confidence = c.confidence;
    f.severity = c.severity;
    if (c.severityUncapped) f.severityUncapped = c.severityUncapped;
    else delete f.severityUncapped;
  }

  // Demotion bookkeeping: a wave-1 action to collect evidence for every unverified finding.
  const unverified = new Set(next.findings.filter((f) => f.confidence === "unverified").map((f) => f.id));
  next.actions = (next.actions ?? []).filter((a) => a.generated !== "collect-evidence" || (a.addresses.length === 1 && unverified.has(a.addresses[0])));
  for (const id of unverified) {
    if (next.actions.some((a) => a.generated === "collect-evidence" && a.addresses[0] === id)) continue;
    next.actions.push({
      id: nextId("A", next.actions),
      title: `Collect evidence for ${id}`,
      addresses: [id],
      wave: 1,
      effort: "S",
      risk: "low",
      dependsOn: [],
      generated: "collect-evidence",
    });
  }
  return { errors, assessment: next };
}

export const isShown = (f) => f.confidence !== "unverified";

export function shownFindings(a) {
  return (a.findings ?? []).filter(isShown);
}
export function notVerifiedFindings(a) {
  return (a.findings ?? []).filter((f) => !isShown(f));
}

/** Severity (rows) x effort (columns). Rows run Critical to Low; Info appears only when a finding has it. */
export function buildMatrix(assessment) {
  const shown = shownFindings(assessment).filter((f) => f.severity && f.severity !== "n/a" && f.effort);
  const sevs = ["Critical", "High", "Medium", "Low"];
  if (shown.some((f) => f.severity === "Info")) sevs.push("Info");
  const rows = sevs.map((severity) => ({
    severity,
    cells: Object.fromEntries(EFFORTS.map((e) => [e, shown.filter((f) => f.severity === severity && f.effort === e).map((f) => f.id)])),
  }));
  return { efforts: EFFORTS, rows };
}

/** High or Critical with effort S or M. Derived, never chosen. */
export function quickWins(assessment) {
  return shownFindings(assessment)
    .filter((f) => (f.severity === "High" || f.severity === "Critical") && (f.effort === "S" || f.effort === "M"))
    .sort((a, b) => sevRank(b.severity) - sevRank(a.severity) || a.id.localeCompare(b.id));
}

export function verifyFirst(assessment) {
  return (assessment.findings ?? []).filter((f) => f.potentialSeverity);
}

/** Values for the summary tokens, such as {{count.critical}}. Counts come from code, never from the model. */
export function tokenValues(assessment) {
  const shown = shownFindings(assessment);
  const count = (pred) => (assessment.findings ?? []).filter(pred).length;
  const v = {
    "count.findings": shown.length,
    "count.all": (assessment.findings ?? []).length,
    "count.critical": count((f) => f.severity === "Critical"),
    "count.high": count((f) => f.severity === "High"),
    "count.medium": count((f) => f.severity === "Medium"),
    "count.low": count((f) => f.severity === "Low"),
    "count.info": count((f) => f.severity === "Info"),
    "count.verified": count((f) => f.confidence === "verified"),
    "count.corroborated": count((f) => f.confidence === "corroborated"),
    "count.reported": count((f) => f.confidence === "reported"),
    "count.unverified": count((f) => f.confidence === "unverified"),
    "count.actions": (assessment.actions ?? []).length,
    "count.quickwins": quickWins(assessment).length,
    "count.verifyfirst": verifyFirst(assessment).length,
  };
  for (const w of [1, 2, 3, 4]) v[`count.wave${w}`] = (assessment.actions ?? []).filter((a) => a.wave === w).length;
  return v;
}

export const TOKEN_RE = /\{\{\s*([a-z0-9.]+)\s*\}\}/gi;

export function unknownTokens(text, values) {
  const out = [];
  for (const m of text.matchAll(TOKEN_RE)) if (!(m[1].toLowerCase() in values)) out.push(m[1]);
  return out;
}

export function expandTokens(text, values) {
  return text.replace(TOKEN_RE, (m, k) => (k.toLowerCase() in values ? String(values[k.toLowerCase()]) : m));
}
