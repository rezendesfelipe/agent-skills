// The in-house KQL allowlist and the scalar-projection rules (OpenSpec change add-azure-waf-review-agent: "Query allowlist",
// "Redaction before write"). Not a KQL parser: it is deliberately strict, so a query it cannot classify is refused.
// A query must start with a documented table, use only read operators, and carry none of: take, limit, sample, top,
// externaldata, evaluate, union, a batch separator or a management command (take, limit and sample would stop Resource
// Graph from returning $skipToken).

export const TABLES = new Set([
  "resources", "resourcecontainers", "advisorresources", "securityresources", "policyresources", "authorizationresources",
  "healthresources", "servicehealthresources", "networkresources", "recoveryservicesresources",
]);
const OPERATORS = new Set(["where", "project", "extend", "summarize", "join", "mv-expand", "order", "count"]);
const FORBIDDEN_WORDS = ["take", "limit", "sample", "sample-distinct", "top", "top-nested", "top-hitters", "externaldata", "evaluate", "union", "invoke", "getschema", "let", "cluster", "database", "http_request", "http_request_post", "render", "print", "search", "find", "parse", "materialize", "fork", "partition"];

/** Resource types whose values are secrets or can hold them: a catalog check may not read them at all in v1. */
export const NEVER_PROJECT_TYPES = [
  "microsoft.containerinstance/containergroups", "microsoft.app/containerapps", "microsoft.logic/workflows", "microsoft.compute/virtualmachines/extensions",
  "microsoft.resources/deployments", "microsoft.web/sites", "microsoft.web/sites/config", "microsoft.apimanagement/service/namedvalues",
  "microsoft.keyvault/vaults/secrets", "microsoft.appconfiguration/configurationstores/keyvalues", "microsoft.automation/automationaccounts/variables",
];
/** Property names that are never projected, at any depth. */
export const NEVER_PROJECT_NAMES = new Set(["appsettings", "connectionstrings", "env", "definition", "settings", "protectedsettings", "parameters", "outputs", "primarykey", "secondarykey", "administratorloginpassword", "namedvalues", "value", "values", "secrets", "keys", "password", "passwords", "sastoken", "certificate", "certificates", "connectionstring"]);
/** Names whose value is an object or an array: `tostring()` of them would write a JSON blob. */
const OBJECT_NAMES = new Set(["properties", "tags", "sku", "identity", "plan", "extended", "zones", "networkacls", "siteconfig", "securityrules", "ipconfigurations", "subnets", "encryption", "privateendpointconnections", "virtualnetworkrules", "iprules", "defaultsecurityrules", "virtualnetworkpeerings", "storageprofile", "osprofile", "networkprofile", "hardwareprofile", "diagnosticsprofile", "agentpoolprofiles", "addonprofiles", "networkprofile", "firewallrules", "accesspolicies", "tolist", "metadata", "resourcemetadata", "recommendationtypeid"]);
const OBJECT_NAMES_FINAL = new Set([...OBJECT_NAMES].filter((n) => n !== "recommendationtypeid"));

