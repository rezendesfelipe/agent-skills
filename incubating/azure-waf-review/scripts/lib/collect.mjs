// The collector: runs the catalog's checks through a transport, pages to disk in parts of at most 1 MiB, and ends each check in
// exactly one state. A failure at any page of `evaluated` or `violations` voids the whole check (no partial pass or fail).
// No `az`, no network here: the transport does that. The wait and the clock are injected, so tests need no real time.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PILLARS, querySha } from "./catalog.mjs";
import { lex } from "./kql.mjs";
import { projectRow } from "./redact.mjs";
import { GUID_RE, UsageError, sha256, writeJsonFile } from "./util.mjs";

export const ENGINE_VERSION = "0.1.0";
export const MIB = 1024 * 1024;
/** A part closes before it would pass 1 MiB minus a margin of 8 KiB (the verifier of assessment-report refuses a file over 1 MiB). */
export const PART_MAX_BYTES = MIB - 8 * 1024;
export const PAGE_SIZE = 1000;
export const MAX_WAIT_TOTAL_MS = 180_000;
const BACKOFF_MS = [1000, 2000, 4000, 8000, 16000, 30000];
const PART_RE = /^([A-Z]{2}-[A-Z]{1,5}-\d{3})\.(\d{3})\.jsonl$/;

class Void extends Error {
  constructor(reason, error = null, extra = {}) {
    super(reason);
    this.reason = reason;
    this.error = error;
    this.extra = extra;
  }
}

const sortedHash = (list) => sha256([...list].sort().join("\n"));

function scopeInfo(scope) {
  return scope.kind === "managementGroup" ? { kind: "managementGroup", id: scope.managementGroup } : { kind: "subscriptions", subscriptionsSha256: sortedHash(scope.subscriptions), count: scope.subscriptions.length };
}
const scopeFields = (scope) => (scope.kind === "managementGroup" ? { managementGroups: [scope.managementGroup] } : { subscriptions: scope.subscriptions });

/** Removes every part of a check (a stale run, or the partial parts of a voided one). */
export function removeParts(collectedDir, id) {
  if (!existsSync(collectedDir)) return;
  for (const f of readdirSync(collectedDir)) if (f.startsWith(`${id}.`) && PART_RE.test(f)) rmSync(join(collectedDir, f), { force: true });
  rmSync(join(collectedDir, `.tmp-${id}`), { recursive: true, force: true });
}

/** One transport call with bounded retries. Backoff on 429 and on transient errors, never on a header. */
async function call(fn, st) {
  let attempt = 0;
  for (;;) {
    if (st.budget.remaining <= 0) throw new Void("error", { class: "budget", status: null }, { budget: true });
    st.budget.remaining--;
    st.budget.used = (st.budget.used ?? 0) + 1;
    let r;
    try {
      r = await fn();
    } catch (e) {
      throw new Void("error", { class: "refused", status: null });
    }
    if (r.status === 200) return r;
    const cls = r.errorClass ?? "error";
    if (cls === "timeout") return { timeout: true };
    if (r.status === 403 || cls === "no-permission") throw new Void("no-permission", { class: "no-permission", status: 403 });
    const retryable = r.status === 429 || cls === "throttled" || cls === "network" || (typeof r.status === "number" && r.status >= 500);
    if (!retryable) throw new Void("error", { class: cls, status: r.status ?? null });
    const wait = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)];
    if (st.waited + wait > MAX_WAIT_TOTAL_MS) throw new Void("error", { class: cls, status: r.status ?? null });
    st.waited += wait;
    attempt++;
    st.retries.push({ reason: r.status === 429 ? "throttled" : "transient", waitMs: wait });
    await st.sleep(wait);
  }
}

const isTruncated = (b) => b?.resultTruncated === true || String(b?.resultTruncated).toLowerCase() === "true";

/** All pages of one Resource Graph query on one scope. @returns {{rows: object[], pages: number}|{timeout: true}} */
async function argQuery(check, role, scopeParts, transport, st) {
  const lim = check.limits;
  const rows = [];
  let cursor = null;
  let pages = 0;
  for (;;) {
    const req = { query: check.sources.collector[role], ...scopeParts, options: { $top: PAGE_SIZE, ...(cursor ? { $skipToken: cursor } : {}), resultFormat: "objectArray" } };
    const r = await call(() => transport.resourceGraph(req, { checkId: check.id, role, page: pages + 1 }), st);
    if (r.timeout) return { timeout: true };
    const data = r.body?.data;
    if (!Array.isArray(data)) throw new Void("error", { class: "format", status: 200 });
    pages++;
    rows.push(...data);
    const next = r.body?.$skipToken || null;
    if (isTruncated(r.body) && !next) throw new Void("truncated");
    if (rows.length > lim.maxRows) throw new Void("truncated");
    if (!next) return { rows, pages };
    if (pages >= lim.maxPages) throw new Void("truncated");
    cursor = next;
  }
}

