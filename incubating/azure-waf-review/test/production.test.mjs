// PR 1b, task 1.9 and "What PR 1b must inherit": plan and collect take their scope, stage, redaction and budget from a valid
// consent.json; the consent is tied to run.json and the manifest; fixtures and production never mix; the production transport runs
// only against a stub `az` here (a Node script that answers from a data file; nothing real is started). Written before the implementation.
// POSIX only: the stub is an executable script. Native Windows is manual test M-10 and the production transport fails closed there.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { sha256, stableStringify } from "../scripts/lib/util.mjs";
import { FSUB1, FSUB2, PHRASES, completeFixture, consentForFixture, consentTransport, isolatedEnv, stubAzForFixture, sub, TENANT } from "./prod-helpers.mjs";
import { planAndCollect, readJson, run, tmp, writeJson } from "./helpers.mjs";

const skip = process.platform === "win32" && "the stub az is a POSIX executable; native Windows is manual test M-10";
const lib = () => import("../scripts/lib/consent.mjs");
const canonicalSha = (file) => sha256(stableStringify(readJson(file)));

async function prod({ az = null, fx = completeFixture() } = {}) {
  const a = az ?? (await stubAzForFixture(fx));
  const env = isolatedEnv({ PATH: a.dir });
  const c = await consentForFixture({ env, azPath: a.bin });
  return { fx, az: a, env, ...c };
}
const plan = (p, extra = []) => run(["plan", "--run-id", "r1", ...extra], { cwd: p.cwd, env: p.env });
const collect = (p, extra = []) => run(["collect", "--run", "r1", ...extra], { cwd: p.cwd, env: p.env });
const runDirOf = (p) => join(p.cwd, "waf-review", "r1");

/** A forgery that is consistent with itself: fields changed, the stored text and both hashes recomputed. */
async function forge(file, mutate) {
  const { storedTextOf } = await lib();
  const c = readJson(file);
  mutate(c);
  c.storedText = storedTextOf(c);
  c.storedTextSha256 = sha256(c.storedText);
  if (c.redact !== "strict") c.textSha256 = c.storedTextSha256;
  writeJson(file, c);
  return c;
}

test("plan without a consent.json, or with a forged one, is refused and writes no run.json", { skip }, async () => {
  const az = await stubAzForFixture(completeFixture());
  const env = isolatedEnv({ PATH: az.dir });
  const cwd = tmp();
  const none = run(["plan", "--run-id", "r1"], { cwd, env });
  assert.equal(none.code, 1, none.out);
  assert.match(none.out, /consent/i);
  const p = await prod({ az });
  const f = join(runDirOf(p), "consent.json");
  const c = readJson(f);
  c.stage = "root-mg";
  writeJson(f, c);
  const forged = plan(p);
  assert.equal(forged.code, 1, forged.out);
  assert.match(forged.out, /consent/i);
  assert.throws(() => readFileSync(join(runDirOf(p), "run.json")));
});

test("plan with a valid consent: scope, stage, redaction and budget come from consent.json, bound by its hash", { skip }, async () => {
  const p = await prod();
  const r = plan(p, ["--pillars", "security,reliability"]);
  assert.equal(r.code, 0, r.out);
  const run1 = readJson(join(runDirOf(p), "run.json"));
  const c = readJson(join(runDirOf(p), "consent.json"));
  assert.equal(run1.fixtures, false);
  assert.equal(run1.stage, "nonprod");
  assert.deepEqual(run1.pillars, ["security", "reliability"]);
  assert.deepEqual(run1.scope.subscriptions, c.scope.subscriptions);
  assert.equal(run1.scope.visible, 2);
  assert.equal(run1.scope.expected, 2);
  assert.equal(run1.scope.complete, true);
  assert.equal(run1.redact, c.redact);
  assert.equal(run1.queryBudget, c.queryBudget);
  assert.equal(run1.consent.sha256, canonicalSha(join(runDirOf(p), "consent.json")));
  assert.equal(run1.consent.textSha256, c.textSha256);
  // the only things plan asked az for: the version and the account
  for (const argv of p.az.log()) assert.ok(["--version", "account"].includes(argv[0]) && !argv.includes("login"), JSON.stringify(argv));
});

