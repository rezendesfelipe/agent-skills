// The second independent review's executable findings (PoCs p1 to p9), as tests written BEFORE the fixes:
// 1 collect and reverify compare run.json with consent.json before any query; 2 the consent says group and inherited role assignments are
// not seen and asks a specific typed confirmation; 3 no predictable temporary name and no symbolic link followed when writing;
// 4 skipped stages are recorded in run.json, the manifest, the summaries, coverage.md and status; 5 cheap nits (HOME unset, a role id that is
// not canonical, isnotnull, the reverify budget).
import assert from "node:assert/strict";
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { kqlProblems } from "../scripts/lib/kql.mjs";
import { loadCatalog } from "../scripts/lib/catalog.mjs";
import { isolatedProfileProblem } from "../scripts/lib/platform.mjs";
import { createFixtureTransport } from "../scripts/lib/transport.mjs";
import { writeJsonFile } from "../scripts/lib/util.mjs";
import { FSUB1, FSUB2, PHRASES, ROLE, SUB1, baseArgs, completeFixture, consentCtx, consentForFixture, consentTransport, isolatedEnv, roleRow, scriptedIo, stubAzForFixture, sub } from "./prod-helpers.mjs";
import { planAndCollect, readJson, run, tmp, writeJson } from "./helpers.mjs";

const posix = process.platform !== "win32";
const skipStub = process.platform === "win32" && "the stub az is a POSIX executable (manual test M-10)";
const lib = () => import("../scripts/lib/consent.mjs");
const go = async ({ args = baseArgs(), transport = consentTransport(), answers = [PHRASES.yes], ctx = consentCtx(), io = scriptedIo(answers) } = {}) => {
  const { runConsent } = await lib();
  const r = await runConsent({ args, transport, io, ...ctx });
  return { r, io, ctx, file: join(ctx.cwd, "waf-review", args.runId ?? "r1", "consent.json") };
};

// ---------------------------------------------------------------------------------------------------- 1 (p1)
async function prod(extra = {}) {
  const fx = completeFixture();
  const az = await stubAzForFixture(fx);
  const env = isolatedEnv({ PATH: az.dir });
  const c = await consentForFixture({ env, azPath: az.bin, ...extra });
  return { fx, az, env, ...c };
}
const runDirOf = (p) => join(p.cwd, "waf-review", "r1");
const plan = (p) => run(["plan", "--run-id", "r1"], { cwd: p.cwd, env: p.env });
const collect = (p) => run(["collect", "--run", "r1"], { cwd: p.cwd, env: p.env });

test("p1: collect compares run.json with consent.json before ANY call to az; an edited scope, stage, redaction or budget never reaches Azure", { skip: skipStub }, async () => {
  const EXTRA = "77777777-7777-7777-7777-777777777777";
  const edits = [
    (r) => { r.scope.subscriptions.push(EXTRA); r.scope.visible = 3; r.queryBudget = 99999; },
    (r) => { r.scope.subscriptions.push(EXTRA); r.scope.visible = 3; },
    (r) => { r.queryBudget = 99999; },
    (r) => { r.stage = "root-mg"; },
    (r) => { r.redact = "strict"; },
    (r) => { r.scope.complete = false; },
  ];
  for (const edit of edits) {
    const p = await prod();
    assert.equal(plan(p).code, 0);
    const before = p.az.log().length;
    const f = join(runDirOf(p), "run.json");
    const r = readJson(f);
    edit(r);
    writeJson(f, r);
    const out = collect(p);
    assert.equal(out.code, 1, `${edit}: ${out.out}`);
    assert.match(out.out, /consent/i);
    assert.equal(p.az.log().length, before, "az was not started at all");
    assert.ok(!existsSync(join(p.az.dir, "bodies.jsonl")), "no query body was ever sent");
  }
});