/** Runs one role, splitting the scope per subscription once if the first attempt times out. */
async function roleQuery(check, role, scope, transport, st) {
  const whole = await argQuery(check, role, scopeFields(scope), transport, st);
  if (!whole.timeout) return whole;
  if (scope.kind !== "subscriptions" || scope.subscriptions.length < 2) throw new Void("timeout", { class: "timeout", status: null });
  st.retries.push({ reason: "timeout", split: "per-subscription", role });
  const rows = [];
  let pages = 0;
  for (const sub of scope.subscriptions) {
    const part = await argQuery(check, role, { subscriptions: [sub] }, transport, st);
    if (part.timeout) throw new Void("timeout", { class: "timeout", status: null });
    rows.push(...part.rows);
    pages += part.pages;
  }
  return { rows, pages, split: true };
}

/** Writes rows as parts of at most PART_MAX_BYTES under a temp folder; moved into place by the caller on success. */
function writeParts(check, rows, collectedDir, redact, aliaser) {
  const tmpDir = join(collectedDir, `.tmp-${check.id}`);
  rmSync(tmpDir, { recursive: true, force: true });
  mkdirSync(tmpDir, { recursive: true, mode: 0o700 });
  const parts = [];
  let cur = null;
  let redactions = 0;
  let pseudonymized = 0;
  const dropped = {};
  const open = () => {
    if (parts.length >= check.limits.maxParts) throw new Void("truncated");
    cur = { name: `${check.id}.${String(parts.length + 1).padStart(3, "0")}.jsonl`, chunks: [], bytes: 0, lines: 0 };
    parts.push(cur);
  };
  open();
  for (const raw of rows) {
    const p = projectRow(raw, check.outputFields, { mode: redact.mode, runId: redact.runId, aliaser });
    redactions += p.redactions;
    pseudonymized += p.pseudonymized;
    for (const d of p.dropped) dropped[d] = (dropped[d] ?? 0) + 1;
    const line = Buffer.from(`${JSON.stringify(p.row)}\n`, "utf8");
    if (cur.bytes + line.length > PART_MAX_BYTES && cur.lines > 0) open();
    cur.chunks.push(line);
    cur.bytes += line.length;
    cur.lines++;
  }
  const sealed = parts.map((p) => {
    const buf = Buffer.concat(p.chunks);
    writeFileSync(join(tmpDir, p.name), buf, { mode: 0o600 });
    return { name: p.name, lines: p.lines, sha256: createHash("sha256").update(buf).digest("hex") };
  });
  return { tmpDir, parts: sealed, redactions, pseudonymized, dropped };
}

const num = (rows) => {
  const n = rows?.[0]?.n;
  return typeof n === "number" && Number.isFinite(n) && n >= 0 ? n : null;
};

async function runRest(check, scope, transport, st) {
  const url = check.sources.collector.url;
  const rows = [];
  let n = 0;
  let pages = 0;
  for (const sub of scope.subscriptions) {
    if (!GUID_RE.test(sub)) throw new Void("error", { class: "invalid-subscription", status: null });
    const target = url.replace("{subscriptionId}", sub);
    const r = await call(() => transport.restGet(target, { checkId: check.id, role: "violations", subscription: sub }), st);
    if (r.timeout) throw new Void("timeout", { class: "timeout", status: null });
    pages++;
    if (!Array.isArray(r.body?.value)) throw new Void("error", { class: "format", status: 200 });
    n++;
    if (!r.body.value.length) rows.push({ id: `/subscriptions/${sub}`, subscriptionId: sub });
    if (r.body.nextLink) throw new Void("truncated"); // paging of a REST list is not followed in v1
  }
  return { evaluated: n, rows, pages: { evaluated: pages, violations: pages } };
}

