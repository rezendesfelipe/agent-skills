import assert from "node:assert/strict";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { NEXT, NODES } from "../scripts/lib/graph.mjs";
import { edit, file, finding, rationale, readJson, repoCopy, run, snapshot, startRun, tmp } from "./helpers.mjs";

const TLS = file("E-001", "infra/main.tf", 11, 11, '  min_tls_version          = "TLS1_0"');
const addFinding = (out) =>
  edit(out, (a) => {
    a.evidence.push(TLS);
    a.findings.push(finding("F-001", ["E-001"], { impact: "high", likelihood: "likely", effort: "S", rationale }));
  });

test("the graph declares every node of the design and only edges between known nodes", () => {
  const expected = ["scope", "inventory", "investigate", "verify", "repair", "demote", "classify", "roadmap", "roadmap-check", "consistency", "narrate", "review", "render", "delegate", "finish"];
  assert.deepEqual(Object.keys(NODES), expected);
  for (const [from, tos] of Object.entries(NEXT)) {
    assert.ok(from in NODES, from);
    for (const to of tos) assert.ok(to in NODES, `${from} -> ${to}`);
  }
});

test("init needs --model, accepts unknown, and refuses to overwrite", () => {
  const repo = repoCopy();
  const out = join(tmp(), "out");
  let r = run(["init", "--out", out, "--root", repo]);
  assert.equal(r.code, 2);
  assert.match(r.out, /--model/);
  assert.ok(!existsSync(out), "nothing written");
  r = run(["init", "--out", out, "--root", repo, "--model", "unknown"]);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /model unknown|the model is unknown/i);
  r = run(["init", "--out", out, "--root", repo, "--model", "unknown"]);
  assert.equal(r.code, 1);
  assert.match(r.out, /never overwrites/);
});

