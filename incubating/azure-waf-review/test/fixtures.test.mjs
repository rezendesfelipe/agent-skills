// The synthetic tenant "Contoso Exemplo" and the scorer (tasks 1.12, 1.13; specs "Synthetic tenant and manual test",
// "Redaction before write", "Privacy and untrusted input"). The fixture is synthetic: it proves the engine and the key agree,
// not that Resource Graph answers this way (manual tests M-3 and M-5).
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";
import { build, ESC_NAME, HOSTILE_TAG } from "./fixtures/contoso-exemplo/build.mjs";
import { FIX, ASSESS, fake, fixtureCopy, hasAssess, jsonl, planAndCollect, readJson, run, tmp, writeJson } from "./helpers.mjs";
import { loadCatalog } from "../scripts/lib/catalog.mjs";

const KEY = readJson(join(FIX, "key.json"));
const walkFiles = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walkFiles(join(d, e.name)) : [join(d, e.name)]));
const statesOf = (cwd) => JSON.parse(run(["status", "--run", "r1", "--json"], { cwd }).stdout).checks;
const complete = (extra) => { const d = fixtureCopy(); const s = readJson(join(d, "scope.json")); s.containers = s.visible; s.expected = 2; writeJson(join(d, "scope.json"), s); extra?.(d); return d; };

test("committed fixtures equal what build.mjs generates (they cannot drift)", () => {
  for (const [rel, content] of Object.entries(build())) assert.equal(readFileSync(join(FIX, rel), "utf8"), content, rel);
});

test("fixtures hold no real GUID, no credential shape and no raw control character", async () => {
  const guid = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
  let scan = () => [];
  if (hasAssess()) scan = (await import(pathToFileURL(join(ASSESS(), "..", "lib", "secrets.mjs")).href)).scanString;
  for (const f of walkFiles(FIX).filter((x) => !x.endsWith("build.mjs"))) {
    const t = readFileSync(f, "utf8");
    for (const g of t.match(guid) ?? []) assert.match(g, /^00000000-0000-0000-0000-\d{12}$/, `${f}: ${g}`);
    assert.deepEqual(scan(t), [], f);
    assert.ok(!/[\u0000-\u0008\u000b-\u001f\u007f]/.test(t), `${f}: raw control character`);
    assert.ok(!/@[a-z0-9-]+\.(com|org|net|io)\b/i.test(t), `${f}: e-mail address`);
  }
  assert.ok(readFileSync(join(FIX, "arg", "CO-TAG-001.json"), "utf8").includes(HOSTILE_TAG), "the hostile tag is in the fixture");
  assert.ok(readFileSync(join(FIX, "arg", "CO-ORP-001.json"), "utf8").includes("\\u001b"), "an ESC name is in the fixture");
});

test("the key: every location it names exists in the fixture", () => {
  const t = readJson(join(FIX, "tenant.json"));
  const ids = new Set(t.resources.map((r) => r.id));
  for (const d of KEY.decoys) assert.ok(ids.has(d.armId), d.armId);
  for (const f of KEY.flaws) {
    assert.ok(existsSync(join(FIX, f.check === "OE-LOCK-001" ? "rest" : "arg", `${f.check}.json`)), f.check);
    assert.ok(f.armIds.length > 0);
  }
  assert.equal(Object.keys(t.subscriptions).length, 3);
  assert.ok(t.resources.some((r) => r.subscriptionId === KEY.invisibleSubscription.id));
  const cat = loadCatalog();
  for (const id of Object.keys(KEY.expectedStatesCompleteScope)) assert.ok(cat.checks.some((c) => c.id === id), `key names ${id}, missing from the catalog`);
  for (const c of cat.checks) assert.ok(c.id in KEY.expectedStatesCompleteScope, `catalog check ${c.id} is not in the key`);
});

test("scorer, incomplete scope: planted flaws found, the invisible subscription makes the clean checks scope-incomplete", () => {
  const { cwd, runDir, collect } = planAndCollect({});
  assert.equal(collect.code, 0, collect.out);
  assert.deepEqual(statesOf(cwd), KEY.expectedStatesIncompleteScope);
  for (const f of KEY.flaws) {
    const lines = readdirSync(join(runDir, "collected")).filter((n) => n.startsWith(`${f.check}.`) && n.endsWith(".jsonl")).flatMap((n) => jsonl(join(runDir, "collected", n)));
    assert.deepEqual(lines.map((l) => l.id).sort(), f.armIds, f.check);
  }
  assert.equal(statesOf(cwd)[KEY.invisibleSubscription.plantedFlaw.check], "not-verified:scope-incomplete");
  const all = walkFiles(runDir).filter((f) => !f.endsWith("run.json")).map((f) => readFileSync(f, "utf8")).join("\n");
  assert.ok(!all.includes("sql-contoso-hidden"), "nothing of the invisible subscription is read");
});

