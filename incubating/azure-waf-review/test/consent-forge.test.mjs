// A forged consent.json (the reviewers' attacks on 1a, applied to the new file): an edited stage, an edited count, a changed text, a
// changed hash, a role added, a flag flipped. Every crude edit must be seen by the file's own checks; a forgery that recomputes the text
// and both hashes passes them (documented: tamper-evident only) and is caught by the seal in the manifest (production.test.mjs).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { sha256 } from "../scripts/lib/util.mjs";
import { PHRASES, ROLE, SUB1, SUB2, SUB3, baseArgs, consentCtx, consentTransport, scriptedIo, sub } from "./prod-helpers.mjs";

const lib = () => import("../scripts/lib/consent.mjs");
async function valid(over = {}) {
  const { runConsent } = await lib();
  const ctx = consentCtx();
  const r = await runConsent({ args: baseArgs(over.args), transport: over.transport ?? consentTransport(), io: scriptedIo(over.answers ?? [PHRASES.yes]), ...ctx });
  assert.equal(r.ok, true, r.message);
  return JSON.parse(readFileSync(r.file, "utf8"));
}
const text = (c) => { c.storedText = `${c.storedText}\nextra`; };
const MUTATIONS = {
  "stage nonprod to root-mg": (c) => { c.stage = "root-mg"; },
  "stage nonprod to one-prod": (c) => { c.stage = "one-prod"; },
  "expectedSubs altered": (c) => { c.expectedSubs = 3; },
  "readSubs altered": (c) => { c.readSubs = 5; },
  "scope.visible altered": (c) => { c.scope.visible = 9; },
  "scope.expected altered": (c) => { c.scope.expected = 1; },
  "a subscription added to the scope": (c) => { c.scope.subscriptions.push(SUB3); },
  "complete flipped while not covered is listed": (c) => { c.scope.notCovered.push({ id: SUB3, state: "Disabled", reason: "x" }); },
  "queryBudget raised": (c) => { c.queryBudget = 100000; },
  "queryBudget not a number": (c) => { c.queryBudget = "6000"; },
  "redact flipped": (c) => { c.redact = "strict"; },
  "createdAt edited": (c) => { c.createdAt = "2027-01-01T00:00:00.000Z"; },
  "createdAt not a time": (c) => { c.createdAt = "yesterday"; },
  "runId edited": (c) => { c.runId = "other"; },
  "an Owner role added": (c) => { c.identity.roles.push({ guid: ROLE.owner, name: "Owner", scope: "/" }); },
  "an unlisted role added without the acknowledgment": (c) => { c.identity.roles.push({ guid: ROLE.custom, name: null, scope: "/" }); },
  "principalVerified flipped": (c) => { c.identity.principalVerified = false; },
  "the az path made a Windows launcher": (c) => { c.az.path = "/mnt/c/x/az.cmd"; },
  "windowsLauncher flipped": (c) => { c.az.windowsLauncher = true; },
  "profile marked not isolated": (c) => { c.profile.isolated = false; },
  "mcp flipped": (c) => { c.mcp = "used"; },
  "an unknown field added": (c) => { c.extra = "x"; },
  "the text edited (hash now wrong)": text,
  "the text hash edited": (c) => { c.storedTextSha256 = "0".repeat(64); },
  "the shown-text hash edited": (c) => { c.textSha256 = "1".repeat(64); },
  "text and its hash edited but not the fields": (c) => { c.storedText = `${c.storedText}\nextra`; c.storedTextSha256 = sha256(c.storedText); c.textSha256 = c.storedTextSha256; },
  "retention confirmation added on nonprod": (c) => { c.acks.retention = true; },
  "previousStage added on nonprod": (c) => { c.acks.previousStage = { reviewed: true, run: "x", skipped: false }; },
  "the tenant hash removed": (c) => { delete c.tenant.sha256; },
  "the schema changed": (c) => { c.schema = "waf-consent/2"; },
};

test("every crude edit of a valid consent.json is seen by consentProblems", async () => {
  const { consentProblems } = await lib();
  const base = await valid();
  assert.deepEqual(consentProblems(base, { runId: "r1" }), []);
  for (const [name, mutate] of Object.entries(MUTATIONS)) {
    const c = structuredClone(base);
    mutate(c);
    assert.ok(consentProblems(c, { runId: "r1" }).length > 0, `not seen: ${name}`);
  }
});

test("the run folder's own name must be the consent's run id", async () => {
  const { consentProblems } = await lib();
  const base = await valid();
  assert.ok(consentProblems(base, { runId: "r2" }).length > 0);
});

test("a one-prod or root-mg consent is not valid without its confirmations", async () => {
  const { consentProblems } = await lib();
  const c = await valid({ args: { stage: "one-prod", expectedSubs: "1", subscriptions: SUB1 }, transport: consentTransport({ accounts: [sub(SUB1, "p")] }), answers: [PHRASES.retention, PHRASES.acceptance, PHRASES.skip, PHRASES.yes] });
  assert.deepEqual(consentProblems(c, { runId: "r1" }), []);
  for (const mutate of [(x) => { x.acks.retention = false; }, (x) => { x.acks.acceptance = false; }, (x) => { x.acks.previousStage = null; }, (x) => { x.acks.previousStage = { reviewed: true, run: null, skipped: true }; }]) {
    const x = structuredClone(c);
    mutate(x);
    assert.ok(consentProblems(x, { runId: "r1" }).length > 0);
  }
  const two = structuredClone(c);
  two.scope.subscriptions.push(SUB2);
  assert.ok(consentProblems(two, { runId: "r1" }).length > 0, "one-prod is exactly one subscription");
});

test("what is not an object, or is missing, is a problem and not a crash", async () => {
  const { consentProblems, readConsent } = await lib();
  for (const x of [null, [], "x", 3, {}, { schema: "waf-consent/1" }, { schema: "waf-consent/1", scope: null, identity: null }]) assert.ok(consentProblems(x, { runId: "r1" }).length > 0);
  assert.ok(readConsent("/nonexistent/waf-review/r1", "r1").problems.length > 0);
});
