import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { audit } from "../scripts/lib/audit.mjs";
import { HERE, ENGINE, FIXTURES, tempRepo } from "./helpers.mjs";

const fixtureDir = (name) => join(HERE, "fixtures", "audit", name);
const copyOf = (name) => { const d = mkdtempSync(join(tmpdir(), `ats-audit-${name}-`)); cpSync(fixtureDir(name), d, { recursive: true }); return d; };
const git = (cwd, ...a) => spawnSync("git", ["-c", "user.email=t@example.com", "-c", "user.name=t", ...a], { cwd, encoding: "utf8" });
const rulesOf = (r, sev) => r.findings.filter((f) => !sev || f.severity === sev).map((f) => f.rule);
const find = (r, rule, file) => r.findings.find((f) => f.rule === rule && (!file || f.file.includes(file)));

test("a repository without a manifest is audited and the manifest is not required", () => {
  const r = audit(fixtureDir("monolith"));
  assert.equal(existsSync(join(fixtureDir("monolith"), "infra", "stacks.yaml")), false);
  assert.equal(r.summary.roots, 1);
  assert.equal(r.ok, false);
});

test("nothing discovered: says so and exits 0", () => {
  const r = audit(fixtureDir("empty"));
  assert.equal(r.nothingFound, true);
  assert.equal(r.ok, true);
  assert.deepEqual(r.findings, []);
  const cli = spawnSync(process.execPath, [ENGINE, "audit", "--root", fixtureDir("empty")], { encoding: "utf8" });
  assert.equal(cli.status, 0);
  assert.match(cli.stdout, /nothing discovered/);
});

test("monolith: one large root with local state, old versions and a resource group nobody creates", () => {
  const r = audit(fixtureDir("monolith"));
  const root = r.inventory.terraformRoots[0];
  assert.equal(root.resourceBlocks, 7);
  assert.deepEqual(root.groups, { network: 2, compute: 1, data: 2, security: 1, other: 1 });
  assert.equal(root.backend, null);
  assert.equal(find(r, "state-local").severity, "warning");
  assert.match(find(r, "rg-owned").message, /rg-network-legacy/);
  assert.equal(rulesOf(r).filter((x) => x === "versions").length, 2);
});

test("shared state: two roots on one blob are an error, and a non-empty backend is flagged", () => {
  const r = audit(fixtureDir("shared-state"));
  assert.equal(r.summary.roots, 2);
  const shared = find(r, "state-shared");
  assert.equal(shared.severity, "error");
  assert.match(shared.message, /live\/aks and live\/network/);
  assert.match(shared.message, /platform\.tfstate in stshared\/tfstate/);
  assert.equal(shared.inferred, undefined, "two literal keys are not an inference");
  assert.equal(rulesOf(r).filter((x) => x === "backend-partial").length, 2);
});

test("a partial backend takes its keys from the key table of a script, marked as inferred", () => {
  const root = tempRepo("full");
  const r = audit(root);
  const aks = r.inventory.terraformRoots.find((t) => t.dir.endsWith("aks-core"));
  assert.equal(aks.backend.partial, true);
  assert.equal(aks.stateKey.status, "per-instance");
  assert.equal(aks.stateKey.inferred, true);
  assert.ok(aks.stateKey.keys.includes("aks-core-prod-brs-01.tfstate"));
});

test("a partial backend with no key anywhere is state-unknown, not shared", () => {
  const r = audit(fixtureDir("argocd"));
  assert.equal(find(r, "state-unknown").severity, "warning");
  assert.equal(find(r, "state-unknown").inferred, true);
  assert.equal(rulesOf(r).includes("state-shared"), false);
});

test("pipelines: trigger, destroy, default action, stored secret; a reusable workflow is left alone", () => {
  const r = audit(fixtureDir("pipelines"));
  assert.equal(r.summary.pipelines, 3);
  assert.match(find(r, "manual-trigger", "deploy.yml").message, /found push/);
  const adoTrigger = find(r, "manual-trigger", "azure-pipelines.yml");
  assert.match(adoTrigger.message, /trigger must be none/);
  assert.equal(adoTrigger.line, 2, "the trigger key, not the comment on line 1 that mentions a trigger");
  const destroy = find(r, "no-prod-destroy", "azure-pipelines.yml");
  assert.equal(destroy.line, 13, "the line of the values list, not the comment that mentions destroy");
  assert.match(find(r, "plan-default", "azure-pipelines.yml").message, /action must default to plan/);
  const selector = r.findings.find((f) => f.rule === "plan-default" && f.severity === "warning");
  assert.match(selector.message, /network must default to false/, "a boolean input is inferred to be a stack selector, so only a warning");
  assert.match(find(r, "oidc", "deploy.yml").message, /ARM_CLIENT_SECRET/);
  assert.equal(r.findings.some((f) => f.file.includes("terraform-reusable.yml")), false);
});