test("plan refuses when the situation changed since consent: another az, another profile, another tenant, a profile that is not isolated", { skip }, async () => {
  const p = await prod();
  const other = await stubAzForFixture(p.fx);
  assert.equal(run(["plan", "--run-id", "r1"], { cwd: p.cwd, env: { ...p.env, PATH: other.dir } }).code, 1, "another az on PATH");
  assert.equal(run(["plan", "--run-id", "r1"], { cwd: p.cwd, env: { ...p.env, AZURE_CONFIG_DIR: tmp("waf-other-profile-") } }).code, 1, "another profile");
  const env2 = { ...p.env }; delete env2.AZURE_CONFIG_DIR;
  assert.equal(run(["plan", "--run-id", "r1"], { cwd: p.cwd, env: env2 }).code, 1, "no profile");
  const t = await stubAzForFixture(p.fx);
  const d = readJson(join(t.dir, "data.json"));
  d.show.tenantId = "88888888-8888-8888-8888-888888888888";
  writeJson(join(t.dir, "data.json"), d);
  // a stub that is the consented az but now logged in to another tenant
  writeFileSync(join(p.az.dir, "data.json"), JSON.stringify({ ...readJson(join(p.az.dir, "data.json")), show: d.show }));
  const r = plan(p);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /tenant/i);
});

test("plan and collect take no stage, scope, redaction or budget from the command line when there is no --fixtures", { skip }, async () => {
  const p = await prod();
  for (const x of [["--redact", "strict"], ["--stage", "root-mg"], ["--query-budget", "5"], ["--expected-subs", "3"]]) assert.equal(plan(p, x).code, 2, x.join(" "));
  assert.throws(() => readFileSync(join(runDirOf(p), "run.json")));
});

test("fixtures and production never mix: --fixtures on a consented run, and a production collect on a fixtures run, are refused", { skip }, async () => {
  const p = await prod();
  assert.equal(plan(p).code, 0);
  const fxCollect = collect(p, ["--fixtures", p.fx]);
  assert.equal(fxCollect.code, 1, fxCollect.out);
  assert.match(fxCollect.out, /consent|production/i);
  const f = run(["plan", "--run-id", "r1", "--fixtures", p.fx], { cwd: p.cwd, env: p.env });
  assert.equal(f.code, 1, "a run folder with a consent.json is a production run");
  const cwd = tmp();
  const fx = planAndCollect({ fixtures: p.fx, cwd });
  assert.equal(fx.collect.code, 0);
  const prodCollect = run(["collect", "--run", "r1"], { cwd, env: p.env });
  assert.equal(prodCollect.code, 1, prodCollect.out);
  assert.match(prodCollect.out, /fixtures/i);
});

test("collect through the production transport (a stub az) gives the states of the fixture run, seals the consent and runs only constant argument lists", { skip }, async () => {
  const p = await prod();
  assert.equal(plan(p).code, 0);
  const c = collect(p);
  assert.equal(c.code, 0, c.out);
  const m = readJson(join(runDirOf(p), "collected", "manifest.json"));
  assert.equal(m.fixtures, false);
  assert.match(m.azVersion, /azure-cli 2\.99\.0/);
  assert.equal(m.consent.sha256, canonicalSha(join(runDirOf(p), "consent.json")));
  const seal = run(["seal-check", "--run", "r1"], { cwd: p.cwd, env: p.env });
  assert.equal(seal.code, 0, seal.out);
  const ref = planAndCollect({ fixtures: p.fx, cwd: tmp() });
  const a = JSON.parse(run(["status", "--run", "r1", "--json"], { cwd: p.cwd, env: p.env }).stdout).checks;
  const b = JSON.parse(run(["status", "--run", "r1", "--json"], { cwd: ref.cwd }).stdout).checks;
  assert.deepEqual(a, b);
  const log = p.az.log();
  const rest = log.filter((x) => x[0] === "rest");
  assert.equal(rest.length, m.queries);
  for (const x of rest) {
    assert.equal(x[1], "--method");
    assert.ok(x.at(-1) === "--only-show-errors");
    assert.ok(x[x.indexOf("--url") + 1].startsWith("https://management.azure.com/"));
    assert.ok(!x.some((y) => /^--(debug|verbose)$/.test(y)));
  }
  assert.ok(!log.some((x) => x.includes("login") || x.includes("get-access-token")));
});

