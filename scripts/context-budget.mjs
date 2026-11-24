#!/usr/bin/env node
// Context budget of the catalog (docs/aep/context-budget.md). No dependencies, no network, no API key.
//
// For each skill and agent it computes the loaded-context cost, reads the declared budget from a committed
// file and exits 1 when a cost is above its budget. Offline, the cost is an ESTIMATE (bytes / 4), always
// labeled as an approximation; it is never an exact measure. A number counted officially by the maintainer
// (token counting of the Anthropic Messages API, run manually and locally) can be recorded in the budgets
// file and is then used with the method `official:<model>`.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseDocument } from "../src/lib/frontmatter.mjs";

const DEFAULT_BUDGETS = "docs/aep/context-budgets.json";
const ESTIMATE = "estimate:bytes/4";

const HELP = `context-budget: loaded-context cost of each skill and agent against its declared budget

Usage:
  context-budget [--root <dir>] [--budgets <file>]

Options:
  --root <dir>      Repository root (default: the current directory)
  --budgets <file>  Declared budgets (default: ${DEFAULT_BUDGETS}, relative to the root)
  -h, --help        Show this help

Line endings are normalized to LF before counting bytes, so the result is the same on every OS.

Cost: a skill is its SKILL.md plus the files listed in "loadedWith"; an agent is the agent file plus
the SKILL.md of every skill in its "skills:" field. Without an official count the cost is an
ESTIMATE, bytes / 4 (method "${ESTIMATE}"), which is an approximation: no offline tokenizer is
accurate for current models. The declared "margin" is added to an estimate before it is compared
with the budget. An official count (method "official:<model>") is compared as it is.

Budgets file (JSON): { "margin": 0.3, "capabilities": { "skill:<name>": { "budget": 4000,
  "loadedWith": ["references/x.md"], "official": { "model": "<model id>", "tokens": 1234,
  "date": "YYYY-MM-DD", "bytes": 5678 } } } }  ("loadedWith" and "official" are optional;
"official.bytes" is the size counted: when the files change, the count is stale and ignored.)
Exit 1 when a cost is over its budget, a capability has no declared budget, or a declared budget
matches no capability.
`;

function subdirs(dir) {
  return existsSync(dir) ? readdirSync(dir).filter((n) => statSync(join(dir, n)).isDirectory()).sort() : [];
}

function discover(root) {
  const skills = new Map();
  const agents = new Map();
  for (const plugin of subdirs(join(root, "plugins"))) {
    for (const skill of subdirs(join(root, "plugins", plugin, "skills"))) {
      const dir = join(root, "plugins", plugin, "skills", skill);
      if (existsSync(join(dir, "SKILL.md"))) skills.set(skill, dir);
    }
    const agentDir = join(root, "plugins", plugin, "agents");
    if (existsSync(agentDir))
      for (const f of readdirSync(agentDir).sort())
        if (f.endsWith(".md") && statSync(join(agentDir, f)).isFile()) agents.set(f.slice(0, -3), join(agentDir, f));
  }
  return { skills, agents };
}

// Bytes of a file with line endings normalized (CRLF and a lone CR become LF): the line ending is an
// artifact of the checkout (Windows may convert LF to CRLF), not content, so the estimate must be the same on
// every operating system.
export function normalizedBytes(text) {
  return Buffer.byteLength(text.replace(/\r\n?/g, "\n"), "utf8");
}

const size = (file) => normalizedBytes(readFileSync(file, "utf8"));

export function estimateTokens(bytes) {
  return Math.ceil(bytes / 4);
}

