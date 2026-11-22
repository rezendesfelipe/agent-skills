// Findings of the 2026-11-22 review of the blog articles' code (design Decision 15).
// Each test asserts the template has the fix and, where a rule exists, that check flags
// the article's original version.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { generateAll } from "../scripts/lib/generate.mjs";
import { runCheck } from "../scripts/lib/check.mjs";
import { manifestOf, tempRepo } from "./helpers.mjs";

const files = generateAll(manifestOf("full"));
const get = (p) => files.get(p);
const flagged = (mutate, rule) => {
  const root = tempRepo("full");
  mutate((p, a, b) => { const f = join(root, p); writeFileSync(f, readFileSync(f, "utf8").replace(a, b)); });
  return runCheck(root, manifestOf("full")).some((f) => f.rule === rule && f.severity === "error");
};

test("B1: every stack creates its own resource group", () => {
  for (const s of ["vnet-core", "aks-core", "app-orders"]) assert.match(get(`infra/stacks/${s}/main.tf`), /resource "azurerm_resource_group" "this"/, s);
  assert.ok(flagged((e) => e("infra/stacks/aks-core/main.tf", 'name     = "rg-aks-core-', 'name     = "rg-other-'), "rg-owned"));
});

test("B2: every module call passes location and resource_group_name", () => {
  for (const s of ["vnet-core", "aks-core", "app-orders"]) {
    const t = get(`infra/stacks/${s}/main.tf`);
    for (const block of t.matchAll(/module "\w+" \{([\s\S]*?)\n\}/g)) {
      assert.match(block[1], /location\s+= var\.location/, `${s}: ${block[0].slice(0, 30)}`);
      assert.match(block[1], /resource_group_name\s+= azurerm_resource_group\.this\.name/, `${s}: ${block[0].slice(0, 30)}`);
    }
  }
  assert.match(get("infra/stacks/aks-core/main.tf"), /vm_size\s+= var\.vm_size[\s\S]*node_count\s+= var\.node_count[\s\S]*outbound_type\s+= var\.outbound_type/);
});

test("B3: the Kustomize base has its own kustomization.yaml", () => {
  assert.match(get("infra/argocd/manifests/orders/base/kustomization.yaml"), /resources:\n {2}- serviceaccount\.yaml\n {2}- deployment\.yaml/);
});

test("I1/I2: Terraform >= 1.12 and azurerm >= 4.65", () => {
  const v = get("infra/stacks/aks-core/versions.tf");
  assert.match(v, /required_version = ">= 1\.12, < 2\.0"/);
  assert.match(v, /version = ">= 4\.65, < 5\.0"/);
  assert.ok(flagged((e) => e("infra/stacks/aks-core/versions.tf", '">= 1.12, < 2.0"', '"~> 1.9"'), "versions"));
});

test("I3: federated credential uses user_assigned_identity_id", () => {
  const t = get("infra/modules/workload-identity/main.tf");
  assert.match(t, /user_assigned_identity_id = azurerm_user_assigned_identity\.this\.id/);
  assert.doesNotMatch(t, /parent_id/);
});

test("I4: AKS identity gets Network Contributor on the subnet", () => {
  const t = get("infra/modules/aks/main.tf");
  assert.match(t, /"subnet_network_contributor"[\s\S]*role_definition_name = "Network Contributor"/);
});

test("I5: tf.sh needs no undefined state variables", () => {
  const t = get("infra/scripts/tf.sh");
  assert.match(t, /-backend-config="resource_group_name=rg-tfstate"/);
  assert.doesNotMatch(t, /TFSTATE_RG|TFSTATE_SA/);
});

test("I6: tf.sh assigns then exports (set -e catches a failure)", () => {
  assert.doesNotMatch(get("infra/scripts/tf.sh"), /export \w+="\$\(/);
});

test("I7: the Argo CD bootstrap runs only on apply", () => {
  assert.match(get("infra/pipelines/azure-pipelines.yml"), /if and\(eq\(parameters\.argocd, true\), eq\(parameters\.action, 'apply'\)\)/);
  assert.match(get(".github/workflows/infra.yml"), /inputs\.argocd && inputs\.action == 'apply'/);
  assert.ok(flagged((e) => e(".github/workflows/infra.yml", "inputs.argocd && inputs.action == 'apply'", "inputs.argocd"), "argocd-apply-only"));
});

test("I8: the network module delegates the PostgreSQL subnet and links the DNS zones", () => {
  const t = get("infra/modules/network/main.tf");
  assert.match(t, /service_delegation \{/);
  assert.match(t, /azurerm_private_dns_zone_virtual_network_link/);
  assert.match(get("infra/stacks/vnet-core/main.tf"), /delegation = "Microsoft\.DBforPostgreSQL\/flexibleServers"/);
});

test("M: NSG per subnet, case with usage error, bash for scripts, pinned tools", () => {
  assert.match(get("infra/modules/network/main.tf"), /azurerm_subnet_network_security_group_association/);
  assert.match(get("infra/scripts/tf.sh"), /\*\)\n\s+usage/);
  assert.match(get(".github/workflows/argocd-bootstrap.yml"), /run: bash infra\/scripts\/bootstrap-argocd\.sh/);
  assert.match(get(".github/workflows/terraform-stack.yml"), /terraform_version: 1\.12\.2/);
  assert.match(get("infra/pipelines/templates/terraform-stack.yml"), /install terraform 1\.12\.2/);
});
