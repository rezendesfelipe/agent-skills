#!/usr/bin/env node
// Integrity and update tool for the vendored `yaml` package (scripts/vendor/yaml). Node 20, no dependency.
//
//   node scripts/vendor-yaml.mjs verify                       offline: the vendored files equal PROVENANCE.json, the version and
//                                                             integrity equal the lockfile's
//   node scripts/vendor-yaml.mjs verify --registry            also downloads the recorded version with `npm pack` into a new
//                                                             empty folder and compares every kept file byte for byte
//                                                             (--tarball <file> uses a local .tgz instead of the network)
//   node scripts/vendor-yaml.mjs watch                        asks the OSV advisory feed about the recorded version and the registry for
//                                                             the latest one (sends only the package name and the version)
//   node scripts/vendor-yaml.mjs update <version> [--force]   the ONLY writer: downloads, checks the hashes, applies the
//                                                             selection rule, writes the files, PROVENANCE.json, package.json
//                                                             (devDependencies) and the lockfile
//
// Nothing from a downloaded tarball is ever executed: it is hashed, listed, unpacked with `tar` and copied as bytes.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_VENDOR_DIR = join(HERE, "vendor", "yaml");
export const DEFAULT_PACKAGE_JSON = join(HERE, "..", "package.json");
export const DEFAULT_LOCKFILE = join(HERE, "..", "package-lock.json");
const RECORD = "PROVENANCE.json";
const NAME = "yaml";
export const SELECTION = "every dist/**/*.js file of the published tarball, plus package.json and LICENSE; not kept: *.d.ts, dist/cli.mjs, browser/, bin.mjs, util.js, README.md";

/** The selection rule, on a path relative to the package root (forward slashes). */
export const selected = (p) => {
  if (typeof p !== "string" || p.includes("\\") || p.startsWith("/") || /^[A-Za-z]:/.test(p)) return false; // backslash, absolute, drive letter
  if (p.split("/").some((seg) => seg === "" || seg === "." || seg === "..")) return false; // no empty, "." or ".." segment
  return p === "package.json" || p === "LICENSE" || /^dist\/.+\.js$/.test(p);
};

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");
const sri512 = (buf) => `sha512-${createHash("sha512").update(buf).digest("base64")}`;
const toLf = (buf) => Buffer.from(buf.toString("latin1").replace(/\r\n/g, "\n"), "latin1");
const VERSION = /^\d+\.\d+\.\d+$/;

/** Every regular file under `dir` as relative posix paths; a symbolic link or another kind of entry is reported, never followed. */
function walk(dir, base = dir, out = { files: [], problems: [] }) {
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    const rel = p.slice(base.length + 1).split(/[\\/]/).join("/");
    const st = lstatSync(p);
    if (st.isSymbolicLink()) out.problems.push(`"${rel}": is a symbolic link (not allowed)`);
    else if (st.isDirectory()) walk(p, base, out);
    else if (st.isFile()) out.files.push(rel);
    else out.problems.push(`"${rel}": is not a regular file`);
  }
  return out;
}

function readRecord(vendorDir) {
  const file = join(vendorDir, RECORD);
  if (!existsSync(file)) return { problems: [`${RECORD} is missing in ${vendorDir}`] };
  try {
    const rec = JSON.parse(readFileSync(file, "utf8"));
    if (!rec || !Array.isArray(rec.files) || typeof rec.version !== "string") return { problems: [`${RECORD} is not a valid record`] };
    return { rec, problems: [] };
  } catch (e) {
    return { problems: [`${RECORD} cannot be read: ${e.message}`] };
  }
}

