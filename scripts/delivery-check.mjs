#!/usr/bin/env node
// Deterministic checks for the AEP delivery graph (docs/aep/delivery-graph.md). No dependencies,
// and no GitHub API: it reads the working tree and git only.
//
//   node scripts/delivery-check.mjs scope <change> [--base <ref>] [--approved] [--root <dir>]
//   node scripts/delivery-check.mjs tasks <change> [--root <dir>]
//   node scripts/delivery-check.mjs evidence <file> [--root <dir>]
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HELP = `delivery-check: deterministic checks for the AEP delivery graph

Usage:
  delivery-check scope <change> [--base <ref>] [--approved] [--root <dir>]
      The diff against the base (default origin/main, then main) and the files not yet
      committed touch only openspec/changes/<change>/. Exit 1 and list the offending paths
      otherwise. --approved states that human gate 1 is recorded on the pull request: the
      check then passes and says so.
  delivery-check tasks <change> [--root <dir>]
      Every task in openspec/changes/<change>/tasks.md is ticked. Exit 1 and name the first
      "- [ ]" otherwise.
  delivery-check evidence <file> [--root <dir>]
      Every file:line reference in <file> exists (the file is inside the root and has that
      line). Exit 1 and list the missing ones. Lines marked "not verified", and lines under a
      heading that says "not verified", are reported and do not fail.

Options:
  --root <dir>   Repository root (default: the current directory)
  --base <ref>   Base ref for scope (default: origin/main, then main)
  --approved     Gate 1 is recorded; scope passes
  -h, --help     Show this help
`;

function parseArgs(argv) {
  const opts = { positional: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-h" || a === "--help") opts.help = true;
    else if (a === "--approved") opts.approved = true;
    else if (a === "--root" || a === "--base") {
      if (i + 1 >= argv.length) throw new Error(`${a} needs a value`);
      opts[a.slice(2)] = argv[++i];
    } else if (a.startsWith("-")) throw new Error(`unknown option ${a}`);
    else opts.positional.push(a);
  }
  return opts;
}

function git(root, args) {
  return execFileSync("git", ["-c", "core.quotepath=off", ...args], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function validChangeName(name) {
  return typeof name === "string" && /^[a-z0-9][a-z0-9._-]*$/.test(name) && !name.includes("..");
}

// ---- scope -----------------------------------------------------------------------------

export function checkScope(root, change, { base, approved = false } = {}) {
  if (!validChangeName(change)) return { ok: false, lines: [`invalid change name: ${change}`] };
  if (approved) return { ok: true, lines: [`scope skipped: gate 1 is recorded for ${change}`] };
  if (base !== undefined && (typeof base !== "string" || base === "" || base.startsWith("-")))
    return { ok: false, lines: [`invalid --base: ${JSON.stringify(base)} (a ref must not start with "-")`] };
  const candidates = base ? [base] : ["origin/main", "main"];
  let mergeBase;
  for (const ref of candidates) {
    try {
      mergeBase = git(root, ["merge-base", "HEAD", ref]).trim();
      break;
    } catch {
      /* try the next candidate */
    }
  }
  if (!mergeBase) return { ok: false, lines: [`cannot find the base (${candidates.join(", ")}); pass --base <ref>`] };
  const changed = new Set();
  // --no-renames: git detects renames by default and would list only the destination of a moved file, so a
  // proposal could move or delete a file outside its folder unseen. Every path touched, source included, must show.
  for (const f of git(root, ["diff", "--name-only", "--no-renames", mergeBase, "--"]).split("\n")) if (f) changed.add(f);
  for (const f of git(root, ["ls-files", "--others", "--exclude-standard", "--"]).split("\n")) if (f) changed.add(f);
  const prefix = `openspec/changes/${change}/`;
  const offending = [...changed].filter((f) => !f.startsWith(prefix)).sort();
  if (offending.length)
    return { ok: false, lines: [`${offending.length} path(s) outside ${prefix}:`, ...offending.map((f) => `  ${f}`)] };
  return { ok: true, lines: [`scope ok: ${changed.size} path(s), all under ${prefix}`] };
}

// ---- tasks -----------------------------------------------------------------------------

export function checkTasks(root, change) {
  if (!validChangeName(change)) return { ok: false, lines: [`invalid change name: ${change}`] };
  const file = resolve(root, "openspec", "changes", change, "tasks.md");
  if (!existsSync(file)) return { ok: false, lines: [`tasks.md not found: openspec/changes/${change}/tasks.md`] };
  const lines = readFileSync(file, "utf8").split(/\r?\n/);
  let done = 0;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*[-*]\s+\[ \]/.test(lines[i]))
      return { ok: false, lines: [`first unticked task, openspec/changes/${change}/tasks.md:${i + 1}`, `  ${lines[i].trim().slice(0, 200)}`] };
    if (/^\s*[-*]\s+\[[xX]\]/.test(lines[i])) done++;
  }
  return { ok: true, lines: [`tasks ok: ${done} task(s) ticked, none open`] };
}

