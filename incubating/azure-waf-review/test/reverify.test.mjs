// PR 1b, task 1.10: `reverify` (the user re-runs one catalog query and compares it with the sealed lines), `purge`, the typed
// confirmations and the terminal rule. Written before the implementation. The transport is the fixture transport or a stub:
// no network, no login. These tests prove the comparison semantics the spec defines, not the shape of a real Resource Graph answer.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { join } from "node:path";
import { test } from "node:test";
import { loadCatalog } from "../scripts/lib/catalog.mjs";
import { createFixtureTransport } from "../scripts/lib/transport.mjs";
import { completeFixture, doReverify, scriptedIo } from "./prod-helpers.mjs";
import { jsonl, planAndCollect, readJson, run, tmp, writeJson } from "./helpers.mjs";

const posix = process.platform !== "win32";
const lib = () => import("../scripts/lib/reverify.mjs");
const setup = () => { const fx = completeFixture(); const r = planAndCollect({ fixtures: fx }); return { ...r, fx }; };
const rev = (runDir, check) => readJson(join(runDir, "reverify", `${check}.json`));
const STG2 = ["/subscriptions/00000000-0000-0000-0000-000000000001/resourceGroups/rg-data/providers/Microsoft.Storage/storageAccounts/stcontosoprod01", "/subscriptions/00000000-0000-0000-0000-000000000002/resourceGroups/rg-np/providers/Microsoft.Storage/storageAccounts/stcontosonp02"];

test("reverify without --resource: match when every sealed offender is still returned with equal fields; the file records state, scope, ids, part hashes and the UTC time", async () => {
  const { runDir, fx } = setup();
  const r = await doReverify({ runDir, fx, check: "SE-STG-002" });
  assert.equal(r.state, "match");
  const j = rev(runDir, "SE-STG-002");
  assert.equal(j.schema, "waf-reverify/1");
  assert.equal(j.state, "match");
  assert.equal(j.scope, "check");
  assert.equal(j.checkId, "SE-STG-002");
  assert.equal(j.runId, "r1");
  assert.deepEqual([...j.covered].sort(), [...STG2].sort());
  const m = readJson(join(runDir, "collected", "manifest.json")).checks["SE-STG-002"];
  assert.deepEqual(j.parts, m.parts.map((p) => ({ name: p.name, sha256: p.sha256 })));
  assert.equal(j.catalogSha256, m.catalogSha256);
  assert.deepEqual(j.querySha256, m.querySha256);
  assert.equal(j.at, "2026-11-25T13:00:00.000Z");
});

test("changed: an offender whose projected field differs; gone: an offender no longer returned; both refuse a Critical", async () => {
  const a = setup();
  const f = join(a.fx, "arg", "SE-STG-002.json");
  const j = readJson(f);
  j.violations.pages[0].rows[0].minimumTls = "TLS1_2";
  const k = Object.keys(j.violations.pages[0].rows[0]).find((x) => /tls/i.test(x));
  j.violations.pages[0].rows[0][k] = "CHANGED";
  writeJson(f, j);
  assert.equal((await doReverify({ runDir: a.runDir, fx: a.fx, check: "SE-STG-002" })).state, "changed");
  const b = setup();
  const g = join(b.fx, "arg", "SE-STG-002.json");
  const jj = readJson(g);
  jj.violations.pages[0].rows.shift();
  writeJson(g, jj);
  assert.equal((await doReverify({ runDir: b.runDir, fx: b.fx, check: "SE-STG-002" })).state, "gone");
  assert.equal(rev(b.runDir, "SE-STG-002").state, "gone");
});

test("a new offender that was not sealed does not break a match (the sealed lines are what is compared)", async () => {
  const { runDir, fx } = setup();
  const f = join(fx, "arg", "SE-STG-002.json");
  const j = readJson(f);
  j.violations.pages[0].rows.push({ ...j.violations.pages[0].rows[0], id: `${STG2[0]}-new`, name: "new" });
  writeJson(f, j);
  const r = await doReverify({ runDir, fx, check: "SE-STG-002" });
  assert.equal(r.state, "match");
  assert.equal(rev(runDir, "SE-STG-002").newOffenders, 1);
});

