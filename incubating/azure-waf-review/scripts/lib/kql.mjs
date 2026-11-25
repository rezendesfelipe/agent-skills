// The in-house KQL allowlist and the projection rules (OpenSpec change add-azure-waf-review-agent: "Query allowlist",
// "Redaction before write"). This is an ALLOWLIST, not a KQL parser: the text is first reduced to a closed set of ASCII characters
// (string literals are blanked by a literal-aware scanner; comments, `;`, `@`, backticks and non-ASCII outside a literal are
// refused), split into pipe segments by a literal-aware splitter, and every segment must start with an allowed operator.
// A query this file cannot classify is refused. What may be WRITTEN into the evidence is decided by the reviewed list of scalar
// paths (catalog/scalar-paths.json) and by the `source` each output field declares; a `where` may read any column.
// Forbidden everywhere: take, limit, sample, top (they stop $skipToken), externaldata, evaluate, union, invoke, comments,
// batches, management commands, object-building functions (pack, bag_pack, todynamic, parse_json, make_*).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const SCALAR = JSON.parse(readFileSync(fileURLToPath(new URL("../../catalog/scalar-paths.json", import.meta.url)), "utf8"));
export const STD_COLUMNS = SCALAR.standardColumns;
export const TABLES = new Set([
  "resources", "resourcecontainers", "advisorresources", "securityresources", "policyresources", "authorizationresources",
  "healthresources", "servicehealthresources", "networkresources", "recoveryservicesresources",
]);
const OPERATORS = new Set(["where", "project", "extend", "summarize", "join", "mv-expand", "order", "count"]);
/** The join kinds Azure Resource Graph documents (leftanti, leftsemi and the right-hand kinds are NOT supported there). */
const JOIN_KINDS = new Set(["innerunique", "inner", "leftouter", "fullouter"]);
const FORBIDDEN_WORDS = ["take", "limit", "sample", "sample-distinct", "top", "top-nested", "top-hitters", "externaldata", "evaluate", "union", "invoke", "getschema", "let", "cluster", "database", "http_request", "http_request_post", "render", "print", "search", "find", "parse", "materialize", "fork", "partition", "pack", "pack_all", "pack_array", "bag_pack", "bag_merge", "bag_remove_keys", "todynamic", "toobject", "parse_json", "parse_xml", "dynamic", "make_bag", "make_list", "make_set", "make_series", "mv-apply", "as", "scan", "sort", "distinct", "project-away", "project-keep", "project-rename", "project-reorder"];
const ALLOWED_CHAR = /^[A-Za-z0-9_ \t\r\n.,()[\]=!<>~$|*+-]$/;
const MAX_QUERY = 4000;

/** Resource types whose values are secrets or can hold them: a catalog check may not read them at all in v1. */
export const NEVER_PROJECT_TYPES = [
  "microsoft.containerinstance/containergroups", "microsoft.app/containerapps", "microsoft.logic/workflows", "microsoft.compute/virtualmachines/extensions",
  "microsoft.resources/deployments", "microsoft.web/sites", "microsoft.web/sites/config", "microsoft.apimanagement/service/namedvalues",
  "microsoft.keyvault/vaults/secrets", "microsoft.appconfiguration/configurationstores/keyvalues", "microsoft.automation/automationaccounts/variables",
];

/**
 * Literal-aware scan. `blank` has the same length as the query with the CONTENT of every string literal replaced by `_`
 * (the quotes stay); `mask[i]` is true inside a literal. Comments, an unterminated literal and any character outside the closed
 * set (outside literals) are problems, and then scanning stops, so a quote inside a comment can never hide real code.
 */
export function lex(query) {
  const problems = [];
  const n = query.length;
  let blank = "";
  const mask = [];
  for (let i = 0; i < n; i++) {
    const c = query[i];
    if (c === "'" || c === '"') {
      let j = i + 1;
      while (j < n && query[j] !== c) j += query[j] === "\\" ? 2 : 1;
      if (j >= n) return { blank, mask, problems: ["a string literal is not closed"] };
      blank += c + "_".repeat(j - i - 1) + c;
      for (let k = i; k <= j; k++) mask.push(k > i && k < j);
      i = j;
      continue;
    }
    if (c === "/" && (query[i + 1] === "/" || query[i + 1] === "*")) return { blank, mask, problems: ["comments are not allowed (a quote inside a comment could hide code)"] };
    if (!ALLOWED_CHAR.test(c)) return { blank, mask, problems: [`the character ${JSON.stringify(c)} is not allowed outside a string literal (ASCII only, no comments, no batch separator, no @, backtick or backslash)`] };
    blank += c;
    mask.push(false);
  }
  return { blank, mask, problems };
}

