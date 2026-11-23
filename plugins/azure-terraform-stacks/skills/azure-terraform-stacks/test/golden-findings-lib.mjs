import { readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { runCheck } from "../scripts/lib/check.mjs";
import { manifestOf, tempRepo, FIXTURES } from "./helpers.mjs";
import { CASES } from "./check-cases.mjs";

const edit = (root, p, from, to) => { const f = join(root, p); writeFileSync(f, readFileSync(f, "utf8").replace(from, to)); };

export function allScenarios() {
  const out = {};
  for (const f of FIXTURES) out[`clean:${f}`] = runCheck(tempRepo(f), manifestOf(f));
  CASES.forEach(([rule, file, from, to], i) => {
    const root = tempRepo("full");
    edit(root, file, from, to);
    out[`case${i}:${rule}:${file}`] = runCheck(root, manifestOf("full"));
  });
  { const root = tempRepo("alz");
    edit(root, "infra/stacks/aks-core/main.tf", "dns_by_policy       = true", "dns_by_policy       = false");
    edit(root, "infra/stacks/vnet-core/main.tf", "private_dns_zones = {}", 'private_dns_zones = { acr = "privatelink.azurecr.io" }');
    out["alz-rules"] = runCheck(root, manifestOf("alz")); }
  { const root = tempRepo("full");
    rmSync(join(root, "infra/modules/aks/outputs.tf"));
    edit(root, "infra/modules/acr/main.tf", 'sku                           = "Premium"', 'sku                           = "Basic"');
    edit(root, "infra/scripts/bootstrap-argocd.sh", "az aks get-credentials", "az aks get-credentials  ");
    out["drift"] = runCheck(root, manifestOf("full")); }
  return out;
}