test("a 403 or a failure is state error with the class only, never a body or a name; the latest result replaces the older one", async () => {
  const { runDir, fx } = setup();
  assert.equal((await doReverify({ runDir, fx, check: "SE-STG-002" })).state, "match");
  const { reverifyCheck } = await lib();
  const denied = { kind: "t", resourceGraph: async () => ({ status: 403, errorClass: "no-permission", body: { error: "secret-name-in-body stcontosoprod01" } }), restGet: async () => ({ status: 403 }), azRead: async () => ({ status: 403 }) };
  const r = await reverifyCheck({ runDir, catalog: loadCatalog(), transport: denied, checkId: "SE-STG-002", resources: [], sleep: async () => {}, now: () => "2026-11-25T14:00:00.000Z" });
  assert.equal(r.state, "error");
  const j = rev(runDir, "SE-STG-002");
  assert.equal(j.state, "error");
  assert.equal(j.error.class, "no-permission");
  assert.ok(!JSON.stringify(j).includes("secret-name-in-body"));
});

test("--resource: match when it covers every sealed offender, partial when it covers some, changed/gone when a covered one differs", async () => {
  const { runDir, fx } = setup();
  const one = await doReverify({ runDir, fx, check: "SE-STG-002", resource: STG2[0] });
  assert.equal(one.state, "partial");
  const j = rev(runDir, "SE-STG-002");
  assert.equal(j.scope, "resource");
  assert.deepEqual(j.covered, [STG2[0]]);
  assert.deepEqual(j.resources, [{ id: STG2[0], state: "match" }]);
  const both = await doReverify({ runDir, fx, check: "SE-STG-002", resource: STG2 });
  assert.equal(both.state, "match");
  assert.equal(rev(runDir, "SE-STG-002").scope, "resource");
});

test("--resource must be an offender of the sealed check and a plain ARM id", async () => {
  const { runDir, fx } = setup();
  const { UsageError } = await import("../scripts/lib/util.mjs");
  for (const bad of ["/subscriptions/00000000-0000-0000-0000-000000000009/resourceGroups/x/providers/a/b/c", "stcontosoprod01", "", `${STG2[0]}\u001b[2J`, `${STG2[0]}\n/x`, "x".repeat(900), "../etc/passwd"]) {
    await assert.rejects(doReverify({ runDir, fx, check: "SE-STG-002", resource: bad }), (e) => e instanceof UsageError, JSON.stringify(bad).slice(0, 40));
  }
  assert.ok(!existsSync(join(runDir, "reverify", "SE-STG-002.json")));
});

test("reverify refuses what it cannot compare: a check that did not fail, an unknown check, a part edited since collect, a changed catalog", async () => {
  const { runDir, fx } = setup();
  const { UsageError } = await import("../scripts/lib/util.mjs");
  await assert.rejects(doReverify({ runDir, fx, check: "SE-NET-002" }), /did not fail|nothing to reverify/i);
  await assert.rejects(doReverify({ runDir, fx, check: "NOPE-001" }), (e) => e instanceof UsageError);
  const part = join(runDir, "collected", "SE-STG-002.001.jsonl");
  writeFileSync(part, readFileSync(part, "utf8").replace("stcontosoprod01", "stcontosoprod0x"));
  await assert.rejects(doReverify({ runDir, fx, check: "SE-STG-002" }), /seal-check|hash/i);
  assert.ok(!existsSync(join(runDir, "reverify", "SE-STG-002.json")));
});

test("reverify never writes outside reverify/ and never touches collected/", async () => {
  const { runDir, fx, cwd } = setup();
  const before = readdirSync(join(runDir, "collected")).sort();
  const manifest = readFileSync(join(runDir, "collected", "manifest.json"));
  await doReverify({ runDir, fx, check: "SE-STG-002" });
  assert.deepEqual(readdirSync(join(runDir, "collected")).sort(), before);
  assert.deepEqual(readFileSync(join(runDir, "collected", "manifest.json")), manifest);
  assert.deepEqual(readdirSync(join(runDir, "reverify")), ["SE-STG-002.json"]);
  void cwd;
});

test("reverify of a rest-get check re-reads the subscriptions and compares", async () => {
  const { runDir, fx } = setup();
  const m = readJson(join(runDir, "collected", "manifest.json")).checks["OE-LOCK-001"];
  if (m.state !== "fail") return;
  const r = await doReverify({ runDir, fx, check: "OE-LOCK-001" });
  assert.equal(r.state, "match");
  void createFixtureTransport;
});

