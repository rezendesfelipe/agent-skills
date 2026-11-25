// The engine needs no installation (OpenSpec change vendor-stacks-engine-yaml): its one dependency, `yaml`, is
// vendored under scripts/vendor/yaml/ and reached only through scripts/lib/yaml.mjs. These tests run without node_modules.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, relative, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { HERE } from "./helpers.mjs";

const SKILL_DIR = join(HERE, "..");
const PLUGIN = join(SKILL_DIR, "..", "..");
const lf = (t) => t.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
const tmp = (p) => mkdtempSync(join(tmpdir(), p));

/** Every .mjs under `dir`, outside node_modules and scripts/vendor. */
function mjsFiles(dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules" || p === join(SKILL_DIR, "scripts", "vendor")) continue;
      out.push(...mjsFiles(p));
    } else if (e.name.endsWith(".mjs")) out.push(p);
  }
  return out;
}

test("the skill copied to a clean folder outside the repository runs check-manifest and audit with no node_modules", () => {
  const copy = join(tmp("ats-noinstall-"), "azure-terraform-stacks");
  cpSync(SKILL_DIR, copy, { recursive: true, filter: (src) => !["node_modules", "test"].includes(basename(src)) });
  const repo = tmp("ats-noinstall-repo-");
  mkdirSync(join(repo, "infra"), { recursive: true });
  cpSync(join(HERE, "fixtures", "single", "stacks.yaml"), join(repo, "infra", "stacks.yaml"));
  const env = { ...process.env };
  delete env.NODE_PATH;
  const engine = join(copy, "scripts", "stacks.mjs");
  for (const args of [["check-manifest", "--root", repo], ["audit", "--root", join(HERE, "fixtures", "audit", "monolith")]]) {
    const r = spawnSync(process.execPath, [engine, ...args], { encoding: "utf8", env });
    assert.ok(!/Cannot find package/.test(`${r.stdout}${r.stderr}`), `${args[0]}: ${r.stderr}`);
    assert.ok(r.status === 0 || r.status === 1, `${args[0]} exited ${r.status}: ${r.stderr}`);
  }
  const cm = spawnSync(process.execPath, [engine, "check-manifest", "--root", repo], { encoding: "utf8", env });
  assert.equal(cm.status, 0, cm.stdout + cm.stderr);
});

test("no file of the skill imports the bare package name yaml (tests included)", () => {
  const bad = [];
  for (const f of mjsFiles(SKILL_DIR)) {
    const t = readFileSync(f, "utf8");
    if (/from\s+["']yaml["']|import\(\s*["']yaml["']\s*\)|require\(\s*["']yaml["']\s*\)/.test(t)) bad.push(relative(SKILL_DIR, f).split(sep).join("/"));
  }
  // this file names the pattern in a regular expression, so it is the one place a literal match is not an import
  assert.deepEqual(bad.filter((f) => f !== "test/no-install.test.mjs"), []);
});

test("SKILL.md does not grow past 13,947 bytes (LF) and has no npm ci", () => {
  const text = lf(readFileSync(join(SKILL_DIR, "SKILL.md"), "utf8"));
  assert.ok(Buffer.byteLength(text, "utf8") <= 13947, `SKILL.md is ${Buffer.byteLength(text, "utf8")} bytes`);
  assert.ok(!/npm ci/.test(text));
});

test("the auditor agent installs nothing: no npm in its text", () => {
  const body = lf(readFileSync(join(PLUGIN, "agents", "stacks-auditor.md"), "utf8"));
  assert.ok(!/\bnpm\b/.test(body), "agents/stacks-auditor.md still mentions npm");
});

test("the guard allows five shapes and denies every npm and npx command, even for a trusted folder", async () => {
  const { SHAPES, decide } = await import(pathToFileURL(join(PLUGIN, "hooks", "stacks-auditor-guard.mjs")).href);
  assert.equal(SHAPES.length, 5);
  assert.ok(!SHAPES.some((s) => /npm/.test(s)));
  const home = tmp("ats-noinstall-home-");
  for (const cmd of [`npm ci --prefix ${SKILL_DIR} --omit=dev --ignore-scripts`, "npm ci", "npm install", "npx yaml"]) {
    const r = decide(cmd, { cwd: tmp("ats-noinstall-cwd-"), home });
    assert.equal(r.allow, false, cmd);
    assert.match(r.reason, /not on the allowlist/, cmd);
  }
});
