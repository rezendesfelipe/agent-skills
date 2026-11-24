import assert from "node:assert/strict";
import { test } from "node:test";
import { fmt, keyPaths, LANGS, loadLabels } from "../scripts/lib/locales.mjs";

test("en, pt-BR and es have exactly the same keys (a missing key names the key and the locale)", () => {
  const en = keyPaths(loadLabels("en")).sort();
  for (const lang of LANGS.filter((l) => l !== "en")) {
    const got = new Set(keyPaths(loadLabels(lang)));
    const missing = en.filter((k) => !got.has(k));
    assert.deepEqual(missing, [], `${lang} is missing: ${missing.join(", ")}`);
    const extra = [...got].filter((k) => !en.includes(k));
    assert.deepEqual(extra, [], `${lang} has keys that en does not: ${extra.join(", ")}`);
  }
});

test("every placeholder of the English labels exists in the translations", () => {
  const ph = (s) => [...String(s).matchAll(/\{([a-zA-Z0-9]+)\}/g)].map((m) => m[1]).sort().join(",");
  const flat = (o, p = "") => Object.entries(o).flatMap(([k, v]) => (typeof v === "object" ? flat(v, `${p}${k}.`) : [[`${p}${k}`, v]]));
  const en = Object.fromEntries(flat(loadLabels("en")));
  for (const lang of ["pt-BR", "es"])
    for (const [k, v] of flat(loadLabels(lang))) assert.equal(ph(v), ph(en[k]), `${lang}.${k}`);
});

test("fixed labels cover every severity, confidence, risk and result the engine can emit", () => {
  for (const lang of LANGS) {
    const L = loadLabels(lang);
    for (const s of ["Critical", "High", "Medium", "Low", "Info", "n/a"]) assert.ok(L.severityNames[s], `${lang} severity ${s}`);
    for (const c of ["verified", "corroborated", "reported", "unverified"]) assert.ok(L.confidenceNames[c], `${lang} confidence ${c}`);
    for (const r of ["low", "medium", "high"]) assert.ok(L.riskNames[r]);
    for (const r of ["pass", "fail", "unchecked"]) assert.ok(L.resultNames[r] && L.controlStatus[r]);
  }
});

test("fmt fills placeholders and leaves unknown ones alone", () => {
  assert.equal(fmt("a {x} b {y}", { x: 1 }), "a 1 b {y}");
});

test("an unsupported language is refused", () => {
  assert.throws(() => loadLabels("fr"), /unsupported language/);
});