// ------------------------------------------------------------------------------------------------ terminal rule (reverify, purge)
test("reverify and purge refuse to run without a terminal (an agent cannot release its own Critical)", () => {
  const { cwd } = setup();
  const a = run(["reverify", "--run", "r1", "--check", "SE-STG-002"], { cwd, input: "r1\n" });
  assert.equal(a.code, 2, a.out);
  assert.match(a.out, /terminal|TTY/i);
  assert.ok(!existsSync(join(cwd, "waf-review", "r1", "reverify")));
  const b = run(["purge", "--run", "r1"], { cwd, input: "r1\n" });
  assert.equal(b.code, 2, b.out);
  assert.ok(existsSync(join(cwd, "waf-review", "r1", "run.json")), "nothing was deleted");
  assert.equal(run(["reverify", "--run", "r1"], { cwd }).code, 2, "--check is required");
});

// ------------------------------------------------------------------------------------------------ purge
const purgeLib = () => import("../scripts/lib/purge.mjs");
function purgeSetup() {
  const { cwd, runDir } = setup();
  const state = tmp("waf-state-");
  mkdirSync(join(state, "waf-review", "r1"), { recursive: true });
  writeFileSync(join(state, "waf-review", "r1", "aliases.json"), "{}");
  mkdirSync(join(cwd, "waf-review", "other"), { recursive: true });
  writeFileSync(join(cwd, "waf-review", "other", "run.json"), "{}");
  return { cwd, runDir, state };
}

test("purge asks for the run id typed exactly, then deletes the run folder and its alias folder and nothing else", async () => {
  const { purgeRun } = await purgeLib();
  const { cwd, runDir, state } = purgeSetup();
  const wrong = await purgeRun({ cwd, runId: "r1", stateBase: join(state, "waf-review"), io: scriptedIo(["R1"]) });
  assert.equal(wrong.ok, false);
  assert.ok(existsSync(runDir));
  for (const bad of ["r1 ", " r1", "r1​", ""]) assert.equal((await purgeRun({ cwd, runId: "r1", stateBase: join(state, "waf-review"), io: scriptedIo([bad]) })).ok, false, JSON.stringify(bad));
  const ok = await purgeRun({ cwd, runId: "r1", stateBase: join(state, "waf-review"), io: scriptedIo(["r1"]) });
  assert.equal(ok.ok, true, ok.message);
  assert.ok(!existsSync(runDir));
  assert.ok(!existsSync(join(state, "waf-review", "r1")));
  assert.ok(existsSync(join(cwd, "waf-review", "other", "run.json")), "another run is untouched");
  assert.ok(existsSync(join(cwd, "waf-review", ".gitignore")));
});

test("purge refuses a folder that is not a run, a run id that could leave the folder, and a run folder that is a symbolic link", { skip: !posix && "symlinks need privileges on Windows" }, async () => {
  const { purgeRun } = await purgeLib();
  const { cwd, state } = purgeSetup();
  mkdirSync(join(cwd, "waf-review", "notarun"));
  writeFileSync(join(cwd, "waf-review", "notarun", "precious.txt"), "x");
  assert.equal((await purgeRun({ cwd, runId: "notarun", stateBase: state, io: scriptedIo(["notarun"]) })).ok, false);
  assert.ok(existsSync(join(cwd, "waf-review", "notarun", "precious.txt")));
  for (const id of ["../x", "a/b", "..", ".", ""]) await assert.rejects(purgeRun({ cwd, runId: id, stateBase: state, io: scriptedIo([id]) }), /run id|--run/i);
  const victim = tmp("waf-victim-");
  writeFileSync(join(victim, "keep.txt"), "x");
  symlinkSync(victim, join(cwd, "waf-review", "linked"));
  assert.equal((await purgeRun({ cwd, runId: "linked", stateBase: state, io: scriptedIo(["linked"]) })).ok, false);
  assert.ok(existsSync(join(victim, "keep.txt")));
});

test("purge does not follow a symbolic link inside the run folder: the link goes, its target stays", { skip: !posix && "symlinks need privileges on Windows" }, async () => {
  const { purgeRun } = await purgeLib();
  const { cwd, runDir, state } = purgeSetup();
  const victim = tmp("waf-victim-");
  writeFileSync(join(victim, "keep.txt"), "x");
  symlinkSync(victim, join(runDir, "collected", "link"));
  const r = await purgeRun({ cwd, runId: "r1", stateBase: join(state, "waf-review"), io: scriptedIo(["r1"]) });
  assert.equal(r.ok, true, r.message);
  assert.ok(existsSync(join(victim, "keep.txt")));
});

