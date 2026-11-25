// reverify: the USER re-runs one catalog query with their own login and compares the answer, by ARM id and projected fields, with the
// sealed lines. It writes reverify/<check>.json, which cap-check reads. `assess.mjs` and CI never call the network; this command is the
// only place where a re-check can happen, and it runs in a terminal (the guard of PR 4 also denies it to the agent).
// States: match, partial (a resource-scope run that did not cover every sealed offender), changed (a sealed line differs), gone (a sealed
// offender is no longer returned), error (class and status only, never a body).
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fetchViolations } from "./collect.mjs";
import { projectRow } from "./redact.mjs";
import { PART_FILE } from "./seal.mjs";
import { UsageError, sha256, stableStringify, writeJsonFile } from "./util.mjs";

const ARM_ID = /^\/[\x21-\x7e]{1,498}$/;
const lines = (runDir, name) => { const t = readFileSync(join(runDir, "collected", name), "utf8").replace(/\r\n?/g, "\n").split("\n"); if (t.at(-1) === "") t.pop(); return t; };

/** @returns {Promise<object>} the reverify record that was written */
export async function reverifyCheck({ runDir, catalog, transport, checkId, resources = [], sleep, now = () => new Date().toISOString(), aliaser = null }) {
  const check = catalog.checks.find((c) => c.id === checkId);
  if (!check) throw new UsageError(`unknown check ${JSON.stringify(String(checkId).slice(0, 40))}. Valid ids: ${catalog.checks.map((c) => c.id).join(", ")}`);
  const run = JSON.parse(readFileSync(join(runDir, "run.json"), "utf8"));
  const manifest = JSON.parse(readFileSync(join(runDir, "collected", "manifest.json"), "utf8"));
  const entry = manifest.checks?.[checkId];
  if (!entry || entry.state !== "fail") throw new Error(`${checkId} did not fail in this run (state ${entry?.state ?? "not run"}): there is nothing to reverify`);
  if (entry.catalogSha256 !== catalog.sha256) throw new Error("the catalog changed since collect; plan and collect a new run");
  if (run.redact === "strict" && !aliaser) throw new UsageError("this run used --redact strict: the alias file of the user's state directory is needed to compare aliased lines");
  // the sealed lines, after checking them against the manifest (a changed part is seal-check's finding, not a comparison)
  const sealed = [];
  for (const p of entry.parts) {
    if (typeof p?.name !== "string" || !PART_FILE.test(p.name) || !p.name.startsWith(`${checkId}.`)) throw new Error(`the manifest names ${JSON.stringify(p?.name)}, which is not a part of ${checkId}: run seal-check first`);
    let buf;
    try { buf = readFileSync(join(runDir, "collected", p.name)); } catch { throw new Error(`${p.name} is missing: run seal-check first`); }
    if (sha256(buf) !== p.sha256) throw new Error(`${p.name} differs from the manifest hash: run seal-check first; nothing was compared`);
    for (const l of lines(runDir, p.name)) sealed.push(JSON.parse(l));
  }
  const sealedById = new Map(sealed.map((r) => [String(r.id).toLowerCase(), r]));
  const asked = [];
  for (const raw of resources) {
    if (typeof raw !== "string" || !ARM_ID.test(raw)) throw new UsageError(`--resource must be a plain ARM resource id (no spaces or control characters), not ${JSON.stringify(String(raw).slice(0, 60))}`);
    if (!sealedById.has(raw.toLowerCase())) throw new UsageError(`--resource ${raw} is not an offender of the sealed ${checkId}; only a sealed offender can be reverified`);
    asked.push(raw);
  }
  const scope = asked.length ? "resource" : "check";
  const base = { schema: "waf-reverify/1", runId: manifest.runId, checkId, scope, catalogSha256: catalog.sha256, querySha256: entry.querySha256, parts: entry.parts.map((p) => ({ name: p.name, sha256: p.sha256 })), at: now() };
  const save = (rec) => { mkdirSync(join(runDir, "reverify"), { recursive: true, mode: 0o700 }); writeJsonFile(join(runDir, "reverify", `${checkId}.json`), rec); return rec; };

  const qscope = { kind: "subscriptions", subscriptions: run.scope.subscriptions, visible: run.scope.visible, expected: run.scope.expected, complete: run.scope.complete };
  const got = await fetchViolations({ check, transport, scope: qscope, sleep, budget: { remaining: 400, used: 0 } });
  if (got.error) return save({ ...base, state: "error", covered: [], error: { class: got.error.class ?? got.reason, status: got.error.status ?? null, reason: got.reason } });
  const fresh = new Map();
  for (const raw of got.rows) {
    const p = projectRow(raw, check.outputFields, { mode: run.redact, runId: run.runId, aliaser });
    fresh.set(String(p.row.id).toLowerCase(), p.row);
  }
  const compare = (id) => {
    const now1 = fresh.get(id);
    if (!now1) return "gone";
    return stableStringify(now1) === stableStringify(sealedById.get(id)) ? "match" : "changed";
  };
  const universe = scope === "check" ? [...sealedById.keys()] : asked.map((x) => x.toLowerCase());
  const results = universe.map((id) => ({ id: sealedById.get(id).id, state: compare(id) }));
  const changed = results.filter((r) => r.state === "changed").length;
  const gone = results.filter((r) => r.state === "gone").length;
  let state = "match";
  if (changed) state = "changed";
  else if (gone) state = "gone";
  else if (scope === "resource" && universe.length < sealedById.size) state = "partial";
  const newOffenders = [...fresh.keys()].filter((id) => !sealedById.has(id)).length;
  const rec = { ...base, state, covered: results.map((r) => r.id), ...(scope === "resource" ? { resources: results } : {}), counts: { changed, gone }, newOffenders };
  return save(rec);
}
export { existsSync };
