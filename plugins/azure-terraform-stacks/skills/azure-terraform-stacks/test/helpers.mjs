import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import { validateManifest } from "../scripts/lib/manifest.mjs";
import { generateAll } from "../scripts/lib/generate.mjs";

export const HERE = dirname(fileURLToPath(import.meta.url));
export const ENGINE = join(HERE, "..", "scripts", "stacks.mjs");
export const FIXTURES = ["full", "alz", "none-gha", "single"];

export const rawFixture = (name) => YAML.parse(readFileSync(join(HERE, "fixtures", name, "stacks.yaml"), "utf8"));
export function manifestOf(nameOrRaw) {
  const raw = typeof nameOrRaw === "string" ? rawFixture(nameOrRaw) : nameOrRaw;
  const r = validateManifest(raw);
  if (!r.manifest) throw new Error(JSON.stringify(r.errors));
  return r.manifest;
}

// A temporary repository with infra/stacks.yaml from a fixture and, optionally, the generated files.
export function tempRepo(fixture, { scaffold = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), `ats-${fixture}-`));
  mkdirSync(join(root, "infra"), { recursive: true });
  cpSync(join(HERE, "fixtures", fixture, "stacks.yaml"), join(root, "infra", "stacks.yaml"));
  if (scaffold) for (const [p, c] of generateAll(manifestOf(fixture))) {
    mkdirSync(dirname(join(root, p)), { recursive: true });
    writeFileSync(join(root, p), c);
  }
  return root;
}

// Minimal Azure Pipelines template-expression expander for tests: ${{ if }}, eq, and, or, not,
// ${{ parameters.x }} and stage templates. Not the official validator.
export function expandAdo(dir, file, params) {
  const doc = YAML.parse(readFileSync(join(dir, file), "utf8"));
  const p = Object.fromEntries((doc.parameters ?? []).map((x) => [x.name, x.default]));
  return walk(doc.stages, { ...p, ...params }, dir);
}
function evalExpr(e, p) {
  e = e.trim();
  let m;
  if ((m = /^(eq|and|or|not)\((.*)\)$/s.exec(e))) {
    const args = splitArgs(m[2]).map((a) => evalExpr(a, p));
    if (m[1] === "eq") return String(args[0]) === String(args[1]);
    if (m[1] === "and") return args.every(Boolean);
    if (m[1] === "or") return args.some(Boolean);
    return !args[0];
  }
  if ((m = /^parameters\.(\w+)$/.exec(e))) return p[m[1]];
  if (e === "true") return true;
  if (e === "false") return false;
  if ((m = /^'(.*)'$/.exec(e))) return m[1];
  throw new Error(`unsupported expression ${e}`);
}
function splitArgs(s) {
  const out = []; let depth = 0, cur = "", q = false;
  for (const ch of s) {
    if (ch === "'") q = !q;
    if (!q && ch === "(") depth++;
    if (!q && ch === ")") depth--;
    if (!q && ch === "," && depth === 0) { out.push(cur); cur = ""; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out;
}
const IF = /^\$\{\{\s*if\s+(.*)\s*\}\}$/s;
function sub(s, p) { return s.replace(/\$\{\{\s*parameters\.(\w+)\s*\}\}/g, (_, k) => (typeof p[k] === "object" ? JSON.stringify(p[k]) : p[k])); }
function walk(n, p, dir) {
  if (Array.isArray(n)) {
    const out = [];
    for (const it of n) {
      if (it && typeof it === "object" && !Array.isArray(it) && Object.keys(it).length === 1 && IF.test(Object.keys(it)[0])) {
        const k = Object.keys(it)[0];
        if (evalExpr(IF.exec(k)[1], p)) { const r = walk(it[k], p, dir); out.push(...(Array.isArray(r) ? r : [r])); }
        continue;
      }
      if (it && typeof it === "object" && it.template) {
        const t = YAML.parse(readFileSync(join(dir, it.template), "utf8"));
        const tp = Object.fromEntries((t.parameters ?? []).map((x) => [x.name, x.default]));
        const given = walk(it.parameters ?? {}, p, dir);
        out.push(...walk(t.stages, { ...tp, ...given }, dir));
        continue;
      }
      out.push(walk(it, p, dir));
    }
    return out;
  }
  if (n && typeof n === "object") {
    const o = {};
    for (const [k, v] of Object.entries(n)) {
      if (IF.test(k)) { if (evalExpr(IF.exec(k)[1], p)) Object.assign(o, walk(v, p, dir)); continue; }
      if (typeof v === "string" && /^\$\{\{\s*parameters\.(\w+)\s*\}\}$/.test(v)) { o[k] = p[/parameters\.(\w+)/.exec(v)[1]]; continue; }
      o[k] = walk(v, p, dir);
    }
    return o;
  }
  return typeof n === "string" ? sub(n, p) : n;
}
