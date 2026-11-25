// The collector against scripted transports: paging, truncation, errors, retries, all-or-nothing, states, budget
// (tasks 1.4; specs "Tenant-scale paging and limits", "All-or-nothing check and query budget", "Result states").
// No network, no real time: the wait is a spy and the clock is a function.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { loadCatalog } from "../scripts/lib/catalog.mjs";
import { collectCheck, runCollect } from "../scripts/lib/collect.mjs";
import { createFixtureTransport } from "../scripts/lib/transport.mjs";
import { FIX, jsonl, stateLabel, tmp } from "./helpers.mjs";

const CAT = loadCatalog();
const check = (id) => CAT.checks.find((c) => c.id === id);
const SUBS = ["00000000-0000-0000-0000-000000000001", "00000000-0000-0000-0000-000000000002"];
const scope = (extra = {}) => ({ kind: "subscriptions", subscriptions: SUBS, visible: 2, expected: 2, complete: true, ...extra });
const NOW = () => "2026-11-25T12:00:00.000Z";
const row = (n) => ({ id: `/subscriptions/${SUBS[0]}/resourceGroups/rg/providers/Microsoft.Storage/storageAccounts/st${n}`, name: `st${n}`, subscriptionId: SUBS[0], resourceGroup: "rg", location: "brazilsouth", publicAccess: "true" });

/** A transport that plays a script per role. An entry is a page, or a failure. */
function scripted({ evaluated = [{ rows: [{ n: 10 }] }], violations = [{ rows: [] }] } = {}) {
  const calls = [];
  const next = { evaluated: 0, violations: 0 };
  return {
    calls,
    async resourceGraph(req, ctx) {
      calls.push({ req: structuredClone(req), ctx: { ...ctx } });
      const script = ctx.role === "evaluated" ? evaluated : violations;
      const i = req.options?.$skipToken ? Number(String(req.options.$skipToken).replace(/\D/g, "")) : 0;
      const e = typeof script === "function" ? script(req, ctx, calls) : script[Math.min(i, script.length - 1)];
      if (e.status && e.status !== 200) return { status: e.status, errorClass: e.errorClass ?? "http", body: e.body };
      if (e.errorClass) return { status: null, errorClass: e.errorClass };
      return { status: 200, body: { data: e.rows, count: e.rows.length, totalRecords: e.rows.length, resultTruncated: e.resultTruncated ?? "false", ...(e.skipToken ? { $skipToken: e.skipToken } : {}) } };
    },
  };
}

function setup() {
  const dir = tmp("waf-collect-");
  const collectedDir = join(dir, "collected");
  mkdirSync(collectedDir, { recursive: true });
  const waits = [];
  return { dir, collectedDir, waits, sleep: async (ms) => { waits.push(ms); } };
}
const go = (id, transport, s, opts = {}) => collectCheck({ check: check(id), transport, scope: opts.scope ?? scope(), collectedDir: s.collectedDir, redact: { mode: "default", runId: "r1" }, sleep: s.sleep, now: NOW, budget: opts.budget ?? { remaining: 1000 }, ...opts.extra });
const filesOf = (s, id) => (existsSync(s.collectedDir) ? readdirSync(s.collectedDir).filter((f) => f.startsWith(`${id}.`)) : []);

test("paging: three pages with $skipToken are all written and the manifest counts three pages", async () => {
  const s = setup();
  const t = scripted({ violations: [{ rows: [row(1), row(2)], skipToken: "t-p1" }, { rows: [row(3), row(4)], skipToken: "t-p2" }, { rows: [row(5)] }] });
  const e = await go("SE-STG-001", t, s);
  assert.equal(stateLabel(e), "fail");
  assert.equal(e.pages.violations, 3);
  assert.equal(e.violations, 5);
  assert.deepEqual(filesOf(s, "SE-STG-001"), ["SE-STG-001.001.jsonl"]);
  assert.equal(jsonl(join(s.collectedDir, "SE-STG-001.001.jsonl")).length, 5);
  const vcalls = t.calls.filter((c) => c.ctx.role === "violations");
  assert.deepEqual(vcalls.map((c) => c.req.options.$skipToken ?? null), [null, "t-p1", "t-p2"]);
  assert.ok(vcalls.every((c) => c.req.options.$top <= 1000 && c.req.options.$top > 0));
  assert.deepEqual(vcalls[0].req.subscriptions, SUBS);
});

