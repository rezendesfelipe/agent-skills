// The shipped check catalog: loading, the in-house validator (the rules of catalog/check.schema.json plus the KQL allowlist,
// the projection rules, the host allowlist and the closed az list) and the catalog hash.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { isAllowedAzVector, isAllowedUrl } from "./azread.mjs";
import { kqlProblems, neverTypeHits, projectionProblems } from "./kql.mjs";
import { sha256, stableStringify } from "./util.mjs";

export const CATALOG_DIR = fileURLToPath(new URL("../../catalog", import.meta.url));
export const PILLARS = ["security", "reliability", "cost", "operations", "performance"];
const PREFIX = { security: "SE", reliability: "RE", cost: "CO", operations: "OE", performance: "PE" };
export const WAF_CHECKLIST_SIZES = { RE: 10, SE: 12, CO: 14, OE: 11, PE: 12 };
const SOURCES = ["collector", "mcp", "questionnaire"];
const TYPES = ["string", "bool", "number", "enum"];
export const TOP_KEYS = new Set(["id", "pillar", "title", "waf", "wafReason", "chain", "noApi", "sources", "proves", "doesNotProve", "outputFields", "redact", "limits", "requires", "severityHint"]);
const GUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
/** Built-in role definition ids are public constants of Azure (not tenant data) and may appear in a query. */
const BUILTIN_GUIDS = new Set(["8e3af657-a8ff-443c-a75c-2fe8c4bcb635", "18d7d88d-d35e-4fb5-a5c3-7773c20a72d9"]);
const isStr = (v) => typeof v === "string" && v.trim() !== "";

