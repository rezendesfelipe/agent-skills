import { test } from "node:test";
import assert from "node:assert/strict";
import { validateManifest } from "../scripts/lib/manifest.mjs";
import { literalName, literalRg, stateKey } from "../scripts/lib/naming.mjs";
import { rawFixture, manifestOf, FIXTURES } from "./helpers.mjs";

const errorsOf = (raw) => validateManifest(raw).errors;
const mutate = (fn, name = "full") => { const r = structuredClone(rawFixture(name)); fn(r); return r; };

test("every fixture is valid", () => {
  for (const f of FIXTURES) assert.deepEqual(errorsOf(rawFixture(f)), [], f);
});

test("dependency cycle is named", () => {
  const e = errorsOf(mutate((r) => { r.stacks[0].dependsOn = ["app-orders"]; }));
  assert.ok(e.some((x) => /dependency cycle: .*vnet-core.*app-orders|dependency cycle: .*app-orders.*vnet-core/.test(x.message)), JSON.stringify(e));
});

test("unknown dependency and module report the path", () => {
  const e = errorsOf(mutate((r) => { r.stacks[1].dependsOn = ["vnet-nope"]; r.stacks[2].modules = ["redis"]; }));
  assert.ok(e.some((x) => x.path === "stacks[1].dependsOn[0]" && /vnet-nope/.test(x.message)));
  assert.ok(e.some((x) => x.path === "stacks[2].modules[0]" && /redis/.test(x.message)));
});

test("stack name must be <type>-<owner>", () => {
  const e = errorsOf(mutate((r) => { r.stacks[1].name = "cluster"; r.stacks[2].dependsOn = ["vnet-core"]; }));
  assert.ok(e.some((x) => /must be aks-core/.test(x.message)));
});

test("unknown region code lists the known codes", () => {
  const e = errorsOf(mutate((r) => { r.instances = ["eus-01"]; }));
  assert.ok(e.some((x) => /region code eus is not in regions; known codes: brs/.test(x.message)));
});

test("shared subscription between environments fails", () => {
  const e = errorsOf(mutate((r) => { r.environments.hml.subscriptionId = r.environments.dev.subscriptionId; }));
  assert.ok(e.some((x) => x.path === "environments.hml.subscriptionId" && /one subscription per environment/.test(x.message)));
});

test("naming pattern must contain every token", () => {
  const e = errorsOf(mutate((r) => { r.naming = { pattern: "{type}-{name}-{region}-{seq}" }; }));
  assert.ok(e.some((x) => x.path === "naming.pattern" && /\{env\}/.test(x.message)));
});

test("derived names with the default pattern", () => {
  const m = manifestOf("full");
  assert.equal(literalName(m, "aks", "core", "prod", "brs-01"), "aks-core-prod-brs-01");
  assert.equal(literalRg(m, "aks", "core", "prod", "brs-01"), "rg-aks-core-prod-brs-01");
  assert.equal(literalName(m, "cr", "core", "prod", "brs-01"), "crcoreprodbrs01");
  assert.equal(stateKey(m, m.clusterStack, "prod", "brs-01"), "aks-core-prod-brs-01.tfstate");
});

test("custom pattern order", () => {
  const m = manifestOf(mutate((r) => { r.naming = { pattern: "{env}-{region}-{type}-{name}-{seq}" }; }));
  assert.equal(literalName(m, "aks", "core", "prod", "brs-01"), "prod-brs-aks-core-01");
  assert.equal(literalName(m, "cr", "core", "prod", "brs-01"), "prodbrscrcore01");
  assert.equal(stateKey(m, m.clusterStack, "prod", "brs-01"), "prod-brs-aks-core-01.tfstate");
});

test("underscore separator is rejected where Key Vault and PostgreSQL forbid it", () => {
  const e = errorsOf(mutate((r) => { r.naming = { separator: "_" }; }));
  assert.ok(e.some((x) => /kv_orders|kv-orders/.test(x.message) && /kv rules/.test(x.message)), JSON.stringify(e[0]));
  const m = manifestOf(mutate((r) => { r.naming = { separator: "_" }; r.profile = "none"; delete r.gitops; }));
  assert.equal(literalName(m, "aks", "core", "prod", "brs-01"), "aks_core_prod_brs_01");
});

test("Key Vault name over 24 characters fails and is not shortened", () => {
  const e = errorsOf(mutate((r) => { r.stacks[2] = { name: "app-ordersbackoffice", type: "app", owner: "ordersbackoffice", dependsOn: ["vnet-core", "aks-core"] }; r.gitops.apps[0].stack = "app-ordersbackoffice"; }));
  assert.ok(e.some((x) => /kv-ordersbackoffice-dev-brs-01 \(30 characters\)/.test(x.message)), JSON.stringify(e));
});

test("more than 25 GitHub inputs fails with the count", () => {
  const e = errorsOf(mutate((r) => {
    for (let i = 0; i < 22; i++) r.stacks.push({ name: `app-a${i}`, type: "app", owner: `a${i}`, dependsOn: ["vnet-core", "aks-core"] });
  }));
  assert.ok(e.some((x) => /would have 29 inputs; workflow_dispatch allows 25/.test(x.message)), JSON.stringify(e.slice(0, 3)));
});

test("alz mode without hub data fails per field", () => {
  const e = errorsOf(mutate((r) => { delete r.landingZone.hubVnetId; delete r.landingZone.privateDnsZoneIds.aks; }, "alz"));
  assert.ok(e.some((x) => x.path === "landingZone.hubVnetId"));
  assert.ok(e.some((x) => x.path === "landingZone.privateDnsZoneIds.aks"));
});
