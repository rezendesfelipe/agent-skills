import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { bridge, applyOutputs } from "../scripts/lib/bridge.mjs";
import { manifestOf, tempRepo } from "./helpers.mjs";

const OUT = {
  postgres_fqdn: { sensitive: false, type: "string", value: "pgsql-orders-prod-brs-01.prod-brs-01.postgres.database.azure.com" },
  app_client_id: { sensitive: false, type: "string", value: "11111111-2222-3333-4444-555555555555" },
};
const overlay = (root) => readFileSync(join(root, "infra/argocd/manifests/orders/overlays/prod-brs-01/kustomization.yaml"), "utf8");
const writeOutputs = (o) => { const f = join(mkdtempSync(join(tmpdir(), "ats-out-")), "outputs.json"); writeFileSync(f, JSON.stringify(o)); return f; };
const git = (cwd, ...a) => spawnSync("git", ["-c", "user.email=test@example.com", "-c", "user.name=test", ...a], { cwd, encoding: "utf8" });

function stubBin(log, kind) {
  const dir = mkdtempSync(join(tmpdir(), "ats-bin-"));
  const gh = `#!/usr/bin/env bash
echo "gh $*" >> "${log}"
case "$1 $2" in "auth status") exit \${GH_AUTH_FAIL:-0};; "pr list") echo "\${GH_EXISTING:-}";; "pr create") echo "https://github.com/example/platform/pull/42";; esac
`;
  const az = `#!/usr/bin/env bash
echo "az $*" >> "${log}"
case "$1 $2" in "account show") exit 0;; "repos pr") case "$3" in list) echo "";; create) echo "77";; esac;; esac
`;
  writeFileSync(join(dir, kind), kind === "gh" ? gh : az); chmodSync(join(dir, kind), 0o755);
  return dir;
}
function repoWithRemote(url) {
  const root = tempRepo("full");
  git(root, "init", "-q", "-b", "main");
  git(root, "add", "-A"); git(root, "commit", "-qm", "init");
  const bare = mkdtempSync(join(tmpdir(), "ats-remote-"));
  spawnSync("git", ["init", "-q", "--bare", bare]);
  git(root, "remote", "add", "origin", bare);
  git(root, "push", "-q", "origin", "main");
  if (url) git(root, "config", "remote.origin.pushurl", bare), git(root, "remote", "set-url", "origin", url), git(root, "config", "remote.origin.pushurl", bare);
  return root;
}

