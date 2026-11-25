// Helpers of the PR 1b tests (production controls). No Azure, no network, no credential: the transport is a recording stub, the
// `az` binary is a small Node script that answers from a data file next to it, and every GUID is synthetic.
// The toy transports below prove only the semantics the engine documents (which vectors it asks for, what it does with the answer);
// they are not Azure and they do not prove the shape of a real answer (manual tests M-0 and M-3).
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isAllowedAzVector } from "../scripts/lib/azread.mjs";
import { cpSync } from "node:fs";
import { FIX, fixtureCopy, planAndCollect, readJson, run, runAssess, tmp, writeJson } from "./helpers.mjs";

export const TENANT = "99999999-9999-9999-9999-999999999999";
export const SUB1 = "11111111-1111-1111-1111-111111111111";
export const SUB2 = "22222222-2222-2222-2222-222222222222";
export const SUB3 = "33333333-3333-3333-3333-333333333333";
export const PRINCIPAL = "44444444-4444-4444-4444-444444444444";
// role definition ids read on 2026-11-25 from https://learn.microsoft.com/azure/role-based-access-control/built-in-roles
export const ROLE = {
  reader: "acdd72a7-3385-48ef-bd42-f606fba81ae7",
  securityReader: "39bc4728-0917-49c7-9d2c-d95423bc2eb4",
  owner: "8e3af657-a8ff-443c-a75c-2fe8c4bcb635",
  contributor: "b24988ac-6180-42a0-ab88-20f7382dd24c",
  uaa: "18d7d88d-d35e-4fb5-a5c3-7773c20a72d9",
  custom: "55555555-5555-5555-5555-555555555555",
};
export const roleRow = (guid, scope = `/subscriptions/${SUB1}`) => ({ id: `${scope}/providers/Microsoft.Authorization/roleAssignments/${guid.slice(0, 8)}`, roleDefinitionId: `/providers/Microsoft.Authorization/roleDefinitions/${guid}`, scope });

export const sub = (id, name, state = "Enabled", tenantId = TENANT) => ({ id, name, state, tenantId, isDefault: false });

/** An in-memory transport that records every call. Answers like the Azure CLI would (documented shapes; not verified, M-0). */
export function consentTransport({
  accounts = [sub(SUB1, "sub-prod"), sub(SUB2, "sub-nonprod")], user = { name: "audit@example.invalid", type: "user" }, tenantId = TENANT,
  principalId = PRINCIPAL, roles = [roleRow(ROLE.reader), roleRow(ROLE.securityReader)], containers = null, failPrincipal = false, failRoles = false, noLogin = false, version = "azure-cli 2.99.0 (synthetic)",
} = {}) {
  const calls = [];
  return {
    kind: "test", calls,
    async azRead(vector) {
      calls.push({ type: "az", vector });
      if (!isAllowedAzVector(vector)) throw new Error(`az vector is not on the closed list: ${JSON.stringify(vector)}`);
      if (noLogin && vector[1] !== "--version") return { status: 401, errorClass: "not-logged-in" };
      if (vector[1] === "--version") return { status: 200, text: `${version}\n` };
      if (vector[1] === "account" && vector[2] === "show") return { status: 200, body: { id: accounts[0]?.id, tenantId, name: accounts[0]?.name, user } };
      if (vector[1] === "account" && vector[2] === "list") return { status: 200, body: accounts };
      if (vector[1] === "ad") return failPrincipal ? { status: 403, errorClass: "no-permission" } : { status: 200, text: `${principalId}\n` };
      return { status: 404, errorClass: "http" };
    },
    async resourceGraph(req, ctx = {}) {
      calls.push({ type: "arg", checkId: ctx.checkId, req });
      if (ctx.checkId === "CONSENT-SUBS") {
        const list = containers ?? accounts.filter((a) => a.state === "Enabled").map((a) => ({ id: a.id, displayName: a.name }));
        return { status: 200, body: { data: list.map((c) => ({ id: `/subscriptions/${c.id}`, subscriptionId: c.id, displayName: c.displayName ?? c.name })), resultTruncated: "false" } };
      }
      if (ctx.checkId === "CONSENT-ROLES") return failRoles ? { status: 403, errorClass: "no-permission" } : { status: 200, body: { data: roles, resultTruncated: "false" } };
      return { status: 404, errorClass: "http" };
    },
    async restGet() { return { status: 404, errorClass: "http" }; },
  };
}

