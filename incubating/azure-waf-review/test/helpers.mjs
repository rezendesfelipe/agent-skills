import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ENGINE = fileURLToPath(new URL("..", import.meta.url));
export const WAF = join(ENGINE, "scripts", "waf.mjs");
export const FIX = join(ENGINE, "test", "fixtures", "contoso-exemplo");

/** The repository root, found by walking up (the engine moves into a skill folder in PR 3, so no fixed depth). */
export function repoRoot() {
  let d = ENGINE;
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(d, "plugins", "assessment-report", "skills", "assessment-report", "scripts", "assess.mjs"))) return d;
    d = dirname(d);
  }
  return null;
}
const ar = () => join(repoRoot() ?? "", "plugins", "assessment-report", "skills", "assessment-report");
export const ASSESS = () => join(ar(), "scripts", "assess.mjs");
export const hasAssess = () => repoRoot() !== null;

export const tmp = (p = "waf-test-") => mkdtempSync(join(tmpdir(), p));
export const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));
export const writeJson = (p, v) => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, `${JSON.stringify(v, null, 2)}\n`); };
export const readText = (p) => readFileSync(p, "utf8").replace(/\r\n?/g, "\n");
export const jsonl = (p) => readText(p).split("\n").filter(Boolean).map((l) => JSON.parse(l));

export function run(args, { cwd, env = {}, input } = {}) {
  const r = spawnSync(process.execPath, [WAF, ...args], { cwd, encoding: "utf8", env: { ...process.env, ...env }, input });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr, out: `${r.stdout}${r.stderr}` };
}
export function runAssess(args, { cwd } = {}) {
  const r = spawnSync(process.execPath, [ASSESS(), ...args], { cwd, encoding: "utf8" });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

/** Every file under a folder with its bytes, for before/after snapshots. */
export function snapshot(dir) {
  const out = {};
  const walk = (d) => {
    for (const n of readdirSync(d).sort()) {
      const f = join(d, n);
      if (statSync(f).isDirectory()) walk(f);
      else out[relative(dir, f).split("\\").join("/")] = readFileSync(f).toString("base64");
    }
  };
  if (existsSync(dir)) walk(dir);
  return out;
}
export const filesUnder = (dir) => Object.keys(snapshot(dir));

/** A copy of the fixture tenant, so a test can change it. */
export function fixtureCopy() {
  const d = tmp("waf-fixture-");
  cpSync(FIX, d, { recursive: true });
  return d;
}

/** Synthetic fake secrets, assembled at run time so no scanner sees a literal token in the repository. */
export const fake = {
  awsKey: () => ["AKIA", "IOSFODNN7", "EXAMPLE"].join(""),
  storageKey: () => ["Account", "Key=", "dGhpc2lzYW5leGFtcGxl", "a2V5Zm9ydGVzdA", "bW9yZWJ5dGVz", "MDEyMzQ1Ng=="].join(""),
  connString: () => ["Default", "EndpointsProtocol=https;", "Account", "Name=x;", "Account", "Key=", "QUJDREVGR0hJSktMTU5PUFFSU1RVVldY", "WVowMTIzNDU2Nzg5MA=="].join(""),
  generic: () => ["db_pass", "word", " = ", '"', ["Zx9fQ2", "mK7vLp", "4Rt8Wy", "3N"].join(""), '"'].join(""),
};

/** plan + collect through the CLI on a work folder. @returns {{cwd:string, runDir:string, plan:object, collect:object}} */
export function planAndCollect({ fixtures = FIX, id = "r1", extra = [], collectExtra = [], env = {}, cwd = tmp("waf-cwd-") } = {}) {
  const plan = run(["plan", "--run-id", id, "--fixtures", fixtures, ...extra], { cwd, env });
  const col = plan.code === 0 ? run(["collect", "--run", id, "--fixtures", fixtures, ...collectExtra], { cwd, env }) : null;
  return { cwd, runDir: join(cwd, "waf-review", id), plan, collect: col };
}
export const stateLabel = (e) => (e.state === "not-verified" ? `not-verified:${e.reason}` : e.state);
