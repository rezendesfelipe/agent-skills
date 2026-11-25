// The attacks the independent review reproduced against the KQL allowlist and the projection rules (B-1 a, b, c; I-1),
// plus the variations (case, tabs, new lines, Unicode). Every query below was ACCEPTED by the first version.
// A query is accepted only if kqlProblems() AND the check-level rules (validateCheck) find nothing.
import assert from "node:assert/strict";
import { test } from "node:test";
import { validateCheck } from "../scripts/lib/catalog.mjs";
import { kqlProblems, projectionProblems } from "../scripts/lib/kql.mjs";

const STD = ["id", "name", "subscriptionId", "resourceGroup", "location"].map((name) => ({ name, type: "string" }));
const fieldsWith = (extra) => [...STD, ...extra];
const WAF = new Set(["SE:06"]);
const checkWith = (violations, outputFields) => ({
  id: "SE-TST-001", pillar: "security", title: "t",
  waf: [{ id: "SE:06", framework: "azure-waf", docDate: "2026-06-26", url: "https://learn.microsoft.com/azure/well-architected/security/checklist", relation: "primary", why: "w" }],
  chain: ["collector"],
  sources: { collector: { kind: "arg", scope: "tenant", evaluated: "resources | where type =~ 'microsoft.storage/storageaccounts' | summarize n=count()", violations } },
  proves: "p", doesNotProve: "d", outputFields, redact: [], limits: { maxRows: 1, maxPages: 1, maxParts: 1, timeoutSec: 1 }, requires: ["Reader"],
});
const refused = (violations, extraFields = []) => validateCheck(checkWith(violations, fieldsWith(extraFields)), { wafIds: WAF }).length > 0;
const BASE = "resources | where type =~ 'microsoft.storage/storageaccounts'";
const P = "id, name, subscriptionId, resourceGroup, location";

test("B-1 (a): an extend alias cannot carry a forbidden or object path into the project", () => {
  const v = { name: "v", type: "string" };
  for (const q of [
    `${BASE} | extend p = tostring(properties.administratorLoginPassword) | project ${P}, v = p`,
    `${BASE} | extend p = tostring(properties) | project ${P}, v = p`,
    `${BASE} | project ${P}, v = tostring(bag_pack('a', properties))`,
    `${BASE} | mv-expand p = properties.x | project ${P}, v = tostring(p)`,
    `${BASE} | join kind=leftouter (resources | project properties1 = properties) on $left.id == $right.properties1 | project ${P}, v = tostring(properties1)`,
    `${BASE} | extend p = tostring(properties.administratorLoginPassword) | project ${P}, p`,
    `${BASE} | extend v = pack_all() | project ${P}, v`,
  ]) {
    assert.ok(refused(q, [{ ...v, source: "properties.publicNetworkAccess" }]), `accepted: ${q}`);
    assert.ok(refused(q, [{ ...v, source: "properties.administratorLoginPassword" }]), `accepted with a forbidden source: ${q}`);
  }
});

test("B-1 (b): a path that is not on the reviewed allowlist is refused, however innocent it looks", () => {
  for (const path of ["properties.upgradePolicy", "properties.template", "properties.networkProfile", "properties.somethingElse", "properties.siteConfig.appSettings", "properties.primaryKey"]) {
    assert.ok(refused(`${BASE} | project ${P}, v = tostring(${path})`, [{ name: "v", type: "string", source: path }]), path);
  }
  assert.ok(!refused(`${BASE} | project ${P}, v = tostring(properties.publicNetworkAccess)`, [{ name: "v", type: "string", source: "properties.publicNetworkAccess" }]), "the control: an allowlisted path passes");
});

test("B-1 (b): the declared source and the projected expression must be the same, and typed", () => {
  const f = (extra) => [{ name: "v", type: "string", source: "properties.publicNetworkAccess", ...extra }];
  assert.ok(refused(`${BASE} | project ${P}, v = tostring(properties.minimumTlsVersion)`, f()), "another allowlisted path than the declared one");
  assert.ok(refused(`${BASE} | project ${P}, v = properties.publicNetworkAccess`, f()), "no conversion");
  assert.ok(refused(`${BASE} | project ${P}, v = tobool(properties.publicNetworkAccess)`, f()), "a conversion that is not the declared type's");
  assert.ok(refused(`${BASE} | project ${P}, v = tostring(properties.publicNetworkAccess)`, [{ name: "v", type: "bool", source: "properties.publicNetworkAccess" }]), "a bool field fed by a string path");
  assert.ok(refused(`${BASE} | project ${P}, v = tostring(properties.publicNetworkAccess)`, [{ name: "v", type: "string" }]), "no declared source at all");
});