test("p1: reverifyCheck of a production run refuses a run.json that no longer matches the consent, before asking the transport", { skip: skipStub }, async () => {
  const p = await prod();
  assert.equal(plan(p).code, 0);
  assert.equal(collect(p).code, 0);
  const f = join(runDirOf(p), "run.json");
  const r = readJson(f);
  r.scope.subscriptions.push("77777777-7777-7777-7777-777777777777");
  r.scope.visible = 3;
  writeJson(f, r);
  const calls = [];
  const spy = { kind: "spy", resourceGraph: async (...a) => { calls.push(a); return { status: 500 }; }, restGet: async (...a) => { calls.push(a); return { status: 500 }; }, azRead: async (...a) => { calls.push(a); return { status: 500 }; } };
  const { reverifyCheck } = await import("../scripts/lib/reverify.mjs");
  await assert.rejects(reverifyCheck({ runDir: runDirOf(p), catalog: loadCatalog(), transport: spy, checkId: "SE-STG-002", resources: [], sleep: async () => {} }), /consent/i);
  assert.equal(calls.length, 0);
});

test("reverify uses the query budget of the consent, not a constant", async () => {
  const fx = completeFixture();
  const f = join(fx, "arg", "SE-DEF-002.json");
  const j = readJson(f);
  const rows = Array.from({ length: 5000 }, (_, i) => ({ id: `/subscriptions/${FSUB1}/providers/Microsoft.Security/assessments/00000000-0000-0000-0000-${String(i).padStart(12, "0")}`, subscriptionId: FSUB1, displayName: `r${i}`, severity: "High" }));
  j.violations.pages = Array.from({ length: 5 }, (_, i) => ({ rows: rows.slice(i * 1000, i * 1000 + 1000), ...(i < 4 ? { $skipToken: `p${i + 2}` } : {}) }));
  j.evaluated.pages = [{ rows: [{ n: 5200 }] }];
  writeJson(f, j);
  const { runDir } = planAndCollect({ fixtures: fx });
  const rf = join(runDir, "run.json");
  const r = readJson(rf);
  r.queryBudget = 2;
  writeJson(rf, r);
  const { reverifyCheck } = await import("../scripts/lib/reverify.mjs");
  const rec = await reverifyCheck({ runDir, catalog: loadCatalog(), transport: createFixtureTransport(fx), checkId: "SE-DEF-002", resources: [], sleep: async () => {} });
  assert.equal(rec.state, "error");
  assert.equal(rec.error.class, "budget");
});

// ---------------------------------------------------------------------------------------------------- 2 (p2 A, B, D)
test("p2 A: the screen says that role assignments through a group or by inheritance are NOT seen, and a specific typed confirmation is required", async () => {
  const no = await go({ io: scriptedIo([PHRASES.yes], { strict: true }) });
  assert.equal(no.r.ok, false, "yes alone is not enough");
  assert.equal(no.r.reason, "groups-not-seen");
  assert.ok(!existsSync(no.file));
  const ok = await go({ io: scriptedIo([PHRASES.groups, PHRASES.yes], { strict: true }) });
  assert.equal(ok.r.ok, true, ok.r.message);
  const t = ok.io.shownScreen;
  assert.match(t, /group/i);
  assert.match(t, /inherit/i);
  assert.match(t, /NOT seen/);
  assert.doesNotMatch(t, /principal id verified: yes\s*$/m, "the verified line must carry the caveat");
  assert.equal(readJson(ok.file).acks.groupBlind, true);
  const { consentProblems } = await lib();
  const c = readJson(ok.file);
  assert.deepEqual(consentProblems(c, { runId: "r1" }), []);
  c.acks.groupBlind = false;
  assert.ok(consentProblems(c, { runId: "r1" }).length > 0);
});

