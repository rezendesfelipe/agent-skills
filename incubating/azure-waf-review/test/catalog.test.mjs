// Catalog format, KQL allowlist, projection rules and the shipped catalog (tasks 1.2, 1.3, 1.5; specs "Fixed catalog",
// "Query allowlist", "Redaction before write", "Mapping to Well-Architected IDs").
import assert from "node:assert/strict";
import { cpSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { CATALOG_DIR, TOP_KEYS, loadCatalog, validateCatalog, validateCheck } from "../scripts/lib/catalog.mjs";
import { kqlProblems, projectionProblems } from "../scripts/lib/kql.mjs";
import { tmp } from "./helpers.mjs";

const WAF_IDS = new Set(["SE:06", "SE:09", "RE:05", "CO:07"]);
const FIELDS = ["id", "name", "subscriptionId", "resourceGroup", "location", "publicAccess"].map((name) => ({ name, type: "string", ...(name === "publicAccess" ? { source: "properties.allowBlobPublicAccess" } : {}) }));
const goodCheck = () => ({
  id: "SE-TST-001", pillar: "security", title: "Test check",
  waf: [{ id: "SE:06", framework: "azure-waf", docDate: "2026-06-26", url: "https://learn.microsoft.com/azure/well-architected/security/networking", relation: "primary", why: "A short reason." }],
  chain: ["collector", "questionnaire"],
  sources: {
    collector: {
      kind: "arg", scope: "tenant",
      evaluated: "resources | where type =~ 'microsoft.storage/storageaccounts' | summarize n=count()",
      violations: "resources | where type =~ 'microsoft.storage/storageaccounts' | where properties.allowBlobPublicAccess == true | project id, name, subscriptionId, resourceGroup, location, publicAccess=tostring(properties.allowBlobPublicAccess)",
    },
    questionnaire: { id: "Q-SE-TST-001", text: { en: "Is it so?", "pt-BR": "Isso é assim?" } },
  },
  proves: "The setting is on.", doesNotProve: "That a container is public.",
  outputFields: structuredClone(FIELDS), redact: [], limits: { maxRows: 20000, maxPages: 20, maxParts: 40, timeoutSec: 30 }, requires: ["Reader"],
});
const ctx = { wafIds: WAF_IDS };
const problems = (mut) => { const c = goodCheck(); mut(c); return validateCheck(c, ctx); };

test("a good check has no problem", () => assert.deepEqual(validateCheck(goodCheck(), ctx), []));

test("one failing fixture per catalog rule", () => {
  const rules = [
    ["missing doesNotProve", (c) => { delete c.doesNotProve; }, /doesNotProve/],
    ["missing proves", (c) => { delete c.proves; }, /proves/],
    ["unknown kind", (c) => { c.sources.collector.kind = "powershell"; }, /kind/],
    ["WAF id not in the shipped list", (c) => { c.waf[0].id = "SE:99"; }, /SE:99/],
    ["empty waf without reason", (c) => { c.waf = []; }, /wafReason|reason/],
    ["mapping without why", (c) => { c.waf[0].why = ""; }, /why/],
    ["mapping without doc date", (c) => { delete c.waf[0].docDate; }, /docDate/],
    ["no limits", (c) => { delete c.limits; }, /limits/],
    ["no requires", (c) => { delete c.requires; }, /requires/],
    ["bad pillar", (c) => { c.pillar = "governance"; }, /pillar/],
    ["bad id", (c) => { c.id = "lower case"; }, /id/],
    ["chain with an unknown source", (c) => { c.chain = ["collector", "shell"]; }, /chain/],
    ["chain starts with mcp", (c) => { c.chain = ["mcp", "collector"]; }, /collector|mcp/],
    ["output type object", (c) => { c.outputFields[5].type = "object"; }, /type/],
    ["enum without values", (c) => { c.outputFields[5] = { name: "publicAccess", type: "enum" }; }, /enum|values/],
    ["first output field is not id", (c) => { c.outputFields.reverse(); }, /first/],
    ["a real-looking GUID literal", (c) => { c.sources.collector.evaluated += " | where subscriptionId == '8e3af657-1111-4444-8888-123456789abc'"; }, /GUID/i],
  ];
  for (const [name, mut, re] of rules) {
    const p = problems(mut);
    assert.ok(p.length, `rule not enforced: ${name}`);
    assert.match(p.join("\n"), re, `rule ${name}: ${p.join(" | ")}`);
  }
});

test("a check with waf [] is accepted only with a reason", () => {
  const c = goodCheck();
  c.waf = [];
  c.wafReason = "Hygiene check, no checklist item names it.";
  assert.deepEqual(validateCheck(c, ctx), []);
});

test("KQL allowlist: read operators pass, the rest is refused", () => {
  assert.deepEqual(kqlProblems("resources | where type =~ 'a' | project id, name | order by name asc"), []);
  assert.deepEqual(kqlProblems("resourcecontainers | where type =~ 'microsoft.resources/subscriptions' | summarize n=count()"), []);
  assert.deepEqual(kqlProblems("resources | extend k=tolower(id) | mv-expand z=zones | project id"), []);
  assert.deepEqual(kqlProblems("resources | extend vmKey=tolower(id) | join kind=leftouter (recoveryservicesresources | extend vmKey=tolower(id), hitR='y' | project vmKey, hitR) on vmKey | where isempty(hitR)"), []);
  for (const q of [
    "resources | take 5", "resources | limit 5", "resources | sample 5", "resources | top 5 by name", "resources | where id == 'a' | take 1",
    "resources | evaluate bag_unpack(tags)", "externaldata(a:string)['https://example.invalid/x']", "resources | project id; resources",
    ".show tables", "resources | union resources", "nosuchtable | project id", "resources | join kind=inner (resources | take 3) on id",
    "resources | project id | invoke x()", "resources | getschema",
  ]) assert.ok(kqlProblems(q).length, `accepted: ${q}`);
});

test("take, limit and sample are refused by their own rule, not only by the operator list", () => {
  for (const w of ["take", "limit", "sample"]) {
    const msgs = kqlProblems(`resources | where id != '' | extend z = ${w}`).join("\n");
    assert.match(msgs, new RegExp(`word "${w}"`), `${w} as a word inside an expression`);
  }
});

test("KQL allowlist: words inside string literals and longer identifiers are not operators", () => {
  assert.deepEqual(kqlProblems("resources | where name == 'take a sample' | extend limits = 1, taken = 2 | project id"), []);
});

test("projection: each projected column must come from a declared source on the reviewed allowlist", () => {
  const f = (...names) => names.map((name) => ({ name, type: "string", ...(["id", "name", "subscriptionId", "resourceGroup", "location"].includes(name) ? {} : { source: `properties.${name}` }) }));
  const q = (proj) => `resources | where type =~ 'x' | project ${proj}`;
  assert.deepEqual(projectionProblems(q("id, name"), f("id", "name")), []);
  assert.deepEqual(projectionProblems(q("id, publicNetworkAccess=tostring(properties.publicNetworkAccess)"), f("id", "publicNetworkAccess")), []);
  // a bare object column, whatever the declaration says
  for (const name of ["properties", "tags", "sku", "identity", "zones", "plan"]) assert.ok(projectionProblems(q(`id, ${name}`), [{ name: "id", type: "string" }, { name, type: "string", source: name }]).length, name);
  assert.ok(projectionProblems(q("id, name"), f("id")).length, "a projected column that is not declared");
  assert.ok(projectionProblems(q("id"), f("id", "name")).length, "a declared field that is not projected");
  assert.ok(projectionProblems(q("id, tostring(properties.publicNetworkAccess)"), f("id")).length, "an unnamed expression");
  // a tag value needs a tagKey field so the engine can hash it
  const tag = [{ name: "id", type: "string" }, { name: "o", type: "string", tagKey: "owner", source: "tags['owner']" }];
  assert.deepEqual(projectionProblems(q("id, o=tostring(tags['owner'])"), tag), []);
  assert.ok(projectionProblems(q("id, o=tostring(tags['owner'])"), [{ name: "id", type: "string" }, { name: "o", type: "string", source: "tags['owner']" }]).length);
});

test("never-project types and names are refused even when the projection looks scalar", () => {
  const c = goodCheck();
  c.sources.collector.violations = "resources | where type =~ 'microsoft.web/sites' | project id, name, subscriptionId, resourceGroup, location, publicAccess=tostring(properties.siteConfig.appSettings)";
  assert.match(validateCheck(c, ctx).join("\n"), /appsettings|never project/i);
  const d = goodCheck();
  d.sources.collector.violations = "resources | where type =~ 'microsoft.containerinstance/containergroups' | project id, name, subscriptionId, resourceGroup, location, publicAccess=tostring(properties.x)";
  assert.match(validateCheck(d, ctx).join("\n"), /never project|containergroups/i);
});

test("rest-get: only management.azure.com, with api-version, GET", () => {
  const rest = (url) => { const c = goodCheck(); c.sources.collector = { kind: "rest-get", scope: "subscription", url, violationWhen: "empty-value" }; return validateCheck(c, ctx).join("\n"); };
  assert.equal(rest("https://management.azure.com/subscriptions/{subscriptionId}/providers/Microsoft.Authorization/locks?api-version=2016-09-01"), "");
  for (const bad of ["https://example.invalid/subscriptions/{subscriptionId}/x?api-version=1", "http://management.azure.com/x?api-version=1", "https://management.azure.com.evil.test/x?api-version=1", "https://management.azure.com@evil.test/x?api-version=1", "https://management.azure.com/x"])
    assert.match(rest(bad), /host|https|api-version/i, bad);
});

test("az-read: only a vector of the closed list", () => {
  const az = (vector) => { const c = goodCheck(); c.sources.collector = { kind: "az-read", vector }; return validateCheck(c, ctx).join("\n"); };
  assert.equal(az(["az", "account", "list", "--all"]), "");
  assert.match(az(["az", "account", "get-access-token"]), /closed|list/i);
});

test("the shipped catalog is valid, small, honest and covers every pillar", () => {
  const cat = loadCatalog();
  assert.ok(cat.checks.length >= 20 && cat.checks.length <= 30, `size ${cat.checks.length}`);
  assert.match(cat.sha256, /^[0-9a-f]{64}$/);
  assert.deepEqual(validateCatalog(cat.checks, { wafIds: cat.wafIds }), []);
  for (const p of ["security", "reliability", "cost", "operations", "performance"]) {
    const of = cat.checks.filter((c) => c.pillar === p);
    assert.ok(of.length >= 1, `${p}: no check`);
    assert.ok(of.some((c) => !c.sources.collector && c.chain.includes("questionnaire")), `${p}: no practice-only questionnaire item`);
  }
  assert.equal(new Set(cat.checks.map((c) => c.id)).size, cat.checks.length);
  for (const c of cat.checks) assert.ok(c.proves && c.doesNotProve, c.id);
});

test("every WAF id of the shipped list has our own title and the ranges of the five checklists", () => {
  const cat = loadCatalog();
  const n = (p) => [...cat.wafIds.keys()].filter((k) => k.startsWith(`${p}:`)).length;
  assert.deepEqual([n("RE"), n("SE"), n("CO"), n("OE"), n("PE")], [10, 12, 14, 11, 12]);
  for (const [id, t] of cat.wafIds) assert.ok(t.title && t.title.length < 80, id);
});

test("checks that read what the Azure MCP does not cover have no mcp in the chain", () => {
  const cat = loadCatalog();
  const mcpBlind = /securityresources|policyresources|networkresources|microsoft\.network\/networksecuritygroups|resourcecontainers|authorizationresources/i;
  for (const c of cat.checks) {
    const q = c.sources.collector?.violations ?? "";
    if (mcpBlind.test(q)) assert.ok(!c.chain.includes("mcp"), `${c.id} lists mcp`);
    assert.equal(c.chain.indexOf("collector") <= c.chain.indexOf("mcp") || !c.chain.includes("mcp"), true);
  }
});

test("catalog hash does not depend on line endings", () => {
  const dir = tmp("waf-cat-");
  mkdirSync(join(dir, "catalog"));
  for (const f of readdirSync(CATALOG_DIR)) {
    const t = readFileSync(join(CATALOG_DIR, f), "utf8");
    writeFileSync(join(dir, "catalog", f), f.endsWith(".json") ? t.replace(/\r?\n/g, "\r\n") : t);
  }
  assert.equal(loadCatalog(join(dir, "catalog")).sha256, loadCatalog().sha256);
});

test("an invalid catalog directory fails loudly and names the entry", () => {
  const dir = tmp("waf-cat-");
  cpSync(CATALOG_DIR, join(dir, "catalog"), { recursive: true });
  const f = join(dir, "catalog", "security.json");
  const j = JSON.parse(readFileSync(f, "utf8"));
  delete j.checks[0].doesNotProve;
  writeFileSync(f, JSON.stringify(j));
  assert.throws(() => loadCatalog(join(dir, "catalog")), new RegExp(j.checks[0].id));
});

test("check.schema.json documents exactly the keys the validator accepts, and the shipped catalog uses only them", () => {
  const schema = JSON.parse(readFileSync(join(CATALOG_DIR, "check.schema.json"), "utf8"));
  assert.deepEqual(Object.keys(schema.properties).sort(), [...TOP_KEYS].sort());
  for (const k of schema.required) assert.ok(TOP_KEYS.has(k));
  for (const c of loadCatalog().checks) for (const k of schema.required) assert.ok(k in c, `${c.id} lacks ${k}`);
});

test("WAF labels follow the official checklists (the review found OE:06 and OE:09 wrong; the labels are ours, the meaning is theirs)", () => {
  const t = (id) => loadCatalog().wafIds.get(id).title;
  assert.match(t("OE:06"), /supply chain|pipeline/i);
  assert.match(t("OE:09"), /testing/i);
  assert.match(t("OE:10"), /automation/i);
  assert.match(t("OE:11"), /deployment/i);
  assert.match(t("RE:09"), /disaster recovery/i);
  assert.match(t("SE:07"), /encrypt/i);
  assert.match(t("SE:10"), /monitor/i);
  assert.match(t("CO:03"), /cost data/i);
});