/** Pieces at `sep` (default `|`) at parenthesis depth 0, as [start, end) ranges, or null when parentheses do not balance. */
function segmentRanges(blank, sep = "|") {
  const out = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < blank.length; i++) {
    const c = blank[i];
    if (c === "(" || c === "[") depth++;
    if (c === ")" || c === "]") depth--;
    if (depth < 0) return null;
    if (c === sep && depth === 0) { out.push([start, i]); start = i + 1; }
  }
  if (depth !== 0) return null;
  out.push([start, blank.length]);
  return out;
}

/** The text without whitespace outside literals (the form two expressions are compared in). */
const norm = (text, mask, from = 0) => {
  let s = "";
  for (let i = 0; i < text.length; i++) if (!(/\s/.test(text[i]) && !mask[from + i])) s += text[i];
  return s;
};

/** Where the operator of a segment is, and the range of its body. */
function opInfo(blank, [a, b]) {
  const rel = blank.slice(a, b);
  const lead = rel.search(/\S/);
  if (lead < 0) return { op: "", opEnd: a, b };
  const op = (rel.slice(lead).match(/^[a-z][a-z-]*/i)?.[0] ?? "").toLowerCase();
  return { op, start: a + lead, opEnd: a + lead + op.length, b };
}
/** The comma-separated items of a body, as absolute ranges. */
const itemRanges = (blank, from, to) => (segmentRanges(blank.slice(from, to), ",") ?? []).map(([x, y]) => [from + x, from + y]);

const IDENT = /^[A-Za-z_]\w*$/;
const WRAPPERS = /^(tolower|tostring|tolong|tobool|toint|toreal|todouble)\((.*)\)$/;
const isPath = (e) => Object.prototype.hasOwnProperty.call(SCALAR.paths, e);
const isTagRef = (e) => /^tags\['[A-Za-z0-9_.-]{1,64}'\]$/.test(e);
/** An expression an `extend` may compute: a conversion of a standard column, a listed path, a tag value, a constant or a listed derived expression. */
function safeExpr(e) {
  if (/^\d{1,9}$/.test(e) || /^'[A-Za-z0-9 _-]{0,40}'$/.test(e)) return true;
  if (Object.prototype.hasOwnProperty.call(SCALAR.derived, e)) return true;
  const m = e.match(WRAPPERS);
  if (m) return safeExpr(m[2]);
  return STD_COLUMNS.includes(e) || e === "managedBy" || isPath(e) || isTagRef(e);
}

/** What the project must contain for an output field, as normalized text; null when the field has no valid source. */
export function expectedExpr(field) {
  const src = field.source;
  if (src === undefined) return STD_COLUMNS.includes(field.name) ? field.name : null;
  if (isPath(src)) return `${{ string: "tostring", enum: "tostring", bool: "tobool", number: "tolong" }[field.type]}(${src})`;
  if (isTagRef(src)) return `tostring(${src})`;
  if (Object.prototype.hasOwnProperty.call(SCALAR.derived, src)) return src;
  const c = src.match(/^const:([A-Za-z0-9 _-]{1,40})$/);
  if (c) return `'${c[1]}'`;
  return null;
}

/** Problems with the declared source of one output field. */
export function sourceProblems(field) {
  const src = field.source;
  if (src === undefined) return STD_COLUMNS.includes(field.name) && !field.tagKey ? [] : [`output field "${field.name}" needs a source (a path of catalog/scalar-paths.json, a tag value, a listed derived expression or const:<text>)`];
  if (isPath(src)) {
    const t = SCALAR.paths[src];
    if ((field.type === "bool" || field.type === "number") && t !== field.type) return [`output field "${field.name}" is ${field.type} but ${src} is ${t}`];
    return field.tagKey ? [`output field "${field.name}": a tagKey needs a tags['key'] source`] : [];
  }
  if (isTagRef(src)) return field.tagKey && src === `tags['${field.tagKey}']` ? (field.type === "string" ? [] : [`tag field "${field.name}" must be a string`]) : [`output field "${field.name}": source ${src} needs tagKey "${src.slice(6, -2)}", so the engine can hash the value`];
  if (Object.prototype.hasOwnProperty.call(SCALAR.derived, src)) return SCALAR.derived[src] === field.type ? [] : [`output field "${field.name}" is ${field.type} but ${src} is ${SCALAR.derived[src]}`];
  if (/^const:[A-Za-z0-9 _-]{1,40}$/.test(src)) return field.type === "string" || field.type === "enum" ? [] : [`output field "${field.name}": a const is a string`];
  return [`output field "${field.name}": source "${src}" is not on the reviewed allowlist of scalar paths (catalog/scalar-paths.json)`];
}

