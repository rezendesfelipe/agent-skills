import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { ENGINE, tempRepo } from "./helpers.mjs";

const run = (root, ...args) => {
  const r = spawnSync(process.execPath, [ENGINE, ...args, "--root", root, "--json"], { encoding: "utf8" });
  return { code: r.status, out: r.stdout ? JSON.parse(r.stdout) : null, err: r.stderr };
};

test("plan lists files and writes nothing", () => {
  const root = tempRepo("full", { scaffold: false });
  const r = run(root, "plan");
  assert.equal(r.code, 0);
  assert.ok(r.out.files.every((f) => f.status === "create"));
  assert.equal(existsSync(join(root, "infra/stacks")), false);
});

test("scaffold writes, then refuses to overwrite a changed file without --force", () => {
  const root = tempRepo("full", { scaffold: false });
  assert.equal(run(root, "scaffold").code, 0);
  const f = join(root, "infra/modules/acr/main.tf");
  writeFileSync(f, readFileSync(f, "utf8") + "# local change\n");
  const r = run(root, "scaffold");
  assert.equal(r.code, 1);
  assert.deepEqual(r.out.refused, ["infra/modules/acr/main.tf"]);
  assert.match(readFileSync(f, "utf8"), /# local change/);
  assert.equal(run(root, "scaffold", "--force").code, 0);
  assert.doesNotMatch(readFileSync(f, "utf8"), /# local change/);
});

test("check-manifest reports errors with exit code 1", () => {
  const root = tempRepo("full", { scaffold: false });
  const m = join(root, "infra/stacks.yaml");
  writeFileSync(m, readFileSync(m, "utf8").replace("dependsOn: [vnet-core]", "dependsOn: [vnet-nope]"));
  const r = run(root, "check-manifest");
  assert.equal(r.code, 1);
  assert.ok(r.out.errors.some((e) => /vnet-nope/.test(e.message)));
});

test("add-stack adds to the manifest and writes only new files and shared pipeline files", () => {
  const root = tempRepo("full");
  const before = readFileSync(join(root, "infra/stacks/app-orders/main.tf"), "utf8");
  const r = run(root, "add-stack", "--name", "app-payments", "--type", "app", "--owner", "payments", "--depends-on", "vnet-core,aks-core");
  assert.equal(r.code, 0, JSON.stringify(r.out));
  assert.match(readFileSync(join(root, "infra/stacks.yaml"), "utf8"), /name: app-payments/);
  assert.ok(r.out.written.includes("infra/stacks/app-payments/main.tf"));
  assert.ok(r.out.written.includes("infra/pipelines/azure-pipelines.yml"));
  assert.equal(readFileSync(join(root, "infra/stacks/app-orders/main.tf"), "utf8"), before);
  assert.equal(run(root, "check").out.findings.filter((f) => f.severity === "error").length, 0);
});

test("check exits 0 on a clean repository and 1 on an error", () => {
  const root = tempRepo("full");
  assert.equal(run(root, "check").code, 0);
  const f = join(root, "infra/pipelines/azure-pipelines.yml");
  writeFileSync(f, readFileSync(f, "utf8").replace("trigger: none", "trigger: [main]"));
  const r = run(root, "check");
  assert.equal(r.code, 1);
  assert.ok(r.out.findings.some((x) => x.rule === "manual-trigger"));
});

test("diagram writes the .drawio file and protects manual edits", () => {
  const root = tempRepo("full");
  const r = run(root, "diagram");
  assert.equal(r.code, 0);
  const f = join(root, "docs/architecture/prod-brs-01.drawio");
  assert.ok(existsSync(f));
  assert.equal(run(root, "check-diagram", f).code, 0);
  writeFileSync(f, readFileSync(f, "utf8").replace("Argo CD", "Argo CD (edited)"));
  const again = run(root, "diagram");
  assert.equal(again.code, 1);
  assert.deepEqual(again.out.edited, ["docs/architecture/prod-brs-01.drawio"]);
  assert.match(readFileSync(f, "utf8"), /edited/);
});

test("unknown command is a usage error", () => {
  const root = tempRepo("full", { scaffold: false });
  assert.equal(run(root, "nope").code, 2);
});