/** @returns {string[]} problems of one check (empty when valid) */
export function validateCheck(check, { wafIds = new Set() } = {}) {
  const p = [];
  const c = check ?? {};
  const at = (m) => p.push(m);
  for (const k of Object.keys(c)) if (!TOP_KEYS.has(k)) at(`unknown key "${k}"`);
  if (!/^[A-Z]{2}-[A-Z]{1,5}-\d{3}$/.test(c.id ?? "")) at(`id "${c.id}" must look like SE-STG-001`);
  if (!PILLARS.includes(c.pillar)) at(`pillar "${c.pillar}" must be one of ${PILLARS.join(", ")}`);
  else if (c.id && !c.id.startsWith(`${PREFIX[c.pillar]}-`)) at(`id "${c.id}" does not start with ${PREFIX[c.pillar]}- (pillar ${c.pillar})`);
  if (!isStr(c.title)) at("title is required");
  if (!isStr(c.proves)) at("proves is required");
  if (!isStr(c.doesNotProve)) at("doesNotProve is required");

  // WAF mapping: IDs with a doc date and a reason, or [] with a reason
  if (!Array.isArray(c.waf)) at("waf must be a list (use [] with wafReason)");
  else if (!c.waf.length) { if (!isStr(c.wafReason)) at("waf is [] so wafReason must say why"); }
  else
    c.waf.forEach((w, i) => {
      if (!wafIds.has(w?.id)) at(`waf[${i}].id "${w?.id}" is not in the shipped list of WAF ids`);
      if (w?.framework !== "azure-waf") at(`waf[${i}].framework must be azure-waf`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(w?.docDate ?? "")) at(`waf[${i}].docDate must be YYYY-MM-DD`);
      if (!/^https:\/\/learn\.microsoft\.com\//.test(w?.url ?? "")) at(`waf[${i}].url must be a learn.microsoft.com https URL`);
      if (!["primary", "related"].includes(w?.relation)) at(`waf[${i}].relation must be primary or related`);
      if (!isStr(w?.why)) at(`waf[${i}].why must say why this check maps to the id`);
    });

  // chain and sources
  const chain = c.chain;
  if (!Array.isArray(chain) || chain.some((s) => !SOURCES.includes(s))) at(`chain must be a list of ${SOURCES.join(", ")}`);
  else {
    if (chain.includes("mcp") && !chain.includes("collector")) at("chain: mcp may only follow collector (the collector is the production path)");
    else if (chain.includes("mcp") && chain.indexOf("mcp") < chain.indexOf("collector")) at("chain: collector must come before mcp");
    if (!chain.length && !isStr(c.noApi)) at("an empty chain needs noApi: the reason nothing can read it");
    if (new Set(chain).size !== chain.length) at("chain repeats a source");
  }
  const src = c.sources ?? {};
  const col = src.collector;
  if (Array.isArray(chain)) {
    if (chain.includes("collector") !== Boolean(col)) at("sources.collector must exist exactly when chain lists collector");
    if (chain.includes("questionnaire")) {
      const q = src.questionnaire;
      if (!isStr(q?.id) || !/^Q-/.test(q.id)) at("sources.questionnaire.id must start with Q-");
      if (!isStr(q?.text?.en) || !isStr(q?.text?.["pt-BR"])) at("sources.questionnaire.text needs en and pt-BR");
    }
    if (chain.includes("mcp") && !(isStr(src.mcp?.namespace) && isStr(src.mcp?.command) && isStr(src.mcp?.equivalence))) at("sources.mcp needs namespace, command and equivalence");
  }
  if (col) {
    if (!["arg", "rest-get", "az-read"].includes(col.kind)) at(`sources.collector.kind "${col.kind}" is not arg, rest-get or az-read`);
    if (col.kind === "arg") {
      if (col.scope !== "tenant") at("an arg check has scope tenant");
      for (const role of ["evaluated", "violations"]) {
        for (const m of kqlProblems(col[role])) at(`${role}: ${m}`);
        for (const g of String(col[role] ?? "").match(GUID) ?? []) if (!/^00000000-0000-0000-0000-\d{12}$/.test(g) && !BUILTIN_GUIDS.has(g.toLowerCase())) at(`${role}: a GUID literal (${g}) is not allowed`);
        for (const t of neverTypeHits(col[role] ?? "")) at(`${role}: the type ${t} is never projected or read in v1`);
      }
      if (!/\|\s*summarize\s+n\s*=\s*count\(\)\s*$/i.test(col.evaluated ?? "")) at("evaluated must end with | summarize n=count()");
      if (Array.isArray(c.outputFields)) for (const m of projectionProblems(col.violations ?? "", c.outputFields)) at(`violations: ${m}`);
    } else if (col.kind === "rest-get") {
      const u = String(col.url ?? "");
      if (!/^https:\/\//.test(u)) at("rest-get url must be https");
      else {
        let host = "";
        try { host = new URL(u.replace(/\{subscriptionId\}/g, "00000000-0000-0000-0000-000000000000")).hostname; } catch { at("rest-get url is not a URL"); }
        if (host && host !== "management.azure.com") at(`rest-get host "${host}" is not management.azure.com (host allowlist)`);
        else if (!/[?&]api-version=[\w.-]+/.test(u)) at("rest-get url needs an api-version");
        else if (!isAllowedUrl(u.replace(/\{subscriptionId\}/g, "00000000-0000-0000-0000-000000000000"), "GET")) at("rest-get url is not on the host allowlist (https://management.azure.com, no credentials in the URL)");
      }
      if (col.scope !== "subscription") at("a rest-get check has scope subscription");
      if (col.violationWhen !== "empty-value") at("rest-get violationWhen must be empty-value");
    } else if (col.kind === "az-read") {
      if (!isAllowedAzVector(col.vector)) at("az-read vector is not on the closed list");
    }
    if (col.kind !== "az-read") {
      const f = c.outputFields;
      if (!Array.isArray(f) || !f.length) at("outputFields is required for a collector check");
      else {
        if (f[0].name !== "id") at("the first output field must be id (the ARM resource id)");
        const seen = new Set();
        f.forEach((x, i) => {
          if (!/^[A-Za-z_]\w*$/.test(x?.name ?? "")) at(`outputFields[${i}].name is not a plain name`);
          if (seen.has(x?.name)) at(`outputFields[${i}] repeats "${x.name}"`);
          seen.add(x?.name);
          if (!TYPES.includes(x?.type)) at(`outputFields[${i}].type "${x?.type}" must be one of ${TYPES.join(", ")}`);
          if (x?.type === "enum" && !(Array.isArray(x.values) && x.values.length && x.values.every(isStr))) at(`outputFields[${i}] is an enum without values`);
          if (x?.alias !== undefined && !["subscription", "resourceGroup", "resource"].includes(x.alias)) at(`outputFields[${i}].alias is not an alias class`);
        });
      }
      if (!Array.isArray(c.redact)) at("redact must be a list (may be empty)");
      const l = c.limits;
      for (const k of ["maxRows", "maxPages", "maxParts", "timeoutSec"]) if (!Number.isInteger(l?.[k]) || l[k] < 1) at(`limits.${k} must be a positive integer`);
      if (!l) at("limits is required for a collector check");
      if (!Array.isArray(c.requires) || !c.requires.length || !c.requires.every(isStr)) at("requires must list the role the read needs");
    }
  }
  return p;
}

/** Catalog-wide rules. @returns {string[]} */
export function validateCatalog(checks, { wafIds }) {
  const p = [];
  const ids = new Set();
  for (const c of checks) {
    if (ids.has(c.id)) p.push(`${c.id}: duplicate id`);
    ids.add(c.id);
    const qs = c.sources?.questionnaire?.id;
    if (qs && checks.filter((x) => x.sources?.questionnaire?.id === qs).length > 1) p.push(`${c.id}: questionnaire id ${qs} is used twice`);
  }
  for (const pillar of PILLARS) {
    const of = checks.filter((c) => c.pillar === pillar);
    if (!of.length) p.push(`${pillar}: no check`);
    if (!of.some((c) => !c.sources?.collector && c.chain?.includes("questionnaire"))) p.push(`${pillar}: no practice-only questionnaire item`);
  }
  void wafIds;
  return p;
}

const readJsonFile = (f) => JSON.parse(readFileSync(f, "utf8").replace(/^\uFEFF/, ""));

/** Loads and validates the catalog; throws with every problem, each naming its entry. */
export function loadCatalog(dir = CATALOG_DIR) {
  const index = readJsonFile(join(dir, "index.json"));
  const ids = readJsonFile(join(dir, "waf-ids.json"));
  const azRead = readJsonFile(join(dir, "az-read.json"));
  const wafIds = new Map();
  for (const [pillar, list] of Object.entries(ids.checklists)) for (const [id, title] of Object.entries(list.ids)) wafIds.set(id, { pillar, title });
  const checks = [];
  const problems = [];
  for (const pillar of PILLARS) {
    const f = join(dir, `${pillar}.json`);
    if (!existsSync(f)) { problems.push(`${pillar}.json is missing`); continue; }
    const file = readJsonFile(f);
    for (const c of file.checks ?? []) {
      for (const m of validateCheck(c, { wafIds: new Set(wafIds.keys()) })) problems.push(`${c?.id ?? "?"}: ${m}`);
      if (c.pillar !== pillar) problems.push(`${c?.id ?? "?"}: pillar ${c.pillar} is in ${pillar}.json`);
      checks.push(c);
    }
  }
  for (const m of validateCatalog(checks, { wafIds })) problems.push(m);
  if (problems.length) throw new Error(`catalog is invalid (${problems.length} problem(s)):\n${problems.map((m) => `  - ${m}`).join("\n")}`);
  const sha = sha256(stableStringify({ version: index.catalogVersion, checks, wafIds: ids, azRead }));
  return { version: index.catalogVersion, sha256: sha, checks, wafIds, azRead: azRead.vectors };
}

/** Sha-256 of a check's query text (used in the manifest and recomputed by seal-check). */
export const querySha = (check) => {
  const c = check.sources?.collector;
  if (c?.kind === "arg") return { evaluated: sha256(c.evaluated), violations: sha256(c.violations) };
  if (c?.kind === "rest-get") return { evaluated: sha256(c.url), violations: sha256(`${c.url}\0${c.violationWhen}`) };
  return null;
};
