// The command line: plan, collect, seal-check, coverage, questionnaire, map, status; folder rules; summaries; strict aliases
// (tasks 1.4, 1.6, 1.7, 1.8; specs "Plan flags", "Fixed catalog", "Summaries for the model", "Sealing, parts and resume",
// "Alias file outside the run folder", "User-only commands" (self-ignoring folder), "Fixtures mode", "Collector engine").
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { ENGINE, FIX, WAF, filesUnder, fixtureCopy, planAndCollect, readJson, readText, run, snapshot, tmp, writeJson } from "./helpers.mjs";

const PILLARS = ["security", "reliability", "cost", "operations", "performance"];

test("--help runs from a clean copy of the engine with nothing installed", () => {
  const dir = tmp("waf-clean-");
  for (const d of ["scripts", "catalog"]) cpSync(join(ENGINE, d), join(dir, d), { recursive: true });
  const r = spawnSync(process.execPath, [join(dir, "scripts", "waf.mjs"), "--help"], { cwd: dir, encoding: "utf8", env: { PATH: process.env.PATH } });
  assert.equal(r.status, 0, r.stderr);
  for (const c of ["plan", "collect", "coverage", "questionnaire", "map", "seal-check", "status"]) assert.match(r.stdout, new RegExp(c));
});

