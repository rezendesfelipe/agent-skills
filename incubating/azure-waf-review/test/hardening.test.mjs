// What the independent review reproduced against 41b0ff3 (B-2, B-3, I-3 to I-8 and the nits). Written first: every test
// here fails on that commit. The attacks use the real assess.mjs where the review did.
import assert from "node:assert/strict";
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { loadCatalog } from "../scripts/lib/catalog.mjs";
import { collectCheck, runCollect } from "../scripts/lib/collect.mjs";
import { isAllowedUrl } from "../scripts/lib/azread.mjs";
import { projectRow, sanitizeString } from "../scripts/lib/redact.mjs";
import { scanString } from "../scripts/lib/scan.mjs";
import { createFixtureTransport } from "../scripts/lib/transport.mjs";
import { FIX, fake, fixtureCopy, hasAssess, planAndCollect, readJson, readText, run, runAssess, tmp, writeJson } from "./helpers.mjs";

const lines = (s) => s.split("\n");
const posix = process.platform !== "win32";

// ---------------------------------------------------------------- B-2: seal-check and strangers in collected/
function sealed() {
  const r = planAndCollect({});
  assert.equal(run(["seal-check", "--run", "r1"], { cwd: r.cwd }).code, 0);
  return r;
}
const sealFails = (cwd, re) => { const r = run(["seal-check", "--run", "r1"], { cwd }); assert.equal(r.code, 1, r.out); if (re) assert.match(r.out, re); };

test("B-2: a file in collected/ that the manifest does not list is refused, whatever its name", () => {
  for (const [name, content] of [["forged.jsonl", '{"id":"/forged"}\n'], ["SE-STG-001.001.jsonl.bak", "x\n"], ["se-stg-009.001.jsonl", "{}\n"], ["notes.txt", "x"], [".hidden", "x"], ["manifest.json.old", "{}"]]) {
    const { cwd, runDir } = sealed();
    writeFileSync(join(runDir, "collected", name), content);
    sealFails(cwd, new RegExp(name.replace(/\./g, "\\.")));
  }
});

test("B-2: a sub folder, a leftover temp folder and a stranger in summary/ are refused", () => {
  for (const make of [(c) => { mkdirSync(join(c, "sub")); writeFileSync(join(c, "sub", "x.jsonl"), "{}\n"); }, (c) => mkdirSync(join(c, ".tmp-SE-STG-001")), (c) => writeFileSync(join(c, "summary", "forged.jsonl"), "{}\n"), (c) => mkdirSync(join(c, "summary", "deeper"))]) {
    const { cwd, runDir } = sealed();
    make(join(runDir, "collected"));
    sealFails(cwd);
  }
});

test("B-2: a symbolic link in place of a sealed part is refused even when the bytes match", { skip: !posix && "symlinks need privileges on Windows" }, () => {
  const { cwd, runDir } = sealed();
  const part = join(runDir, "collected", "SE-STG-001.001.jsonl");
  const outside = join(tmp("waf-out-"), "copy.jsonl");
  copyFileSync(part, outside);
  rmSync(part);
  symlinkSync(outside, part);
  sealFails(cwd, /symbolic link|symlink/i);
  rmSync(part);
  const link = join(runDir, "collected", "summary-link");
  symlinkSync(tmp("waf-out-"), link);
  copyFileSync(outside, part);
  sealFails(cwd, /summary-link/);
});

test("B-2: a part name in the manifest must be a plain part name (no path, no other shape)", () => {
  for (const bad of ["../x.jsonl", "/etc/x.jsonl", "sub/SE-STG-001.001.jsonl", "SE-STG-001.001.jsonl\n", "x.jsonl"]) {
    const { cwd, runDir } = sealed();
    const f = join(runDir, "collected", "manifest.json");
    const m = readJson(f);
    m.checks["SE-STG-001"].parts[0].name = bad;
    writeJson(f, m);
    sealFails(cwd, /part name|not a valid/i);
  }
});