/** Offline check. `lockfile: null` skips the lockfile comparison (unit tests of fake packages). */
export function verify({ vendorDir = DEFAULT_VENDOR_DIR, lockfile = DEFAULT_LOCKFILE } = {}) {
  const { rec, problems } = readRecord(vendorDir);
  if (!rec) return { ok: false, problems };
  const w = walk(vendorDir);
  problems.push(...w.problems);
  const have = new Set(w.files.filter((f) => f !== RECORD));
  const want = new Map();
  for (const f of rec.files) {
    if (want.has(f.path)) problems.push(`"${f.path}": listed twice in ${RECORD}`);
    want.set(f.path, f.sha256);
    if (!selected(f.path)) problems.push(`"${f.path}": listed in ${RECORD} but outside the selection rule`);
  }
  for (const [path, hash] of want) {
    if (!have.has(path)) { problems.push(`"${path}": missing from the vendored folder`); continue; }
    const buf = readFileSync(join(vendorDir, ...path.split("/")));
    if (sha256(buf) === hash) continue;
    problems.push(sha256(toLf(buf)) === hash
      ? `"${path}": line endings changed (CRLF); the file must keep the bytes of the published package (.gitattributes -text)`
      : `"${path}": content differs from the SHA-256 in ${RECORD}`);
  }
  for (const path of have) if (!want.has(path)) problems.push(`"${path}": not in ${RECORD} (extra file)`);
  // version and integrity: the record, the vendored package.json and the lockfile must say the same
  let vendored = null;
  try { vendored = JSON.parse(readFileSync(join(vendorDir, "package.json"), "utf8")); } catch { /* reported as missing above */ }
  if (vendored && vendored.version !== rec.version) problems.push(`version: ${RECORD} says ${rec.version}, the vendored package.json says ${vendored.version}`);
  if (vendored && vendored.name !== NAME) problems.push(`name: the vendored package.json says ${vendored.name}, expected ${NAME}`);
  if (lockfile) {
    let entry;
    try { entry = JSON.parse(readFileSync(lockfile, "utf8")).packages?.[`node_modules/${NAME}`]; } catch (e) { problems.push(`lockfile cannot be read: ${e.message}`); }
    if (!entry) problems.push(`lockfile has no node_modules/${NAME} entry`);
    else {
      if (entry.version !== rec.version) problems.push(`version: ${RECORD} says ${rec.version}, the lockfile says ${entry.version}`);
      if (entry.integrity !== rec.integrity) problems.push(`integrity: ${RECORD} says ${rec.integrity}, the lockfile says ${entry.integrity}`);
    }
  }
  return { ok: problems.length === 0, problems, files: want.size, version: rec.version, tarballSha256: rec.tarballSha256 };
}

const npmBin = process.platform === "win32" ? "npm.cmd" : "npm";
function npm(args, cwd) {
  // fixed arguments only; on Windows .cmd files need a shell, and nothing here comes from outside except a validated version
  return spawnSync(npmBin, args, { cwd, encoding: "utf8", shell: process.platform === "win32" });
}

/** Downloads `yaml@version` with `npm pack` into a new empty folder (no package code runs: --ignore-scripts, and pack only downloads). */
function pack(version) {
  if (!VERSION.test(version)) throw new Error(`"${version}" is not an exact version (x.y.z)`);
  const dir = mkdtempSync(join(tmpdir(), "ats-yaml-pack-"));
  const r = npm(["pack", `${NAME}@${version}`, "--ignore-scripts", "--json", "--pack-destination", "."], dir);
  if (r.status !== 0) throw new Error(`npm pack ${NAME}@${version} failed: ${r.stderr || r.stdout}`);
  const info = JSON.parse(r.stdout)[0];
  const v = npm(["view", `${NAME}@${version}`, "dist.integrity"], dir);
  return { file: join(dir, info.filename), dir, registryIntegrity: v.status === 0 ? v.stdout.trim() : null };
}