test("no dependency and no network code: only node: built-ins and relative imports", () => {
  const files = [];
  const walk = (d) => { for (const n of readdirSync(d)) { const f = join(d, n); statSync(f).isDirectory() ? walk(f) : f.endsWith(".mjs") && files.push(f); } };
  walk(join(ENGINE, "scripts"));
  assert.ok(files.length >= 8);
  for (const f of files) {
    const t = readText(f);
    for (const m of t.matchAll(/(?:^|\n)\s*(?:import|export)[^"'\n]*from\s+["']([^"']+)["']|import\(["']([^"']+)["']\)/g)) {
      const spec = m[1] ?? m[2];
      assert.ok(spec.startsWith("node:") || spec.startsWith("./") || spec.startsWith("../"), `${f}: ${spec}`);
      assert.ok(!/^node:(http|https|http2|net|tls|dns|dgram|worker_threads)$/.test(spec), `${f}: network module ${spec}`);
    }
    assert.ok(!/\bfetch\s*\(|XMLHttpRequest|WebSocket/.test(t), `${f}: fetch`);
  }
});

test("plan without --fixtures is refused: no consent file can exist before PR 1b", () => {
  const cwd = tmp();
  const r = run(["plan", "--run-id", "r1"], { cwd });
  assert.equal(r.code, 1);
  assert.match(r.out, /consent/i);
  assert.ok(!existsSync(join(cwd, "waf-review", "r1", "run.json")));
  const c = run(["collect", "--run", "r1"], { cwd });
  assert.equal(c.code, 1);
  assert.match(c.out, /consent/i);
});

test("plan writes run.json with the catalog hash, the pillars and the scope, and a self-ignoring folder", () => {
  const cwd = tmp();
  const r = run(["plan", "--run-id", "r1", "--fixtures", FIX, "--pillars", "security,reliability"], { cwd });
  assert.equal(r.code, 0, r.out);
  const runJson = readJson(join(cwd, "waf-review", "r1", "run.json"));
  assert.deepEqual(runJson.pillars, ["security", "reliability"]);
  assert.match(runJson.catalog.sha256, /^[0-9a-f]{64}$/);
  assert.equal(runJson.fixtures, true);
  assert.equal(runJson.redact, "default");
  assert.equal(runJson.queryBudget, 6000);
  assert.equal(readText(join(cwd, "waf-review", ".gitignore")), "*\n");
  assert.equal(runJson.scope.expected, 3);
  assert.equal(runJson.scope.subscriptions.length, 2);
  assert.equal(runJson.scope.visible, 2);
  assert.equal(runJson.scope.complete, false);
});

test("plan --pillars: default is all five, an unknown name exits 2 and lists the valid ones", () => {
  const cwd = tmp();
  assert.equal(run(["plan", "--run-id", "a", "--fixtures", FIX], { cwd }).code, 0);
  assert.deepEqual(readJson(join(cwd, "waf-review", "a", "run.json")).pillars, PILLARS);
  const bad = run(["plan", "--run-id", "b", "--fixtures", FIX, "--pillars", "security,bogus"], { cwd });
  assert.equal(bad.code, 2);
  for (const p of PILLARS) assert.match(bad.out, new RegExp(p));
  assert.ok(!existsSync(join(cwd, "waf-review", "b", "run.json")));
});

test("plan refuses a run id that could leave the folder", () => {
  const cwd = tmp();
  for (const id of ["../x", "a/b", "a\\b", ".hidden", "", "x".repeat(80), "a b"]) assert.equal(run(["plan", "--run-id", id, "--fixtures", FIX], { cwd }).code, 2, id);
});

test("collect --only a pillar runs the checks of that pillar only; --check with an unknown id exits 2 and lists ids", () => {
  const { cwd, plan } = planAndCollect({ collectExtra: ["--pillar", "reliability"] });
  assert.equal(plan.code, 0);
  const m = readJson(join(cwd, "waf-review", "r1", "collected", "manifest.json"));
  assert.ok(Object.keys(m.checks).length >= 4);
  for (const id of Object.keys(m.checks)) assert.match(id, /^RE-/);
  const bad = run(["collect", "--run", "r1", "--fixtures", FIX, "--check", "NOPE-001"], { cwd });
  assert.equal(bad.code, 2);
  assert.match(bad.out, /SE-STG-001/);
});

test("a fixture run produces the same manifest on every run, apart from times", () => {
  const strip = (m) => JSON.parse(JSON.stringify(m, (k, v) => (["startedAt", "finishedAt", "generatedAt"].includes(k) ? undefined : v)));
  const a = planAndCollect({});
  const b = planAndCollect({});
  assert.equal(a.collect.code, 0, a.collect.out);
  assert.deepEqual(strip(readJson(join(a.runDir, "collected", "manifest.json"))), strip(readJson(join(b.runDir, "collected", "manifest.json"))));
  assert.equal(readText(join(a.runDir, "collected", "summary", "security.md")), readText(join(b.runDir, "collected", "summary", "security.md")));
});

test("nothing is written outside waf-review/<run-id>/ (home and working folder snapshots)", () => {
  const cwd = tmp("waf-cwd-");
  const home = tmp("waf-home-");
  const state = tmp("waf-state-");
  const env = { HOME: home, USERPROFILE: home, XDG_STATE_HOME: state, LOCALAPPDATA: state };
  const beforeHome = snapshot(home);
  const beforeState = snapshot(state);
  const { collect } = planAndCollect({ cwd, env });
  assert.equal(collect.code, 0, collect.out);
  for (const sub of ["coverage", "questionnaire", "map", "status", "seal-check"]) assert.ok([0, 1].includes(run([sub, "--run", "r1"], { cwd, env }).code), sub);
  assert.deepEqual(snapshot(home), beforeHome);
  assert.deepEqual(snapshot(state), beforeState);
  const top = readdirSync(cwd).sort();
  assert.deepEqual(top, ["waf-review"]);
  assert.deepEqual(readdirSync(join(cwd, "waf-review")).sort(), [".gitignore", "r1"]);
});

test("the self-ignoring folder leaves git status empty", { skip: spawnSync("git", ["--version"]).status !== 0 && "git not available" }, () => {
  const cwd = tmp("waf-git-");
  assert.equal(spawnSync("git", ["init", "-q"], { cwd }).status, 0);
  const { collect } = planAndCollect({ cwd });
  assert.equal(collect.code, 0);
  const st = spawnSync("git", ["status", "--porcelain", "--untracked-files=all"], { cwd, encoding: "utf8" });
  assert.equal(st.stdout.trim(), "");
});

test("summaries: per check state, counts, WAF ids and at most 10 offenders with line numbers; each pillar at most 6,000 characters", () => {
  const { runDir } = planAndCollect({});
  for (const p of PILLARS) {
    const f = join(runDir, "collected", "summary", `${p}.md`);
    assert.ok(existsSync(f), p);
    assert.ok(readText(f).length <= 6000, `${p} summary is ${readText(f).length}`);
  }
  const sec = readText(join(runDir, "collected", "summary", "security.md"));
  assert.match(sec, /SE-STG-001/);
  assert.match(sec, /fail/);
  assert.match(sec, /SE:06/);
  assert.match(sec, /line 1/i);
  assert.match(sec, /stcontosoprod01/);
});

test("summaries: 5,000 violations list ten and the count, and the pillar summary stays under the limit", () => {
  const fx = fixtureCopy();
  const f = join(fx, "arg", "SE-DEF-002.json");
  const j = readJson(f);
  const rows = Array.from({ length: 5000 }, (_, i) => ({ id: `/subscriptions/00000000-0000-0000-0000-000000000001/providers/Microsoft.Security/assessments/00000000-0000-0000-0000-${String(i).padStart(12, "0")}`, subscriptionId: "00000000-0000-0000-0000-000000000001", displayName: `Recommendation number ${i} with a reasonably long display name`, severity: "Medium" }));
  const pages = [];
  for (let i = 0; i < rows.length; i += 1000) pages.push({ rows: rows.slice(i, i + 1000), ...(i + 1000 < rows.length ? { $skipToken: `p${i / 1000 + 2}` } : {}) });
  j.violations.pages = pages;
  j.evaluated.pages = [{ rows: [{ n: 5200 }] }];
  writeJson(f, j);
  const { runDir } = planAndCollect({ fixtures: fx });
  const s = readText(join(runDir, "collected", "summary", "security.md"));
  assert.ok(s.length <= 6000);
  assert.match(s, /5000/);
  const block = s.split(/\n(?=### )/).find((b) => b.startsWith("### SE-DEF-002"));
  assert.ok(block);
  assert.equal((block.match(/^- offender /gm) ?? []).length, 10);
});

test("seal-check: clean run passes; a one-byte edit of a part, a missing part and an extra part fail", () => {
  const { cwd, runDir } = planAndCollect({});
  assert.equal(run(["seal-check", "--run", "r1"], { cwd }).code, 0);
  const part = join(runDir, "collected", "SE-STG-001.001.jsonl");
  const orig = readFileSync(part);
  const flipped = Buffer.from(orig);
  flipped[flipped.length - 3] ^= 1;
  writeFileSync(part, flipped);
  const r = run(["seal-check", "--run", "r1"], { cwd });
  assert.equal(r.code, 1);
  assert.match(r.out, /SE-STG-001\.001\.jsonl/);
  assert.match(r.out, /hash/i);
  writeFileSync(part, orig);
  assert.equal(run(["seal-check", "--run", "r1"], { cwd }).code, 0);
  writeFileSync(join(runDir, "collected", "SE-STG-001.002.jsonl"), "{}\n");
  const extra = run(["seal-check", "--run", "r1"], { cwd });
  assert.equal(extra.code, 1);
  assert.match(extra.out, /SE-STG-001\.002\.jsonl/);
});

test("seal-check: the manifest catalog hash or a query hash that differs from the shipped catalog fails (library)", async () => {
  const { sealCheck } = await import("../scripts/lib/seal.mjs");
  const { loadCatalog } = await import("../scripts/lib/catalog.mjs");
  const { runDir } = planAndCollect({});
  const cat = loadCatalog();
  assert.deepEqual(sealCheck({ runDir, catalog: cat }).problems, []);
  const changed = structuredClone(cat);
  changed.sha256 = "0".repeat(64);
  assert.match(sealCheck({ runDir, catalog: changed }).problems.join("\n"), /catalog/i);
  const q = structuredClone(cat);
  q.checks.find((c) => c.id === "SE-STG-001").sources.collector.violations += " | where 1 == 1";
  assert.match(sealCheck({ runDir, catalog: q }).problems.join("\n"), /SE-STG-001.*query|query.*SE-STG-001/i);
});

test("the root seal: scope.root of assessment.json must resolve to <run>/collected", () => {
  const { cwd, runDir } = planAndCollect({});
  const forged = join(tmp("waf-forged-"), "collected");
  mkdirSync(forged, { recursive: true });
  writeFileSync(join(forged, "SE-STG-001.001.jsonl"), '{"id":"/subscriptions/x/forged"}\n');
  const assessment = (root) => writeJson(join(runDir, "assessment.json"), { schemaVersion: "1.0", scope: { root }, evidence: [], findings: [] });
  assessment(forged);
  const bad = run(["seal-check", "--run", "r1"], { cwd });
  assert.equal(bad.code, 1);
  assert.ok(bad.out.includes(forged) || bad.out.includes("scope.root"), bad.out);
  assessment(join(runDir, "collected"));
  assert.equal(run(["seal-check", "--run", "r1"], { cwd }).code, 0);
  assessment(join(runDir, "collected", "..", "collected"));
  assert.equal(run(["seal-check", "--run", "r1"], { cwd }).code, 0, "a different spelling of the same folder is the same real path");
  assessment(runDir);
  assert.equal(run(["seal-check", "--run", "r1"], { cwd }).code, 1, "the run folder itself is not the sealed root");
  assessment("relative/collected");
  assert.equal(run(["seal-check", "--run", "r1"], { cwd }).code, 1);
  assessment(join(runDir, "collected") + "/");
  assert.equal(run(["seal-check", "--run", "r1"], { cwd }).code, 0);
});

test("the root seal follows symbolic links to their real path", { skip: process.platform === "win32" && "symlinks need privileges on Windows" }, () => {
  const { cwd, runDir } = planAndCollect({});
  const other = join(tmp("waf-other-"), "elsewhere");
  mkdirSync(other, { recursive: true });
  const link = join(tmp("waf-link-"), "looks-like-collected");
  symlinkSync(other, link);
  writeJson(join(runDir, "assessment.json"), { schemaVersion: "1.0", scope: { root: link }, evidence: [], findings: [] });
  assert.equal(run(["seal-check", "--run", "r1"], { cwd }).code, 1);
  const link2 = join(tmp("waf-link-"), "to-collected");
  symlinkSync(join(runDir, "collected"), link2);
  writeJson(join(runDir, "assessment.json"), { schemaVersion: "1.0", scope: { root: link2 }, evidence: [], findings: [] });
  assert.equal(run(["seal-check", "--run", "r1"], { cwd }).code, 0);
});

test("a malformed assessment.json is refused by seal-check, not crashed on", () => {
  const { cwd, runDir } = planAndCollect({});
  writeFileSync(join(runDir, "assessment.json"), "{not json");
  const r = run(["seal-check", "--run", "r1"], { cwd });
  assert.equal(r.code, 1);
  assert.match(r.out, /assessment\.json/);
});

test("coverage: per pillar counts equal the ones derived from the manifest", () => {
  const { cwd, runDir } = planAndCollect({});
  assert.equal(run(["coverage", "--run", "r1"], { cwd }).code, 0);
  const cov = readJson(join(runDir, "coverage.json"));
  const manifest = readJson(join(runDir, "collected", "manifest.json"));
  const catalog = JSON.parse(JSON.stringify(Object.fromEntries(PILLARS.map((p) => [p, readJson(join(ENGINE, "catalog", `${p}.json`)).checks]))));
  assert.equal(cov.mcp, "not-used");
  for (const p of PILLARS) {
    const cs = catalog[p];
    const states = cs.map((c) => manifest.checks[c.id]);
    const c = cov.pillars[p];
    assert.equal(c.checksInCatalog, cs.length, p);
    assert.equal(c.evaluatedSealed, states.filter((e) => e && ["fail", "pass", "not-applicable"].includes(e.state)).length, p);
    assert.equal(c.answeredMcpOnly, 0);
    assert.equal(c.answeredQuestionnaire, 0);
    const nv = {};
    for (const e of states) if (e?.state === "not-verified") nv[e.reason] = (nv[e.reason] ?? 0) + 1;
    assert.deepEqual(c.notVerified, nv, p);
    assert.equal(c.needsQuestionnaire, states.filter((e) => e?.state === "needs-questionnaire").length, p);
    assert.ok(c.wafIdsTotal > 0 && c.wafIdsCovered >= 0 && c.wafIdsCovered <= c.wafIdsTotal);
  }
  const md = readText(join(runDir, "coverage.md"));
  assert.match(md, /not used/i);
  assert.ok(!/score|compliant|conforme\b/i.test(md), "no score and no 'compliant'");
  assert.match(md, /sample/i, "the sample sentence");
});

test("a nothing-to-evaluate check is never counted as pass", () => {
  const { cwd, runDir } = planAndCollect({ fixtures: (() => { const d = fixtureCopy(); const s = readJson(join(d, "scope.json")); s.containers = s.visible; s.expected = 2; writeJson(join(d, "scope.json"), s); return d; })() });
  const r = run(["status", "--run", "r1", "--json"], { cwd });
  const st = JSON.parse(r.stdout);
  assert.equal(st.checks["PE-ADV-001"], "not-applicable");
  assert.notEqual(st.checks["PE-ADV-001"], "pass");
  assert.equal(st.checks["SE-NET-002"], "pass");
  assert.ok(runDir);
});

test("questionnaire: pt-BR and English text, the five answers, unanswered stays visible", () => {
  const { cwd, runDir } = planAndCollect({});
  assert.equal(run(["questionnaire", "--run", "r1"], { cwd }).code, 0);
  const q = readJson(join(runDir, "questionnaire.json"));
  assert.deepEqual(q.allowedAnswers, ["yes", "partial", "no", "unknown", "not-applicable"]);
  const ids = q.items.map((i) => i.check);
  for (const c of ["SE-Q-001", "RE-Q-001", "OE-Q-001", "PE-Q-001", "CO-RSV-001"]) assert.ok(ids.includes(c) || c === "CO-RSV-001", c);
  for (const i of q.items) { assert.ok(i.text.en && i.text["pt-BR"], i.id); assert.match(i.id, /^Q-/); }
  assert.ok(!ids.includes("SE-STG-001"), "a check answered by the collector has no question");
  // no answers file: needs-questionnaire; with a partial answers file: the rest is unanswered; an answer counts as answered
  let st = JSON.parse(run(["status", "--run", "r1", "--json"], { cwd }).stdout);
  assert.equal(st.checks["SE-Q-001"], "needs-questionnaire");
  writeJson(join(runDir, "questionnaire.answers.json"), { answers: [{ id: q.items.find((i) => i.check === "SE-Q-001").id, answer: "partial", note: "" }] });
  st = JSON.parse(run(["status", "--run", "r1", "--json"], { cwd }).stdout);
  assert.equal(st.checks["SE-Q-001"], "answered");
  assert.equal(st.checks["RE-Q-001"], "not-verified:unanswered");
  writeJson(join(runDir, "questionnaire.answers.json"), { answers: [{ id: q.items[0].id, answer: "maybe" }] });
  const bad = run(["status", "--run", "r1", "--json"], { cwd });
  assert.equal(bad.code, 1);
  assert.match(bad.out, /answer/i);
});

test("--redact strict: aliases in every output, the alias map outside the run folder and never in a summary", () => {
  const state = tmp("waf-state-");
  const env = { XDG_STATE_HOME: state, LOCALAPPDATA: state, HOME: state, USERPROFILE: state };
  const { cwd, runDir, collect } = planAndCollect({ env, extra: ["--redact", "strict"] });
  assert.equal(collect.code, 0, collect.out);
  const text = filesUnder(runDir).filter((f) => f !== "run.json").map((f) => Buffer.from(snapshot(runDir)[f], "base64").toString("utf8")).join("\n");
  // run.json keeps the subscription ids the collector needs to query (it is not read by the model); names and ids in every other file are aliases
  for (const name of ["stcontosoprod01", "sub-prod", "rg-data", "00000000-0000-0000-0000-000000000001", "vm-web-02"]) assert.ok(!text.includes(name), `${name} leaked into the run folder`);
  assert.match(readText(join(runDir, "collected", "summary", "security.md")), /sub-01/);
  const aliasFile = join(state, "waf-review", "r1", "aliases.json");
  assert.ok(existsSync(aliasFile));
  assert.ok(Object.values(readJson(aliasFile)).flatMap((m) => Object.keys(m)).some((k) => k.includes("stcontosoprod01")));
  assert.ok(!filesUnder(runDir).some((f) => /alias/i.test(f)), "no alias file under the run folder");
  if (process.platform !== "win32") {
    assert.equal(statSync(aliasFile).mode & 0o777, 0o600);
    assert.equal(statSync(dirname(aliasFile)).mode & 0o777, 0o700);
  }
  assert.ok(cwd);
});

test("a disabled, warned or past-due subscription, or one missing from a list, makes the scope incomplete and is named", () => {
  for (const state of ["Disabled", "Warned", "PastDue"]) {
    const fx = fixtureCopy();
    const s = readJson(join(fx, "scope.json"));
    s.containers = s.visible; s.expected = 2;
    writeJson(join(fx, "scope.json"), s);
    const l = readJson(join(fx, "az", "account-list.json"));
    l[1].state = state;
    writeJson(join(fx, "az", "account-list.json"), l);
    const cwd = tmp();
    const r = run(["plan", "--run-id", "r1", "--fixtures", fx], { cwd });
    assert.equal(r.code, 0, r.out);
    const j = readJson(join(cwd, "waf-review", "r1", "run.json"));
    assert.equal(j.scope.complete, false, state);
    assert.ok(j.scope.notCovered.some((x) => x.state === state && x.id === l[1].id), state);
    assert.match(r.out, new RegExp(state));
  }
  const fx = fixtureCopy();
  const s = readJson(join(fx, "scope.json"));
  s.containers = s.visible; s.expected = 2;
  writeJson(join(fx, "scope.json"), s);
  const cwd = tmp();
  assert.equal(run(["plan", "--run-id", "ok", "--fixtures", fx], { cwd }).code, 0);
  assert.equal(readJson(join(cwd, "waf-review", "ok", "run.json")).scope.complete, true);
});

test("the typed count alone does not hide a subscription missing from resourcecontainers", () => {
  const fx = fixtureCopy();
  const s = readJson(join(fx, "scope.json"));
  s.expected = 2; // the user typed 2 and 2 are readable, but the management group holds 3
  writeJson(join(fx, "scope.json"), s);
  const cwd = tmp();
  const r = run(["plan", "--run-id", "r1", "--fixtures", fx], { cwd });
  assert.equal(r.code, 0);
  const j = readJson(join(cwd, "waf-review", "r1", "run.json"));
  assert.equal(j.scope.complete, false);
  assert.ok(j.scope.notCovered.some((x) => x.id === s.containers[2]));
});