test("B-2: the attack of the review with the real assess.mjs (a forged file that verify accepts) is refused by seal-check", { skip: !hasAssess() && "assessment-report not present" }, () => {
  const { cwd, runDir } = sealed();
  writeFileSync(join(runDir, "collected", "forged.jsonl"), '{"id":"/forged"}\n');
  const A = (a) => runAssess(a);
  assert.equal(A(["init", "--out", runDir, "--root", join(runDir, "collected"), "--model", "t", "--client", "c", "--title", "t", "--author", "a", "--version", "1", "--date", "2026-11-25", "--lang", "en"]).code, 0);
  A(["inventory", "--out", runDir]);
  const a = readJson(join(runDir, "assessment.json"));
  a.evidence = [{ id: "E-001", kind: "file", path: "forged.jsonl", startLine: 1, endLine: 1, quote: '{"id":"/forged"}' }];
  a.findings = [{ id: "F-001", title: "t", statement: "s", evidence: ["E-001"] }];
  writeJson(join(runDir, "assessment.json"), a);
  assert.match(A(["verify", "--out", runDir, "--json"]).out, /"ok": true/, "the verifier alone accepts it (the review's reproduction)");
  sealFails(cwd, /forged\.jsonl/);
});

test("the manifest's counts and states must agree with its parts", () => {
  const edit = (fn) => { const { cwd, runDir } = sealed(); const f = join(runDir, "collected", "manifest.json"); const m = readJson(f); fn(m); writeJson(f, m); return cwd; };
  sealFails(edit((m) => { m.checks["SE-STG-001"].violations = 99; }), /SE-STG-001.*violations|violations.*SE-STG-001/);
  sealFails(edit((m) => { m.checks["SE-STG-001"].state = "pass"; }), /SE-STG-001/);
  sealFails(edit((m) => { m.checks["SE-NET-002"].state = "pass"; delete m.checks["SE-NET-002"].reason; }), /SE-NET-002/);
  sealFails(edit((m) => { m.checks["PE-ADV-001"].state = "fail"; m.checks["PE-ADV-001"].violations = 1; }), /PE-ADV-001/);
});

// ---------------------------------------------------------------- B-3: run.json is sealed into the manifest
test("B-3: editing run.json after collect (a forged complete scope) fails seal-check", () => {
  const { cwd, runDir } = sealed();
  const f = join(runDir, "run.json");
  const r = readJson(f);
  assert.equal(r.scope.complete, false);
  r.scope.complete = true;
  writeJson(f, r);
  sealFails(cwd, /run\.json/);
});

test("B-3: every field that matters in run.json is sealed (scope, pillars, redaction, run id, budget)", () => {
  const edits = [(r) => { r.scope.subscriptions.pop(); }, (r) => { r.scope.expected = 2; }, (r) => { r.redact = "strict"; }, (r) => { r.pillars = ["security"]; }, (r) => { r.queryBudget = 1; }, (r) => { r.scope.notCovered = []; }, (r) => { r.fixtures = false; }];
  for (const edit of edits) {
    const { cwd, runDir } = sealed();
    const f = join(runDir, "run.json");
    const r = readJson(f);
    edit(r);
    writeJson(f, r);
    sealFails(cwd, /run\.json/);
  }
});

test("B-3: a manifest entry whose scope fields differ from run.json is refused", () => {
  const { cwd, runDir } = sealed();
  const f = join(runDir, "collected", "manifest.json");
  const m = readJson(f);
  m.checks["SE-NET-002"].scopeComplete = true;
  writeJson(f, m);
  sealFails(cwd, /SE-NET-002/);
});

test("B-3: --resume refuses a changed run.json instead of trusting finished checks", () => {
  const { cwd, runDir } = planAndCollect({});
  const f = join(runDir, "run.json");
  const r = readJson(f);
  r.scope.complete = true;
  writeJson(f, r);
  const again = run(["collect", "--run", "r1", "--fixtures", FIX, "--resume"], { cwd });
  assert.notEqual(again.code, 0);
  assert.match(again.out, /run\.json/);
  const status = JSON.parse(run(["status", "--run", "r1", "--json"], { cwd }).stdout).checks;
  assert.equal(status["SE-NET-002"], "not-verified:scope-incomplete", "nothing was rewritten");
});