/** Scripted terminal: answers in order, records what was shown. */
export function scriptedIo(answers = []) {
  const shown = [];
  const asked = [];
  const queue = [...answers];
  return { shown, asked, get shownScreen() { return shown.find((x) => x.startsWith("WAF REVIEW CONSENT")); }, text: () => shown.join("\n"), print: (s = "") => shown.push(String(s)), ask: async (q) => { asked.push(q); shown.push(q); if (!queue.length) throw new Error(`unexpected prompt: ${q}`); return queue.shift(); } };
}

export const PHRASES = { yes: "yes", retention: "RETENTION CHECKED", acceptance: "ACCEPTANCE RECORDED", previous: "PREVIOUS STAGE REVIEWED", skip: "SKIP PREVIOUS STAGES", unverifiable: "I ACCEPT AN UNVERIFIED IDENTITY", unclassified: "I ACCEPT UNCLASSIFIED ROLES", folder: "I ACCEPT THIS OUTPUT FOLDER" };

/** The consent arguments of a nonprod run over the two subscriptions of consentTransport, with the typed count 2. */
export const baseArgs = (over = {}) => ({ runId: "r1", stage: "nonprod", expectedSubs: "2", subscriptions: `${SUB1},${SUB2}`, redact: "default", ...over });

/** An isolated profile folder (exists, is not ~/.azure). */
export function isolatedEnv(extra = {}) {
  const dir = tmp("waf-azprofile-");
  return { AZURE_CONFIG_DIR: dir, HOME: tmp("waf-home-"), PATH: "/usr/bin", ...extra };
}

/** A fresh working folder and the inputs runConsent needs (a POSIX, non-WSL, native Linux az). */
export function consentCtx(over = {}) {
  const cwd = tmp("waf-cwd-");
  const env = isolatedEnv();
  return { cwd, env, platform: "linux", wsl: false, azPath: "/usr/bin/az", now: () => "2026-11-25T12:00:00.000Z", ...over };
}