test("every line starts with the ARM id and holds only the declared fields", async () => {
  const s = setup();
  const r = { ...row(1), properties: { secretish: "x" }, tags: { a: "b" }, extra: 1 };
  await go("SE-STG-001", scripted({ violations: [{ rows: [r] }] }), s);
  const raw = readFileSync(join(s.collectedDir, "SE-STG-001.001.jsonl"), "utf8");
  assert.ok(raw.startsWith('{"id":"/subscriptions/'));
  assert.deepEqual(Object.keys(JSON.parse(raw)), check("SE-STG-001").outputFields.map((f) => f.name));
  assert.ok(!raw.includes("\r"));
});

test("truncation: resultTruncated without a skip token ends the check as truncated (also as a string)", async () => {
  for (const flag of [true, "true"]) {
    const s = setup();
    const e = await go("SE-STG-001", scripted({ violations: [{ rows: [row(1)], resultTruncated: flag }] }), s);
    assert.equal(stateLabel(e), "not-verified:truncated");
    assert.deepEqual(filesOf(s, "SE-STG-001"), [], "a sample must not stay on disk as evidence");
  }
  const s = setup();
  const e = await go("SE-STG-001", scripted({ violations: [{ rows: [row(1)], resultTruncated: true, skipToken: "t-p1" }, { rows: [row(2)] }] }), s);
  assert.equal(stateLabel(e), "fail", "truncated with a skip token is a normal page");
});

test("limits: too many rows or pages end the check as truncated", async () => {
  const s = setup();
  const c = structuredClone(check("SE-STG-001"));
  c.limits = { ...c.limits, maxRows: 3 };
  const t = scripted({ violations: [{ rows: [row(1), row(2)], skipToken: "t-p1" }, { rows: [row(3), row(4)] }] });
  const e = await collectCheck({ check: c, transport: t, scope: scope(), collectedDir: s.collectedDir, redact: { mode: "default", runId: "r1" }, sleep: s.sleep, now: NOW, budget: { remaining: 100 } });
  assert.equal(stateLabel(e), "not-verified:truncated");
  const s2 = setup();
  const c2 = structuredClone(check("SE-STG-001"));
  c2.limits = { ...c2.limits, maxPages: 1 };
  const e2 = await collectCheck({ check: c2, transport: scripted({ violations: [{ rows: [row(1)], skipToken: "t-p1" }, { rows: [row(2)] }] }), scope: scope(), collectedDir: s2.collectedDir, redact: { mode: "default", runId: "r1" }, sleep: s2.sleep, now: NOW, budget: { remaining: 100 } });
  assert.equal(stateLabel(e2), "not-verified:truncated");
});

test("403 is no-permission, and only the status is recorded", async () => {
  const s = setup();
  const e = await go("SE-STG-001", scripted({ violations: [{ status: 403, errorClass: "no-permission", body: { error: { message: "/subscriptions/x/resourceGroups/secret-rg" } } }] }), s);
  assert.equal(stateLabel(e), "not-verified:no-permission");
  assert.deepEqual(e.error, { class: "no-permission", status: 403 });
  assert.ok(!JSON.stringify(e).includes("secret-rg"));
  assert.deepEqual(filesOf(s, "SE-STG-001"), []);
});

test("timeout: one retry with the scope split per subscription, recorded in the manifest", async () => {
  const s = setup();
  const t = scripted({ violations: (req) => (req.subscriptions.length > 1 ? { errorClass: "timeout" } : { rows: req.subscriptions[0] === SUBS[0] ? [row(1)] : [] }) });
  const e = await go("SE-STG-001", t, s);
  assert.equal(stateLabel(e), "fail");
  assert.ok(e.retries.some((r) => r.reason === "timeout" && r.split === "per-subscription"), JSON.stringify(e.retries));
  const split = t.calls.filter((c) => c.ctx.role === "violations" && c.req.subscriptions.length === 1);
  assert.deepEqual(split.map((c) => c.req.subscriptions[0]), SUBS);
  const e2 = await go("SE-STG-002", scripted({ evaluated: () => ({ errorClass: "timeout" }) }), setup());
  assert.equal(stateLabel(e2), "not-verified:timeout");
});

test("throttling: waits with growing backoff and never reads a header", async () => {
  const s = setup();
  let n = 0;
  const t = scripted({ violations: () => (++n <= 2 ? { status: 429, errorClass: "throttled" } : { rows: [row(1)] }) });
  const e = await go("SE-STG-001", t, s);
  assert.equal(stateLabel(e), "fail");
  assert.equal(s.waits.length, 2);
  assert.ok(s.waits[1] > s.waits[0] && s.waits[0] > 0, s.waits.join(","));
  assert.ok(t.calls.every((c) => c.req.headers === undefined));
});

