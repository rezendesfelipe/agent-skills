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

// The same repository was audited with the engine of `main` (the npm package) and with this one: the JSON output and the exit status
// were byte-identical (recorded in the pull request of vendor-stacks-engine-yaml); this pins what that run returned.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HERE } from "./helpers.mjs";

test("audit on a repository with an alias bomb, a CRLF file with a byte-order mark and a deeply nested file: exit status 1 and the same findings as before", () => {
  const r = mkdtempSync(join(tmpdir(), "ats-hostile-"));
  mkdirSync(join(r, ".github", "workflows"), { recursive: true });
  mkdirSync(join(r, "live"));
  let b = "l0: &l0 [x,x,x,x,x,x,x,x,x]\n";
  for (let i = 1; i <= 5; i++) b += `l${i}: &l${i} [${Array(9).fill(`*l${i - 1}`).join(",")}]\n`;
  const job = "jobs:\n  a:\n    runs-on: ubuntu-latest\n    steps:\n      - run: terraform apply\n";
  writeFileSync(join(r, ".github", "workflows", "bomb.yml"), `on: push\n${b}${job}`);
  writeFileSync(join(r, ".github", "workflows", "crlf.yml"), `\uFEFFon: push\r\n${job.replace(/\n/g, "\r\n").replace("terraform apply", "terraform apply -auto-approve")}`);
  writeFileSync(join(r, ".github", "workflows", "deep.yml"), `[${"[".repeat(1000)}${"]".repeat(1000)}]\n`);
  writeFileSync(join(r, "live", "main.tf"), 'terraform {\n  backend "azurerm" {}\n}\n');
  const env = { ...process.env };
  delete env.NODE_PATH;
  const out = spawnSync(process.execPath, [join(HERE, "..", "scripts", "stacks.mjs"), "audit", "--root", r, "--json"], { encoding: "utf8", env });
  assert.equal(out.status, 1, out.stderr);
  const j = JSON.parse(out.stdout);
  assert.equal(j.findings.length, 4);
  assert.deepEqual([...new Set(j.findings.map((f) => f.rule))].sort(), ["manual-trigger", "state-unknown", "versions"]);
});
