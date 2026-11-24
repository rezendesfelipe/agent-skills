#!/usr/bin/env node
// PreToolUse guard for the `stacks-auditor` subagent (Claude Code only). Node 20, no dependency.
//
// It is one layer, not a guarantee:
//   - it allows a short list of command SHAPES and denies everything else (exit code 2, reason on stderr);
//   - it does nothing (exit 0) for every call whose `agent_type` is not `stacks-auditor`;
//   - it FAILS OPEN: if Node cannot start this script, or an administrator disables plugin hooks,
//     Claude Code does not block anything (only exit code 2 blocks);
//   - it rejects shell metacharacters wholesale instead of parsing the shell, so it never decides what a
//     compound command "means".
// The same shapes are listed in agents/stacks-auditor.md ("Commands you may run"); a test keeps them equal.
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const AGENT = "stacks-auditor";

/** The allowed command shapes, in the words the agent's instructions use. */
export const SHAPES = [
  "ls -d <path>...",
  "test -f <path>",
  "test -d <path>",
  "node --version",
  "node <engine> audit [--root <path>] [--json]",
  "npm ci --prefix <skill folder> --omit=dev --ignore-scripts",
];

export const SKILL = "azure-terraform-stacks";
/**
 * The user-scope skills folders of the five supported tools, relative to the home directory: the ONLY places
 * outside the plugin where the engine is trusted. The agent's `ls -d` line lists the same folders, and a test
 * keeps both equal to the `user` folders of src/lib/tools.mjs. Project-scope folders (`<repo>/.claude/skills`,
 * ...) are deliberately absent: they live inside the audited repository, which is untrusted.
 */
export const USER_SKILL_FOLDERS = [".claude/skills", ".agents/skills", ".gemini/skills", ".cursor/skills", ".copilot/skills"];
// The plugin's own copy of the skill: this file is <plugin>/hooks/stacks-auditor-guard.mjs.
const PLUGIN_SKILL_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "skills", SKILL);

const ENGINE_TAIL = `${SKILL}/scripts/stacks.mjs`;
// A newline or any of ; & | < > ` $ ( ) { } is denied before matching (the spec), plus the characters that
// expand or escape in a shell: backslash, history bang, glob characters and comment. Control characters too.
// eslint-disable-next-line no-control-regex
const FORBIDDEN = /[\u0000-\u0008\u000a-\u001f\u007f;&|<>`$(){}\\!*?[\]#]/;

const deny = (reason) => ({ allow: false, reason });
const allow = () => ({ allow: true });

/** Splits on spaces and tabs; a token may be wrapped in one pair of quotes. Returns null when a quote is misused. */
function tokenize(cmd) {
  const tokens = [];
  let i = 0;
  while (i < cmd.length) {
    if (cmd[i] === " " || cmd[i] === "\t") { i++; continue; }
    if (cmd[i] === '"' || cmd[i] === "'") {
      const end = cmd.indexOf(cmd[i], i + 1);
      if (end < 0) return null;
      tokens.push(cmd.slice(i + 1, end));
      i = end + 1;
      if (i < cmd.length && cmd[i] !== " " && cmd[i] !== "\t") return null; // `"a"b` glues a quote to a word
    } else {
      let j = i;
      while (j < cmd.length && cmd[j] !== " " && cmd[j] !== "\t") {
        if (cmd[j] === '"' || cmd[j] === "'") return null;
        j++;
      }
      tokens.push(cmd.slice(i, j));
      i = j;
    }
  }
  return tokens;
}

const isPath = (t) => typeof t === "string" && t.length > 0 && !t.startsWith("-");
const hasDotDot = (p) => p.split(/[\\/]/).includes("..");

const realOf = (p) => { try { return realpathSync(p); } catch { return null; } };
const norm = (p) => (process.platform === "win32" ? p.toLowerCase() : p);
const same = (a, b) => norm(a) === norm(b);
const within = (child, parent) => { const r = relative(norm(parent), norm(child)); return r === "" || (!r.startsWith("..") && !isAbsolute(r)); };

/** `~` and `~/x` mean the home directory (the shell expands them, the guard sees the raw text); anything else relative is relative to cwd. */
const expand = (p, cwd, home) => (p === "~" ? home : p.startsWith("~/") ? join(home, p.slice(2)) : resolve(cwd, p));

/** Real paths of the skill folders the guard trusts: the plugin's own, then the user's, for the five tools. */
function trustedSkillDirs(home) {
  return [PLUGIN_SKILL_DIR, ...USER_SKILL_FOLDERS.map((f) => join(home, f, SKILL))].map(realOf).filter(Boolean);
}

function isEngineDir(dir) {
  try {
    if (!existsSync(join(dir, "scripts", "stacks.mjs"))) return false;
    return JSON.parse(readFileSync(join(dir, "package.json"), "utf8")).name === "azure-terraform-stacks-engine";
  } catch {
    return false;
  }
}

/**
 * Does `given` (a path as the agent wrote it) name something we trust to run or install? It must resolve (realpath,
 * so a symbolic link is followed), have no `..`, lie neither as written nor once resolved inside the working
 * directory or the audited --root (the audited repository is untrusted), and, once resolved, be exactly `want(dir)`
 * for the plugin's skill folder or a user-installed one. Returns null when fine, or the reason.
 */
function untrusted(given, what, want, { cwd, home, root }) {
  if (typeof cwd !== "string" || !cwd) return "the working directory is unknown, so the guard cannot tell whether the path is inside the audited repository";
  if (hasDotDot(given)) return `${what} has a ".." segment`;
  const abs = expand(given, cwd, home);
  const real = realOf(abs);
  if (!real) return `${what} does not exist or does not resolve`;
  const cwdReal = realOf(cwd) ?? resolve(cwd);
  const rootAbs = root === undefined ? null : expand(root, cwd, home);
  const rootReal = rootAbs ? realOf(rootAbs) ?? rootAbs : null;
  for (const [label, base, baseReal] of [["the working directory", resolve(cwd), cwdReal], ["the audited --root", rootAbs, rootReal]]) {
    if (base && (within(abs, base) || within(real, baseReal))) return `${what} is inside ${label}, that is, inside the audited repository, which is untrusted`;
  }
  if (!trustedSkillDirs(home).some((d) => same(real, want(d)))) {
    return `${what} is not the engine of this plugin or one installed in the user's skills folders (${USER_SKILL_FOLDERS.map((f) => `~/${f}`).join(", ")}); a copy elsewhere, including in the audited repository, is never run`;
  }
  return null;
}