/** Writes a stub `az` (a CommonJS Node script, no package.json around it) and returns { dir, bin, log() }. It answers from data.json beside it. */
export function stubAz(data, graphSource = "module.exports = () => ({ data: [], resultTruncated: \"false\" });") {
  const dir = tmp("waf-stubaz-");
  const bin = join(dir, "az");
  writeJson(join(dir, "data.json"), data);
  writeFileSync(join(dir, "graph.cjs"), graphSource);
  const src = `#!${process.execPath}
const fs = require("node:fs");
const path = require("node:path");
const data = JSON.parse(fs.readFileSync(path.join(__dirname, "data.json"), "utf8"));
const argv = process.argv.slice(2);
fs.appendFileSync(path.join(__dirname, "log.jsonl"), JSON.stringify(argv) + "\\n");
const out = (v) => process.stdout.write(typeof v === "string" ? v : JSON.stringify(v));
if (argv[0] === "--version") out("azure-cli 2.99.0 (synthetic)\\n");
else if (argv[0] === "account" && argv[1] === "show") out(data.show);
else if (argv[0] === "account" && argv[1] === "list") out(data.list);
else if (argv[0] === "ad") out(data.principal + "\\n");
else if (argv[0] === "rest" && argv[argv.indexOf("--method") + 1] === "get") { const m = argv[argv.indexOf("--url") + 1].match(/subscriptions\\/([^/]+)\\//); const r = (data.rest || {})[m && m[1]]; if (r) out(r); else { process.stderr.write("404 not found"); process.exit(1); } }
else if (argv[0] === "rest") { const body = JSON.parse(fs.readFileSync(argv[argv.indexOf("--body") + 1].slice(1), "utf8")); fs.appendFileSync(path.join(__dirname, "bodies.jsonl"), JSON.stringify(body) + "\\n"); out(require(path.join(__dirname, "graph.cjs"))(body, data)); }
else { process.stderr.write("unexpected vector"); process.exit(1); }
`;
  writeFileSync(bin, src, { mode: 0o755 });
  chmodSync(bin, 0o755);
  return { dir, bin, log: () => (existsSync(join(dir, "log.jsonl")) ? readFileSync(join(dir, "log.jsonl"), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []) };
}

export const readRun = (cwd, id = "r1") => ({ runDir: join(cwd, "waf-review", id), run: readJson(join(cwd, "waf-review", id, "run.json")) });


/** The fixture tenant with a complete scope (both readable subscriptions are also under the management group, typed count 2). */
export function completeFixture() {
  const d = fixtureCopy();
  const sc = readJson(join(d, "scope.json"));
  sc.containers = sc.visible;
  sc.expected = 2;
  writeJson(join(d, "scope.json"), sc);
  return d;
}

const SEV = { critical: { impact: "severe", likelihood: "likely" }, low: { impact: "low", likelihood: "likely" } };

/**
 * A full assess.mjs flow over the sealed evidence of the complete fixture run, up to the node where `render` is allowed:
 * init, inventory, verify, classify, roadmap, check, summary. The findings of `critical` (check ids) are severe and likely
 * (so the real classify says Critical, the exact string); every other finding is Low. Uses the REAL assess.mjs.
 * @returns {{cwd:string, runDir:string, map:object, fx:string, a:object}}
 */
export function assessedRun({ critical = [], id = "r1", fixtures = completeFixture(), only = null, handFindings = null, dropMapFindings = false, cwd = tmp("waf-cwd-") } = {}) {
  const pc = planAndCollect({ fixtures, id, cwd });
  if (pc.plan.code !== 0 || pc.collect.code !== 0) throw new Error(`plan/collect failed: ${pc.plan.out}${pc.collect?.out}`);
  const runDir = pc.runDir;
  if (run(["map", "--run", id], { cwd }).code !== 0) throw new Error("map failed");
  const collected = join(runDir, "collected");
  const init = runAssess(["init", "--out", runDir, "--root", collected, "--model", "test-model", "--client", "Cliente Exemplo", "--title", "Revisao", "--author", "Autor Exemplo", "--version", "1.0", "--date", "2026-11-25", "--lang", "pt-BR"]);
  if (init.code !== 0) throw new Error(init.out);
  if (runAssess(["inventory", "--out", runDir]).code !== 0) throw new Error("inventory failed");
  const map = readJson(join(runDir, "map.json"));
  const a = readJson(join(runDir, "assessment.json"));
  a.frameworks = [{ id: "azure-waf", name: "Azure Well-Architected Framework", version: "2026-11", date: "2026-11-25", url: "https://learn.microsoft.com/azure/well-architected/" }];
  const checkOfFinding = Object.fromEntries(Object.entries(map.checks).filter(([, c]) => c.finding).map(([k, c]) => [c.finding, k]));
  const keep = (f) => !only || only.includes(checkOfFinding[f.id]);
  const used = new Set();
  const stubs = handFindings ? [] : map.findings.filter(keep);
  a.findings = [...stubs.map((f) => ({ ...f, ...(critical.includes(checkOfFinding[f.id]) ? SEV.critical : SEV.low), effort: "M", rationale: { impact: "synthetic", likelihood: "synthetic" } }))];
  for (const f of a.findings) for (const e of f.evidence) used.add(e);
  a.evidence = map.evidence.filter((e) => used.has(e.id));
  if (handFindings) { a.findings = handFindings.findings; a.evidence = handFindings.evidence; }
  if (dropMapFindings) { const m = readJson(join(runDir, "map.json")); m.findings = []; m.checks = {}; writeJson(join(runDir, "map.json"), m); }
  writeJson(join(runDir, "assessment.json"), a);
  const v = runAssess(["verify", "--out", runDir]);
  if (v.code !== 0) throw new Error(`verify: ${v.out}`);
  const c = runAssess(["classify", "--out", runDir]);
  if (c.code !== 0) throw new Error(`classify: ${c.out}`);
  const b = readJson(join(runDir, "assessment.json"));
  b.actions = [...(b.actions ?? []), ...b.findings.filter((f) => f.severity === "Critical" || f.severity === "High" || f.severity === "Medium").map((f, i) => ({ id: `A-${String(100 + i)}`, title: `Corrigir ${f.id}`, addresses: [f.id], wave: 1, effort: "M", risk: "low", dependsOn: [] }))];
  writeJson(join(runDir, "assessment.json"), b);
  const k = runAssess(["check", "--out", runDir]);
  if (k.code !== 0) throw new Error(`check: ${k.out}`);
  const d = readJson(join(runDir, "assessment.json"));
  d.summary = "Revisao tecnica com {{count.findings}} achados, dos quais {{count.critical}} criticos.";
  writeJson(join(runDir, "assessment.json"), d);
  return { cwd, runDir, map, fx: fixtures, a: readJson(join(runDir, "assessment.json")) };
}

/** Writes reverify/<check>.json through the library, with the fixture transport (no network, no TTY). */
export async function doReverify({ runDir, fx, check, resource = null, sleep = async () => {} }) {
  const { reverifyCheck } = await import("../scripts/lib/reverify.mjs");
  const { createFixtureTransport } = await import("../scripts/lib/transport.mjs");
  const { loadCatalog } = await import("../scripts/lib/catalog.mjs");
  return reverifyCheck({ runDir, catalog: loadCatalog(), transport: createFixtureTransport(fx), checkId: check, resources: resource !== null ? [].concat(resource) : [], sleep, now: () => "2026-11-25T13:00:00.000Z" });
}
export { FIX, readJson, run, tmp, writeJson, cpSync };

export const FSUB1 = "00000000-0000-0000-0000-000000000001";
export const FSUB2 = "00000000-0000-0000-0000-000000000002";

/** A stub `az` that serves the synthetic tenant: the fixture pages keyed by the exact query text, the REST answers, the CLI answers. */
export async function stubAzForFixture(fx) {
  const { loadCatalog } = await import("../scripts/lib/catalog.mjs");
  const catalog = loadCatalog();
  const queries = {};
  for (const c of catalog.checks) {
    const col = c.sources.collector;
    if (col?.kind !== "arg") continue;
    const f = join(fx, "arg", `${c.id}.json`);
    if (!existsSync(f)) continue;
    const d = readJson(f);
    queries[col.evaluated] = d.evaluated.pages;
    queries[col.violations] = d.violations.pages;
  }
  const rest = {};
  const rf = join(fx, "rest", "OE-LOCK-001.json");
  if (existsSync(rf)) Object.assign(rest, readJson(rf).bySubscription);
  const accounts = [sub(FSUB1, "sub-prod"), sub(FSUB2, "sub-nonprod")];
  const graph = `const q = require("./queries.json");
module.exports = (body) => {
  const pages = q[body.query];
  if (!pages) return { data: [], resultTruncated: "false", note: "consent" };
  const tok = body.options && body.options.$skipToken;
  const i = tok ? Number(String(tok).match(/(\\d+)$/)[1]) - 1 : 0;
  const page = pages[i];
  const subs = body.subscriptions;
  const rows = page.rows.filter((r) => !subs || !r.subscriptionId || subs.includes(r.subscriptionId));
  return Object.assign({ data: rows, count: rows.length, resultTruncated: page.resultTruncated || "false" }, page.$skipToken ? { $skipToken: page.$skipToken } : {});
};`;
  const az = stubAz({ show: { id: FSUB1, tenantId: TENANT, user: { name: "audit@example.invalid", type: "user" } }, list: accounts, principal: PRINCIPAL, rest }, graph);
  writeJson(join(az.dir, "queries.json"), queries);
  return { ...az, accounts };
}

/** Consent for the fixture tenant through the library (nonprod over both fixture subscriptions, typed count 2). Returns the cwd. */
export async function consentForFixture({ cwd = tmp("waf-cwd-"), runId = "r1", env = null, args = {}, transport = null, answers = [PHRASES.yes], azPath = "/usr/bin/az" } = {}) {
  const { runConsent } = await import("../scripts/lib/consent.mjs");
  const t = transport ?? consentTransport({ accounts: [sub(FSUB1, "sub-prod"), sub(FSUB2, "sub-nonprod")] });
  const e = env ?? isolatedEnv();
  const r = await runConsent({ args: { runId, stage: "nonprod", expectedSubs: "2", subscriptions: `${FSUB1},${FSUB2}`, redact: "default", ...args }, transport: t, io: scriptedIo(answers), cwd, env: e, platform: "linux", wsl: false, azPath, now: () => "2026-11-25T12:00:00.000Z" });
  if (!r.ok) throw new Error(`consent: ${r.message}`);
  return { cwd, env: e, consent: r.consent, consentFile: join(cwd, "waf-review", runId, "consent.json") };
}
