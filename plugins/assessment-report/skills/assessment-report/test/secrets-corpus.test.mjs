// Corpus regression without literals: the scanner runs over the versioned text files of this skill (references, locales,
// goldens, fixtures after the marker is replaced, and the test sources) and over the goldens of the other skills, and
// flags nothing outside an explicit allowlist. A test source or fixture that holds a credential-shaped literal fails
// here, and the failure names the file, the line and the kind, never the value.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { scanString } from "../scripts/lib/secrets.mjs";
import { fakeSecretValue, MARKER } from "../evals/fake-secret.mjs";
import { tmp } from "./helpers.mjs";
import { mkdirSync, writeFileSync } from "node:fs";

const SKILL = fileURLToPath(new URL("..", import.meta.url));
const PLUGINS = join(SKILL, "..", "..", "..");
const OTHER_GOLDENS = ["azure-terraform-stacks", "docs-generator", "stacks-auditor"].map((p) => join(PLUGINS, p, "skills", p, "test", "golden"));
const SKIP_DIRS = new Set(["node_modules", ".git", "results"]);
const TEXT = /\.(?:md|mjs|js|json|ya?ml|tf|tfvars|hcl|txt|sh|html|css|csv|cjs|toml|ini|cfg|env|gitattributes)$|^\.gitattributes$/i;
// an explicit allowlist: file (relative to the plugins folder, with forward slashes), kind and reason
export const ALLOWLIST = [
  { file: "assessment-report/skills/assessment-report/evals/cases/model/M-01/repo/infra/terraform.tfvars", kind: "generic-credential", reason: "the eval case plants one synthetic secret on purpose, to check that the report redacts it" },
];

const normalize = (t) => t.replace(/\r\n?/g, "\n");
const rel = (p) => relative(PLUGINS, p).split("\\").join("/");

/** Versioned files only (git ls-files, no shell), so a generated or untracked file never enters the corpus. */
export function versioned(cwd) {
  const r = spawnSync("git", ["ls-files", "-z", "--", "."], { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (r.error || r.status !== 0) throw new Error(`the corpus test needs git to list the versioned files: ${r.error ? r.error.message : r.stderr.trim()}`);
  return r.stdout.split("\0").filter(Boolean).map((f) => join(cwd, f));
}

export function collect(roots) {
  const files = [];
  for (const r of roots) {
    if (!existsSync(r)) continue;
    for (const p of versioned(r)) {
      const n = p.slice(p.lastIndexOf(sep) + 1);
      if (p.split(sep).some((x) => SKIP_DIRS.has(x))) continue;
      if (TEXT.test(n) || /^(?:SKILL|README)\.md$/.test(n)) files.push(p);
    }
  }
  return files;
}

/** Findings as "file:line kind" for the given files; the marker of fixtures is replaced by its synthetic value first. */
export function scanFiles(files) {
  const hits = [];
  for (const f of files) {
    let t;
    try { t = normalize(readFileSync(f, "utf8")); } catch { continue; }
    t = t.split(MARKER).join(fakeSecretValue());
    t.split("\n").forEach((l, i) => { for (const kind of scanString(l)) hits.push({ where: `${rel(f)}:${i + 1}`, file: rel(f), kind }); });
  }
  return hits;
}

const allowed = (h) => ALLOWLIST.some((a) => a.file === h.file && a.kind === h.kind && a.reason);

test("corpus: the scanner flags nothing in the versioned files of the skill and the other skills' goldens", () => {
  const files = collect([SKILL, ...OTHER_GOLDENS]);
  const hits = scanFiles(files).filter((h) => !allowed(h));
  console.log(`# corpus files scanned: ${files.length}`);
  assert.ok(files.length > 100, `only ${files.length} files scanned`);
  assert.deepEqual(hits.map((h) => `${h.where} ${h.kind}`), []);
});

/** A temporary git repository with the given files added (the corpus lists versioned files only). */
function repoOf(files) {
  const dir = tmp("corpus-repo-");
  spawnSync("git", ["init", "-q"], { cwd: dir });
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, name)), { recursive: true });
    writeFileSync(join(dir, name), text);
  }
  spawnSync("git", ["add", "-A"], { cwd: dir });
  return dir;
}

test("corpus: a test source with an assignment of a credential-shaped literal fails, naming file and kind but not the value", () => {
  const value = ["Zx9fQ2", "mK7vLp", "4Rt8Wy"].join("");
  const dir = repoOf({ "test/bad.test.mjs": `const a = "${["db_pass", "word"].join("")} = '${value}'";\n` });
  const hits = scanFiles(collect([dir]));
  assert.equal(hits.length, 1);
  assert.equal(hits[0].kind, "generic-credential");
  assert.ok(!JSON.stringify(hits).includes(value), "the value is never part of a finding");
});

test("corpus: only versioned files are scanned; an untracked file with a flaggable line is not read", () => {
  const dir = tmp("corpus-git-");
  const git = (...a) => spawnSync("git", a, { cwd: dir, encoding: "utf8" });
  assert.equal(git("init", "-q").status, 0, "git is required");
  const line = `${["db_pass", "word"].join("")} = '${["Zx9fQ2", "mK7vLp", "4Rt8Wy"].join("")}'\n`;
  writeFileSync(join(dir, "tracked.md"), "plain\n");
  writeFileSync(join(dir, "generated.txt"), line);
  git("add", "tracked.md");
  const files = collect([dir]).map((f) => f.slice(dir.length + 1));
  assert.deepEqual(files, ["tracked.md"]);
  git("add", "generated.txt");
  assert.deepEqual(collect([dir]).map((f) => f.slice(dir.length + 1)).sort(), ["generated.txt", "tracked.md"]);
  assert.equal(scanFiles(collect([dir])).length, 1);
  assert.throws(() => versioned(tmp("corpus-nogit-")), /needs git/);
});

test("corpus: CRLF in a versioned file gives the same result as LF", () => {
  const dir = repoOf({ "a.md": "line one\r\nline two\r\n" });
  assert.deepEqual(scanFiles(collect([dir])), []);
});