// ------------------------------------------------------------------------------------------------ the binding to the manifest
async function collected() {
  const p = await prod();
  assert.equal(plan(p).code, 0);
  assert.equal(collect(p).code, 0);
  return p;
}
const seal = (p) => run(["seal-check", "--run", "r1"], { cwd: p.cwd, env: p.env });

test("consent.json edited after collect: seal-check refuses, whether the edit is crude or self-consistent (text and hashes recomputed)", { skip }, async () => {
  const crude = await collected();
  const f = join(runDirOf(crude), "consent.json");
  const c = readJson(f);
  c.expectedSubs = 3;
  writeJson(f, c);
  assert.equal(seal(crude).code, 1);
  const smart = await collected();
  await forge(join(runDirOf(smart), "consent.json"), (x) => { x.queryBudget = 1; });
  const { consentProblems } = await lib();
  assert.deepEqual(consentProblems(readJson(join(runDirOf(smart), "consent.json")), { runId: "r1" }), [], "a self-consistent forgery passes the file's own checks (tamper-evident only, documented)");
  const s = seal(smart);
  assert.equal(s.code, 1, s.out);
  assert.match(s.out, /consent\.json/);
});

test("consent.json deleted, or the consent hash removed from the manifest or from run.json: refused", { skip }, async () => {
  const a = await collected();
  rmSync(join(runDirOf(a), "consent.json"));
  assert.equal(seal(a).code, 1);
  const b = await collected();
  const m = readJson(join(runDirOf(b), "collected", "manifest.json"));
  delete m.consent;
  writeJson(join(runDirOf(b), "collected", "manifest.json"), m);
  assert.equal(seal(b).code, 1);
  const c = await collected();
  const r = readJson(join(runDirOf(c), "run.json"));
  delete r.consent;
  writeJson(join(runDirOf(c), "run.json"), r);
  assert.equal(seal(c).code, 1);
});

test("run.json scope, stage or fixtures flag edited to disagree with consent.json: refused", { skip }, async () => {
  for (const edit of [(r) => { r.scope.subscriptions = [...r.scope.subscriptions, "33333333-3333-3333-3333-333333333333"]; r.scope.visible = 3; }, (r) => { r.stage = "root-mg"; }, (r) => { r.fixtures = true; }, (r) => { r.scope.complete = false; }, (r) => { r.redact = "strict"; }]) {
    const p = await collected();
    const f = join(runDirOf(p), "run.json");
    const r = readJson(f);
    edit(r);
    writeJson(f, r);
    assert.equal(seal(p).code, 1, edit.toString());
  }
});

test("collect --resume with a consent that changed since the manifest is refused", { skip }, async () => {
  const p = await collected();
  await forge(join(runDirOf(p), "consent.json"), (x) => { x.queryBudget = 7; });
  const r = collect(p, ["--resume"]);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /consent/i);
});

test("a fixtures run holding a consent.json, or a production run without one, fails seal-check", { skip }, async () => {
  const fx = planAndCollect({ fixtures: completeFixture() });
  writeJson(join(fx.runDir, "consent.json"), { schema: "waf-consent/1" });
  assert.equal(run(["seal-check", "--run", "r1"], { cwd: fx.cwd }).code, 1);
});

test("status --json of a production run names the stage and says it is not fixtures", { skip }, async () => {
  const p = await collected();
  const s = JSON.parse(run(["status", "--run", "r1", "--json"], { cwd: p.cwd, env: p.env }).stdout);
  assert.equal(s.stage, "nonprod");
  assert.equal(s.fixtures, false);
  void TENANT; void FSUB1; void FSUB2; void PHRASES; void consentTransport; void sub;
});