test("B-1 (c): comments are refused, so a quote inside one cannot swallow real code", () => {
  const attack = "resources | where name == 'a' // '\n| project id, v=name\n| take 5\n| project id, v=name // '\n| project id, v=name";
  assert.ok(kqlProblems(attack).length);
  for (const bad of ["union securityresources", "evaluate bag_unpack(tags)", "externaldata(a:string)['https://example.invalid/x']"])
    assert.ok(kqlProblems(attack.replace("take 5", bad)).length, bad);
  assert.ok(kqlProblems("resources | project id /* ' */ | project id").length, "block comment");
  assert.ok(kqlProblems("resources // nothing\n| project id").length, "line comment");
  assert.ok(kqlProblems("resources | where url == 'https://example.invalid/x' | project id").length === 0, "// inside a literal is data, not a comment");
});

test("B-1 (c): a pipe inside a literal does not move the final project", () => {
  const q = "resources | where name == 'a|project id, v=name|b' | project id, v = tostring(properties)";
  assert.ok(projectionProblems(q, [{ name: "id", type: "string" }, { name: "v", type: "string", source: "properties.publicNetworkAccess" }]).length);
  assert.ok(projectionProblems(q, [{ name: "id", type: "string" }, { name: "v", type: "string", source: "name" }]).length);
  assert.deepEqual(kqlProblems("resources | where name == 'a|project|b' | project id"), [], "the control: a literal with pipes is fine");
});

test("B-1: the same attacks with other case, spaces, tabs, new lines and Unicode", () => {
  const f = [{ name: "v", type: "string", source: "properties.publicNetworkAccess" }];
  for (const q of [
    `${BASE} | PROJECT ${P}, v = TOSTRING(PROPERTIES)`,
    `${BASE} | Project ${P}, v = ToString(properties)`,
    `${BASE}\t|\tproject\t${P},\tv\t=\ttostring(properties)`,
    `${BASE}\n|\nproject ${P},\nv\n=\ntostring(\nproperties\n)`,
    `${BASE} | project ${P}, v = tostring(properties )`,
    `${BASE} | project ${P}, v = tostring( properties . upgradePolicy )`,
    `${BASE} | project ${P}, v = tostring(properties)`,
    `${BASE} | project ${P}, v = tostring(ｐroperties)`,
    `${BASE} | project ${P}, v = tostring(properties) | take 5`,
    `${BASE} | project ${P}, v​ = tostring(properties)`,
    `${BASE} | TAKE 5 | project ${P}`,
    `${BASE} | Take 5 | project ${P}`,
    `${BASE} | project ${P}, v = tostring(properties.publicNetworkAccess) | take 5`,
  ]) assert.ok(refused(q, f), `accepted: ${JSON.stringify(q)}`);
});

test("B-1: only ASCII and a closed set of characters outside string literals", () => {
  for (const q of ["resources | where name == 'a' | project id;", "resources | where @'x' == name | project id", "resources | where name == `x` | project id", "resources | where name == \"unterminated | project id", "resources | where a \\ b | project id", "resources | where x ? y | project id", "resources | project id # c"])
    assert.ok(kqlProblems(q).length, q);
});

test("the header of kql.mjs is true: a query it cannot classify is refused (unknown operator, unknown function shapes, unbalanced parentheses)", () => {
  for (const q of ["resources | frobnicate id", "resources | project id) | where (", "resources | where isnull(", "resources |", "| project id", ""]) assert.ok(kqlProblems(q).length, JSON.stringify(q));
});

test("I-1: Resource Graph does not support join kind=leftanti (or other kinds); the allowed kinds are the documented ones", () => {
  for (const kind of ["leftanti", "leftsemi", "rightanti", "rightouter", "rightsemi", "anti", "LEFTANTI"])
    assert.ok(kqlProblems(`resources | extend k = tolower(id) | join kind=${kind} (resources | extend kr = tolower(id) | project kr) on $left.k == $right.kr`).length, kind);
  for (const kind of ["leftouter", "inner", "innerunique", "fullouter"])
    assert.deepEqual(kqlProblems(`resources | extend k = tolower(id) | join kind=${kind} (resources | extend kr = tolower(id) | project kr) on $left.k == $right.kr`), [], kind);
});

test("summarize is for the evaluated query only; the violations query ends with a project", () => {
  assert.ok(refused(`${BASE} | summarize v = make_set(properties) by id | project ${P}`, []));
});