// ---- evidence --------------------------------------------------------------------------

// path.ext:12 or path.ext:12-20; the extension must contain a letter, so versions and IPs do not match.
const REF = /(?<![\w./@:-])((?:[\w.-]+\/)*[\w.-]+\.[A-Za-z][A-Za-z0-9]*):(\d+)(?:-(\d+))?(?![\w])/g;

function lineCount(file) {
  const text = readFileSync(file, "utf8");
  if (text === "") return 0;
  const n = text.split(/\r?\n/).length;
  return text.endsWith("\n") ? n - 1 : n;
}

export function checkEvidence(root, file) {
  const abs = resolve(root, file);
  if (!existsSync(abs)) return { ok: false, lines: [`report not found: ${file}`] };
  const rootAbs = resolve(root);
  const missing = [];
  const notVerified = [];
  let checked = 0;
  let inNotVerified = false;
  const lines = readFileSync(abs, "utf8").split(/\r?\n/);
  let fence = false;
  for (let i = 0; i < lines.length; i++) {
    const text = lines[i];
    if (/^\s*```/.test(text)) fence = !fence;
    const heading = !fence && text.match(/^#{1,6}\s+(.*)$/);
    if (heading) inNotVerified = /not verified/i.test(heading[1]);
    const marked = inNotVerified || /not verified/i.test(text);
    for (const m of text.matchAll(REF)) {
      const [ref, path, from, to] = m;
      const target = resolve(rootAbs, path);
      const rel = relative(rootAbs, target);
      const line = Number(to ?? from);
      let problem = null;
      if (rel.startsWith("..") || isAbsolute(rel)) problem = "outside the root";
      else if (!existsSync(target)) problem = "file does not exist";
      else {
        try {
          const n = lineCount(target);
          if (Number(from) < 1 || line > n || (to && Number(to) < Number(from))) problem = `line ${to ? `${from}-${to}` : from} does not exist (file has ${n} line(s))`;
        } catch {
          problem = "not a readable text file";
        }
      }
      const where = `${file}:${i + 1}`;
      if (marked) notVerified.push(`  ${where}: ${ref}${problem ? ` (${problem})` : ""}`);
      else {
        checked++;
        if (problem) missing.push(`  ${where}: ${ref} - ${problem}`);
      }
    }
    if (!heading && /not verified/i.test(text) && !REF.test(text)) notVerified.push(`  ${file}:${i + 1}: marked "not verified" without a file:line`);
    REF.lastIndex = 0;
  }
  const out = [];
  if (notVerified.length) out.push(`not verified (reported, not failed): ${notVerified.length}`, ...notVerified);
  if (missing.length) return { ok: false, lines: [`${missing.length} missing reference(s) of ${checked}:`, ...missing, ...out] };
  return { ok: true, lines: [`evidence ok: ${checked} reference(s) exist`, ...out] };
}

// ---- CLI -------------------------------------------------------------------------------

function main(argv) {
  let opts;
  try {
    opts = parseArgs(argv);
  } catch (e) {
    console.error(`delivery-check: ${e.message}\n\n${HELP}`);
    return 2;
  }
  const [command, arg] = opts.positional;
  if (opts.help || !command) {
    console.log(HELP);
    return opts.help ? 0 : 2;
  }
  if (!["scope", "tasks", "evidence"].includes(command)) {
    console.error(`delivery-check: unknown subcommand "${command}"\n\n${HELP}`);
    return 2;
  }
  if (!arg) {
    console.error(`delivery-check: ${command} needs an argument\n\n${HELP}`);
    return 2;
  }
  const root = resolve(opts.root ?? process.cwd());
  let result;
  try {
    result =
      command === "scope" ? checkScope(root, arg, { base: opts.base, approved: opts.approved })
      : command === "tasks" ? checkTasks(root, arg)
      : checkEvidence(root, arg);
  } catch (e) {
    console.error(`delivery-check: ${e.message}`);
    return 2;
  }
  const print = result.ok ? console.log : console.error;
  for (const l of result.lines) print(l);
  return result.ok ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
