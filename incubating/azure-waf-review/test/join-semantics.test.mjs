// N-1: the three join checks must return their violations under the documented Kusto semantics. A STRING column that comes from
// the right side of a leftouter join is EMPTY, not null, when nothing matches, and isnull() of a string is always false
// (https://learn.microsoft.com/azure/data-explorer/kusto/query/isnull-function), so `where isnull(<string>)` would drop every row
// and the check would pass silently. A toy executor of the exact shape of these queries (not a KQL engine) proves it on the
// synthetic tenant, and the validator must refuse the isnull form. The toy executor proves ONLY the documented semantics of
// isnull, isempty and leftouter: it does NOT cover any row limit of the right side of a join (none is documented, and no guarantee
// that the right side is not truncated was found; a cut would give mass false positives, see tasks.md and manual test M-3). The queries are NOT run against Azure Resource Graph.
import assert from "node:assert/strict";
import { test } from "node:test";
import { loadCatalog } from "../scripts/lib/catalog.mjs";
import { kqlProblems } from "../scripts/lib/kql.mjs";
import { joinTables } from "./fixtures/contoso-exemplo/build.mjs";
import { FIX, readJson } from "./helpers.mjs";
import { join } from "node:path";

const KEY = readJson(join(FIX, "key.json"));
const JOIN_CHECKS = ["SE-GOV-001", "RE-BKP-001", "PE-ASP-001"];
const T = joinTables();
const get = (row, path) => path.split(".").reduce((o, k) => (o == null ? o : o[k]), row);

