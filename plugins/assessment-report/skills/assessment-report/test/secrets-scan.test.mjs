// The secret scanner: linear time, overlapping windows on long lines, YAML tags/anchors/aliases, and the exclusions that
// must stay narrow. Every credential-shaped value is assembled at run time from parts (no literal in this file).
import assert from "node:assert/strict";
import { test } from "node:test";
import { MAX_SCAN_LINE_CHARS, SCAN_WINDOW_OVERLAP, SECRET_PATTERNS, hasSecretKind, scanString, scanValue } from "../scripts/lib/secrets.mjs";
import { evidenceMessageFor } from "./scan-evidence.mjs";
import { fakeSecret, shortValue } from "./helpers.mjs";
import { MIB, SCAN_TIME_BOUND_MS, SHAPES, measure, repeatTo, scalesFor } from "./scan-inputs.mjs";

const c = (...p) => p.join("");
const PW = c("pass", "word");
const SEC = c("sec", "ret");
const TOK = c("to", "ken");
const V = shortValue();
const DOLLAR = "$";
const A = fakeSecret.generic(); // db_<name> = "<value>"
const addr = (...p) => p.join(".");

// ---- linear time ---------------------------------------------------------------------------------------------------
test("initial values are exported and documented as initial", () => {
  assert.equal(MAX_SCAN_LINE_CHARS, 8192);
  assert.equal(SCAN_WINDOW_OVERLAP, 512);
});

test("repeated short token and separator: 20,000 then 40,000 repetitions scale linearly, pattern by pattern", async () => {
  const r = await scalesFor("ab12.".repeat(20000), "ab12.".repeat(40000));
  assert.ok(r.ok, r.detail);
  for (const [kind, ms] of Object.entries(r.bigPatterns)) assert.ok(ms < SCAN_TIME_BOUND_MS, `${kind} took ${ms.toFixed(0)} ms on 200000 characters`);
});

test("repeated letter and dot: every pattern, including the URL credential pattern, is linear", async () => {
  const r = await scalesFor("a.".repeat(50000), "a.".repeat(100000));
  assert.ok(r.ok, r.detail);
});