/** @returns {string[]} problems; empty when the query passes the allowlist */
export function kqlProblems(query, depth = 0) {
  if (typeof query !== "string" || !query.trim()) return ["the query is empty"];
  if (depth > 2) return ["join subqueries nest too deep"];
  if (query.length > MAX_QUERY) return [`the query is longer than ${MAX_QUERY} characters`];
  const { blank, mask, problems: lexProblems } = lex(query);
  if (lexProblems.length) return lexProblems;
  const problems = [];
  for (const w of FORBIDDEN_WORDS) if (new RegExp(`(?<![\\w$.-])${w.replace("-", "\\-")}(?![\\w-])`, "i").test(blank)) problems.push(`the word "${w}" is not allowed (read operators only; take, limit and sample also stop $skipToken)`);
  const ranges = segmentRanges(blank);
  if (!ranges) return [...problems, "parentheses do not balance"];
  const first = blank.slice(...ranges[0]).trim().split(/\s+/);
  const table = first[0].toLowerCase();
  if (!TABLES.has(table)) problems.push(`the query must start with a documented table, not "${table}"`);
  else if (first.length > 1) problems.push("the first segment must be the table name only");
  for (const r of ranges.slice(1)) {
    const { op, opEnd, b } = opInfo(blank, r);
    if (!OPERATORS.has(op)) { problems.push(`operator "${op || blank.slice(...r).trim().slice(0, 12)}" is not on the allowlist`); continue; }
    const body = query.slice(opEnd, b);
    if (op === "order" && !/^\s+by\s/i.test(body)) problems.push("order must be followed by by");
    if (op === "extend") {
      for (const [x, y] of itemRanges(blank, opEnd, b)) {
        const m = query.slice(x, y).match(/^\s*([A-Za-z_]\w*)\s*=\s*/);
        if (!m) { problems.push(`extend item "${query.slice(x, y).trim()}" must be name = expression`); continue; }
        if (!safeExpr(norm(query.slice(x + m[0].length, y), mask.slice(x + m[0].length, y)))) problems.push(`extend "${m[1]}" computes an expression that is not on the allowlist (a conversion of a standard column, a path of catalog/scalar-paths.json, a tag value, a constant or a listed derived expression)`);
      }
    }
    if (op === "mv-expand" && !/^\s*(?:[A-Za-z_]\w*\s*=\s*)?[A-Za-z_][\w.]*\s*$/.test(body)) problems.push("mv-expand takes [alias =] a plain property path");
    if (op === "join") {
      const bb = blank.slice(opEnd, b);
      const open = bb.indexOf("(");
      let d = 0;
      let close = -1;
      for (let i = open; i >= 0 && i < bb.length; i++) {
        if (bb[i] === "(") d++;
        if (bb[i] === ")" && --d === 0) { close = i; break; }
      }
      if (open < 0 || close < 0) { problems.push("join needs a parenthesized subquery"); continue; }
      const head = bb.slice(0, open).trim();
      const km = head.match(/^kind\s*=\s*([A-Za-z]+)$/i);
      if (head && !km) problems.push("join takes only kind=<kind> before the subquery");
      if (km && !JOIN_KINDS.has(km[1].toLowerCase())) problems.push(`join kind=${km[1]} is not supported by Azure Resource Graph (innerunique, inner, leftouter and fullouter are)`);
      if (!/^\s*on\s+(?:[A-Za-z_]\w*|\$left\.[A-Za-z_]\w*\s*==\s*\$right\.[A-Za-z_]\w*)\s*$/.test(bb.slice(close + 1))) problems.push("join must end with on <column> or on $left.<a> == $right.<b>");
      const sub = query.slice(opEnd + open + 1, opEnd + close);
      problems.push(...kqlProblems(sub, depth + 1).map((p) => `in the join subquery: ${p}`));
      // a join subquery may project plain column names only
      const sl = lex(sub);
      const sr = sl.problems.length ? null : segmentRanges(sl.blank);
      for (const sx of (sr ?? []).slice(1)) {
        const o = opInfo(sl.blank, sx);
        if (o.op === "project" && !itemRanges(sl.blank, o.opEnd, o.b).every(([x, y]) => IDENT.test(sub.slice(x, y).trim()))) problems.push("a join subquery may project plain column names only");
      }
    }
  }
  return [...new Set(problems)];
}

