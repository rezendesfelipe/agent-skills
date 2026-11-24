import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

export const SKILL = fileURLToPath(new URL("..", import.meta.url));
export const CLI = join(SKILL, "scripts", "assess.mjs");
export const FIXTURE_REPO = join(SKILL, "test", "fixtures", "repo");

export const tmp = (prefix = "assessment-report-test-") => mkdtempSync(join(tmpdir(), prefix));

/** Runs the engine CLI. @returns {{code: number, stdout: string, stderr: string, out: string}} */
export function run(args, { cwd = SKILL, env = {}, input } = {}) {
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: "utf8", env: { ...process.env, ...env }, input });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr, out: `${r.stdout}${r.stderr}` };
}

/** A copy of the fixture repository, so a test can change it. */
export function repoCopy() {
  const dir = tmp("assessment-repo-");
  cpSync(FIXTURE_REPO, dir, { recursive: true });
  return dir;
}

/** Reads a versioned text file with LF line endings, whatever the checkout used (CRLF on Windows, or a lone CR). */
export const readText = (p) => readFileSync(p, "utf8").replace(/\r\n?/g, "\n");
export const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));
export const writeJson = (p, v) => writeFileSync(p, `${JSON.stringify(v, null, 2)}\n`);

/** Every file under a folder with its content, for before/after snapshots. */
export function snapshot(dir) {
  const out = {};
  const walk = (d) => {
    for (const name of readdirSync(d).sort()) {
      const full = join(d, name);
      const st = statSync(full);
      if (st.isDirectory()) walk(full);
      else out[relative(dir, full)] = readFileSync(full, "utf8");
    }
  };
  walk(dir);
  return out;
}

/** Synthetic fake secrets, assembled at run time so no scanner sees a literal token in the repository. */
export const fakeSecret = {
  privateKeyHeader: () => ["-----BEGIN", "RSA PRIVATE KEY-----"].join(" "),
  awsKey: () => ["AKIA", "IOSFODNN7", "EXAMPLE"].join(""),
  githubToken: () => ["ghp", "_", "a1B2c3D4e5", "F6g7H8i9J0", "k1L2m3N4o5", "P6q7R8"].join(""),
  genericValue: () => ["Zx9fQ2", "mK7vLp", "4Rt8Wy", "3N"].join(""),
  generic: () => ["db_password", " = ", '"', fakeSecret.genericValue(), '"'].join(""),
  keyBody: () => ["MIIBOgIB", "AAJBAKj3", "4GkxFhD9", "0vcNLYLI", "nFEX6Ppy"].join(""),
};

/** init + inventory on a repository copy. @returns {{repo: string, out: string}} */
export function startRun(repo = repoCopy(), extra = []) {
  const out = join(tmp(), "out");
  const a = run(["init", "--out", out, "--root", repo, "--model", "test-model", "--client", "Acme", "--title", "Technical assessment",
    "--author", "Ana Souza", "--version", "1.0", "--date", "2026-11-20", "--lang", "en", ...extra]);
  if (a.code !== 0) throw new Error(`init failed: ${a.out}`);
  const b = run(["inventory", "--out", out]);
  if (b.code !== 0) throw new Error(`inventory failed: ${b.out}`);
  return { repo, out };
}

export const file = (id, path, startLine, endLine, quote, extra = {}) => ({ id, kind: "file", path, startLine, endLine, quote, ...extra });
export const finding = (id, evidence, extra = {}) => ({ id, title: `Finding ${id}`, statement: `Statement of ${id}.`, evidence, ...extra });
export const rationale = { impact: "Data could be read from the internet.", likelihood: "The setting is on in every environment." };

export function edit(out, fn) {
  const p = join(out, "assessment.json");
  const a = readJson(p);
  fn(a);
  writeJson(p, a);
  return a;
}

/** Small seeded generator (mulberry32): the same seed gives the same sequence on every machine. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A short eight-character value assembled from two parts (task 5.3), for cases that need a literal after a tag. */
export const shortValue = () => ["Qm7x", "Lp3z"].join("");