test("the secret-name pattern has no repeated prefix group and the URL scheme is bounded", () => {
  const generic = SECRET_PATTERNS.find((p) => p.kind === "generic-credential").re.source;
  const url = SECRET_PATTERNS.find((p) => p.kind === "url-credential").re.source;
  assert.ok(!generic.includes("(?:[A-Za-z0-9]+[_.-])*"), "the redundant prefix group is back");
  assert.match(url, /\{0,\d+\}:\\\/\\\//, "the scheme part of url-credential is unbounded");
});

test("one line of the file size cap (1 MiB) of repeated short tokens scans within the bound", async () => {
  for (const name of Object.keys(SHAPES)) {
    const { scan } = await measure({ shape: name, length: MIB, scanOnly: true });
    assert.ok(scan < SCAN_TIME_BOUND_MS, `${name}: ${scan.toFixed(0)} ms on 1 MiB (initial bound ${SCAN_TIME_BOUND_MS} ms)`);
  }
});

test("ordinary names: a prefix is matched, a suffix is not", () => {
  const val = c('"', "hunt", "er2", '"');
  for (const name of [`db_${PW}`, `client.${SEC}`, `a.b-c_${TOK}`, `x${PW}`.replace("x", "x_"), `DB_${PW.toUpperCase()}`]) assert.deepEqual(scanString(`${name} = ${val}`), ["generic-credential"], name);
  for (const name of [`${PW}_name`, `${SEC}_id`, `${TOK}s`, `my${PW}`]) assert.deepEqual(scanString(`${name} = ${val}`), [], name);
});

// ---- windows -------------------------------------------------------------------------------------------------------
const FILL = "ab12.";
const withAt = (pos, total = MIB) => {
  const base = repeatTo(FILL, total);
  return base.slice(0, pos) + ` ${A} ` + base.slice(pos + A.length + 2);
};

test("a secret in a 1 MiB line is found at the start, in the middle, at the end and across a window boundary", () => {
  assert.equal(withAt(0).length, MIB);
  for (const [where, pos] of [["start", 0], ["middle", MIB / 2], ["end", MIB - A.length - 40], ["across a boundary", MAX_SCAN_LINE_CHARS - 10], ["across the 5th boundary", 5 * (MAX_SCAN_LINE_CHARS - SCAN_WINDOW_OVERLAP) + MAX_SCAN_LINE_CHARS - SCAN_WINDOW_OVERLAP - 12]]) {
    const line = withAt(pos);
    assert.ok(A.length < SCAN_WINDOW_OVERLAP);
    assert.deepEqual(scanString(line), ["generic-credential"], where);
    assert.equal(hasSecretKind(line, "generic-credential"), true, where);
    assert.deepEqual(scanValue({ a: line }).map((x) => x.kind), ["generic-credential"], where);
  }
});

test("a secret split by a window boundary is found at every offset of the overlap region", () => {
  const step = MAX_SCAN_LINE_CHARS - SCAN_WINDOW_OVERLAP;
  for (let off = 0; off < A.length + 4; off++) {
    const line = withAt(step + SCAN_WINDOW_OVERLAP - off, 3 * MAX_SCAN_LINE_CHARS);
    assert.deepEqual(scanString(line), ["generic-credential"], `offset ${off}`);
  }
});

test("text with short lines is scanned as a whole, so a pattern spanning a line break behaves as before", () => {
  assert.deepEqual(scanString(`${PW}\n=\n${c("hunt", "er2pass")}`), ["generic-credential"]);
  assert.deepEqual(scanString(`${PW}: |\n  text`), []);
  // a short line next to a long one is still scanned with its neighbors, and the long one in windows
  const mixed = `${PW}\n= ${c("hunt", "er2pass")}\n${repeatTo(FILL, 3 * MAX_SCAN_LINE_CHARS)}`;
  assert.deepEqual(scanString(mixed), ["generic-credential"]);
  assert.deepEqual(scanString(`${repeatTo(FILL, 2 * MAX_SCAN_LINE_CHARS)}\r\n${A}\r\n`), ["generic-credential"]);
});

// ---- YAML tags, anchors and aliases (R-2) ----------------------------------------------------------------------------
const flagged = (t) => assert.ok(scanString(t).includes("generic-credential"), `not flagged: ${t.replace(V, "<v>")}`);
const ignored = (t) => assert.deepEqual(scanString(t), [], t);

test("a type tag followed by a literal is flagged", () => { for (const t of ["!!str", "!!int", "!!binary"]) flagged(`${PW}: ${t} ${V}`); flagged(`${TOK} = !!str ${V}`); });
test("a short anchor or alias name followed by a literal is flagged; the same forms alone or before a reference are not", () => {
  for (const n of ["a", "ab", "x1"]) { flagged(`${PW}: &${n} ${V}`); flagged(`${PW}: *${n} ${V}`); flagged(`${TOK} = &${n} ${V}`); }
  flagged(`${PW}: !a ${V}`);
  for (const n of ["a", "ab"]) { ignored(`${PW}: &${n}`); ignored(`${PW}: *${n}`); ignored(`${PW}: &${n} # note`); ignored(`${PW}: *${n} ${addr("var", "x", "y")}`); }
  ignored(`${PW}: !Ref X`);
  ignored(`${PW}: !GetAtt a.b`);
  ignored(`${PW}: !ImportValue x`);
  ignored(`${PW}: !Sub "a${DOLLAR}{B}"`);
  ignored(`${PW} = ab`); // a short value with no node before it is still not flagged
});

test("an anchor followed by a literal is flagged", () => { flagged(`${PW}: &anc ${V}`); flagged(`${PW}: &anc_name ${V} # note`); });
test("an alias followed by a literal is flagged", () => { flagged(`${PW}: *shared ${V}`); flagged(`${SEC}: *shared_value ${V}`); });
test("a custom tag followed by a literal is flagged, with and without digits", () => { for (const t of ["!vault", "!secret", "!encrypted", "!vault2", "!key9"]) flagged(`${PW}: ${t} ${V}`); });
test("a function tag followed by a literal is flagged", () => { for (const t of ["!Sub", "!GetAtt", "!Join", "!Select"]) flagged(`${PW}: ${t} ${V}`); flagged(`${PW}: !Ref ${V} ${V}`); });

test("reference operands stay ignored", () => {
  ignored(`${PW}: !Ref DbPassParam`);
  ignored(`${PW}: !ImportValue net-db:${TOK}`);
  ignored(`${PW}: !GetAtt Db.Endpoint.Address`);
  ignored(`${PW}: !Sub "arn:aws:s3:::${DOLLAR}{Bucket}/x"`);
  ignored(`${PW}: !Sub ${DOLLAR}{Prefix}-x`);
  ignored(`${PW}: !Join [ "", [ "a", !Ref B ] ]`);
  ignored(`${PW}: !If [ Cond, a, b ]`);
  ignored(`${PW}: !!str var.db_${PW}`);
  ignored(`${PW}: &a ${addr("random_" + PW, "db", "result")}`);
  ignored(`${PW}: *a ${DOLLAR}{DB_X}`);
  ignored(`${PW}: !vault ${addr("local", "x")}`);
});

test("a tag, anchor or alias alone, or a tag with a block indicator at the end of the line, is ignored", () => {
  for (const t of ["!!str", "&anchor_name", "*shared_name", "!vault", "!vault |", "!vault >-", "!Ref", "!!str # why", "&a   ", "|", ">-", "|2"]) ignored(`${PW}: ${t}`);
  ignored(`${TOK} = !!str`);
});

test("a literal after a tag is flagged without printing the value: the verifier reports the kind and the place", async () => {
  const msg = await evidenceMessageFor(`${PW}: !!str ${V}\n`);
  assert.match(msg.code, /secret-in-quote/);
  assert.ok(!msg.text.includes(V), "the literal reached the verification result");
});

// ---- exclusions that stay narrow (N-1) -------------------------------------------------------------------------------
test("a value that is exactly a reference prefix is flagged, one case per prefix", () => {
  // "var" has three characters and no value shorter than four is ever flagged (unchanged limit, documented), so it is not in the list
  for (const p of ["local", "data", "module", "each", "count", "path", "terraform", "self"]) flagged(`${PW} = ${p}`);
  ignored(`${PW} = var`);
});
test("a reference prefix with one segment, with an index or two segments is ignored", () => {
  for (const p of ["var", "local", "data", "module", "each", "count", "path", "terraform", "self"]) { ignored(`${PW} = ${addr(p, "x")}`); ignored(`${PW} = ${p}[0].x`); ignored(`${PW} = ${addr(p, "x", "y")}`); }
});
test("a value that starts with an exclamation mark followed by text, or a custom tag with digits followed by text, is flagged", () => {
  flagged(`${PW} = !${c("Hunt", "er", "2")}`);
  flagged(`${PW} = !${V}`);
  flagged(`${PW}: !tag9 ${V}`);
  flagged(`${PW}: !v2${V}`);
  flagged(`${PW}: !tag9 ${addr("var", "db", "x")}`); // digits in a tag: not the narrow form, so a reference after it does not rescue it
  ignored(`${PW}: !tag ${addr("var", "db", "x")}`);
});
test("a resource-type shape with two segments is ignored and with one segment is flagged", () => {
  ignored(`${PW} = ${addr("random_" + PW, "db", "result")}`);
  ignored(`${PW} = ${addr("azurerm_key_vault_" + SEC, "x", "value")}`);
  flagged(`${PW} = ${addr("random_" + PW, "result")}`);
  flagged(`${PW} = ${addr("prod_db", "passw0rd")}`);
});