/**
 * @param {string} command the Bash command of the call
 * @param {{cwd?: string, home?: string}} ctx `home` is for tests; the hook uses the user's home directory
 * @returns {{allow: true} | {allow: false, reason: string}}
 */
export function decide(command, { cwd, home = homedir() } = {}) {
  if (typeof command !== "string" || !command.trim()) return deny("empty command");
  if (FORBIDDEN.test(command)) return deny("shell metacharacters (newline ; & | < > ` $ ( ) { } and escapes, globs or comments) are not allowed: run one plain command");
  const t = tokenize(command);
  if (!t || !t.length) return deny("quotes must wrap a whole argument");

  switch (t[0]) {
    case "ls":
      if (t[1] === "-d" && t.length > 2 && t.slice(2).every(isPath)) return allow();
      return deny("only `ls -d <path>...` is allowed");
    case "test":
      if (t.length === 3 && (t[1] === "-f" || t[1] === "-d") && isPath(t[2])) return allow();
      return deny("only `test -f <path>` and `test -d <path>` are allowed");
    case "node": {
      if (t.length === 2 && t[1] === "--version") return allow();
      const engine = t[1];
      if (!isPath(engine) || !(engine === ENGINE_TAIL || engine.endsWith(`/${ENGINE_TAIL}`)) || hasDotDot(engine))
        return deny(`node may only run \`${ENGINE_TAIL}\` (without ..) or print its version`);
      if (t[2] !== "audit") return deny("only the engine's `audit` command is allowed (scaffold, add-stack, bridge and diagram write files)");
      let root, json = false;
      for (let i = 3; i < t.length; i++) {
        if (t[i] === "--json" && !json) json = true;
        else if (t[i] === "--root" && root === undefined && isPath(t[i + 1])) { root = t[i + 1]; i++; }
        else return deny(`unexpected argument "${t[i]}": audit takes only [--root <path>] [--json]`);
      }
      const why = untrusted(engine, "the engine", (d) => join(d, "scripts", "stacks.mjs"), { cwd, home, root });
      return why ? deny(why) : allow();
    }
    case "npm": {
      // npm ci --prefix <dir> --omit=dev --ignore-scripts, in exactly this order, nothing else. With --prefix npm does not
      // read the working directory's .npmrc (checked with npm 10.9.9), so the audited repository cannot steer it; the
      // user's own npm configuration and environment still apply, and extra flags such as --registry, --userconfig,
      // --globalconfig or --foreground-scripts are denied by this exact match.
      if (t.length !== 6 || t[1] !== "ci" || t[2] !== "--prefix" || !isPath(t[3]) || t[4] !== "--omit=dev" || t[5] !== "--ignore-scripts")
        return deny("only `npm ci --prefix <skill folder> --omit=dev --ignore-scripts` is allowed");
      const why = untrusted(t[3], "the --prefix folder", (d) => d, { cwd, home });
      if (why) return deny(why);
      if (!isEngineDir(realOf(expand(t[3], cwd, home)))) return deny("the --prefix folder is not the engine's skill folder (it needs scripts/stacks.mjs and a package.json named azure-terraform-stacks-engine)");
      return allow();
    }
    case "git":
      // Task 2.4 of fix-stacks-auditor-agent: `git -c core.fsmonitor=false status --porcelain` still ran a clean filter
      // (`filter.<name>.clean` plus `.gitattributes`) named by the repository's own configuration, so git is not allowed.
      return deny("git is not allowed: it runs programs named in the audited repository's own configuration (clean filters, fsmonitor, textconv)");
    default:
      return deny(`\`${t[0]}\` is not on the allowlist (${SHAPES.join("; ")})`);
  }
}

/** The hook's decision for one input object (already parsed). */
export function guard(input) {
  if (!input || typeof input !== "object" || input.agent_type !== AGENT) return allow(); // not our agent: touch nothing
  if (input.tool_name !== undefined && input.tool_name !== "Bash") return allow();
  try {
    return decide(input.tool_input?.command, { cwd: input.cwd });
  } catch (e) {
    return deny(`the guard failed on this command (${e?.message ?? e})`); // once it is our agent, an internal error blocks
  }
}

function main() {
  let input;
  try {
    input = JSON.parse(readFileSync(0, "utf8"));
  } catch {
    process.exit(0); // cannot tell which agent this is: do not touch it
  }
  const r = guard(input);
  if (r.allow) process.exit(0);
  process.stderr.write(`stacks-auditor guard: ${r.reason}\nThis command is denied. Report it to the user and stop; do not look for another way to run it.\n`);
  process.exit(2);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
