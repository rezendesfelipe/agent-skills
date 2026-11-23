// `check` and `audit` share rules.mjs. This pins what `check` reports, finding by finding, on every
// fixture and on every mutation case, so a change to a shared rule shows up as a diff here.
// Regenerate with: node test/update-golden-findings.mjs (review the diff first).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { HERE } from "./helpers.mjs";
import { allScenarios } from "./golden-findings-lib.mjs";

test("check findings are unchanged on all fixtures and mutation cases", () => {
  const golden = JSON.parse(readFileSync(join(HERE, "golden-findings.json"), "utf8"));
  const now = JSON.parse(JSON.stringify(allScenarios()));
  assert.deepEqual(Object.keys(now), Object.keys(golden));
  for (const k of Object.keys(golden)) assert.deepEqual(now[k], golden[k], k);
});