/** Only the violations of one check, for reverify: the same paging, limits and retries as collect. @returns {Promise<{rows: object[]}|{error: object, reason: string}>} */
export async function fetchViolations({ check, transport, scope, sleep, budget }) {
  const st = { budget, sleep, retries: [], waited: 0 };
  try {
    if (check.sources.collector.kind === "rest-get") return { rows: (await runRest(check, scope, transport, st)).rows };
    return { rows: (await roleQuery(check, "violations", scope, transport, st)).rows };
  } catch (e) {
    if (!(e instanceof Void)) throw e;
    return { error: e.error ?? { class: e.reason, status: null }, reason: e.reason };
  }
}

/** True when the violations query joins another table: the size of the right side is not documented (risk R, manual test M-3). */
export const usesJoin = (check) => check.sources.collector?.kind === "arg" && /\bjoin\b/i.test(lex(check.sources.collector.violations).blank);

/**
 * Runs one collector check and returns its manifest entry. Parts are written under `collectedDir`; a voided check leaves none.
 * @returns {Promise<object>}
 */
export async function collectCheck({ check, transport, scope, collectedDir, redact, sleep, now, budget, aliaser = null }) {
  const st = { budget, sleep, retries: [], waited: 0 };
  const entry = {
    checkId: check.id, pillar: check.pillar, source: "collector", startedAt: now(), querySha256: querySha(check),
    scope: scopeInfo(scope), visibleSubscriptions: scope.visible, expectedSubscriptions: scope.expected, scopeComplete: scope.complete,
    pages: { evaluated: 0, violations: 0 }, retries: st.retries, redactions: 0,
    ...(usesJoin(check) ? { joinRisk: true } : {}),
  };
  const voided = (reason, error) => {
    removeParts(collectedDir, check.id);
    return { ...entry, state: "not-verified", reason, ...(error ? { error } : {}), finishedAt: now() };
  };
  try {
    mkdirSync(collectedDir, { recursive: true, mode: 0o700 });
    let evaluated;
    let rows;
    if (check.sources.collector.kind === "rest-get") {
      const r = await runRest(check, scope, transport, st);
      evaluated = r.evaluated; rows = r.rows; entry.pages = r.pages;
    } else {
      const ev = await roleQuery(check, "evaluated", scope, transport, st);
      entry.pages.evaluated = ev.pages;
      // the evaluated query counts; after a per-subscription split the counts are summed
      evaluated = ev.split ? (ev.rows.every((r) => num([r]) !== null) && ev.rows.length ? ev.rows.reduce((a, r) => a + num([r]), 0) : null) : num(ev.rows);
      if (evaluated === null) throw new Void("error", { class: "format", status: 200 });
      const vi = await roleQuery(check, "violations", scope, transport, st);
      entry.pages.violations = vi.pages;
      rows = vi.rows;
    }
    entry.evaluated = evaluated;
    entry.violations = rows.length;
    if (rows.length && evaluated === 0) throw new Void("error", { class: "inconsistent", status: null });

    const incomplete = !scope.complete;
    const clean = rows.length === 0;
    if (clean && incomplete) return voided("scope-incomplete", null);
    removeParts(collectedDir, check.id);
    const w = writeParts(check, rows, collectedDir, redact, aliaser);
    for (const p of w.parts) renameSync(join(w.tmpDir, p.name), join(collectedDir, p.name));
    rmSync(w.tmpDir, { recursive: true, force: true });
    entry.parts = w.parts;
    entry.redactions = w.redactions;
    if (w.pseudonymized) entry.tagsPseudonymized = w.pseudonymized;
    if (Object.keys(w.dropped).length) entry.dropped = w.dropped;
    entry.state = rows.length ? "fail" : evaluated > 0 ? "pass" : "not-applicable";
    entry.truncated = false;
    entry.finishedAt = now();
    return entry;
  } catch (e) {
    if (!(e instanceof Void)) throw e;
    removeParts(collectedDir, check.id);
    const out = voided(e.reason, e.error);
    out.truncated = e.reason === "truncated";
    if (e.extra.budget) out.budgetStop = true;
    return out;
  }
}

/** A resume trusts a finished check (its parts exist and match their hashes) or a fixed answer (no API, needs a questionnaire). It runs the rest again. */
export function partsValid(collectedDir, entry) {
  const finished = ["fail", "pass", "not-applicable"].includes(entry.state);
  if (!finished) return entry.state === "needs-questionnaire" || (entry.state === "not-verified" && entry.reason === "no-api");
  for (const p of entry.parts) {
    const f = join(collectedDir, p.name);
    if (!existsSync(f)) return false;
    if (sha256(readFileSync(f)) !== p.sha256) return false;
  }
  return true;
}