export function measure(root, budgetsPath = DEFAULT_BUDGETS) {
  const errors = [];
  const file = resolve(root, budgetsPath);
  if (!existsSync(file)) return { rows: [], errors: [`budgets file not found: ${budgetsPath}`], margin: 0 };
  let declared;
  try {
    declared = JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    return { rows: [], errors: [`${budgetsPath} is not valid JSON: ${e.message}`], margin: 0 };
  }
  const margin = declared.margin ?? 0;
  if (typeof margin !== "number" || margin < 0) errors.push(`${budgetsPath}: "margin" must be a number >= 0`);
  const caps = declared.capabilities ?? {};
  const { skills, agents } = discover(root);
  const rows = [];
  const seen = new Set();

  const costOf = (id, files, note) => {
    const bytes = files.reduce((sum, f) => sum + size(f), 0);
    const entry = caps[id];
    seen.add(id);
    if (!entry || typeof entry.budget !== "number" || !(entry.budget > 0)) {
      errors.push(`${id}: no declared budget in ${budgetsPath}`);
      return;
    }
    let tokens = estimateTokens(bytes);
    let method = `${ESTIMATE} (approximation)`;
    let compared = Math.ceil(tokens * (1 + margin));
    let stale = "";
    const o = entry.official;
    if (o) {
      if (typeof o.tokens === "number" && o.model && (o.bytes === undefined || o.bytes === bytes)) {
        tokens = o.tokens;
        compared = o.tokens;
        method = `official:${o.model}${o.date ? ` (${o.date})` : ""}`;
      } else stale = ` [official count ignored: ${o.bytes !== undefined && o.bytes !== bytes ? "the files changed since it was counted" : "model or tokens missing"}]`;
    }
    rows.push({ id, bytes, tokens, compared, budget: entry.budget, method, over: compared > entry.budget, stale, note });
  };

  for (const [name, dir] of skills) {
    const id = `skill:${name}`;
    const extra = (caps[id]?.loadedWith ?? []).map((p) => resolve(dir, p));
    const bad = extra.filter((p) => !existsSync(p) || !p.startsWith(resolve(dir)));
    if (bad.length) errors.push(`${id}: "loadedWith" lists a file that does not exist or is outside the skill folder`);
    costOf(id, [join(dir, "SKILL.md"), ...extra.filter((p) => !bad.includes(p))]);
  }
  for (const [name, file] of agents) {
    const id = `agent:${name}`;
    const doc = parseDocument(readFileSync(file, "utf8"));
    const pre = doc?.has("skills") ? doc.list("skills") ?? [] : [];
    const files = [file];
    for (const s of pre) {
      if (skills.has(s)) files.push(join(skills.get(s), "SKILL.md"));
      else errors.push(`${id}: pre-loads skill "${s}", which is not in the catalog`);
    }
    costOf(id, files, pre.length ? `pre-loads ${pre.join(", ")}` : undefined);
  }
  for (const id of Object.keys(caps)) if (!seen.has(id)) errors.push(`${id}: declared in ${budgetsPath} but no such skill or agent exists`);
  return { rows, errors, margin };
}

function main(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-h" || a === "--help") opts.help = true;
    else if ((a === "--root" || a === "--budgets") && i + 1 < argv.length) opts[a.slice(2)] = argv[++i];
    else {
      console.error(`context-budget: unknown or incomplete option ${a}\n\n${HELP}`);
      return 2;
    }
  }
  if (opts.help) {
    console.log(HELP);
    return 0;
  }
  const { rows, errors, margin } = measure(resolve(opts.root ?? process.cwd()), opts.budgets ?? DEFAULT_BUDGETS);
  for (const r of rows) {
    const shown = r.method.startsWith("official:") ? `${r.tokens} tokens` : `~${r.tokens} tokens`;
    const adj = r.method.startsWith("official:") ? "" : `, with margin ${Math.round(margin * 100)}% = ~${r.compared}`;
    console.log(`${r.over ? "OVER " : "ok   "} ${r.id}: ${shown} [${r.method}]${adj}; budget ${r.budget}${r.note ? `; ${r.note}` : ""}${r.stale}`);
  }
  if (rows.some((r) => r.method.includes("approximation")))
    console.log("Estimates are approximations (bytes / 4), not exact token counts; the official count of the model in use is the reference.");
  const over = rows.filter((r) => r.over);
  for (const r of over) console.error(`over budget: ${r.id}: cost ${r.compared} tokens (${r.method}) > budget ${r.budget}`);
  for (const e of errors) console.error(`problem: ${e}`);
  return over.length || errors.length ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
