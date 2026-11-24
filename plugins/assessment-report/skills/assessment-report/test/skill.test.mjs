import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { readText } from "./helpers.mjs";
import { ENGINE_VERSION, SKILL_VERSION } from "../scripts/lib/version.mjs";

const SKILL = fileURLToPath(new URL("..", import.meta.url));
const walk = (dir, out = []) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (name === "node_modules") continue;
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
};
const scripts = () => walk(join(SKILL, "scripts")).filter((f) => f.endsWith(".mjs"));

test("SKILL.md has at most 150 lines (reports the count when it does not)", () => {
  const lines = readText(join(SKILL, "SKILL.md")).split("\n").length;
  assert.ok(lines <= 150, `SKILL.md has ${lines} lines; the limit is 150`);
});

test("the skill, engine, package and plugin versions agree", () => {
  const pkg = JSON.parse(readFileSync(join(SKILL, "package.json"), "utf8"));
  const plugin = JSON.parse(readFileSync(join(SKILL, "..", "..", ".claude-plugin", "plugin.json"), "utf8"));
  assert.equal(SKILL_VERSION, pkg.version);
  assert.equal(ENGINE_VERSION, pkg.version);
  assert.equal(plugin.version, pkg.version);
});

test("the engine has no runtime dependency", () => {
  const pkg = JSON.parse(readFileSync(join(SKILL, "package.json"), "utf8"));
  assert.equal(pkg.dependencies, undefined);
  assert.equal(pkg.devDependencies, undefined);
  assert.ok(!existsSync(join(SKILL, "package-lock.json")), "nothing to install: no lock file");
  for (const f of scripts()) {
    const imports = [...readFileSync(f, "utf8").matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)].map((m) => m[1]);
    for (const spec of imports) assert.ok(spec.startsWith("node:") || spec.startsWith("."), `${relative(SKILL, f)} imports ${spec}`);
  }
});

test("no script has network code or starts a process", () => {
  const banned = /node:(?:http|https|http2|net|tls|dns|dgram|child_process|worker_threads)|\bfetch\s*\(|XMLHttpRequest|WebSocket/;
  // worker threads are allowed only to run the absence regular expression under a time limit
  const timeLimit = ["regex-limited.mjs", "regex-worker.mjs"];
  for (const f of scripts()) {
    const src = readFileSync(f, "utf8");
    const bannedHere = timeLimit.some((n) => f.endsWith(n)) ? /node:(?:http|https|http2|net|tls|dns|dgram|child_process)|\bfetch\s*\(|XMLHttpRequest|WebSocket/ : banned;
    assert.ok(!bannedHere.test(src), `${relative(SKILL, f)} has network or process code`);
  }
});

test("no rendering code: no import of a PDF or DOCX library, no HTML layout template", () => {
  const banned = /^(?:pdfkit|pdf-lib|pdfjs-dist|puppeteer|puppeteer-core|playwright|playwright-core|jspdf|docx|officegen|html-pdf|pagedjs|fflate)$/;
  for (const f of scripts()) {
    const imports = [...readFileSync(f, "utf8").matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)].map((m) => m[1]);
    for (const spec of imports) assert.ok(!banned.test(spec), `${relative(SKILL, f)} imports ${spec}`);
  }
  const templates = walk(SKILL).filter((f) => /\.(html?|css|hbs|ejs|njk)$/i.test(f));
  assert.deepEqual(templates.map((f) => relative(SKILL, f)), [], "no HTML or CSS layout templates");
  assert.match(readText(join(SKILL, "references", "report-format.md")), /contains no layout, PDF or DOCX code/);
});