test("purge of transcripts: only a folder inside .claude/projects, typed by name, never the home folder, a symbolic link or a parent", async () => {
  const { purgeRun } = await purgeLib();
  const { cwd, state } = purgeSetup();
  const home = tmp("waf-home-");
  const proj = join(home, ".claude", "projects", "-home-audit-work");
  mkdirSync(proj, { recursive: true });
  writeFileSync(join(proj, "t.jsonl"), "x");
  for (const bad of [home, join(home, ".claude"), "/", cwd, tmp("waf-else-")]) {
    const r = await purgeRun({ cwd, runId: "r1", stateBase: join(state, "waf-review"), transcripts: bad, home, io: scriptedIo(["r1", "whatever"]) });
    assert.equal(r.ok, false, bad);
  }
  assert.ok(existsSync(join(proj, "t.jsonl")));
  const wrongName = await purgeRun({ cwd, runId: "r1", stateBase: join(state, "waf-review"), transcripts: proj, home, io: scriptedIo(["r1", "wrong"]) });
  assert.equal(wrongName.ok, false);
  assert.ok(existsSync(join(proj, "t.jsonl")));
  const ok = await purgeRun({ cwd, runId: "r1", stateBase: join(state, "waf-review"), transcripts: proj, home, io: scriptedIo(["r1", "-home-audit-work"]) });
  assert.equal(ok.ok, true, ok.message);
  assert.ok(!existsSync(join(proj, "t.jsonl")));
  assert.ok(existsSync(join(home, ".claude", "projects")), "the projects folder itself stays");
  void jsonl;
});

// ------------------------------------------------------------------------------------------------ purge, each rule proved alone (disposable folders only)
test("purge: a transcript folder outside <home>/.claude/projects is refused even when its name is typed right (every folder here is a disposable tmp folder)", async () => {
  const { purgeRun } = await purgeLib();
  const { cwd, state } = purgeSetup();
  const home = tmp("waf-home-");
  mkdirSync(join(home, ".claude", "projects", "p1"), { recursive: true });
  const outside = [tmp("waf-else-"), join(home, ".claude"), home, tmp("waf-else2-")];
  for (const dir of outside) {
    writeFileSync(join(dir, "keep.txt"), "x");
    const r = await purgeRun({ cwd, runId: "r1", stateBase: join(state, "waf-review"), transcripts: dir, home, io: scriptedIo(["r1", basename(dir)]) });
    assert.equal(r.ok, false, dir);
    assert.match(r.message, /not inside/);
    assert.ok(existsSync(join(dir, "keep.txt")), "nothing was deleted");
  }
  assert.ok(existsSync(join(cwd, "waf-review", "r1", "run.json")), "the run was not deleted either: everything is validated before the first deletion");
});

test("purge: the projects folder itself is refused; only the folder of one project is accepted", async () => {
  const { purgeRun } = await purgeLib();
  const { cwd, state } = purgeSetup();
  const home = tmp("waf-home-");
  const projects = join(home, ".claude", "projects");
  mkdirSync(join(projects, "p1"), { recursive: true });
  writeFileSync(join(projects, "p1", "t.jsonl"), "x");
  writeFileSync(join(projects, "other.txt"), "x");
  const r = await purgeRun({ cwd, runId: "r1", stateBase: join(state, "waf-review"), transcripts: projects, home, io: scriptedIo(["r1", "projects"]) });
  assert.equal(r.ok, false);
  assert.match(r.message, /project|root|itself/i);
  assert.ok(existsSync(join(projects, "p1", "t.jsonl")) && existsSync(join(projects, "other.txt")));
  assert.ok(existsSync(join(cwd, "waf-review", "r1", "run.json")));
  const ok = await purgeRun({ cwd, runId: "r1", stateBase: join(state, "waf-review"), transcripts: join(projects, "p1"), home, io: scriptedIo(["r1", "p1"]) });
  assert.equal(ok.ok, true, ok.message);
  assert.ok(!existsSync(join(projects, "p1")) && existsSync(join(projects, "other.txt")));
});

test("purge: a run folder that is a symbolic link to ANOTHER real run inside waf-review/ is refused as a link (the other checks would accept it)", { skip: !posix && "symlinks need privileges on Windows" }, async () => {
  const { purgeRun } = await purgeLib();
  const { cwd, state } = purgeSetup();
  symlinkSync(join(cwd, "waf-review", "other"), join(cwd, "waf-review", "linked"));
  const r = await purgeRun({ cwd, runId: "linked", stateBase: join(state, "waf-review"), io: scriptedIo(["linked"]) });
  assert.equal(r.ok, false);
  assert.match(r.message, /symbolic link/);
  assert.ok(existsSync(join(cwd, "waf-review", "other", "run.json")));
});
