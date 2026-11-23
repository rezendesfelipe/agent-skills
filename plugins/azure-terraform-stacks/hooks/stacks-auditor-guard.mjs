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
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const AGENT = "stacks-auditor";

/** The allowed command shapes, in the words the agent's instructions use. */
export const SHAPES = [
  "ls -d <path>...",
  "test -f <path>",
  "test -d <path>",
  "node --version",
  "node <engine> audit [--root <path>] [--json]",
  "npm ci --omit=dev --ignore-scripts",
];

const ENGINE_TAIL = "azure-terraform-stacks/scripts/stacks.mjs";
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

function isSkillFolder(cwd) {
  if (typeof cwd !== "string" || !cwd) return false;
  try {
    if (!existsSync(join(cwd, "scripts", "stacks.mjs"))) return false;
    return JSON.parse(readFileSync(join(cwd, "package.json"), "utf8")).name === "azure-terraform-stacks-engine";
  } catch {
    return false;
  }
}

/**
 * @param {string} command the Bash command of the call
 * @param {{cwd?: string}} ctx
 * @returns {{allow: true} | {allow: false, reason: string}}
 */
export function decide(command, { cwd } = {}) {
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
      let root = false, json = false;
      for (let i = 3; i < t.length; i++) {
        if (t[i] === "--json" && !json) json = true;
        else if (t[i] === "--root" && !root && isPath(t[i + 1])) { root = true; i++; }
        else return deny(`unexpected argument "${t[i]}": audit takes only [--root <path>] [--json]`);
      }
      return allow();
    }
    case "npm":
      if (t.length !== 4 || t[1] !== "ci" || t[2] !== "--omit=dev" || t[3] !== "--ignore-scripts")
        return deny("only `npm ci --omit=dev --ignore-scripts` is allowed");
      if (!isSkillFolder(cwd)) return deny("npm ci runs only in the skill's folder (the one with scripts/stacks.mjs), never in the audited repository");
      return allow();
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