test("throttling that never ends is bounded by retries and a total wait cap", async () => {
  const s = setup();
  const t = scripted({ violations: () => ({ status: 429, errorClass: "throttled" }) });
  const e = await go("SE-STG-001", t, s);
  assert.equal(stateLabel(e), "not-verified:error");
  assert.equal(e.error.class, "throttled");
  assert.ok(s.waits.length >= 2 && s.waits.length <= 12, `${s.waits.length} retries`);
  assert.ok(s.waits.reduce((a, b) => a + b, 0) <= 180_000, "total wait cap");
  assert.deepEqual(filesOf(s, "SE-STG-001"), []);
});

test("all or nothing: a failure at page 3 of violations leaves no part and no pass or fail", async () => {
  const s = setup();
  const t = scripted({ violations: [{ rows: [row(1)], skipToken: "t-p1" }, { rows: [row(2)], skipToken: "t-p2" }, { status: 500, errorClass: "http" }] });
  const e = await go("SE-STG-001", t, s);
  assert.equal(stateLabel(e), "not-verified:error");
  assert.deepEqual(filesOf(s, "SE-STG-001"), []);
  assert.ok(!("parts" in e) || !e.parts.length);
  assert.ok(!["pass", "fail"].includes(e.state));
});

test("all or nothing: an error in evaluated voids a clean violations result, and the reverse", async () => {
  const a = await go("SE-STG-001", scripted({ evaluated: [{ status: 500, errorClass: "http" }], violations: [{ rows: [] }] }), setup());
  assert.equal(stateLabel(a), "not-verified:error");
  const s = setup();
  const b = await go("SE-STG-001", scripted({ evaluated: [{ rows: [{ n: 4 }] }], violations: [{ status: 500, errorClass: "http" }] }), s);
  assert.equal(stateLabel(b), "not-verified:error");
  assert.notEqual(b.state, "pass");
});

test("the error class and status are kept, the body never", async () => {
  const s = setup();
  const e = await go("SE-STG-001", scripted({ violations: [{ status: 500, errorClass: "http", body: { error: { message: "resource st-secret-name failed" } } }] }), s);
  assert.deepEqual(e.error, { class: "http", status: 500 });
  assert.ok(!JSON.stringify(e).includes("st-secret-name"));
});

test("states: fail, pass, not-applicable; never a pass with nothing evaluated", async () => {
  assert.equal(stateLabel(await go("SE-STG-001", scripted({ evaluated: [{ rows: [{ n: 5 }] }], violations: [{ rows: [row(1)] }] }), setup())), "fail");
  const s = setup();
  const p = await go("SE-STG-001", scripted({ evaluated: [{ rows: [{ n: 5 }] }], violations: [{ rows: [] }] }), s);
  assert.equal(stateLabel(p), "pass");
  assert.equal(p.evaluated, 5);
  assert.equal(statSync(join(s.collectedDir, "SE-STG-001.001.jsonl")).size, 0, "pass still writes an empty .001.jsonl");
  const na = await go("SE-STG-001", scripted({ evaluated: [{ rows: [{ n: 0 }] }], violations: [{ rows: [] }] }), setup());
  assert.equal(stateLabel(na), "not-applicable");
  const odd = await go("SE-STG-001", scripted({ evaluated: [{ rows: [{ n: 0 }] }], violations: [{ rows: [row(1)] }] }), setup());
  assert.equal(stateLabel(odd), "not-verified:error", "violations without anything evaluated is inconsistent, not a fail and not a pass");
  assert.notEqual(odd.state, "pass");
  const none = await go("SE-STG-001", scripted({ evaluated: [{ rows: [] }], violations: [{ rows: [] }] }), setup());
  assert.notEqual(none.state, "pass", "an empty evaluated answer is not a count");
});

test("incomplete scope: a clean result is not a pass, a violation is still a fail", async () => {
  const sc = scope({ visible: 2, expected: 3, complete: false });
  const p = await go("SE-STG-001", scripted({ evaluated: [{ rows: [{ n: 5 }] }], violations: [{ rows: [] }] }), setup(), { scope: sc });
  assert.equal(stateLabel(p), "not-verified:scope-incomplete");
  const na = await go("SE-STG-001", scripted({ evaluated: [{ rows: [{ n: 0 }] }], violations: [{ rows: [] }] }), setup(), { scope: sc });
  assert.equal(stateLabel(na), "not-verified:scope-incomplete");
  const f = await go("SE-STG-001", scripted({ evaluated: [{ rows: [{ n: 5 }] }], violations: [{ rows: [row(1)] }] }), setup(), { scope: sc });
  assert.equal(stateLabel(f), "fail");
  assert.equal(f.scopeComplete, false);
  assert.equal(f.visibleSubscriptions, 2);
});

