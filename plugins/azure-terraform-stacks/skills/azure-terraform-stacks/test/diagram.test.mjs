import { test } from "node:test";
import assert from "node:assert/strict";
import { generateDiagrams, checkDiagram, untouched, resolveTheme, exportDiagram, ICONS } from "../scripts/lib/diagram.mjs";
import { manifestOf, rawFixture } from "./helpers.mjs";

const xmlOf = (f, opts = {}) => [...generateDiagrams(manifestOf(f), opts).files.values()][0];

test("standalone diagram shows every resource with its stack and passes the checks", () => {
  const xml = xmlOf("full");
  for (const r of ["vnet-core-prod-brs-01", "aks-core-prod-brs-01", "crcoreprodbrs01", "pgsql-orders-prod-brs-01", "kv-orders-prod-brs-01", "pep-cr-core-prod-brs-01", "pep-kv-orders-prod-brs-01", "privatelink.azurecr.io", "privatelink.vaultcore.azure.net", "prod-brs-01.postgres.database.azure.com"]) {
    assert.match(xml, new RegExp(`resource="${r.replace(/\./g, "\\.")}"`), r);
  }
  for (const s of ["snet-aks-prod-brs-01", "snet-endpoints-prod-brs-01", "snet-postgres-prod-brs-01", "snet-agents-prod-brs-01"]) assert.match(xml, new RegExp(s));
  assert.match(xml, /Argo CD/);
  assert.deepEqual(checkDiagram(xml, manifestOf("full")), []);
});

test("alz diagram puts the hub and central zones in an external connectivity subscription", () => {
  const xml = xmlOf("alz");
  assert.match(xml, /Connectivity subscription · platform team \(external\)/);
  assert.match(xml, /records by Azure Policy/);
  const workload = xml.slice(0, xml.indexOf("Connectivity subscription"));
  assert.doesNotMatch(workload, /resource="privatelink\./);
  assert.deepEqual(checkDiagram(xml, manifestOf("alz")), []);
});

test("diagram XML follows the draw.io rules", () => {
  const xml = xmlOf("full");
  assert.match(xml, /<mxCell id="0" \/>\n\s*<mxCell id="1" parent="0" \/>/);
  assert.doesNotMatch(xml, /edge="1"[^>]*\/>/, "edges are never self-closing");
  assert.match(xml, /edgeStyle=orthogonalEdgeStyle;rounded=1;orthogonalLoop=1;jettySize=auto;html=1;/);
  for (const img of xml.matchAll(/image=([^;"]+)/g)) assert.ok(Object.values(ICONS).includes(img[1]), img[1]);
});

test("generation is deterministic and the hash detects edits", () => {
  const a = xmlOf("full"), b = xmlOf("full");
  assert.equal(a, b);
  assert.ok(untouched(a));
  assert.equal(untouched(a.replace("Argo CD", "ArgoCD")), false);
});

test("check-diagram reports dangling edges, unknown icons and overlaps", () => {
  let xml = xmlOf("full");
  xml = xml.replace(/target="([^"]+)"/, 'target="nope"');
  xml = xml.replace("img/lib/azure2/containers/Kubernetes_Services.svg", "img/lib/azure2/containers/Guess.svg");
  xml = xml.replace(/(<mxCell id="nothing"|<UserObject id="crcoreprodbrs01"[\s\S]*?<mxGeometry )x="\d+" y="\d+"/, '$1x="70" y="410"');
  const p = checkDiagram(xml, manifestOf("full"));
  assert.ok(p.some((x) => /edge target nope does not exist/.test(x)), p.join("\n"));
  assert.ok(p.some((x) => /Guess\.svg is not in diagram\/icons\.json/.test(x)));
});

test("overlapping siblings are reported", () => {
  const xml = xmlOf("full").replace(/(<UserObject id="kv-orders-prod-brs-01"[\s\S]*?<mxGeometry )x="\d+" y="\d+"/, (m, a) => `${a}x="70" y="${/crcoreprodbrs01[\s\S]*?y="(\d+)"/.exec(xmlOf("full"))[1]}"`);
  assert.ok(checkDiagram(xml, manifestOf("full")).some((x) => /overlap/.test(x)));
});

test("custom theme tokens are contrast-checked", () => {
  assert.deepEqual(resolveTheme({ background: "#0b1326", surface: "#171f33", border: "#45464d", text: "#dae2fd", textSecondary: "#c6c6cd", accent: "#2fd9f4" }).errors, []);
  const bad = resolveTheme({ background: "#ffffff", text: "#cccccc" });
  assert.ok(bad.errors.some((e) => /text #cccccc on background #ffffff has contrast/.test(e)));
});

test("theme from the manifest is applied", () => {
  const raw = rawFixture("full");
  raw.diagram = { theme: "dark" };
  const xml = [...generateDiagrams(manifestOf(raw), {}).files.values()][0];
  assert.match(xml, /background="#111827"/);
});

test("export without draw.io writes nothing and returns the install hint", () => {
  const save = { PATH: process.env.PATH, DRAWIO_BIN: process.env.DRAWIO_BIN };
  process.env.PATH = "/nonexistent"; process.env.DRAWIO_BIN = "/nonexistent/drawio";
  try {
    const r = exportDiagram("/tmp/x.drawio", ["svg", "png"]);
    assert.deepEqual(r.skipped, ["svg", "png"]);
    assert.match(r.hint, /draw\.io desktop/);
  } finally { process.env.PATH = save.PATH; if (save.DRAWIO_BIN) process.env.DRAWIO_BIN = save.DRAWIO_BIN; else delete process.env.DRAWIO_BIN; }
});
