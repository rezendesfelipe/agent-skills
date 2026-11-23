import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(new URL("../scripts/delivery-check.mjs", import.meta.url));
const GIT = ["-c", "user.name=test", "-c", "user.email=test@example.com", "-c", "commit.gpgsign=false"];

function git(root, ...args) {
  return execFileSync("git", [...GIT, ...args], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function write(root, path, content) {
  const file = join(root, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
}

// A temporary git repository whose `main` branch has one commit, checked out on `claude/add-x`.
function repo() {
  const root = mkdtempSync(join(tmpdir(), "delivery-check-"));
  git(root, "init", "-q", "-b", "main");
  write(root, "README.md", "readme\n");
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "init");
  git(root, "checkout", "-q", "-b", "claude/add-x");
  return root;
}

function commitAll(root) {
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "change");
}

function run(root, ...args) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args, "--root", root], { encoding: "utf8" });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

function cleanup(root) {
  rmSync(root, { recursive: true, force: true });
}

test("--help lists the three subcommands", () => {
  const r = spawnSync(process.execPath, [SCRIPT, "--help"], { encoding: "utf8" });
  assert.equal(r.status, 0);
  for (const sub of ["scope", "tasks", "evidence"]) assert.match(r.stdout, new RegExp(`delivery-check ${sub} `));
});

test("an unknown subcommand exits 2", () => {
  assert.equal(spawnSync(process.execPath, [SCRIPT, "nope", "x"], { encoding: "utf8" }).status, 2);
});

// ---- Human gate 1 before implementation, and Roles and permissions: the scope check ----

test("scope passes when a proposal changes only its own folder", () => {
  const root = repo();
  write(root, "openspec/changes/add-x/proposal.md", "p\n");
  commitAll(root);
  const r = run(root, "scope", "add-x", "--base", "main");
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /scope ok/);
  cleanup(root);
});

test("scope fails and lists a committed path outside the change folder (no gate 1 approval)", () => {
  const root = repo();
  write(root, "openspec/changes/add-x/proposal.md", "p\n");
  write(root, "src/code.mjs", "x\n");
  commitAll(root);
  const r = run(root, "scope", "add-x", "--base", "main");
  assert.equal(r.code, 1);
  assert.match(r.out, /src\/code\.mjs/);
  assert.doesNotMatch(r.out, /proposal\.md/);
  cleanup(root);
});

test("scope fails for an author's file that is not committed yet, and for a proposal that edits package.json", () => {
  const root = repo();
  write(root, "openspec/changes/add-x/proposal.md", "p\n");
  commitAll(root);
  write(root, "package.json", "{}\n");
  const r = run(root, "scope", "add-x", "--base", "main");
  assert.equal(r.code, 1);
  assert.match(r.out, /package\.json/);
  cleanup(root);
});

test("scope fails for a path in another change's folder", () => {
  const root = repo();
  write(root, "openspec/changes/other/proposal.md", "p\n");
  commitAll(root);
  const r = run(root, "scope", "add-x", "--base", "main");
  assert.equal(r.code, 1);
  assert.match(r.out, /openspec\/changes\/other\/proposal\.md/);
  cleanup(root);
});

test("scope passes with --approved after gate 1 is recorded, even outside the folder", () => {
  const root = repo();
  write(root, "src/code.mjs", "x\n");
  commitAll(root);
  const r = run(root, "scope", "add-x", "--base", "main", "--approved");
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /gate 1 is recorded/);
  cleanup(root);
});

test("scope fails when the base cannot be found", () => {
  const root = repo();
  const r = run(root, "scope", "add-x", "--base", "does-not-exist");
  assert.equal(r.code, 1);
  assert.match(r.out, /cannot find the base/);
  cleanup(root);
});

test("scope rejects a change name that could escape the folder", () => {
  const root = repo();
  assert.equal(run(root, "scope", "../x", "--base", "main").code, 1);
  cleanup(root);
});

// ---- tasks ----

test("tasks passes when every task is ticked", () => {
  const root = repo();
  write(root, "openspec/changes/add-x/tasks.md", "## 1. A\n\n- [x] 1.1 one\n- [X] 1.2 two\n");
  const r = run(root, "tasks", "add-x");
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /2 task\(s\) ticked/);
  cleanup(root);
});

test("tasks fails and names the first unticked task with its line", () => {
  const root = repo();
  write(root, "openspec/changes/add-x/tasks.md", "## 1. A\n\n- [x] 1.1 one\n- [ ] 1.2 second\n- [ ] 1.3 third\n");
  const r = run(root, "tasks", "add-x");
  assert.equal(r.code, 1);
  assert.match(r.out, /tasks\.md:4/);
  assert.match(r.out, /1\.2 second/);
  assert.doesNotMatch(r.out, /1\.3 third/);
  cleanup(root);
});

test("tasks fails when tasks.md is missing", () => {
  const root = repo();
  assert.equal(run(root, "tasks", "add-x").code, 1);
  cleanup(root);
});

// ---- Verifier node for findings: the evidence check ----

test("evidence passes a finding whose file has at least that many lines", () => {
  const root = repo();
  write(root, "infra/main.tf", Array.from({ length: 120 }, (_, i) => `line ${i + 1}`).join("\n") + "\n");
  write(root, "report.md", "- Local state is used - infra/main.tf:42\n");
  const r = run(root, "evidence", "report.md");
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /1 reference/);
  cleanup(root);
});

test("evidence rejects a finding that cites line 900 of a 120-line file", () => {
  const root = repo();
  write(root, "infra/main.tf", Array.from({ length: 120 }, (_, i) => `line ${i + 1}`).join("\n") + "\n");
  write(root, "report.md", "- Bad finding - infra/main.tf:900\n");
  const r = run(root, "evidence", "report.md");
  assert.equal(r.code, 1);
  assert.match(r.out, /infra\/main\.tf:900/);
  assert.match(r.out, /120 line/);
  cleanup(root);
});

test("evidence rejects a nonexistent file and a path that leaves the root", () => {
  const root = repo();
  write(root, "report.md", "- a - nope/missing.tf:3\n- b - ../outside.txt:1\n");
  const r = run(root, "evidence", "report.md");
  assert.equal(r.code, 1);
  assert.match(r.out, /file does not exist/);
  assert.match(r.out, /outside the root/);
  cleanup(root);
});

test("evidence accepts a line range and rejects a range past the end", () => {
  const root = repo();
  write(root, "a.txt", "1\n2\n3\n");
  write(root, "ok.md", "see a.txt:1-3\n");
  write(root, "bad.md", "see a.txt:2-9\n");
  assert.equal(run(root, "evidence", "ok.md").code, 0);
  assert.equal(run(root, "evidence", "bad.md").code, 1);
  cleanup(root);
});

test("evidence reports 'not verified' lines and sections without failing", () => {
  const root = repo();
  write(root, "a.txt", "1\n");
  write(root, "report.md", ["- ok a.txt:1", "- claim x gone.tf:7 (not verified)", "", "## Not verified", "- claim y gone.tf:9", "", "## Findings", "- fine a.txt:1", ""].join("\n"));
  const r = run(root, "evidence", "report.md");
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /not verified \(reported, not failed\): 2/);
  assert.match(r.out, /2 reference/);
  cleanup(root);
});

test("evidence ignores URLs, versions and addresses", () => {
  const root = repo();
  write(root, "report.md", "see https://example.com:8443/x, version 1.2.3:4 and host 10.0.0.1:80\n");
  const r = run(root, "evidence", "report.md");
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /0 reference/);
  cleanup(root);
});
