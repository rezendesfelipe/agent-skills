import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { runCheck } from "../scripts/lib/check.mjs";
import { manifestOf, tempRepo, FIXTURES } from "./helpers.mjs";

const edit = (root, p, from, to) => {
  const f = join(root, p);
  const t = readFileSync(f, "utf8");
  assert.ok(t.includes(from), `${p} does not contain ${from}`);
  writeFileSync(f, t.replace(from, to));
};
const rules = (root, fixture = "full") => runCheck(root, manifestOf(fixture)).filter((f) => f.severity === "error").map((f) => f.rule);

test("a freshly scaffolded repository has no findings", () => {
  for (const f of FIXTURES) {
    const found = runCheck(tempRepo(f), manifestOf(f)).filter((x) => x.severity !== "info");
    assert.deepEqual(found, [], f);
  }
});

test("pending bridge steps are reported as info, not findings", () => {
  const info = runCheck(tempRepo("full"), manifestOf("full")).filter((x) => x.severity === "info");
  assert.equal(info.length, 3);
  assert.ok(info.every((x) => x.rule === "bridge-placeholders"));
});

const cases = [
  ["state-key", "infra/scripts/tf.sh", 'echo "aks-core-prod-brs-01.tfstate"', 'echo "aks.tfstate"'],
  ["backend-partial", "infra/stacks/aks-core/versions.tf", 'backend "azurerm" {}', 'backend "azurerm" {\n    key = "x.tfstate"\n  }'],
  ["versions", "infra/stacks/aks-core/versions.tf", '">= 1.12, < 2.0"', '"~> 1.9"'],
  ["versions", "infra/stacks/app-orders/versions.tf", '">= 4.65, < 5.0"', '"~> 4.0"'],
  ["rg-owned", "infra/stacks/aks-core/main.tf", 'name     = "rg-aks-core-', 'name     = "rg-cluster-'],
  ["no-prod-destroy", "infra/pipelines/azure-pipelines.yml", "values: [plan, apply]", "values: [plan, apply, destroy]"],
  ["no-prod-destroy", ".github/workflows/infra.yml", "options: [plan, apply]", "options: [plan, apply, destroy]"],
  ["manual-trigger", "infra/pipelines/azure-pipelines.yml", "trigger: none", "trigger: [main]"],
  ["manual-trigger", ".github/workflows/infra.yml", "on:\n  workflow_dispatch:", "on:\n  push:\n  workflow_dispatch:"],
  ["plan-default", "infra/pipelines/azure-pipelines.yml", "default: plan", "default: apply"],
  ["pipeline-params", ".github/workflows/infra.yml", "      app_orders:\n", "      app_payments:\n"],
  ["pipeline-deps", ".github/workflows/infra.yml", "needs: [vnet-core, aks-core]", "needs: [aks-core]"],
  ["pipeline-deps", "infra/pipelines/azure-pipelines.yml", "            - ${{ if eq(parameters.vnetCore, true) }}:\n                - vnet_core\n            - ${{ if eq(parameters.aksCore, true) }}:\n                - aks_core", "            - ${{ if eq(parameters.aksCore, true) }}:\n                - aks_core"],
  ["argocd-apply-only", "infra/pipelines/azure-pipelines.yml", "${{ if and(eq(parameters.argocd, true), eq(parameters.action, 'apply')) }}", "${{ if eq(parameters.argocd, true) }}"],
  ["argocd-apply-only", ".github/workflows/infra.yml", "inputs.argocd && inputs.action == 'apply'", "inputs.argocd"],
  ["oidc", ".github/workflows/terraform-stack.yml", "      ARM_TENANT_ID:", "      ARM_CLIENT_SECRET: ${{ secrets.X }}\n      ARM_TENANT_ID:"],
  ["oidc", ".github/workflows/infra.yml", "  id-token: write\n", "  id-token: none\n"],
  ["wi-subject", "infra/stacks/app-orders/main.tf", 'service_account_name = "orders"', 'service_account_name = "orders-api"'],
  ["wi-subject", "infra/argocd/apps/prod-brs-01/orders.yaml", "    namespace: orders", "    namespace: shop"],
  ["argocd-finalizer", "infra/argocd/apps/prod-brs-01/orders.yaml", "    - resources-finalizer.argocd.argoproj.io", "    - other"],
  ["argocd-prod-sync", "infra/argocd/apps/prod-brs-01/orders.yaml", "  syncPolicy:\n", "  syncPolicy:\n    automated: {}\n"],
  ["argocd-pinned", "infra/scripts/bootstrap-argocd.sh", 'argocd_version="v3.6.2"', 'argocd_version="stable"'],
];

for (const [rule, file, from, to] of cases) {
  test(`${rule}: ${file}`, () => {
    const root = tempRepo("full");
    edit(root, file, from, to);
    assert.ok(rules(root).includes(rule), `expected ${rule}, got ${rules(root).join(", ")}`);
  });
}

test("alz rules: zone group with DNS by policy, local privatelink zone", () => {
  const root = tempRepo("alz");
  edit(root, "infra/stacks/aks-core/main.tf", "dns_by_policy       = true", "dns_by_policy       = false");
  edit(root, "infra/stacks/vnet-core/main.tf", "private_dns_zones = {}", 'private_dns_zones = { acr = "privatelink.azurecr.io" }');
  const r = rules(root, "alz");
  assert.ok(r.includes("lz-dns-zone-group"));
  assert.ok(r.includes("lz-no-local-privatelink-zone"));
});

test("drift: a generated file that is missing or edited is a warning", () => {
  const root = tempRepo("full");
  rmSync(join(root, "infra/modules/aks/outputs.tf"));
  edit(root, "infra/modules/acr/main.tf", 'sku                           = "Premium"', 'sku                           = "Basic"');
  const drift = runCheck(root, manifestOf("full")).filter((f) => f.rule === "drift");
  assert.deepEqual(drift.map((d) => d.file).sort(), ["infra/modules/acr/main.tf", "infra/modules/aks/outputs.tf"]);
  assert.ok(drift.every((d) => d.severity === "warning"));
});

test("findings carry rule, file, line and reference", () => {
  const root = tempRepo("full");
  edit(root, "infra/scripts/tf.sh", 'echo "aks-core-prod-brs-01.tfstate"', 'echo "aks.tfstate"');
  const f = runCheck(root, manifestOf("full")).find((x) => x.rule === "state-key");
  assert.equal(f.file, "infra/scripts/tf.sh");
  assert.ok(f.line > 0);
  assert.match(f.message, /found aks\.tfstate, expected aks-core-prod-brs-01\.tfstate/);
  assert.match(f.ref, /^references\//);
});
