// Task 2.1: behavior of the secret scanner on ordinary short input is frozen in test/golden/scan-table.json.
// The inputs are generated from a fixed seed out of parts that are not credential-shaped on their own (no literal
// credential in this file). The golden holds the expected kinds per case and a digest of the generated inputs, so a
// change of the generator is noticed. It was recorded with the patterns that existed before the linear-time change.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { scanString } from "../scripts/lib/secrets.mjs";
import { mulberry32 } from "./helpers.mjs";

const GOLDEN = fileURLToPath(new URL("./golden/scan-table.json", import.meta.url));
const SEED = 20261124;
const COUNT = 320;
const c = (...p) => p.join("");

const NAMES = [c("pass", "word"), c("db_pass", "word"), c("client.sec", "ret"), c("to", "ken"), c("id-to", "ken"), c("sec", "ret_name"), c("api_", "key"), c("access-", "key"),
  c("private_", "key"), c("Pass", "word"), c("x", "pwd"), c("sec", "ret_id"), c("a.b.to", "ken"), c("DB_PASS", "WORD"), c("my.app-api", "key"), c("token", "s"), "name"];
const QUOTES = ["", "", "\"", "'"];
const SEPS = ["=", ": ", " = ", ":", " : ", " := "];
const LEADS = ["", "", "export ", "  ", "- ", "# ", "set "];
const LITERALS = [c("hunt", "er2"), c("Zx9f", "Q2mK7v"), c("abcd", "efgh"), "ab", c("corr", "ect"), c("S3cr3t", "Pass", "w0rd"), c("Hm4Tq8", "Zr2Lw6"), "1234", c("a-b", "-c-d")];
const PLACEHOLDERS = ["changeme", "change-me", c("var.db_", "x"), "local.a.b", c("$", "{DB_X}"), c("<your-", "x>"), "example", "none", "true", "false", "read", "write", c("my-", "thing"), c("your_", "x"), c("to", "do"), "xxxx", "****", "required", "optional", "string", "null"];
const REFS = [c("module.a.b"), c("data.x.y.z"), c("random_", "password.db.result"), c("azurerm_key_vault_", "secret.pg.value"), "each.value.x", "count.index", c("path.", "module"), c("self.", "id"), c("a_b.c"), "local.x[0]", "var.x[*].y"];
const YAML = ["|", ">-", "|2", "!!str", "&anc_name", "*als_name", "!vault |", "!Ref Foo", c("!GetAtt a", ".b"), c("!Sub \"arn:", "$", "{X}\""), "!!int"];
const CALLS = ["get_value(x)", "foo()", c("vault.read", "(\"k\")")];
const BARE = [c("pass", "word"), c("hunt", "er2pass"), c("!Pass", "w0rd123"), c("*Hunt", "er2Hunter2"), c("|hunt", "er2pass"), c("&Abc", "12345"), c("random_", "password.x")];
const OTHER = [
  c("-----BEGIN", " RSA PRIVATE KEY-----"), c("AKIA", "IOSFODNN7", "EXAMPLE"), c("ghp", "_", "a1B2c3D4e5", "F6g7H8i9J0", "k1L2m3N4o5", "P6q7R8"),
  c("postgres://admin", ":", "S3cr3t", "Passw0rd", "@db.example.com/app"), c("postgres://admin", ":", "$", "{DB_PASS}", "@db.example.com/app"), "https://user@example.com/path",
  c("Authorization: ", "Bearer", " ", "0123456789", "abcdef0123", "456789abcd", "ef"), c("Authorization: ", "Bearer", " <t>"), c("https://st.blob.core.windows.net/c?sv=1&", "sig", "=", "Ab3dE6gH9", "jK2mN5pQ8", "sT1vW4yZ"),
  c("Account", "Key", "=", "Zm9vYmFy", "YmF6cXV4", "Zm9vYmFy", "YmF6cXV4", "Zm9vYg", "=="), c("xo", "xb-1234567890-abcdef"), "plain text without anything", "",
];

export function buildTable(seed = SEED, count = COUNT) {
  const rnd = mulberry32(seed);
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const out = [];
  for (let i = 0; i < count; i++) {
    const r = rnd();
    let text;
    if (r < 0.1) text = pick(OTHER);
    else {
      const k = rnd();
      const v = k < 0.25 ? pick(LITERALS) : k < 0.45 ? pick(PLACEHOLDERS) : k < 0.6 ? pick(REFS) : k < 0.75 ? pick(YAML) : k < 0.82 ? pick(CALLS) : k < 0.9 ? pick(BARE) : pick(LITERALS) + pick(["", "s", "-x", "_y"]);
      const q = pick(["", "", "\"", "'"]);
      const value = q && k < 0.45 + (rnd() < 0.5 ? 0.3 : 0) ? `${q}${v}${q}` : v;
      text = `${pick(LEADS)}${pick(NAMES)}${pick(QUOTES)}${pick(SEPS)}${value}`;
      if (rnd() < 0.15) text = `${text}\n${pick(LEADS)}${pick(NAMES)}${pick(SEPS)}${pick(LITERALS)}`;
      if (rnd() < 0.1) text = `${pick(["a", "ab", "x.y", "id", ""])}${pick(["_", "-", ".", ""])}${text}`;
    }
    out.push(text);
  }
  return out;
}

const digest = (inputs) => createHash("sha256").update(JSON.stringify(inputs)).digest("hex");

test("scanner behavior on ordinary input is the same as recorded before the linear-time change (320 cases)", () => {
  const inputs = buildTable();
  const kinds = inputs.map((t) => scanString(t));
  if (process.env.UPDATE_GOLDEN) writeFileSync(GOLDEN, `${JSON.stringify({ seed: SEED, count: COUNT, inputsSha256: digest(inputs), kinds }, null, 1)}\n`);
  const golden = JSON.parse(readFileSync(GOLDEN, "utf8").replace(/\r\n/g, "\n"));
  assert.equal(golden.inputsSha256, digest(inputs), "the generated inputs changed; the table must be re-recorded with the previous patterns");
  const diffs = [];
  kinds.forEach((k, i) => { if (JSON.stringify(k) !== JSON.stringify(golden.kinds[i])) diffs.push(`case ${i}: got [${k}] expected [${golden.kinds[i]}]`); });
  assert.deepEqual(diffs, [], "differences against the recorded behavior");
  const flagged = golden.kinds.filter((k) => k.length).length;
  assert.ok(inputs.length >= 200 && flagged > 40 && flagged < inputs.length - 40, `table is not varied: ${flagged}/${inputs.length}`);
});