/** Replaces string literals with '' so words inside them are not read as operators. */
function stripLiterals(q) {
  let out = "";
  for (let i = 0; i < q.length; i++) {
    const c = q[i];
    if (c === "'" || c === '"') {
      const quote = c;
      let j = i + 1;
      while (j < q.length && q[j] !== quote) j += q[j] === "\\" ? 2 : 1;
      if (j >= q.length) return null; // unterminated
      out += "''";
      i = j;
    } else out += c;
  }
  return out;
}
export const literalsOf = (q) => [...q.matchAll(/'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1] ?? m[2]);

/** Splits at `|` at parenthesis depth 0. Returns null when parentheses do not balance. */
function pipeSegments(q) {
  const segs = [];
  let depth = 0;
  let cur = "";
  for (const c of q) {
    if (c === "(" || c === "[") depth++;
    if (c === ")" || c === "]") depth--;
    if (depth < 0) return null;
    if (c === "|" && depth === 0) { segs.push(cur.trim()); cur = ""; } else cur += c;
  }
  if (depth !== 0) return null;
  segs.push(cur.trim());
  return segs;
}
export const splitTop = (s, sep = ",") => {
  const out = [];
  let depth = 0;
  let cur = "";
  for (const c of s) {
    if (c === "(" || c === "[") depth++;
    if (c === ")" || c === "]") depth--;
    if (c === sep && depth === 0) { out.push(cur.trim()); cur = ""; } else cur += c;
  }
  out.push(cur.trim());
  return out;
};

/** @returns {string[]} problems; empty when the query passes the allowlist */
export function kqlProblems(query, depth = 0) {
  const problems = [];
  if (typeof query !== "string" || !query.trim()) return ["the query is empty"];
  if (depth > 2) return ["join subqueries nest too deep"];
  const q = stripLiterals(query);
  if (q === null) return ["a string literal is not closed"];
  if (q.includes(";")) problems.push("a batch separator (;) is not allowed");
  if (/(^|\s)\.[a-z]/i.test(q)) problems.push("a management command (starts with a dot) is not allowed");
  for (const w of FORBIDDEN_WORDS) if (new RegExp(`(?<![\\w$.-])${w.replace("-", "\\-")}(?![\\w-])`, "i").test(q)) problems.push(`the word "${w}" is not allowed (read operators only; take, limit and sample also stop $skipToken)`);
  const segs = pipeSegments(q);
  if (!segs) return [...problems, "parentheses do not balance"];
  const table = segs[0].split(/\s+/)[0].toLowerCase();
  if (!TABLES.has(table)) problems.push(`the query must start with a documented table, not "${table}"`);
  else if (segs[0].trim().split(/\s+/).length > 1) problems.push("the first segment must be the table name only");
  for (const seg of segs.slice(1)) {
    const op = (seg.match(/^[a-z][a-z-]*/i)?.[0] ?? "").toLowerCase();
    if (!OPERATORS.has(op)) problems.push(`operator "${op || seg.slice(0, 12)}" is not on the allowlist`);
    if (op === "order" && !/^order\s+by\b/i.test(seg)) problems.push("order must be followed by by");
    if (op === "join") {
      const open = seg.indexOf("(");
      let d = 0;
      let close = -1;
      for (let i = open; i >= 0 && i < seg.length; i++) {
        if (seg[i] === "(") d++;
        if (seg[i] === ")" && --d === 0) { close = i; break; }
      }
      if (open < 0 || close < 0) problems.push("join needs a parenthesized subquery");
      else problems.push(...kqlProblems(seg.slice(open + 1, close), depth + 1).map((p) => `in the join subquery: ${p}`));
    }
  }
  return [...new Set(problems)];
}

const CONV = /^(tostring|tolong|toint|todouble|toreal|tobool|tolower)\((.+)\)$/is;
/** Does the path point at a scalar the catalog may project? @returns {string|null} a problem */
function pathProblem(expr, field) {
  let e = expr.trim();
  while (CONV.test(e)) e = e.match(CONV)[2].trim();
  if (/[(),]/.test(e)) return `projection "${expr}" is not a plain property path`;
  const bracket = e.match(/^tags\[\s*(?:'([^']+)'|"([^"]+)")\s*\]$/i);
  if (bracket) {
    const k = (bracket[1] ?? bracket[2]).toLowerCase();
    return field?.tagKey && field.tagKey.toLowerCase() === k ? null : `a tag value ("${k}") needs a field with tagKey "${k}", so the engine can hash it`;
  }
  const segs = e.split(".").map((s) => s.replace(/\[.*\]$/, "").toLowerCase());
  for (const s of segs) if (NEVER_PROJECT_NAMES.has(s)) return `"${expr}" reads "${s}", which is never projected (never project secrets, settings or values)`;
  const last = segs[segs.length - 1];
  if (segs.length === 1 && OBJECT_NAMES_FINAL.has(last)) return `"${expr}" is an object or array; only typed scalars may be projected`;
  if (OBJECT_NAMES_FINAL.has(last) && last !== "plan") return `"${expr}" ends in "${last}", an object or array; only typed scalars may be projected`;
  if (segs[0] === "tags") return `"${expr}" reads tags; use tags['key'] with a tagKey field`;
  return null;
}

/** Checks the final `project` of a violations query against the declared output fields. @returns {string[]} */
export function projectionProblems(query, outputFields) {
  const q = stripLiterals(query) ?? "";
  const segs = pipeSegments(query) ?? [];
  const segsStripped = pipeSegments(q) ?? [];
  let idx = -1;
  segsStripped.forEach((s, i) => { if (/^project\b/i.test(s)) idx = i; });
  if (idx < 0) return ["the violations query must end with a project of the declared output fields"];
  const problems = [];
  const body = segs[idx].replace(/^project\s+/i, "");
  const names = [];
  for (const item of splitTop(body)) {
    if (!item) { problems.push("an empty projection item"); continue; }
    if (item === "*") { problems.push("project * is not allowed"); continue; }
    const m = item.match(/^([A-Za-z_]\w*)\s*=\s*([\s\S]+)$/);
    if (m) {
      names.push(m[1]);
      const f = outputFields.find((x) => x.name === m[1]);
      if (/\b(todynamic|pack|pack_all|bag_\w+|make_\w+|parse_json|parse_xml|dynamic)\s*\(/i.test(m[2])) problems.push(`projection "${item}" builds an object`);
      else { const p = pathProblem(m[2], f); if (p) problems.push(p); }
    } else if (/^[A-Za-z_]\w*$/.test(item)) {
      names.push(item);
      const lower = item.toLowerCase();
      if (OBJECT_NAMES_FINAL.has(lower)) problems.push(`"${item}" is an object or array; only typed scalars may be projected`);
      if (NEVER_PROJECT_NAMES.has(lower)) problems.push(`"${item}" is never projected`);
    } else problems.push(`projection item "${item}" needs a name (alias = expression)`);
  }
  const declared = outputFields.map((f) => f.name);
  for (const n of names) if (!declared.includes(n)) problems.push(`"${n}" is projected but is not a declared output field`);
  for (const n of declared) if (!names.includes(n)) problems.push(`output field "${n}" is declared but not projected`);
  return problems;
}

/** Never-project types named in the query's literals. */
export const neverTypeHits = (query) => literalsOf(query).map((l) => l.toLowerCase()).filter((l) => NEVER_PROJECT_TYPES.some((t) => l === t || l.startsWith(`${t}/`)));
