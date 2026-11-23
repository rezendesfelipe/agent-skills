import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { runCheck } from "../scripts/lib/check.mjs";
import { manifestOf, tempRepo, FIXTURES } from "./helpers.mjs";
import { CASES } from "./check-cases.mjs";

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


for (const [rule, file, from, to] of CASES) {
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