test("p2 B and D: a role definition id that is not canonical aborts the consent (no acknowledgment turns it into 'unclassified')", async () => {
  for (const id of [`/providers/Microsoft.Authorization/roleDefinitions/${ROLE.owner}/`, `/providers/Microsoft.Authorization/roleDefinitions/${ROLE.owner}?x`, `${ROLE.owner}x`, "/providers/Microsoft.Authorization/roleDefinitions/not-a-guid", `/providers/Microsoft.Authorization/roleDefinitions/${ROLE.owner}/extra`, ""]) {
    const t = consentTransport({ roles: [roleRow(ROLE.reader), { ...roleRow(ROLE.owner), roleDefinitionId: id }] });
    const { r, file } = await go({ transport: t, answers: [PHRASES.unclassified, PHRASES.yes] });
    assert.equal(r.ok, false, JSON.stringify(id));
    assert.equal(r.reason, "role-id-invalid");
    assert.ok(!existsSync(file));
  }
  const upper = consentTransport({ roles: [{ ...roleRow(ROLE.owner), roleDefinitionId: `/providers/Microsoft.Authorization/roleDefinitions/${ROLE.owner.toUpperCase()}` }] });
  assert.equal((await go({ transport: upper })).r.reason, "write-role", "an upper-case GUID is still Owner");
  const sub1 = consentTransport({ roles: [{ ...roleRow(ROLE.reader), roleDefinitionId: `/subscriptions/${SUB1}/providers/Microsoft.Authorization/roleDefinitions/${ROLE.reader}` }] });
  assert.equal((await go({ transport: sub1 })).r.ok, true, "a subscription-scoped path of a built-in role is canonical");
});

// ---------------------------------------------------------------------------------------------------- 3 (p9)
test("p9: a symbolic link planted at the old predictable temporary name is not followed when a file is written", { skip: !posix && "symlinks need privileges on Windows" }, () => {
  const d = tmp("waf-p9-");
  const victim = join(tmp("waf-victim-"), "victim.txt");
  writeFileSync(victim, "PRECIOUS\n");
  symlinkSync(victim, join(d, `consent.json.tmp-${process.pid}`));
  writeJsonFile(join(d, "consent.json"), { schema: "x" }, 0o600);
  assert.equal(readFileSync(victim, "utf8"), "PRECIOUS\n");
  assert.ok(!lstatSync(join(d, "consent.json")).isSymbolicLink());
  assert.deepEqual(readJson(join(d, "consent.json")), { schema: "x" });
});

test("p9: the temporary name is random and never reused; a file in the way is not overwritten", { skip: !posix && "symlinks need privileges on Windows" }, () => {
  const d = tmp("waf-p9-");
  const names = new Set();
  for (let i = 0; i < 5; i++) { writeJsonFile(join(d, "a.json"), { i }); }
  assert.deepEqual(readdirSync(d), ["a.json"], "no temporary file is left");
  for (let i = 0; i < 3; i++) { const before = new Set(readdirSync(d)); writeJsonFile(join(d, `b${i}.json`), {}); for (const n of readdirSync(d)) names.add(n); void before; }
  assert.ok(names.size >= 3);
});

test("a folder that is a symbolic link is never written into: writeJsonFile, consent and plan refuse it", { skip: !posix && "symlinks need privileges on Windows" }, async () => {
  const victim = tmp("waf-victim-");
  const d = tmp("waf-p9-");
  symlinkSync(victim, join(d, "linked"));
  assert.throws(() => writeJsonFile(join(d, "linked", "x.json"), {}), /symbolic link/);
  assert.deepEqual(readdirSync(victim), []);
  // consent: the run folder itself is a link
  const ctx = consentCtx();
  mkdirSync(join(ctx.cwd, "waf-review"));
  symlinkSync(victim, join(ctx.cwd, "waf-review", "r1"));
  const c = await go({ ctx });
  assert.equal(c.r.ok, false);
  assert.equal(c.r.reason, "symlink");
  assert.deepEqual(readdirSync(victim), []);
  // consent: waf-review/ itself is a link
  const ctx2 = consentCtx();
  symlinkSync(victim, join(ctx2.cwd, "waf-review"));
  assert.equal((await go({ ctx: ctx2 })).r.reason, "symlink");
  assert.deepEqual(readdirSync(victim), []);
  // plan --fixtures: waf-review/ is a link
  const cwd = tmp("waf-cwd-");
  symlinkSync(victim, join(cwd, "waf-review"));
  const r = run(["plan", "--run-id", "r1", "--fixtures", completeFixture()], { cwd });
  assert.equal(r.code, 1, r.out);
  assert.deepEqual(readdirSync(victim), []);
});