test("scorer, complete scope: every decoy is clean and every clean check is pass or not-applicable", () => {
  const { cwd, runDir } = planAndCollect({ fixtures: complete() });
  assert.deepEqual(statesOf(cwd), KEY.expectedStatesCompleteScope);
  for (const d of KEY.decoys) {
    const lines = readdirSync(join(runDir, "collected")).filter((n) => n.startsWith(`${d.check}.`)).flatMap((n) => jsonl(join(runDir, "collected", n)));
    assert.ok(!lines.some((l) => l.id === d.armId), `decoy ${d.armId} was flagged by ${d.check}`);
  }
});

test("hostile tag, ESC names and planted secrets never reach any output file or the terminal", () => {
  const fx = complete((d) => {
    // planted at run time: a secret-shaped value in a declared field, an appSettings block and a secret in `properties`
    const f = join(d, "arg", "SE-STG-001.json");
    const j = readJson(f);
    j.violations.pages[0].rows[0].name = `stcontosoprod01 ${fake.awsKey()}`;
    j.violations.pages[0].rows[0].properties = { siteConfig: { appSettings: [{ name: "DB", value: fake.generic() }] }, connectionString: fake.connString() };
    j.violations.pages[0].rows[0].tags = { owner: fake.storageKey() };
    writeJson(f, j);
  });
  const { cwd, runDir, collect, plan } = planAndCollect({ fixtures: fx });
  const outputs = [plan.out, collect.out];
  for (const sub of ["coverage", "questionnaire", "map", "status"]) outputs.push(run([sub, "--run", "r1"], { cwd }).out);
  const files = walkFiles(runDir).map((f) => readFileSync(f, "utf8"));
  const everything = [...files, ...outputs].join("\n");
  for (const bad of [HOSTILE_TAG, "ignore previous instructions", "\u001b", fake.awsKey(), fake.storageKey(), fake.connString(), "appSettings", "FEATURE_FLAG", "placeholder-not-a-secret", "siteConfig"]) assert.ok(!everything.includes(bad), `leaked: ${JSON.stringify(bad)}`);
  assert.ok(!everything.includes(fake.generic().slice(14)), "generic credential value");
  assert.match(files.join("\n"), /\[redacted:aws-access-key\]/);
  assert.match(readFileSync(join(runDir, "collected", "CO-TAG-001.001.jsonl"), "utf8"), /"owner":"tag:[0-9a-f]{8}"/);
  const manifest = readJson(join(runDir, "collected", "manifest.json"));
  assert.ok(manifest.checks["SE-STG-001"].redactions >= 1, "the redaction is counted");
  assert.ok(ESC_NAME.includes("\u001b") && everything.includes("disk-orphan-"), "the ESC name is read, cleaned");
  assert.ok(!JSON.stringify(manifest).includes("properties"));
});

test("the repository scanner finds nothing in any output of a full fixture run", { skip: !hasAssess() && "assessment-report not present" }, async () => {
  const scan = (await import(pathToFileURL(join(ASSESS(), "..", "lib", "secrets.mjs")).href)).scanString;
  const { cwd, runDir } = planAndCollect({});
  for (const sub of ["coverage", "questionnaire", "map"]) run([sub, "--run", "r1"], { cwd });
  for (const f of walkFiles(runDir)) assert.deepEqual(scan(readFileSync(f, "utf8")), [], f);
});

test("no output file is over 1 MiB and none has a carriage return", () => {
  const { cwd, runDir } = planAndCollect({});
  for (const sub of ["coverage", "questionnaire", "map"]) run([sub, "--run", "r1"], { cwd });
  for (const f of walkFiles(runDir)) {
    assert.ok(statSync(f).size <= 1024 * 1024, f);
    if (/\.(jsonl|md|json)$/.test(f)) assert.ok(!readFileSync(f, "utf8").includes("\r"), f);
  }
});

test("a fixture with a Windows (CRLF) checkout reads the same", () => {
  const fx = fixtureCopy();
  for (const f of walkFiles(fx).filter((x) => x.endsWith(".json"))) {
    writeFileSync(f, readFileSync(f, "utf8").replace(/\n/g, "\r\n"));
  }
  const { cwd, runDir } = planAndCollect({ fixtures: fx });
  assert.ok(existsSync(join(runDir, "collected", "manifest.json")));
  assert.ok(!readFileSync(join(runDir, "collected", "SE-STG-001.001.jsonl"), "utf8").includes("\r"));
  assert.equal(statesOf(cwd)["SE-STG-001"], "fail");
});