test("B-3: library resume compares the run hash, the redaction mode and the run id", async () => {
  const dir = tmp("waf-resume-");
  const base = { runDir: dir, catalog: loadCatalog(), transport: createFixtureTransport(FIX), scope: { kind: "subscriptions", subscriptions: ["00000000-0000-0000-0000-000000000001"], visible: 1, expected: 1, complete: true }, pillars: ["security"], only: ["SE-STG-001"], sleep: async () => {}, now: () => "2026-11-25T00:00:00.000Z" };
  await runCollect({ ...base, redact: { mode: "default", runId: "r1" }, runSha256: "a".repeat(64) });
  await assert.rejects(() => runCollect({ ...base, redact: { mode: "default", runId: "r1" }, runSha256: "b".repeat(64), resume: true }), /run\.json|run hash/);
  await assert.rejects(() => runCollect({ ...base, redact: { mode: "strict", runId: "r1" }, runSha256: "a".repeat(64), resume: true }), /redact/i);
  await assert.rejects(() => runCollect({ ...base, redact: { mode: "default", runId: "other" }, runSha256: "a".repeat(64), resume: true }), /run id|runId/i);
});

// ---------------------------------------------------------------- I-3 strict stdout, I-4 permissions
test("I-3: plan --redact strict prints no real name and no subscription id (the stdout reaches the model)", () => {
  const state = tmp("waf-state-");
  const env = { XDG_STATE_HOME: state, LOCALAPPDATA: state, HOME: state, USERPROFILE: state };
  for (const extra of [[], ["--json"]]) {
    const cwd = tmp();
    const r = run(["plan", "--run-id", "r1", "--fixtures", FIX, "--redact", "strict", ...extra], { cwd, env });
    assert.equal(r.code, 0, r.out);
    for (const real of ["sub-prod", "sub-nonprod", "00000000-0000-0000-0000-00000000000", "\u001b"]) assert.ok(!r.out.includes(real), `${extra}: ${real}`);
    assert.match(r.out, /sub-0\d/);
    const c = run(["collect", "--run", "r1", "--fixtures", FIX], { cwd, env });
    for (const real of ["sub-prod", "00000000-0000-0000-0000-00000000000"]) assert.ok(!c.out.includes(real), real);
  }
  const cwd = tmp();
  const plain = run(["plan", "--run-id", "r1", "--fixtures", FIX], { cwd });
  assert.match(plain.out, /sub-prod/, "the default mode still shows names (the user reads them at consent)");
});

test("I-4: the run folder, its folders and its files are private (0700 and 0600) on POSIX", { skip: !posix && "ACLs on Windows are not verified (the engine does not promise them)" }, () => {
  const { cwd, runDir } = planAndCollect({});
  for (const sub of ["coverage", "questionnaire", "map"]) run([sub, "--run", "r1"], { cwd });
  const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => [join(d, e.name), ...(e.isDirectory() ? walk(join(d, e.name)) : [])]);
  const base = join(cwd, "waf-review");
  assert.equal(statSync(base).mode & 0o777, 0o700);
  assert.equal(statSync(runDir).mode & 0o777, 0o700);
  for (const f of walk(base)) assert.equal(statSync(f).mode & 0o777, statSync(f).isDirectory() ? 0o700 : 0o600, f);
});

// ---------------------------------------------------------------- I-5 URL parser differential, subscription id
test("I-5: URLs that other parsers read differently, or that carry characters we never need, are refused", () => {
  const ok = "https://management.azure.com/subscriptions/00000000-0000-0000-0000-000000000001/providers/Microsoft.Authorization/locks?api-version=2016-09-01";
  assert.equal(isAllowedUrl(ok, "GET"), true);
  for (const u of ["https://management.azure.com\\@evil.example/x?api-version=1", "https://management.azure.com/x?api-version=1#frag", "https://management.azure.com/a b?api-version=1", "https://management.azure.com/x\n?api-version=1", "https://management.azure.com/x?api-version=1\r\nHost: evil", "https://management.azure.com/%2e%2e/x?api-version=1", "https://management.azure.com/x@y?api-version=1", "https://management.azure.com/x\t?api-version=1", "https://management.azure.com/\u0000x?api-version=1", "https://mаnagement.azure.com/x?api-version=1", "https://management.azure.com/x?api-version=1&a=é"])
    assert.equal(isAllowedUrl(u, "GET"), false, JSON.stringify(u));
});

