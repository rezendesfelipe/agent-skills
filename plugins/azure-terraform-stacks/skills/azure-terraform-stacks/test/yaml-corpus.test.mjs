// The golden corpus: what the engine's parser returns for hostile and awkward YAML. Runs with no node_modules.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { cases, childCases, runAll } from "./yaml-corpus/cases.mjs";
import { GOLDEN, runChild } from "./yaml-corpus/run.mjs";
import YAML from "../scripts/lib/yaml.mjs";

const golden = JSON.parse(readFileSync(GOLDEN, "utf8"));

test("every in-process case equals the golden file", async () => {
  const got = JSON.parse(JSON.stringify(await runAll(YAML)));
  assert.deepEqual(Object.keys(got), Object.keys(golden.inProcess));
  for (const name of Object.keys(cases)) assert.deepEqual(got[name], golden.inProcess[name], name);
});

test("the corpus has the cases the specification names", () => {
  for (const n of ["alias-bomb", "alias-reuse", "tag-custom", "merge-key", "dup-keys", "multi-doc", "doc-markers", "crlf", "lone-cr", "bom", "tabs", "unknown-alias", "add-stack"]) assert.ok(n in cases, n);
  for (const n of ["flow-5000", "block-3000", "scalar-1MiB"]) assert.ok(n in childCases, n);
});

test("the alias bomb ends with the parser's own refusal", () => {
  assert.match(golden.inProcess["alias-bomb"].parse.error.message, /Excessive alias count/);
});

for (const name of Object.keys(childCases)) {
  test(`child process case ${name}: same exit status and result as the golden file`, () => {
    const r = runChild(name, "facade");
    assert.equal(r.status, golden.child[name].status);
    assert.deepEqual(r.steps, golden.child[name].steps);
  });
}