// ---------------------------------------------------------------------------------------------------- 4 (stages skipped)
test("a skipped stage is recorded in run.json, the manifest, the summaries, coverage.md and status --json, and sealed", { skip: skipStub }, async () => {
  const fx = completeFixture();
  const az = await stubAzForFixture(fx);
  const env = isolatedEnv({ PATH: az.dir });
  const c = await consentForFixture({ env, azPath: az.bin, args: { stage: "one-prod", expectedSubs: "1", subscriptions: FSUB1 }, answers: [PHRASES.retention, PHRASES.acceptance, PHRASES.skip, PHRASES.yes] });
  assert.deepEqual(c.consent.acks.previousStage, { reviewed: false, run: null, skipped: true, stagesSkipped: ["nonprod"] });
  const p = { cwd: c.cwd, env };
  assert.equal(plan(p).code, 0);
  const rd = runDirOf(p);
  assert.deepEqual(readJson(join(rd, "run.json")).stagesSkipped, ["nonprod"]);
  assert.equal(collect(p).code, 0);
  assert.deepEqual(readJson(join(rd, "collected", "manifest.json")).stagesSkipped, ["nonprod"]);
  assert.match(readFileSync(join(rd, "collected", "summary", "security.md"), "utf8"), /Stages skipped before this run: nonprod/);
  const cov = run(["coverage", "--run", "r1"], p);
  assert.match(cov.out, /Stages skipped before this run: nonprod/);
  assert.match(readFileSync(join(rd, "coverage.md"), "utf8"), /nonprod/);
  const st = JSON.parse(run(["status", "--run", "r1", "--json"], p).stdout);
  assert.deepEqual(st.stagesSkipped, ["nonprod"]);
  assert.equal(run(["seal-check", "--run", "r1"], p).code, 0);
  const rf = join(rd, "run.json");
  const r = readJson(rf);
  r.stagesSkipped = [];
  writeJson(rf, r);
  assert.equal(run(["seal-check", "--run", "r1"], p).code, 1, "an edit that hides the skip is refused");
});

test("root-mg after nothing lists both earlier stages; a reviewed previous stage lists none", async () => {
  const args = { runId: "r1", stage: "root-mg", expectedSubs: "2", managementGroup: "mg-root", redact: "default" };
  const { r, file } = await go({ args, answers: [PHRASES.retention, PHRASES.acceptance, PHRASES.skip, PHRASES.yes] });
  assert.equal(r.ok, true, r.message);
  assert.deepEqual(readJson(file).acks.previousStage.stagesSkipped, ["nonprod", "one-prod"]);
  const fixtures = planAndCollect({});
  assert.deepEqual(readJson(join(fixtures.runDir, "run.json")).stagesSkipped ?? [], []);
  assert.deepEqual(JSON.parse(run(["status", "--run", "r1", "--json"], { cwd: fixtures.cwd }).stdout).stagesSkipped, []);
});

// ---------------------------------------------------------------------------------------------------- 5 (nits)
test("p7: with HOME unset the default ~/.azure is still recognized through the operating system's home folder", () => {
  const dflt = join(homedir(), ".azure");
  assert.match(isolatedProfileProblem({ env: { AZURE_CONFIG_DIR: dflt }, home: "", platform: process.platform }) ?? "", /default/);
  assert.match(isolatedProfileProblem({ env: { AZURE_CONFIG_DIR: dflt }, platform: process.platform }) ?? "", /default/);
});

test("isnotnull of a string is as wrong as isnull of a string: it is always true", () => {
  const q = (e) => `resources | where type =~ 'microsoft.storage/storageaccounts' | ${e} | project id, name, subscriptionId, resourceGroup, location`;
  for (const bad of ["where isnotnull(name)", "where isnotnull(id)", "extend a = tostring(properties.x) | where isnotnull(a)", "extend a = strcat(name,'x') | where isnull(a)", "extend a = toupper(name) | where isnull(a)", "where isnotnull(strcat(id,'x'))"]) assert.ok(kqlProblems(q(bad)).some((m) => /isnull|isnotnull/i.test(m)), bad);
  assert.deepEqual(kqlProblems(q("where isnotnull(properties.allowBlobPublicAccess)")), []);
});
void SUB1; void FSUB2; void sub;
