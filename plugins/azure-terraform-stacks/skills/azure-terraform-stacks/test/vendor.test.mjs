// Integrity of the vendored yaml (scripts/vendor/yaml): the committed state verifies, and every mutation is caught.
// Mutations run on temporary copies, never on the committed files.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { HERE } from "./helpers.mjs";
import { verify, verifyRegistry, update } from "../scripts/vendor-yaml.mjs";

const SKILL = join(HERE, "..");
const VENDOR = join(SKILL, "scripts", "vendor", "yaml");
const LOCK = join(SKILL, "package-lock.json");
const SCRIPT = join(SKILL, "scripts", "vendor-yaml.mjs");
const tmp = (p) => mkdtempSync(join(tmpdir(), p));
const copyVendor = () => { const d = join(tmp("ats-vendor-"), "yaml"); cpSync(VENDOR, d, { recursive: true }); return d; };
const bad = (r, needle) => { assert.equal(r.ok, false, "verify passed on a mutated copy"); assert.ok(r.problems.some((p) => p.includes(needle)), `no problem names ${needle}: ${r.problems.join(" | ")}`); };

test("the committed vendor verifies, and so does the command line", () => {
  const r = verify({ vendorDir: VENDOR, lockfile: LOCK });
  assert.deepEqual(r.problems, []);
  const c = spawnSync(process.execPath, [SCRIPT, "verify"], { encoding: "utf8" });
  assert.equal(c.status, 0, c.stdout + c.stderr);
});

test("the record, the vendored package.json and the lockfile agree on version and integrity", () => {
  const rec = JSON.parse(readFileSync(join(VENDOR, "PROVENANCE.json"), "utf8"));
  const lock = JSON.parse(readFileSync(LOCK, "utf8")).packages["node_modules/yaml"];
  assert.equal(rec.version, "2.9.1");
  assert.equal(rec.version, JSON.parse(readFileSync(join(VENDOR, "package.json"), "utf8")).version);
  assert.equal(rec.integrity, lock.integrity);
  assert.equal(rec.tarballSha256, "4ef6c54cf559b8a207b7b518378230805a1c84af239b14960e8c67c7d59de5d3");
  assert.equal(rec.license, "ISC");
  assert.equal(rec.files.length, 76);
  assert.match(readFileSync(join(VENDOR, "LICENSE"), "utf8"), /Copyright Eemeli Aro/);
});

test("mutation: one byte of one file", () => {
  const d = copyVendor();
  const f = join(d, "dist", "index.js");
  const b = readFileSync(f); b[10] ^= 1; writeFileSync(f, b);
  bad(verify({ vendorDir: d, lockfile: LOCK }), "dist/index.js");
});

test("mutation: a file deleted", () => {
  const d = copyVendor();
  unlinkSync(join(d, "dist", "log.js"));
  bad(verify({ vendorDir: d, lockfile: LOCK }), "dist/log.js");
});

test("mutation: an extra file, also a .js file", () => {
  const d = copyVendor();
  writeFileSync(join(d, "dist", "extra.js"), "module.exports = 1;\n");
  bad(verify({ vendorDir: d, lockfile: LOCK }), "dist/extra.js");
  writeFileSync(join(d, "extra.txt"), "x");
  bad(verify({ vendorDir: d, lockfile: LOCK }), "extra.txt");
});

test("mutation: a hash edited in the record", () => {
  const d = copyVendor();
  const p = join(d, "PROVENANCE.json");
  const rec = JSON.parse(readFileSync(p, "utf8"));
  rec.files[3].sha256 = "0".repeat(64);
  writeFileSync(p, JSON.stringify(rec, null, 2));
  bad(verify({ vendorDir: d, lockfile: LOCK }), rec.files[3].path);
});

test("mutation: the version of the record differs from the vendored package.json and the lockfile", () => {
  const d = copyVendor();
  const p = join(d, "PROVENANCE.json");
  const rec = JSON.parse(readFileSync(p, "utf8"));
  rec.version = "2.9.2";
  writeFileSync(p, JSON.stringify(rec, null, 2));
  const r = verify({ vendorDir: d, lockfile: LOCK });
  bad(r, "version");
});

test("mutation: the integrity of the record differs from the lockfile", () => {
  const d = copyVendor();
  const p = join(d, "PROVENANCE.json");
  const rec = JSON.parse(readFileSync(p, "utf8"));
  rec.integrity = "sha512-" + Buffer.alloc(64).toString("base64");
  writeFileSync(p, JSON.stringify(rec, null, 2));
  bad(verify({ vendorDir: d, lockfile: LOCK }), "integrity");
});