/**
 * The rules for the VIOLATIONS query: it ends with a project (and maybe an order); no summarize; every extend that computes a
 * declared field equals that field's expected expression; every projected column is a declared field written exactly as its
 * source says. Returns problems; empty when the query writes only what the fields declare.
 */
export function projectionProblems(query, outputFields) {
  const { blank, mask, problems: lexProblems } = lex(query);
  if (lexProblems.length) return lexProblems;
  const ranges = segmentRanges(blank);
  if (!ranges) return ["parentheses do not balance"];
  const problems = [];
  const infos = ranges.map((r) => opInfo(blank, r));
  let last = -1;
  infos.forEach((o, i) => { if (o.op === "project") last = i; });
  if (last < 1) return ["the violations query must end with a project of the declared output fields"];
  if (infos.slice(last + 1).some((o) => o.op !== "order")) problems.push("only order by may follow the final project");
  if (infos.slice(1).some((o) => o.op === "summarize")) problems.push("the violations query must not summarize (a summarize can build objects); aggregate only in the evaluated query");
  const byName = new Map(outputFields.map((f) => [f.name, f]));
  for (const f of outputFields) problems.push(...sourceProblems(f));
  // extend items that define a declared field must equal its expected expression
  const defined = new Set();
  for (const o of infos.slice(1, last)) {
    if (o.op !== "extend") continue;
    for (const [x, y] of itemRanges(blank, o.opEnd, o.b)) {
      const m = query.slice(x, y).match(/^\s*([A-Za-z_]\w*)\s*=\s*/);
      if (!m) continue;
      defined.add(m[1]);
      const f = byName.get(m[1]);
      if (!f) continue; // a helper: kqlProblems checked it
      const want = expectedExpr(f);
      const got = norm(query.slice(x + m[0].length, y), mask.slice(x + m[0].length, y));
      if (want === null || got !== norm(want, new Array(want.length).fill(false))) problems.push(`extend "${m[1]}" is ${got}, not what the declared source of field "${m[1]}" says (${want ?? "no valid source"})`);
    }
  }
  const projected = [];
  const o = infos[last];
  for (const [x, y] of itemRanges(blank, o.opEnd, o.b)) {
    const it = query.slice(x, y).trim();
    if (!it) { problems.push("an empty projection item"); continue; }
    const m = query.slice(x, y).match(/^\s*([A-Za-z_]\w*)\s*=\s*/);
    if (m) {
      projected.push(m[1]);
      const f = byName.get(m[1]);
      if (!f) { problems.push(`"${m[1]}" is projected but is not a declared output field`); continue; }
      const want = expectedExpr(f);
      const got = norm(query.slice(x + m[0].length, y), mask.slice(x + m[0].length, y));
      if (want === null || got !== norm(want, new Array(want.length).fill(false))) problems.push(`"${m[1]}" is projected as ${got} but its declared source says ${want ?? "nothing valid"}`);
    } else if (IDENT.test(it)) {
      projected.push(it);
      const f = byName.get(it);
      if (!f) { problems.push(`"${it}" is projected but is not a declared output field`); continue; }
      const std = STD_COLUMNS.includes(it) && f.source === undefined;
      if (!std && !defined.has(it)) problems.push(`"${it}" is projected bare but no extend computes it from its declared source`);
    } else problems.push(`projection item "${it}" must be a column name or name = <declared source expression>`);
  }
  for (const f of outputFields) if (!projected.includes(f.name)) problems.push(`output field "${f.name}" is declared but not projected`);
  return [...new Set(problems)];
}

/** The text of every string literal. */
export const literalsOf = (q) => [...q.matchAll(/'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1] ?? m[2]);
/** Never-project types named in the query's literals. */
export const neverTypeHits = (query) => literalsOf(query).map((l) => l.toLowerCase()).filter((l) => NEVER_PROJECT_TYPES.some((t) => l === t || l.startsWith(`${t}/`)));