/**
 * Runs the checks of the chosen pillars. `only` limits it to ids; `resume` skips checks whose entry is still valid.
 * Writes collected/manifest.json after every check, so an interrupted run resumes.
 */
export async function runCollect({ runDir, catalog, transport, scope, pillars = PILLARS, only = null, resume = false, redact, runSha256 = null, consentSha256 = null, queryBudget = 6000, sleep, now = () => new Date().toISOString(), aliaser = null, azVersion = "unknown", fixtures = false }) {
  const collectedDir = join(runDir, "collected");
  for (const sub of scope.subscriptions ?? []) if (!GUID_RE.test(sub)) throw new UsageError(`subscription id ${JSON.stringify(String(sub).slice(0, 60))} is not a GUID`);
  mkdirSync(collectedDir, { recursive: true, mode: 0o700 });
  if (only) {
    const unknown = only.filter((id) => !catalog.checks.some((c) => c.id === id));
    if (unknown.length) throw new UsageError(`unknown check id(s): ${unknown.join(", ")}. Valid ids: ${catalog.checks.map((c) => c.id).join(", ")}`);
  }
  const manifestPath = join(collectedDir, "manifest.json");
  let manifest = null;
  if (existsSync(manifestPath)) {
    try { manifest = JSON.parse(readFileSync(manifestPath, "utf8")); } catch { manifest = null; }
  }
  if (!manifest || manifest.catalog?.sha256 !== catalog.sha256) manifest = null;
  if (manifest) {
    // an existing manifest is reused only for the same run: the same run id, redaction mode and sealed run.json
    if (manifest.runId !== redact.runId) throw new Error(`the manifest belongs to run id ${JSON.stringify(manifest.runId)}, not ${JSON.stringify(redact.runId)}; refusing to reuse it`);
    if (manifest.redact !== redact.mode) throw new Error(`the manifest was written with redact=${manifest.redact} and this run says redact=${redact.mode}; refusing to reuse it`);
    if (runSha256 && manifest.run?.sha256 !== runSha256) throw new Error("run.json changed since the manifest was written (the run hash differs); refusing to reuse the sealed checks. Plan a new run.");
  }
  manifest ??= { schema: "waf-manifest/1", runId: redact.runId, run: { sha256: runSha256 }, consent: consentSha256 ? { sha256: consentSha256 } : null, engineVersion: ENGINE_VERSION, azVersion, redact: redact.mode, fixtures, catalog: { version: catalog.version, sha256: catalog.sha256 }, checks: {} };
  manifest.generatedAt = now();
  const budget = { remaining: queryBudget, used: 0 };
  const todo = catalog.checks.filter((c) => pillars.includes(c.pillar) && (!only || only.includes(c.id)));
  const notDone = [];
  let budgetReached = false;
  const save = () => writeJsonFile(manifestPath, manifest);

  for (const check of todo) {
    const prior = manifest.checks[check.id];
    if (resume && prior && prior.catalogSha256 === catalog.sha256 && partsValid(collectedDir, prior)) continue;
    if (budgetReached) { notDone.push(check.id); continue; }
    const col = check.sources.collector;
    const base = { checkId: check.id, pillar: check.pillar, catalogSha256: catalog.sha256 };
    if (!col || col.kind === "az-read") {
      removeParts(collectedDir, check.id);
      manifest.checks[check.id] = col
        ? { ...base, source: "none", state: "not-verified", reason: "no-api", note: "az-read checks are not run as catalog checks in v1" }
        : check.chain.includes("questionnaire")
          ? { ...base, source: "questionnaire", state: "needs-questionnaire" }
          : { ...base, source: "none", state: "not-verified", reason: "no-api", note: check.noApi };
      save();
      continue;
    }
    const need = col.kind === "rest-get" ? Math.max(scope.subscriptions.length, 1) : 2;
    if (budget.remaining < need) { budgetReached = true; notDone.push(check.id); continue; }
    const e = await collectCheck({ check, transport, scope, collectedDir, redact, sleep, now, budget, aliaser });
    if (e.budgetStop) { budgetReached = true; notDone.push(check.id); save(); continue; }
    manifest.checks[check.id] = { ...base, ...e };
    save();
  }
  manifest.queries = (manifest.queries ?? 0) + budget.used;
  save();
  return { manifest, notDone, budgetReached, queries: budget.used, collectedDir };
}