test("I-5: a subscription id that is not a GUID never reaches a URL (collect refuses the run)", async () => {
  const scope = { kind: "subscriptions", subscriptions: ["00000000-0000-0000-0000-000000000001/../x"], visible: 1, expected: 1, complete: true };
  const c = loadCatalog().checks.find((x) => x.id === "OE-LOCK-001");
  const seen = [];
  const t = { restGet: async (u) => { seen.push(u); return { status: 200, body: { value: [] } }; }, resourceGraph: async () => ({ status: 500 }) };
  const e = await collectCheck({ check: c, transport: t, scope, collectedDir: join(tmp(), "collected"), redact: { mode: "default", runId: "r1" }, sleep: async () => {}, now: () => "t", budget: { remaining: 10 } });
  assert.equal(e.state, "not-verified");
  assert.deepEqual(seen, []);
  await assert.rejects(() => runCollect({ runDir: tmp(), catalog: loadCatalog(), transport: t, scope: { ...scope, subscriptions: ["x y"] }, pillars: ["operations"], redact: { mode: "default", runId: "r1" }, sleep: async () => {}, now: () => "t" }), /subscription|GUID/i);
});

// ---------------------------------------------------------------- I-7 and I-8 (documented behavior)
test("I-7: seal-check passes when assessment.json does not exist yet (the render of PR 1b must require the file)", () => {
  const { cwd, runDir } = sealed();
  assert.ok(!existsSync(join(runDir, "assessment.json")));
  const r = run(["seal-check", "--run", "r1"], { cwd });
  assert.equal(r.code, 0);
  assert.match(r.out, /assessment\.json/i, "the output says the root seal was not checked because the file is absent");
});

test("I-8: a tag value is pseudonymized, not redacted: the output says so and the manifest counts it separately", () => {
  const { runDir } = planAndCollect({});
  const m = readJson(join(runDir, "collected", "manifest.json"));
  assert.ok(m.checks["CO-TAG-001"].tagsPseudonymized >= 1);
  assert.equal(m.redactions?.tagValues, undefined);
  assert.match(readText(join(runDir, "collected", "CO-TAG-001.001.jsonl")), /"owner":"tag:[0-9a-f]{8}"/);
});

// ---------------------------------------------------------------- nits
test("nit: run ids that Windows or a case-insensitive disk would turn into trouble are refused", () => {
  const cwd = tmp();
  for (const id of ["CON", "con", "nul", "aux.txt", "com1", "LPT9", "prn.log", "abc.", "abc ", "a:b"]) assert.equal(run(["plan", "--run-id", id, "--fixtures", FIX], { cwd }).code, 2, id);
  assert.equal(run(["plan", "--run-id", "abc", "--fixtures", FIX], { cwd }).code, 0);
  const dup = run(["plan", "--run-id", "ABC", "--fixtures", FIX], { cwd });
  assert.equal(dup.code, 2);
  assert.match(dup.out, /case|already/i);
});

test("nit: run.json's runId is checked again before it forms the alias path", () => {
  const { cwd, runDir } = planAndCollect({ id: "r1" });
  const f = join(runDir, "run.json");
  const r = readJson(f);
  r.runId = "../../../x";
  r.redact = "strict";
  writeJson(f, r);
  const c = run(["collect", "--run", "r1", "--fixtures", FIX], { cwd });
  assert.equal(c.code, 2, c.out);
  assert.match(c.out, /run id|runId|run\.json/i);
});

test("nit: two collects on one run id cannot run at once (lock file), and the lock is released", () => {
  const { cwd, runDir } = planAndCollect({});
  writeFileSync(join(runDir, ".lock"), "12345\n");
  const r = run(["collect", "--run", "r1", "--fixtures", FIX], { cwd });
  assert.equal(r.code, 1);
  assert.match(r.out, /lock/i);
  rmSync(join(runDir, ".lock"));
  assert.equal(run(["collect", "--run", "r1", "--fixtures", FIX], { cwd }).code, 0);
  assert.ok(!existsSync(join(runDir, ".lock")), "released after the run");
});

