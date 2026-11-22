import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { generateAll } from "../scripts/lib/generate.mjs";
import { generateDiagrams } from "../scripts/lib/diagram.mjs";
import { HERE, FIXTURES, manifestOf, tempRepo, expandAdo } from "./helpers.mjs";

const walk = (d, root = d) => readdirSync(d).flatMap((e) => (statSync(join(d, e)).isDirectory() ? walk(join(d, e), root) : [relative(root, join(d, e))]));

test("generated files match the golden trees byte for byte", () => {
  for (const f of FIXTURES) {
    const m = manifestOf(f);
    const files = generateAll(m);
    if (m.profile === "private-aks-postgres") for (const [p, c] of generateDiagrams(m, { all: true }).files) files.set(p, c);
    const golden = join(HERE, "golden", f);
    assert.deepEqual([...files.keys()].sort(), walk(golden).sort(), `${f}: file list (run node test/update-golden.mjs after an intended change)`);
    for (const [p, c] of files) assert.equal(c, readFileSync(join(golden, p), "utf8"), `${f}: ${p}`);
  }
});

test("generation is deterministic", () => {
  const m = manifestOf("full");
  assert.deepEqual([...generateAll(m)], [...generateAll(manifestOf("full"))]);
});

test("Azure DevOps: only the selected stack exists and its dependsOn is empty", () => {
  const root = tempRepo("full");
  const stages = expandAdo(join(root, "infra/pipelines"), "azure-pipelines.yml", { appOrders: true, action: "plan" });
  assert.deepEqual(stages.map((s) => s.stage), ["app_orders"]);
  assert.deepEqual(stages[0].dependsOn, []);
});

test("Azure DevOps: all stacks run in order and dependencies exist", () => {
  const root = tempRepo("full");
  const stages = expandAdo(join(root, "infra/pipelines"), "azure-pipelines.yml", { vnetCore: true, aksCore: true, appOrders: true, argocd: true, action: "apply" });
  const names = stages.map((s) => s.stage);
  assert.deepEqual(names, ["vnet_core", "aks_core", "app_orders", "argocd"]);
  for (const s of stages) for (const d of s.dependsOn) assert.ok(names.includes(d), `${s.stage} depends on missing ${d}`);
  assert.deepEqual(stages[2].dependsOn, ["vnet_core", "aks_core"]);
  assert.deepEqual(stages[3].dependsOn, ["aks_core", "app_orders"]);
  const apply = stages[0].jobs.find((j) => j.deployment === "apply");
  assert.equal(apply.environment, "azure-dev");
  const download = apply.strategy.runOnce.deploy.steps.find((x) => x.download);
  assert.equal(download.artifact, "plan-vnet_core");
});

test("Azure DevOps: a plan run does not bootstrap Argo CD, and nothing selected fails fast", () => {
  const root = tempRepo("full");
  const plan = expandAdo(join(root, "infra/pipelines"), "azure-pipelines.yml", { aksCore: true, argocd: true, action: "plan" });
  assert.deepEqual(plan.map((s) => s.stage), ["aks_core"]);
  const none = expandAdo(join(root, "infra/pipelines"), "azure-pipelines.yml", {});
  assert.deepEqual(none.map((s) => s.stage), ["nothing_selected"]);
  const onlyBootstrap = expandAdo(join(root, "infra/pipelines"), "azure-pipelines.yml", { argocd: true, action: "apply" });
  assert.deepEqual(onlyBootstrap.map((s) => s.stage), ["argocd"]);
});

test("guardrails: no destroy, plan default, manual trigger, no stored secrets", () => {
  for (const f of FIXTURES) {
    for (const [p, c] of generateAll(manifestOf(f))) {
      if (!/pipelines|workflows|scripts/.test(p)) continue;
      assert.ok(!/(values|options): \[[^\]]*destroy/.test(c), `${f}: ${p} offers destroy`);
      assert.ok(!/ARM_CLIENT_SECRET|ARM_ACCESS_KEY|client-secret/.test(c), `${f}: ${p} has a stored credential`);
    }
    const files = generateAll(manifestOf(f));
    const ado = files.get("infra/pipelines/azure-pipelines.yml");
    if (ado) assert.match(ado, /^trigger: none/m);
    const gha = files.get(".github/workflows/infra.yml");
    if (gha) { assert.match(gha, /on:\n {2}workflow_dispatch:/); assert.match(gha, /id-token: write/); }
  }
});

test("each environment gets its own subscription", () => {
  const tf = generateAll(manifestOf("full")).get("infra/scripts/tf.sh");
  assert.match(tf, /dev\) echo "00000000-0000-0000-0000-000000000001"/);
  assert.match(tf, /prod\) echo "00000000-0000-0000-0000-000000000003"/);
  const boot = generateAll(manifestOf("full")).get(".github/workflows/argocd-bootstrap.yml");
  assert.match(boot, /fromJSON\('\{"dev":"00000000-0000-0000-0000-000000000001"/);
});

test("standalone owns the privatelink zones; alz creates none and leaves DNS to policy", () => {
  const std = generateAll(manifestOf("full"));
  assert.match(std.get("infra/stacks/vnet-core/main.tf"), /privatelink\.azurecr\.io/);
  assert.match(std.get("infra/stacks/aks-core/main.tf"), /dns_by_policy\s+= false/);
  const alz = generateAll(manifestOf("alz"));
  assert.doesNotMatch(alz.get("infra/stacks/vnet-core/main.tf"), /privatelink\./);
  assert.match(alz.get("infra/stacks/aks-core/main.tf"), /dns_by_policy\s+= true/);
  assert.match(alz.get("infra/stacks/aks-core/main.tf"), /private_dns_zone_id = var\.aks_dns_zone_id/);
  assert.match(alz.get("infra/envs/vnet-core/prod-brs-01.tfvars"), /hub_vnet_id = "\/subscriptions\//);
});

test("scaffold writes only infra/, .github/workflows/ and the manifest", () => {
  for (const f of FIXTURES) for (const p of generateAll(manifestOf(f)).keys()) assert.match(p, /^(infra\/|\.github\/workflows\/)/);
  assert.ok(existsSync(join(HERE, "golden", "full", "docs/architecture/prod-brs-01.drawio")));
});