test("init leaves unknown values as placeholders and lists them; it never uses the machine's user", () => {
  const repo = repoCopy();
  const out = join(tmp(), "out");
  const r = run(["init", "--out", out, "--root", repo, "--model", "m"]);
  assert.equal(r.code, 0, r.out);
  const a = readJson(join(out, "assessment.json"));
  for (const k of ["title", "client", "author", "version", "date"]) assert.match(a.meta[k], /^\[REPLACE: /);
  assert.match(r.out, /Placeholders to replace before check: title, client, author, version, date/);
  assert.ok(!JSON.stringify(a).includes(process.env.USER ?? "\u0000none"), "no machine user name");
});

test("--out inside .git or equal to the assessed folder is a usage error and writes nothing", () => {
  const repo = repoCopy();
  const git = join(repo, ".git");
  mkdirSync(git);
  let r = run(["init", "--out", join(git, "report"), "--root", repo, "--model", "m"]);
  assert.equal(r.code, 2);
  assert.deepEqual(readdirSync(git), []);
  r = run(["init", "--out", repo, "--root", repo, "--model", "m"]);
  assert.equal(r.code, 2);
});

test("status prints the current node and the allowed next nodes", () => {
  const { out } = startRun();
  let r = run(["status", "--out", out]);
  assert.match(r.out, /Current node: investigate/);
  assert.match(r.out, /Allowed next: verify/);
  r = run(["status", "--out", out, "--json"]);
  const s = JSON.parse(r.stdout);
  assert.equal(s.current, "investigate");
  assert.deepEqual(s.next.map((n) => n.node), ["verify"]);
});

test("a command out of order exits 1 and names what must run first", () => {
  const { out } = startRun();
  let r = run(["classify", "--out", out]);
  assert.equal(r.code, 1);
  assert.match(r.out, /out of order/i);
  assert.match(r.out, /verify/);
  r = run(["render", "--out", out]);
  assert.equal(r.code, 1);
  assert.match(r.out, /investigate/);
  r = run(["check", "--out", out]);
  assert.equal(r.code, 1);
  r = run(["review", "--out", out]);
  assert.equal(r.code, 1);
  assert.equal(run(["status", "--out", out, "--json"]).stdout.includes('"current": "investigate"'), true, "state unchanged by refusals");
});

test("render before review is refused and names review", () => {
  const { out } = startRun();
  addFinding(out);
  assert.equal(run(["verify", "--out", out]).code, 0);
  assert.equal(run(["classify", "--out", out]).code, 0);
  edit(out, (a) => a.actions.push({ id: "A-001", title: "Raise TLS", addresses: ["F-001"], wave: 1, effort: "S", risk: "low", dependsOn: [] }));
  assert.equal(run(["check", "--out", out]).code, 0);
  edit(out, (a) => (a.summary = "We found {{count.findings}} finding."));
  const r = run(["render", "--out", out]);
  assert.equal(r.code, 1);
  assert.match(r.out, /not approved|review/);
});

test("editing a finding after verify refuses classify, check and render, and returns the flow to verify", () => {
  const { out } = startRun();
  addFinding(out);
  assert.equal(run(["verify", "--out", out]).code, 0);
  edit(out, (a) => (a.findings[0].statement = "A different claim."));
  let r = run(["classify", "--out", out]);
  assert.equal(r.code, 1);
  assert.match(r.out, /changed since the last successful verify/);
  assert.match(r.out, /back at "verify"/);
  assert.equal(readJson(join(out, ".state", "run.json")).current, "verify");
  r = run(["render", "--out", out]);
  assert.equal(r.code, 1);
  r = run(["check", "--out", out]);
  assert.equal(r.code, 1);
  assert.equal(run(["verify", "--out", out]).code, 0, "verify is allowed again");
});

test("editing impact after check refuses review approval and render until check runs again", () => {
  const { out } = startRun();
  addFinding(out);
  run(["verify", "--out", out]);
  run(["classify", "--out", out]);
  edit(out, (a) => a.actions.push({ id: "A-001", title: "Raise TLS", addresses: ["F-001"], wave: 1, effort: "S", risk: "low", dependsOn: [] }));
  assert.equal(run(["check", "--out", out]).code, 0);
  edit(out, (a) => {
    a.summary = "Summary.";
    a.findings[0].effort = "L";
  });
  const r = run(["review", "--approve", "--by", "Ana", "--out", out]);
  assert.equal(r.code, 1);
  assert.match(r.out, /Run check first/);
});

test("the engine writes nothing outside --out (assessed folder and other folders unchanged)", () => {
  const repo = repoCopy();
  const other = tmp("other-");
  const beforeRepo = snapshot(repo);
  const beforeOther = snapshot(other);
  const out = join(tmp(), "out");
  const base = ["--out", out];
  assert.equal(run(["init", ...base, "--root", repo, "--model", "m", "--client", "C", "--title", "T", "--author", "A", "--version", "1", "--date", "2026-11-20"]).code, 0);
  assert.equal(run(["inventory", ...base]).code, 0);
  addFinding(out);
  assert.equal(run(["verify", ...base]).code, 0);
  assert.equal(run(["classify", ...base]).code, 0);
  assert.deepEqual(snapshot(repo), beforeRepo);
  assert.deepEqual(snapshot(other), beforeOther);
});

test("with --out inside the assessed folder, only the output folder changes", () => {
  const repo = repoCopy();
  const before = snapshot(repo);
  const out = join(repo, "assessment-report");
  assert.equal(run(["init", "--out", out, "--root", repo, "--model", "m"]).code, 0);
  assert.equal(run(["inventory", "--out", out]).code, 0);
  const after = snapshot(repo);
  const changed = Object.keys(after).filter((k) => before[k] !== after[k]);
  assert.ok(changed.length > 0 && changed.every((k) => k.startsWith("assessment-report")), changed.join(", "));
  const inv = readJson(join(out, "inventory.json"));
  assert.ok(!inv.files.some((f) => f.path.startsWith("assessment-report/")), "the output folder is not inventoried");
});