/** Unpacks with `tar` into <dir>/ex, using relative paths so a Windows drive letter never reaches tar. Returns the package root. */
function unpack(tgz) {
  const dir = dirname(tgz);
  const ex = join(dir, "ex");
  mkdirSync(ex, { recursive: true });
  const r = spawnSync("tar", ["-xzf", basename(tgz), "-C", "ex"], { cwd: dir, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`tar failed: ${r.stderr}`);
  const root = join(ex, "package");
  if (!existsSync(root)) throw new Error("the tarball has no package/ folder");
  return root;
}

/** The selected files of an unpacked package: Map path -> Buffer. */
function selectedFiles(root) {
  const w = walk(root);
  if (w.problems.length) throw new Error(`the tarball contains entries that are not regular files: ${w.problems.join("; ")}`);
  const out = new Map();
  for (const p of w.files) if (selected(p)) out.set(p, readFileSync(join(root, ...p.split("/"))));
  return out;
}

/** Compares the vendored files with the registry's tarball. `tarball` may be a local .tgz; otherwise the recorded version is downloaded. */
export function verifyRegistry({ vendorDir = DEFAULT_VENDOR_DIR, tarball } = {}) {
  const { rec, problems } = readRecord(vendorDir);
  if (!rec) return { ok: false, problems };
  const tgz = tarball ? resolve(tarball) : pack(rec.version).file;
  const tbuf = readFileSync(tgz);
  if (sha256(tbuf) !== rec.tarballSha256) problems.push(`tarball: SHA-256 ${sha256(tbuf)} differs from the record (${rec.tarballSha256})`);
  if (sri512(tbuf) !== rec.integrity) problems.push(`tarball: integrity differs from the record`);
  const files = selectedFiles(unpack(tgz));
  const want = new Map(rec.files.map((f) => [f.path, f.sha256]));
  for (const [path, buf] of files) {
    const p = join(vendorDir, ...path.split("/"));
    if (!existsSync(p)) { problems.push(`"${path}": in the published package, missing from the vendored folder`); continue; }
    if (Buffer.compare(readFileSync(p), buf) !== 0) problems.push(`"${path}": differs from the published package, byte for byte`);
    if (want.get(path) !== sha256(buf)) problems.push(`"${path}": the record's SHA-256 is not the published file's`);
  }
  for (const path of want.keys()) if (!files.has(path)) problems.push(`"${path}": vendored, not in the published package`);
  return { ok: problems.length === 0, problems };
}

/**
 * Known advisories for the recorded version (OSV, https://osv.dev) and the latest published version. `fetchImpl` and `latest` are for tests.
 * Only the package name and the version leave this machine.
 */
export async function watch({ vendorDir = DEFAULT_VENDOR_DIR, fetchImpl = globalThis.fetch, latest } = {}) {
  const { rec, problems } = readRecord(vendorDir);
  if (!rec) return { ok: false, problems, advisories: [] };
  const res = await fetchImpl("https://api.osv.dev/v1/query", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ package: { name: NAME, ecosystem: "npm" }, version: rec.version }) });
  if (!res.ok) return { ok: false, problems: [`OSV answered ${res.status}`], advisories: [] };
  const body = await res.json();
  const advisories = (body.vulns ?? []).map((v) => ({ id: v.id, summary: v.summary ?? "" }));
  let newest = latest;
  if (newest === undefined) { const v = npm(["view", NAME, "dist-tags.latest"], tmpdir()); newest = v.status === 0 ? v.stdout.trim() : null; }
  const out = [...problems];
  for (const a of advisories) out.push(`advisory ${a.id} affects ${NAME} ${rec.version}: ${a.summary}`);
  return { ok: out.length === 0, problems: out, advisories, version: rec.version, latest: newest, newer: Boolean(newest) && newest !== rec.version };
}

/** The only writer. */
export function update({ version, vendorDir = DEFAULT_VENDOR_DIR, packageJson = DEFAULT_PACKAGE_JSON, lockfile = DEFAULT_LOCKFILE, tarball, sha256: expectSha, integrity: expectIntegrity, force = false, runNpm = true, today = new Date().toISOString().slice(0, 10) } = {}) {
  if (!VERSION.test(String(version))) throw new Error(`"${version}" is not an exact version (x.y.z)`);
  let tgz, registryIntegrity = expectIntegrity ?? null;
  if (tarball) tgz = resolve(tarball);
  else { const p = pack(version); tgz = p.file; registryIntegrity ??= p.registryIntegrity; }
  const tbuf = readFileSync(tgz);
  const tarballSha256 = sha256(tbuf);
  const integrity = sri512(tbuf);
  if (expectSha && expectSha !== tarballSha256) throw new Error(`the SHA-256 of the tarball is ${tarballSha256}, not the expected ${expectSha}`);
  if (registryIntegrity && registryIntegrity !== integrity) throw new Error(`the integrity of the tarball is ${integrity}, not the registry's ${registryIntegrity}`);
  const files = selectedFiles(unpack(tgz));
  if (!files.has("package.json") || !files.has("LICENSE")) throw new Error("the tarball has no package.json or no LICENSE");
  const pkg = JSON.parse(files.get("package.json").toString("utf8"));
  if (pkg.version !== version || pkg.name !== NAME) throw new Error(`the tarball is ${pkg.name}@${pkg.version}, not ${NAME}@${version}`);
  if (!files.has("dist/index.js")) throw new Error("the tarball has no dist/index.js");

  // never overwrite a hand edit silently
  let old = null;
  if (existsSync(vendorDir)) {
    const v = verify({ vendorDir, lockfile: null });
    old = readRecord(vendorDir).rec ?? null;
    if (!v.ok && !force) throw new Error(`the vendored folder differs from its record (a hand edit?); use --force to replace it:\n  ${v.problems.join("\n  ")}`);
  }
  const oldHash = new Map((old?.files ?? []).map((f) => [f.path, f.sha256]));
  const record = {
    name: NAME,
    version,
    tarball: `https://registry.npmjs.org/${NAME}/-/${NAME}-${version}.tgz`,
    tarballSha256,
    integrity,
    license: pkg.license,
    licenseFile: "LICENSE",
    selection: SELECTION,
    retrieved: today,
    files: [...files].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([path, buf]) => ({ path, sha256: sha256(buf) })),
  };
  const staging = `${vendorDir}.new`;
  rmSync(staging, { recursive: true, force: true });
  for (const [path, buf] of files) {
    const p = join(staging, ...path.split("/"));
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, buf);
  }
  writeFileSync(join(staging, RECORD), `${JSON.stringify(record, null, 2)}\n`);
  rmSync(vendorDir, { recursive: true, force: true });
  renameSync(staging, vendorDir);

  const pj = JSON.parse(readFileSync(packageJson, "utf8"));
  if (pj.dependencies) { delete pj.dependencies[NAME]; if (!Object.keys(pj.dependencies).length) delete pj.dependencies; }
  pj.devDependencies = { ...(pj.devDependencies ?? {}), [NAME]: version };
  writeFileSync(packageJson, `${JSON.stringify(pj, null, 2)}\n`);
  if (runNpm && lockfile) {
    const r = npm(["install", "--package-lock-only", "--ignore-scripts"], dirname(packageJson));
    if (r.status !== 0) throw new Error(`npm install --package-lock-only failed: ${r.stderr}`);
  }
  const added = [], changed = [], removed = [];
  for (const f of record.files) { if (!oldHash.has(f.path)) added.push(f.path); else if (oldHash.get(f.path) !== f.sha256) changed.push(f.path); }
  for (const p of oldHash.keys()) if (!files.has(p)) removed.push(p);
  return { version, tarballSha256, integrity, added, changed, removed, files: record.files.length };
}