test("mutation: a file rewritten with CRLF line endings is named as a line-ending change", () => {
  const d = copyVendor();
  const f = join(d, "dist", "index.js");
  writeFileSync(f, readFileSync(f, "utf8").replace(/\n/g, "\r\n"));
  const r = verify({ vendorDir: d, lockfile: LOCK });
  bad(r, "dist/index.js");
  assert.ok(r.problems.some((p) => /line ending|CRLF/i.test(p)), r.problems.join(" | "));
});

test("mutation: a file replaced by a symbolic link", (t) => {
  const d = copyVendor();
  const f = join(d, "dist", "log.js");
  const target = join(tmp("ats-vendor-link-"), "log.js");
  cpSync(f, target);
  unlinkSync(f);
  try { symlinkSync(target, f); } catch (e) { t.skip(`symbolic links are not allowed here (${e.code}); the other mutations still run`); return; }
  bad(verify({ vendorDir: d, lockfile: LOCK }), "dist/log.js");
});

// A small fake package, as `npm pack` would deliver it: package/<files> in a .tgz.
function fakeTarball(extra = {}) {
  const root = tmp("ats-faketar-");
  const files = { "package.json": JSON.stringify({ name: "yaml", version: "1.2.3", license: "ISC", type: "commonjs" }), LICENSE: "ISC licence text\n", "dist/index.js": "module.exports = { a: 1 };\n", "dist/sub/b.js": "exports.b = 2;\n", "dist/index.d.ts": "export {};\n", "browser/index.js": "export {};\n", "README.md": "readme\n", ...extra };
  for (const [p, c] of Object.entries(files)) { mkdirSync(join(root, "package", p, ".."), { recursive: true }); writeFileSync(join(root, "package", p), c); }
  const out = join(root, "fake.tgz");
  const r = spawnSync("tar", ["-czf", out, "-C", root, "package"], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  return { out, sha256: createHash("sha256").update(readFileSync(out)).digest("hex") };
}

test("update writes only the selection, with a record that verifies; verify --registry compares with the tarball", () => {
  const { out, sha256 } = fakeTarball();
  const work = tmp("ats-vendor-update-");
  const vendorDir = join(work, "vendor", "yaml");
  const packageJson = join(work, "package.json");
  writeFileSync(packageJson, JSON.stringify({ name: "x", devDependencies: { yaml: "1.0.0" } }));
  const s = update({ version: "1.2.3", vendorDir, packageJson, lockfile: null, tarball: out, sha256, runNpm: false, today: "2026-01-01" });
  assert.deepEqual(readdirSync(vendorDir).sort(), ["LICENSE", "PROVENANCE.json", "dist", "package.json"]);
  assert.deepEqual(readdirSync(join(vendorDir, "dist")).sort(), ["index.js", "sub"]);
  assert.ok(s.added.includes("dist/index.js"));
  assert.equal(JSON.parse(readFileSync(packageJson, "utf8")).devDependencies.yaml, "1.2.3");
  assert.deepEqual(verify({ vendorDir, lockfile: null }).problems, []);
  assert.deepEqual(verifyRegistry({ vendorDir, tarball: out }).problems, []);
  // a tarball whose file differs by one byte, offered as "the registry's"
  const other = fakeTarball({ "dist/index.js": "module.exports = { a: 2 };\n" });
  const r = verifyRegistry({ vendorDir, tarball: other.out });
  assert.equal(r.ok, false);
  assert.ok(r.problems.some((p) => /tarball/i.test(p)));
  assert.ok(r.problems.some((p) => p.includes("dist/index.js")));
});

test("update refuses a wrong tarball hash and a hand-edited vendor file without --force", () => {
  const { out, sha256 } = fakeTarball();
  const work = tmp("ats-vendor-update2-");
  const vendorDir = join(work, "vendor", "yaml");
  const packageJson = join(work, "package.json");
  writeFileSync(packageJson, "{}");
  assert.throws(() => update({ version: "1.2.3", vendorDir, packageJson, lockfile: null, tarball: out, sha256: "0".repeat(64), runNpm: false }), /sha-?256/i);
  assert.ok(!existsSync(vendorDir));
  update({ version: "1.2.3", vendorDir, packageJson, lockfile: null, tarball: out, sha256, runNpm: false });
  writeFileSync(join(vendorDir, "dist", "index.js"), "// edited by hand\n");
  assert.throws(() => update({ version: "1.2.3", vendorDir, packageJson, lockfile: null, tarball: out, sha256, runNpm: false }), /hand|differ|--force/i);
  update({ version: "1.2.3", vendorDir, packageJson, lockfile: null, tarball: out, sha256, runNpm: false, force: true });
  assert.deepEqual(verify({ vendorDir, lockfile: null }).problems, []);
});
