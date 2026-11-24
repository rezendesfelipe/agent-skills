// Light property test of the secret scanner with a fixed seed: generated pathological inputs must not throw, must stay
// within the time bounds, must scale linearly, and a planted secret must give the same kinds on one long line as on the
// same text split into short lines. A failure names the seed and the case index, never the input. No dependency.
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { test } from "node:test";
import { MAX_SCAN_LINE_CHARS, scanString } from "../scripts/lib/secrets.mjs";
import { fakeSecret, mulberry32 } from "./helpers.mjs";
import { SCAN_TIME_BOUND_MS, measure, scalesFor } from "./scan-inputs.mjs";

const SEED = 424242; // fixed: the same cases on every run and machine
const CASES = 36;
const BUDGET_MS = 5000; // initial value: the whole test on a developer machine
const c = (...p) => p.join("");

// building blocks of pathological input; none is a credential on its own
const TOKENS = ["a", "ab", "ab12", "x1y2z3", "db", "client", "id", "a1B2"];
const SEPARATORS = [".", "_", "-", ":", "=", " ", "\t", "/", ",", ";"];
const PREFIXES = ["var.", "local.", "data.", "module.", "each.", "path.", "self.", "a_b.c.", "!!", "!", "&", "*", "|", ">"];
const SCHEMES = ["a://", "ab+c://", "a.b://", "x://u:", "http://", "z.z.z."];
const BREAKS = ["\n", "\r\n", "\r", "\n\n"];
const NAMES = [c("pass", "word"), c("to", "ken"), c("sec", "ret"), c("api_", "key")];

const pick = (rnd, a) => a[Math.floor(rnd() * a.length)];

/** A pathological single input of about `length` characters, from a few families chosen by the generator. */
function pathological(rnd, length) {
  const family = Math.floor(rnd() * 8);
  const unit = [
    () => pick(rnd, TOKENS) + pick(rnd, SEPARATORS),
    () => "a.",
    () => "x",
    () => pick(rnd, PREFIXES),
    () => pick(rnd, SCHEMES),
    () => pick(rnd, NAMES) + pick(rnd, ["=", ":", ": ", " = "]) + pick(rnd, ["", "!!str ", "&a ", "*a ", "!Sub "]),
    () => pick(rnd, TOKENS) + pick(rnd, BREAKS),
    () => pick(rnd, [...TOKENS, ...PREFIXES, ...SCHEMES]) + pick(rnd, SEPARATORS),
  ][family];
  // a fixed unit repeated, or a mix, so both a pure repetition and a varied one are covered
  const fixed = unit();
  let out = "";
  const mix = rnd() < 0.5;
  while (out.length < length) out += mix ? unit() : fixed;
  return out.slice(0, length) + (rnd() < 0.3 ? "(" : "");
}

test(`property: pathological inputs (seed ${SEED}, ${CASES} cases) do not throw, stay in bounds and scale linearly`, async () => {
  const rnd = mulberry32(SEED);
  const started = performance.now();
  for (let i = 0; i < CASES; i++) {
    const length = 16000 + Math.floor(rnd() * 48000);
    const text = pathological(rnd, length);
    const where = `seed ${SEED}, case ${i}`;
    assert.ok(Array.isArray(scanString(text)), where);
    const m = await measure({ text }, { runs: 1 }).catch((e) => assert.fail(`${where}: ${e.message}`));
    assert.ok(m.scan < SCAN_TIME_BOUND_MS, `${where}: ${m.scan.toFixed(0)} ms for ${length} characters`);
    if (i % 3 === 0) {
      const r = await scalesFor(text, text + text).catch((e) => assert.fail(`${where}: ${e.message}`));
      assert.ok(r.ok, `${where}: doubling took ${r.detail}`);
    }
  }
  assert.ok(performance.now() - started < BUDGET_MS, `the property test took more than ${BUDGET_MS} ms (initial value)`);
});

test(`property: a planted secret gives the same kinds on one long line as split into short lines (seed ${SEED})`, () => {
  const rnd = mulberry32(SEED + 1);
  const secrets = [
    [fakeSecret.generic(), "generic-credential"], [fakeSecret.awsKey(), "aws-access-key"], [fakeSecret.githubToken(), "github-token"], [fakeSecret.privateKeyHeader(), "private-key"],
  ];
  for (let i = 0; i < 24; i++) {
    const [secret, kind] = pick(rnd, secrets);
    const chunks = [];
    const total = 2 * MAX_SCAN_LINE_CHARS + Math.floor(rnd() * 20000);
    let size = 0;
    while (size < total) { const ch = pick(rnd, TOKENS) + pick(rnd, ["_", ".", "-"]) + pick(rnd, TOKENS); chunks.push(ch); size += ch.length + 1; }
    chunks.splice(Math.floor(rnd() * chunks.length), 0, secret);
    const where = `seed ${SEED + 1}, case ${i}`;
    const oneLine = chunks.join(" ");
    const split = chunks.join("\n");
    assert.ok(oneLine.length > MAX_SCAN_LINE_CHARS, where);
    assert.deepEqual(scanString(oneLine), [kind], `${where}: one long line`);
    assert.deepEqual(scanString(split), [kind], `${where}: split into short lines`);
  }
});

test("property: mixed line endings and an empty or non-string input do not throw", () => {
  for (const t of ["", "\r\n\r\n", "\r", c("pass", "word") + "\r\n=\r\nx", "a".repeat(MAX_SCAN_LINE_CHARS + 1) + "\u2028" + "b".repeat(MAX_SCAN_LINE_CHARS + 1), "\u0000\ud800"]) assert.ok(Array.isArray(scanString(t)));
  assert.deepEqual(scanString(null), []);
  assert.deepEqual(scanString(undefined), []);
});