test("outputs are written only on marked lines", () => {
  const root = tempRepo("full");
  const before = overlay(root);
  const r = bridge(root, manifestOf("full"), { stack: "app-orders", env: "prod", instance: "brs-01", outputsFile: writeOutputs(OUT) });
  assert.ok(r.ok, r.message);
  const after = overlay(root);
  assert.match(after, /- DB_HOST=pgsql-orders-prod-brs-01\.prod-brs-01\.postgres\.database\.azure\.com # bridge: postgres_fqdn/);
  assert.match(after, /value: "11111111-2222-3333-4444-555555555555" # bridge: app_client_id/);
  assert.doesNotMatch(after, /<\w+>/);
  const changedLines = before.split("\n").filter((l, i) => l !== after.split("\n")[i]);
  assert.equal(changedLines.length, 2);
});

test("a sensitive output is refused and nothing is written", () => {
  const root = tempRepo("full");
  const before = overlay(root);
  const r = bridge(root, manifestOf("full"), { stack: "app-orders", env: "prod", instance: "brs-01", outputsFile: writeOutputs({ ...OUT, postgres_fqdn: { ...OUT.postgres_fqdn, sensitive: true } }) });
  assert.equal(r.ok, false);
  assert.match(r.message, /postgres_fqdn is sensitive/);
  assert.equal(overlay(root), before);
});

test("applyOutputs leaves unmapped lines alone", () => {
  const { text, used } = applyOutputs("a: 1\n      - X=<x> # bridge: x\n", { x: { value: "v" } });
  assert.equal(text, "a: 1\n      - X=v # bridge: x\n");
  assert.deepEqual([...used], ["x"]);
});

test("--open-pr on GitHub commits only the overlay, pushes a bridge branch and does not merge", () => {
  const root = repoWithRemote("https://github.com/example/platform.git");
  const log = join(mkdtempSync(join(tmpdir(), "ats-log-")), "log");
  const bin = stubBin(log, "gh");
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}` };
  const save = process.env.PATH; process.env.PATH = env.PATH;
  try {
    const r = bridge(root, manifestOf("full"), { stack: "app-orders", env: "prod", instance: "brs-01", outputsFile: writeOutputs(OUT), openPr: true, base: "main" });
    assert.ok(r.ok, r.message);
    assert.match(r.branch, /^bridge\/app-orders-prod-brs-01-[0-9a-f]{8}$/);
    assert.equal(r.pr, "https://github.com/example/platform/pull/42");
    const calls = readFileSync(log, "utf8");
    assert.match(calls, /gh pr create --head bridge\/app-orders-prod-brs-01-\w+ --base main/);
    assert.doesNotMatch(calls, /merge/);
    const files = git(root, "show", "--name-only", "--pretty=format:", "HEAD").stdout.trim().split("\n");
    assert.deepEqual(files, ["infra/argocd/manifests/orders/overlays/prod-brs-01/kustomization.yaml"]);
  } finally { process.env.PATH = save; }
});

test("--open-pr on Azure Repos uses az repos pr create", () => {
  const root = repoWithRemote("https://dev.azure.com/example/platform/_git/platform");
  const log = join(mkdtempSync(join(tmpdir(), "ats-log-")), "log");
  const save = process.env.PATH; process.env.PATH = `${stubBin(log, "az")}:${save}`;
  try {
    const r = bridge(root, manifestOf("full"), { stack: "app-orders", env: "prod", instance: "brs-01", outputsFile: writeOutputs(OUT), openPr: true, base: "main" });
    assert.ok(r.ok, r.message);
    assert.match(readFileSync(log, "utf8"), /az repos pr create --source-branch bridge\/app-orders-prod-brs-01-\w+ --target-branch main/);
  } finally { process.env.PATH = save; }
});

test("--open-pr with nothing to change or a PR already open opens no new PR", () => {
  const root = repoWithRemote("https://github.com/example/platform.git");
  const log = join(mkdtempSync(join(tmpdir(), "ats-log-")), "log");
  const save = process.env.PATH; process.env.PATH = `${stubBin(log, "gh")}:${save}`;
  try {
    // nothing pending: outputs already committed
    bridge(root, manifestOf("full"), { stack: "app-orders", env: "prod", instance: "brs-01", outputsFile: writeOutputs(OUT) });
    git(root, "commit", "-qam", "outputs");
    const none = bridge(root, manifestOf("full"), { stack: "app-orders", env: "prod", instance: "brs-01", outputsFile: writeOutputs(OUT), openPr: true });
    assert.match(none.message, /no pull request opened/);
    // existing PR
    process.env.GH_EXISTING = "https://github.com/example/platform/pull/7";
    const r = bridge(root, manifestOf("full"), { stack: "app-orders", env: "dev", instance: "brs-01", outputsFile: writeOutputs(OUT), openPr: true });
    assert.equal(r.pr, "https://github.com/example/platform/pull/7");
    assert.doesNotMatch(readFileSync(log, "utf8"), /pr create/);
  } finally { process.env.PATH = save; delete process.env.GH_EXISTING; }
});

test("--open-pr when the CLI is not logged in keeps the change and stores no token", () => {
  const root = repoWithRemote("https://github.com/example/platform.git");
  const log = join(mkdtempSync(join(tmpdir(), "ats-log-")), "log");
  const save = process.env.PATH; process.env.PATH = `${stubBin(log, "gh")}:${save}`; process.env.GH_AUTH_FAIL = "1";
  try {
    const r = bridge(root, manifestOf("full"), { stack: "app-orders", env: "prod", instance: "brs-01", outputsFile: writeOutputs(OUT), openPr: true });
    assert.equal(r.ok, false);
    assert.match(r.message, /gh auth login/);
    assert.match(overlay(root), /pgsql-orders-prod-brs-01/);
    // after logging in, the kept change still becomes a pull request
    delete process.env.GH_AUTH_FAIL;
    const again = bridge(root, manifestOf("full"), { stack: "app-orders", env: "prod", instance: "brs-01", outputsFile: writeOutputs(OUT), openPr: true, base: "main" });
    assert.ok(again.ok, again.message);
    assert.ok(again.pr);
  } finally { process.env.PATH = save; delete process.env.GH_AUTH_FAIL; }
});