test("Argo CD: finalizer, production sync, unpinned install, best-effort federated subject", () => {
  const r = audit(fixtureDir("argocd"));
  assert.equal(r.summary.applications, 2);
  assert.match(find(r, "argocd-finalizer").file, /orders-prod\.yaml/);
  assert.equal(r.findings.filter((f) => f.rule === "argocd-finalizer").length, 1, "orders-dev has the finalizer");
  assert.match(find(r, "argocd-prod-sync").file, /orders-prod\.yaml/);
  assert.equal(r.findings.filter((f) => f.rule === "argocd-prod-sync").length, 1, "dev may sync automatically");
  const pinned = find(r, "argocd-pinned");
  assert.equal(pinned.line, 5);
  assert.match(pinned.message, /not stable or latest/);
  const wi = find(r, "wi-subject");
  assert.equal(wi.severity, "warning", "best effort is never an error");
  assert.match(wi.message, /namespace shop/);
});

test("rules that need the manifest are listed as not evaluated and never as passed", () => {
  const r = audit(fixtureDir("monolith"));
  const notEvaluated = Object.fromEntries(r.notEvaluated.map((n) => [n.rule, n.reason]));
  for (const rule of ["state-key", "pipeline-params", "pipeline-deps", "lz-dns-zone-group", "lz-no-local-privatelink-zone", "drift", "bridge-placeholders"]) {
    assert.match(notEvaluated[rule], /needs infra\/stacks\.yaml/, rule);
    assert.equal(r.evaluated.some((e) => e.rule === rule), false, `${rule} must not be listed as evaluated`);
  }
  // a rule with nothing to look at is not evaluated either, with the reason
  assert.match(notEvaluated["manual-trigger"], /nothing to examine: no pipeline/);
  assert.match(notEvaluated["argocd-finalizer"], /nothing to examine: no Argo CD Application/);
  assert.ok(r.evaluated.some((e) => e.rule === "versions" && e.examined === 1));
});

test("Terragrunt is reported as not covered", () => {
  const r = audit(fixtureDir("terragrunt"));
  assert.ok(r.notCovered.some((n) => /terragrunt\.hcl/.test(n) && /not supported/.test(n)));
});

test("every scaffolded fixture audits without errors", () => {
  for (const f of FIXTURES) {
    const r = audit(tempRepo(f));
    assert.deepEqual(rulesOf(r, "error"), [], f);
    assert.deepEqual(rulesOf(r, "warning"), [], f);
  }
});

test("audit leaves the working tree exactly as it was, even with uncommitted changes", () => {
  const d = copyOf("pipelines");
  git(d, "init", "-q", "-b", "main"); git(d, "add", "-A"); git(d, "commit", "-qm", "init");
  writeFileSync(join(d, "azure-pipelines.yml"), readFileSync(join(d, "azure-pipelines.yml"), "utf8") + "# uncommitted\n");
  writeFileSync(join(d, "untracked.tf"), "# not added\n");
  const snapshot = () => ({ status: git(d, "status", "--porcelain", "--ignored").stdout, files: readdirSync(d, { recursive: true }).sort().join("\n"), diff: git(d, "diff").stdout });
  const before = snapshot();
  const cli = spawnSync(process.execPath, [ENGINE, "audit", "--root", d, "--json"], { encoding: "utf8" });
  assert.equal(cli.status, 1);
  assert.ok(JSON.parse(cli.stdout).findings.length > 0);
  assert.deepEqual(snapshot(), before);
});

test("audit starts no external process", () => {
  for (const f of ["audit.mjs", "discover.mjs", "rules.mjs", "util.mjs"]) {
    const text = readFileSync(join(HERE, "..", "scripts", "lib", f), "utf8");
    assert.doesNotMatch(text, /child_process|\b(spawn|spawnSync|execSync|execFile|execFileSync|fork)\b/, f);
    assert.doesNotMatch(text, /writeFile|appendFile|mkdir|rmSync|unlink|rename|copyFile|chmod/, `${f} must not write`);
  }
});

test("CLI: --json prints the full result, a clean repository exits 0, usage errors exit 2", () => {
  const clean = spawnSync(process.execPath, [ENGINE, "audit", "--root", tempRepo("full"), "--json"], { encoding: "utf8" });
  assert.equal(clean.status, 0);
  const out = JSON.parse(clean.stdout);
  assert.equal(out.ok, true);
  assert.ok(out.inventory.terraformRoots.length === 3 && out.notEvaluated.length > 0 && out.notCovered.length > 0);
  assert.equal(spawnSync(process.execPath, [ENGINE, "audit", "--root", fixtureDir("monolith")], { encoding: "utf8" }).status, 1);
});
