// The vendored copy against the npm package (the oracle, a devDependency). Needs `npm ci` in the skill folder; without it the
// test says so and is skipped. REQUIRE_YAML_ORACLE=1 (CI parity job) turns a skip into a failure.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, extname } from "node:path";
import { createRequire } from "node:module";
import { HERE } from "./helpers.mjs";
import { cases, childCases, parityOnlyChildCases, runAll, runOne } from "./yaml-corpus/cases.mjs";
import { runChild } from "./yaml-corpus/run.mjs";
import YAML from "../scripts/lib/yaml.mjs";

const SKILL = join(HERE, "..");
const required = process.env.REQUIRE_YAML_ORACLE === "1";
const require_ = createRequire(join(SKILL, "package.json"));
let oracle = null;
try { oracle = require_("yaml"); } catch { /* not installed */ }
const missing = oracle ? false : "the oracle package is not installed (run `npm ci` in the skill folder); parity not checked";
if (missing && required) test("the oracle is installed", () => assert.fail(missing));

const opts = { skip: missing && !required ? missing : false };

test("the oracle has the vendored version", opts, () => {
  const record = JSON.parse(readFileSync(join(SKILL, "scripts", "vendor", "yaml", "PROVENANCE.json"), "utf8"));
  assert.equal(require_("yaml/package.json").version, record.version);
});

test("every in-process corpus case: vendored copy equals package", opts, async () => {
  const a = JSON.parse(JSON.stringify(await runAll(YAML)));
  const b = JSON.parse(JSON.stringify(await runAll(oracle)));
  assert.deepEqual(a, b);
});

function yamlFiles(dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...yamlFiles(p));
    else if ([".yaml", ".yml"].includes(extname(e.name))) out.push(p);
  }
  return out;
}

test("every YAML file under test/fixtures and test/golden: vendored copy equals package", opts, () => {
  const files = [...yamlFiles(join(HERE, "fixtures")), ...yamlFiles(join(HERE, "golden"))];
  assert.ok(files.length > 20, `only ${files.length} files`);
  for (const f of files) {
    const text = readFileSync(f, "utf8");
    assert.deepEqual(JSON.parse(JSON.stringify(runOne(YAML, text))), JSON.parse(JSON.stringify(runOne(oracle, text))), f);
  }
});

for (const name of Object.keys(childCases)) {
  test(`child process case ${name}: same ending for the vendored copy and the package`, opts, () => {
    const a = runChild(name, "facade");
    const b = runChild(name, "package");
    assert.equal(a.status, b.status);
    assert.deepEqual(a.steps, b.steps);
  });
}

// A flow collection nested 1,000 deep (a caught stack overflow) and then 10,000 deep, in one process. Observed on yaml 2.9.1: whether V8
// aborts depends on the stack and heap state, so the same code can end either way depending on how it was loaded (an observation of the
// change vendor-stacks-engine-yaml, design P1.3). The only claim here: each run either finishes with the parser's own refusal or ends the
// process; it never hangs.
for (const name of Object.keys(parityOnlyChildCases)) {
  test(`child process case ${name}: finishes with the parser's refusal or ends the process, for both copies`, opts, () => {
    for (const mode of ["facade", "package"]) {
      const r = runChild(name, mode);
      assert.notEqual(r.signal, "SIGTERM", `${mode} did not finish within the time limit`);
      if (r.status === 0) assert.ok(r.steps.every((x) => x.code === "RESOURCE_EXHAUSTION"), JSON.stringify(r.steps));
    }
  });
}