test("nit: a malformed evaluated row inside a split is an error, not a zero", async () => {
  const c = loadCatalog().checks.find((x) => x.id === "SE-STG-001");
  const SUBS = ["00000000-0000-0000-0000-000000000001", "00000000-0000-0000-0000-000000000002"];
  const t = { resourceGraph: async (req, ctx) => (req.subscriptions.length > 1 ? { status: null, errorClass: "timeout" } : { status: 200, body: { data: ctx.role === "evaluated" ? [{ nope: 1 }] : [], resultTruncated: "false" } }) };
  const e = await collectCheck({ check: c, transport: t, scope: { kind: "subscriptions", subscriptions: SUBS, visible: 2, expected: 2, complete: true }, collectedDir: join(tmp(), "collected"), redact: { mode: "default", runId: "r1" }, sleep: async () => {}, now: () => "t", budget: { remaining: 50 } });
  assert.equal(e.state, "not-verified");
  assert.equal(e.reason, "error");
  assert.equal(e.error.class, "format");
});

test("nit: the summary shows a bool as a bool and a number as a number", () => {
  const { runDir } = planAndCollect({});
  const s = readText(join(runDir, "collected", "summary", "security.md"));
  assert.match(s, /\(softDelete: true\)/);
  assert.ok(!/\(softDelete: "true"\)/.test(s));
  assert.match(readText(join(runDir, "collected", "summary", "cost.md")), /\(diskState: "Unattached"\)/);
});

test("nit: the secret scan runs BEFORE the cut to 256 characters", () => {
  const jwt = `eyJ${"a".repeat(12)}.eyJ${"b".repeat(12)}.${"c".repeat(20)}`;
  const value = "x".repeat(236) + jwt; // the cut at 256 would keep the header and half of the payload
  const r = projectRow({ id: "x", name: value }, [{ name: "id", type: "string" }, { name: "name", type: "string" }], { mode: "default", runId: "r1" });
  assert.equal(r.row.name, "[redacted:jwt]");
  assert.equal(r.redactions, 1);
  assert.equal(sanitizeString("a".repeat(300)).length, 256);
});

test("nit: the scanner also finds a bare storage key (88 base64 characters) and an Entra client secret, built at run time", () => {
  const b64 = "QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVphYmNkZWZnaGlqa2xtbm9wcXJzdHV2d3h5ejAxMjM0NTY3ODk";
  const bare = `${b64.slice(0, 86)}==`;
  assert.equal(bare.length, 88);
  assert.ok(scanString(`value ${bare} end`).includes("azure-storage-key-bare"));
  const aad = ["abc8", "Q~", "x".repeat(34)].join("");
  assert.ok(scanString(`client ${aad}`).includes("aad-client-secret"));
  for (const ok of ["plain text", "00000000-0000-0000-0000-000000000001", "stcontosoprod01", "x".repeat(88), "Q~"]) assert.deepEqual(scanString(ok), [], ok);
  assert.ok(scanString(fake.awsKey()).includes("aws-access-key"), "the scanner of the source is still part of it");
  const r = projectRow({ id: "x", name: bare }, [{ name: "id", type: "string" }, { name: "name", type: "string" }], { mode: "default", runId: "r1" });
  assert.match(r.row.name, /^\[redacted:/);
});

test("nit: the query budget is enforced in the MIDDLE of a check (the one surviving mutant of the first review)", async () => {
  const c = loadCatalog();
  const SUBS = ["00000000-0000-0000-0000-000000000001"];
  let n = 0;
  const t = { resourceGraph: async (req, ctx) => { n++; return ctx.role === "evaluated" ? { status: 200, body: { data: [{ n: 9 }], resultTruncated: "false" } } : { status: 200, body: { data: [{ id: `/subscriptions/x/${n}`, name: "a", subscriptionId: SUBS[0], resourceGroup: "g", location: "l", publicAccess: "true" }], resultTruncated: "false", $skipToken: `p${n + 1}` } }; } };
  const dir = tmp("waf-budget-");
  const r = await runCollect({ runDir: dir, catalog: c, transport: t, scope: { kind: "subscriptions", subscriptions: SUBS, visible: 1, expected: 1, complete: true }, pillars: ["security"], only: ["SE-STG-001"], redact: { mode: "default", runId: "r1" }, queryBudget: 4, sleep: async () => {}, now: () => "t" });
  assert.equal(r.budgetReached, true);
  assert.deepEqual(r.notDone, ["SE-STG-001"]);
  assert.ok(n <= 4, `${n} queries with a budget of 4`);
  assert.ok(!("SE-STG-001" in r.manifest.checks));
  assert.deepEqual(readdirSync(join(dir, "collected")).filter((f) => f.startsWith("SE-STG-001")), []);
});