function main(argv) {
  const [cmd, ...rest] = argv;
  const opt = (name) => { const i = rest.indexOf(name); return i >= 0 ? rest[i + 1] : undefined; };
  try {
    if (cmd === "verify") {
      const r = rest.includes("--registry") ? verifyRegistry({ tarball: opt("--tarball") }) : verify();
      const off = verify();
      const problems = [...new Set([...off.problems, ...r.problems])];
      if (problems.length) { console.error(`vendor check FAILED (${problems.length}):\n${problems.map((p) => `  - ${p}`).join("\n")}`); return 1; }
      console.log(`ok: ${off.files} files, ${NAME} ${off.version}, tarball sha256 ${off.tarballSha256}${rest.includes("--registry") ? ", equal to the published package" : ""}`);
      return 0;
    }
    if (cmd === "update" && rest[0] && !rest[0].startsWith("--")) {
      const s = update({ version: rest[0], force: rest.includes("--force"), tarball: opt("--tarball"), sha256: opt("--sha256") });
      console.log(`vendored ${NAME} ${s.version}: ${s.files} files; tarball sha256 ${s.tarballSha256}\n  integrity ${s.integrity}\n  added ${s.added.length}, changed ${s.changed.length}, removed ${s.removed.length}\nNow read the diff of scripts/vendor/yaml, run the corpus and the parity tests, and commit the vendor folder, package.json and the lockfile together.`);
      return 0;
    }
  } catch (e) {
    console.error(`vendor-yaml: ${e.message}`);
    return 1;
  }
  console.error("usage: node scripts/vendor-yaml.mjs verify [--registry [--tarball <file>]] | watch | update <x.y.z> [--force] [--tarball <file>] [--sha256 <hex>]");
  return 2;
}

async function runWatch() {
  try {
    const r = await watch();
    if (r.newer) console.log(`::notice::yaml ${r.latest} is published; the vendored copy is ${r.version}. Consider: node scripts/vendor-yaml.mjs update ${r.latest}`);
    if (!r.ok) { console.error(`vendor watch FAILED:\n${r.problems.map((p) => `  - ${p}`).join("\n")}`); return 1; }
    console.log(`ok: no known advisory for ${NAME} ${r.version}${r.newer ? `; newer version ${r.latest} exists` : ""}`);
    return 0;
  } catch (e) {
    console.error(`vendor-yaml: ${e.message}`);
    return 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === "watch") runWatch().then((c) => process.exit(c));
  else process.exit(main(process.argv.slice(2)));
}