/** Kusto semantics for the shapes used here: tolower, tostring, plain paths, string constants. */
function value(expr, row) {
  const e = expr.trim();
  let m = e.match(/^(tolower|tostring)\((.*)\)$/);
  if (m) { const v = value(m[2], row); return v == null ? "" : m[1] === "tolower" ? String(v).toLowerCase() : String(v); }
  m = e.match(/^'([^']*)'$/);
  if (m) return m[1];
  return get(row, e);
}
const splitDepth0 = (text, sep) => { const out = []; let d = 0; let cur = ""; for (const c of text) { if (c === "(") d++; if (c === ")") d--; if (c === sep && d === 0) { out.push(cur.trim()); cur = ""; } else cur += c; } out.push(cur.trim()); return out; };
const typeFilter = (rows, seg) => { const m = seg.match(/type\s*=~\s*'([^']+)'/); return m ? rows.filter((r) => r.type === m[1].toLowerCase()) : rows; };
const tierFilter = (rows, seg) => {
  const m = seg.match(/sku\.tier\)\s*!in~\s*\(([^)]*)\)/);
  if (!m) return rows;
  const out = m[1].split(",").map((x) => x.trim().replace(/'/g, "").toLowerCase());
  return rows.filter((r) => !out.includes(String(r.sku?.tier).toLowerCase()));
};

/** Runs `T | where type | [where tier] | extend k | join kind=leftouter (S | where type | extend k, hit | project ...) on k | where isempty|isnull(c)`. */
function run(query) {
  const top = splitDepth0(query, "|");
  let rows = T[top[0]].map((r) => ({ ...r }));
  let joined = false;
  let onKey = null;
  let right = null;
  for (const seg of top.slice(1)) {
    if (/^where\b/.test(seg) && !joined) { rows = typeFilter(rows, seg); rows = tierFilter(rows, seg); continue; }
    const ext = seg.match(/^extend\s+(\w+)\s*=\s*(.+)$/);
    if (ext && !joined) { for (const r of rows) r[ext[1]] = value(ext[2], r); continue; }
    if (/^join\b/.test(seg)) {
      const sub = seg.match(/\((.*)\)\s*on\s+(\w+)\s*$/s);
      assert.ok(sub, `join shape: ${seg}`);
      onKey = sub[2];
      const parts = splitDepth0(sub[1], "|");
      let rrows = T[parts[0]].map((r) => ({ ...r }));
      for (const p of parts.slice(1)) {
        if (/^where\b/.test(p)) { rrows = typeFilter(rrows, p); continue; }
        const ex = p.match(/^extend\s+(.+)$/);
        if (ex) for (const item of splitDepth0(ex[1], ",")) { const [k, ...v] = item.split("="); for (const r of rrows) r[k.trim()] = value(v.join("=").trim(), r); }
      }
      const hit = parts.find((p) => /^extend/.test(p)).match(/(\w+)\s*=\s*'[^']*'/)?.[1];
      assert.ok(hit, "the right side carries a string marker column");
      right = { rows: rrows, hit };
      joined = true;
      rows = rows.flatMap((l) => { const ms = right.rows.filter((r) => r[onKey] === l[onKey]); return ms.length ? ms.map((r) => ({ ...l, [hit]: r[hit] })) : [{ ...l, [hit]: "" }]; }); // leftouter: a STRING column is empty when unmatched
      continue;
    }
    const w = seg.match(/^where\s+(isempty|isnull)\((\w+)\)$/);
    if (w && joined) { rows = rows.filter((r) => (w[1] === "isempty" ? r[w[2]] == null || r[w[2]] === "" : r[w[2]] == null)); continue; } // isnull(string) is false for ""
  }
  return rows.map((r) => r.id).sort();
}

test("the three join checks return their planted flaws under the documented semantics (and only those)", () => {
  const cat = loadCatalog();
  for (const id of JOIN_CHECKS) {
    const q = cat.checks.find((c) => c.id === id).sources.collector.violations;
    const projected = q.replace(/\|\s*project\s+[^|]+$/, "");
    assert.match(q, /join kind=leftouter/);
    assert.match(q, /where isempty\(\w+\)/, `${id} must test the string marker with isempty`);
    assert.ok(!/isnull\(/.test(q), `${id} must not use isnull on a string`);
    const want = KEY.flaws.find((f) => f.check === id).armIds.map((x) => x.toLowerCase().replace(/\u001b/g, "")).sort();
    assert.deepEqual(run(projected).map((x) => x.toLowerCase()), want, id);
  }
});

test("the same queries with isnull return NOTHING: a silent pass, which is why the validator refuses the form", () => {
  const cat = loadCatalog();
  for (const id of JOIN_CHECKS) {
    const q = cat.checks.find((c) => c.id === id).sources.collector.violations.replace(/\|\s*project\s+[^|]+$/, "").replace(/isempty\(/, "isnull(");
    assert.deepEqual(run(q), [], id);
    assert.ok(kqlProblems(q).some((m) => /isnull/.test(m) && /isempty/.test(m)), `the validator accepted: ${q}`);
  }
});

test("isnull over a string is refused: standard columns, extend aliases of tostring or tolower, join-side columns, direct conversions", () => {
  const bad = [
    "resources | where isnull(subscriptionId) | project id",
    "resources | where isnull(name) | project id",
    "resources | extend k = tolower(id) | where isnull(k) | project id",
    "resources | extend k = tostring(properties.x) | where isnull(k) | project id",
    "resources | where isnull(tostring(properties.x)) | project id",
    "resources | where isnull(tolower(id)) | project id",
    "resources | extend k = tolower(id) | join kind=leftouter (resources | extend k = tolower(id), hit = 'y' | project k, hit) on k | where isnull(hit) | project id",
    "resources | where ISNULL(subscriptionId) | project id",
    "resources | where isnull( subscriptionId ) | project id",
  ];
  for (const q of bad) assert.ok(kqlProblems(q).some((m) => /isnull/.test(m)), q);
  // dynamic values keep isnull: a missing property or a missing array is null
  for (const q of ["resources | where isnull(zones) | project id", "resources | where isnull(properties.availabilitySet) | project id", "resources | extend z = coalesce(array_length(zones), 0) | where z == 0 | project id", "resources | where isempty(name) | project id"])
    assert.deepEqual(kqlProblems(q), [], q);
});

test("a join joins on a column of the SAME name on both sides: `on $left.a == $right.b` is not confirmed for Resource Graph and is refused", () => {
  assert.ok(kqlProblems("resources | extend k = tolower(id) | join kind=leftouter (resources | extend k = tolower(id), hit = 'y' | project k, hit) on $left.k == $right.k | where isempty(hit) | project id").some((m) => /on /.test(m)));
  assert.deepEqual(kqlProblems("resources | extend k = tolower(id) | join kind=leftouter (resources | extend k = tolower(id), hit = 'y' | project k, hit) on k | where isempty(hit) | project id"), []);
  for (const id of JOIN_CHECKS) {
    const q = loadCatalog().checks.find((c) => c.id === id).sources.collector.violations;
    assert.ok(!/\$left|\$right/.test(q), id);
    assert.match(q, /\) on \w+ \|/, `${id}: on <column>`);
  }
});