test("both queries use the same scope and the manifest entry records hashes, time and counts", async () => {
  const s = setup();
  const t = scripted({ evaluated: [{ rows: [{ n: 3 }] }], violations: [{ rows: [row(1)] }] });
  const e = await go("SE-STG-001", t, s);
  const [a, b] = ["evaluated", "violations"].map((r) => t.calls.find((c) => c.ctx.role === r).req);
  assert.deepEqual(a.subscriptions, b.subscriptions);
  assert.equal(a.query, check("SE-STG-001").sources.collector.evaluated);
  assert.equal(b.query, check("SE-STG-001").sources.collector.violations);
  assert.match(e.querySha256.evaluated, /^[0-9a-f]{64}$/);
  assert.match(e.querySha256.violations, /^[0-9a-f]{64}$/);
  assert.notEqual(e.querySha256.evaluated, e.querySha256.violations);
  assert.equal(e.startedAt, NOW());
  assert.equal(e.finishedAt, NOW());
  assert.equal(e.parts.length, 1);
  assert.deepEqual(Object.keys(e.parts[0]).sort(), ["lines", "name", "sha256"]);
});

test("query budget: the run stops with the list of checks not done", async () => {
  const dir = tmp("waf-budget-");
  const t = createFixtureTransport(FIX);
  const r = await runCollect({ runDir: dir, catalog: CAT, transport: t, scope: scope({ expected: 2 }), pillars: ["security", "reliability"], redact: { mode: "default", runId: "r1" }, queryBudget: 5, sleep: async () => {}, now: NOW });
  assert.equal(r.budgetReached, true);
  assert.ok(r.notDone.length > 0);
  const done = Object.keys(r.manifest.checks);
  assert.ok(done.length + r.notDone.length >= 10);
  for (const id of r.notDone) assert.ok(!done.includes(id));
  assert.ok(r.queries <= 5 + 2, `queries ${r.queries}`);
});

test("resume: finished checks with valid parts are not queried again", async () => {
  const dir = tmp("waf-resume-");
  const counting = () => { const t = createFixtureTransport(FIX); const calls = []; return { calls, resourceGraph: (...a) => { calls.push(a[1]); return t.resourceGraph(...a); }, restGet: (...a) => { calls.push(a[1]); return t.restGet(...a); }, azRead: t.azRead }; };
  const base = { runDir: dir, catalog: CAT, scope: scope({ expected: 2 }), pillars: ["security"], redact: { mode: "default", runId: "r1" }, sleep: async () => {}, now: NOW };
  const t1 = counting();
  await runCollect({ ...base, transport: t1, only: ["SE-STG-001", "SE-STG-002", "SE-KV-001"] });
  assert.ok(t1.calls.length >= 6);
  const t2 = counting();
  const r2 = await runCollect({ ...base, transport: t2, only: ["SE-STG-001", "SE-STG-002", "SE-KV-001", "SE-NET-001"], resume: true });
  assert.deepEqual([...new Set(t2.calls.map((c) => c.checkId))], ["SE-NET-001"]);
  assert.equal(Object.keys(r2.manifest.checks).length, 4);
  // a tampered part is not trusted: that check runs again
  const part = join(dir, "collected", "SE-KV-001.001.jsonl");
  const bytes = readFileSync(part);
  const { writeFileSync } = await import("node:fs");
  writeFileSync(part, Buffer.concat([bytes, Buffer.from(" ")]));
  const t3 = counting();
  await runCollect({ ...base, transport: t3, only: ["SE-KV-001"], resume: true });
  assert.ok(t3.calls.some((c) => c.checkId === "SE-KV-001"));
});

test("a check with an unknown id is refused before anything runs", async () => {
  await assert.rejects(() => runCollect({ runDir: tmp(), catalog: CAT, transport: createFixtureTransport(FIX), scope: scope(), pillars: ["security"], only: ["NOPE-001"], redact: { mode: "default", runId: "r" }, sleep: async () => {}, now: NOW }), /NOPE-001/);
});

test("a check without a collector source is not queried: no-api or needs-questionnaire", async () => {
  const dir = tmp("waf-na-");
  const r = await runCollect({ runDir: dir, catalog: CAT, transport: createFixtureTransport(FIX), scope: scope({ expected: 2 }), pillars: ["cost", "security"], redact: { mode: "default", runId: "r1" }, sleep: async () => {}, now: NOW });
  assert.equal(stateLabel(r.manifest.checks["CO-RSV-001"]), "not-verified:no-api");
  assert.equal(r.manifest.checks["SE-Q-001"].state, "needs-questionnaire");
  assert.deepEqual(readdirSync(join(dir, "collected")).filter((f) => f.startsWith("SE-Q-001") || f.startsWith("CO-RSV-001")), []);
});
