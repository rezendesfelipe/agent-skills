// The command guard of the stacks-auditor subagent (hooks/stacks-auditor-guard.mjs). The guard is one layer,
// not a guarantee (it fails open when Node cannot start it), so these tests pin what it does when it runs:
// the hook is fed hook-input JSON on stdin and the exit code is asserted, as Claude Code would see it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { HERE } from "./helpers.mjs";

const SKILL_DIR = join(HERE, "..");
const PLUGIN = join(SKILL_DIR, "..", "..");
const GUARD = join(PLUGIN, "hooks", "stacks-auditor-guard.mjs");
const { SHAPES, decide } = await import(pathToFileURL(GUARD).href);
const ENGINE = "/x/azure-terraform-stacks/scripts/stacks.mjs";
const AUDITED = mkdtempSync(join(tmpdir(), "ats-guard-repo-"));

// Runs the script as the hook does: JSON on stdin, exit code and stderr out.
const hook = (command, { agent_type = "stacks-auditor", cwd = AUDITED, tool_name = "Bash" } = {}) => {
  const input = { hook_event_name: "PreToolUse", tool_name, tool_input: { command }, cwd, ...(agent_type === null ? {} : { agent_type }) };
  const r = spawnSync(process.execPath, [GUARD], { input: JSON.stringify(input), encoding: "utf8" });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
};
const allowed = (cmd, opts) => { const r = hook(cmd, opts); assert.equal(r.code, 0, `${cmd}: ${r.stderr}`); assert.equal(r.stderr, ""); };
const denied = (cmd, opts) => { const r = hook(cmd, opts); assert.equal(r.code, 2, `${cmd} should be denied`); assert.match(r.stderr, /stacks-auditor guard: /); };

test("hooks.json registers one PreToolUse hook for Bash that runs the guard through the plugin variable", () => {
  const cfg = JSON.parse(readFileSync(join(PLUGIN, "hooks", "hooks.json"), "utf8"));
  const entries = cfg.hooks.PreToolUse;
  assert.equal(entries.length, 1);
  assert.equal(entries[0].matcher, "Bash");
  assert.deepEqual(entries[0].hooks.map((h) => h.type), ["command"]);
  assert.equal(entries[0].hooks[0].command, 'node "${CLAUDE_PLUGIN_ROOT}/hooks/stacks-auditor-guard.mjs"');
  assert.deepEqual(Object.keys(cfg.hooks), ["PreToolUse"]);
});

test("other agents are untouched: no agent_type, another agent, or another tool exit 0 and print nothing", () => {
  for (const cmd of ["terraform apply", "rm -rf /", "a; b"]) {
    for (const agent_type of [null, "general-purpose", "Stacks-Auditor", "stacks-auditor-2", ""]) {
      const r = hook(cmd, { agent_type });
      assert.equal(r.code, 0, `${cmd} for ${String(agent_type)}`);
      assert.equal(r.stdout + r.stderr, "");
    }
  }
  const other = hook("terraform apply", { tool_name: "Read" });
  assert.equal(other.code, 0);
  for (const bad of ["", "not json", "null", "[]"]) {
    const r = spawnSync(process.execPath, [GUARD], { input: bad, encoding: "utf8" });
    assert.equal(r.status, 0, `unparseable input "${bad}" cannot be scoped, so it is not touched`);
  }
});

test("allowed: the engine lookup, the checks, the audit and the closing status", () => {
  allowed(`ls -d /p/skills/${ENGINE.slice(3)} /repo/.claude/skills/azure-terraform-stacks/scripts/stacks.mjs ~/.copilot/skills/azure-terraform-stacks/scripts/stacks.mjs`);
  allowed("test -f /x/azure-terraform-stacks/scripts/stacks.mjs");
  allowed("test -d /x/azure-terraform-stacks/node_modules");
  allowed("node --version");
  allowed(`node ${ENGINE} audit`);
  allowed(`node ${ENGINE} audit --root /repo --json`);
  allowed(`node ${ENGINE} audit --json --root /repo`);
  allowed(`node "${ENGINE}" audit --root "/my repo"`);
  allowed("node azure-terraform-stacks/scripts/stacks.mjs audit --json");
});

test("chaining, pipes, redirects, substitution and newlines are denied before matching", () => {
  const e = `node ${ENGINE} audit`;
  for (const cmd of [
    `${e} && rm -rf x`, `${e} || rm -rf x`, `${e}; rm -rf x`, `${e} & rm -rf x`, `${e} | tee b`, "ls -d a | tee b",
    "echo hi > f", "echo hi >> f", "cat < /etc/passwd", `${e} > out.json`, `${e} 2>&1`,
    "ls -d $(whoami)", "ls -d `whoami`", "ls -d ${HOME}", "ls -d $HOME", "ls -d (a)", "ls -d {a,b}",
    `${e}\nrm -rf x`, `${e}\r\nrm -rf x`, `${e}\trm`.replace("\t", "\u000b"), "ls -d a\u0000b",
    "ls -d a\\ b", "ls -d *", "ls -d ?", "ls -d [a]", "ls -d a #b", "ls -d !x",
    "ls -d \"a;b\"", "ls -d 'a|b'", "ls -d \"$(id)\"", "ls -d '`id`'", "test -f \"a&b\"", `node "${ENGINE}" audit --root "a>b"`,
  ]) denied(cmd);
});

test("node: only the engine's audit; no inline code, no other subcommand, no other script, no extra options", () => {
  for (const cmd of [
    'node -e "1"', "node -e 1", "node -p 1", "node --eval 1", "node --input-type=module", "node -", "node",
    "node --version --help", "node --inspect", "node /tmp/x.mjs", "node ./stacks.mjs audit", "node stacks.mjs audit",
    `node ${ENGINE}`, `node ${ENGINE} scaffold`, `node ${ENGINE} add-stack`, `node ${ENGINE} bridge`, `node ${ENGINE} diagram`,
    `node ${ENGINE} check`, `node ${ENGINE} plan`, `node ${ENGINE} audit --force`, `node ${ENGINE} audit --root`, `node ${ENGINE} audit --root --json`,
    `node ${ENGINE} audit --json --json`, `node ${ENGINE} audit --root a --root b`, `node ${ENGINE} audit extra`, `node ${ENGINE} audit --root=/r`,
    `node /x/../azure-terraform-stacks/scripts/stacks.mjs audit`, `node /x/azure-terraform-stacks/scripts/stacks.mjs.evil audit`,
    `node --require /x/e.js ${ENGINE} audit`, `NODE_OPTIONS=--require=x node ${ENGINE} audit`, `/usr/bin/node ${ENGINE} audit`, `env node ${ENGINE} audit`,
  ]) denied(cmd);
});

test("ls and test: only -d and -f/-d with plain paths", () => {
  for (const cmd of ["ls", "ls -la", "ls -d", "ls -d -a x", "ls -l -d x", "ls /x", "test -e x", "test -f", "test -f a b", "test ! -f a", "test -f -x", "[ -f a ]", "cat /etc/passwd", "find . -delete", "echo hi"])
    denied(cmd);
});

test("the dependency install only runs in the skill's folder, with exactly the declared flags", () => {
  const cmd = "npm ci --omit=dev --ignore-scripts";
  denied(cmd); // the audited repository
  denied(cmd, { cwd: undefined });
  denied(cmd, { cwd: join(tmpdir(), "does-not-exist") });
  const lookalike = mkdtempSync(join(tmpdir(), "ats-guard-lookalike-"));
  mkdirSync(join(lookalike, "scripts"));
  writeFileSync(join(lookalike, "scripts", "stacks.mjs"), "");
  writeFileSync(join(lookalike, "package.json"), JSON.stringify({ name: "someone-elses-repo" }));
  denied(cmd, { cwd: lookalike });
  const copy = mkdtempSync(join(tmpdir(), "ats-guard-skill-"));
  for (const f of ["scripts", "package.json", "package-lock.json"]) cpSync(join(SKILL_DIR, f), join(copy, f), { recursive: true });
  allowed(cmd, { cwd: copy });
  for (const bad of ["npm ci", "npm ci --omit=dev", "npm ci --ignore-scripts --omit=dev", "npm install", "npm ci --omit=dev --ignore-scripts --foreground-scripts", "npm run test", "npm ci --omit=dev --ignore-scripts && ls", "npx yaml"])
    denied(bad, { cwd: copy });
});

// Task 2.4: with a clean filter configured in the audited repository, `git -c core.fsmonitor=false status --porcelain`
// still ran the filter's program (fsmonitor off was not enough), so no git command is allowed at all.
test("git: nothing, because git runs programs named in the audited repository's own configuration", () => {
  for (const cmd of ["git status", "git status --porcelain", "git -c core.fsmonitor=false status --porcelain", "git -c core.fsmonitor=false status --porcelain --ignored",
    "git log", "git diff", "git push", "git commit -m x", "git -c alias.x=!rm status", "git --no-pager status --porcelain", "git -C /r status --porcelain"])
    denied(cmd);
});

test("commands the spec names are denied: terraform, kubectl, az, gh, git push", () => {
  for (const cmd of ["terraform plan", "terraform --version", "kubectl get pods", "az login", "gh pr create", "git push", "rm -rf x", "mv a b", "cp a b", "tee f", "sed -i s/a/b/ f", "python3 -c 1", "bash -c ls", "sh script.sh", "curl http://x", "xargs rm", "sudo ls"])
    denied(cmd);
});

test("an empty or non-string command is denied for the auditor, and a guard error blocks", () => {
  denied("");
  denied("   ");
  for (const c of [undefined, null, 5, {}, []]) assert.equal(decide(c).allow, false);
  const r = spawnSync(process.execPath, [GUARD], { input: JSON.stringify({ agent_type: "stacks-auditor", tool_name: "Bash", tool_input: {} }), encoding: "utf8" });
  assert.equal(r.status, 2);
});

test("the deny message tells the agent to stop and not to look for another way", () => {
  assert.match(hook("terraform plan").stderr, /report it to the user and stop|Report it to the user and stop/);
});

// ---- the shapes the agent is told about are the shapes the guard allows ----
const AGENT = readFileSync(join(PLUGIN, "agents", "stacks-auditor.md"), "utf8").replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n"); // CRLF checkouts on Windows

test("the allowed shapes listed in the agent's instructions equal the guard's SHAPES", () => {
  const section = /## Commands you may run[\s\S]*?```text\n([\s\S]*?)```/.exec(AGENT);
  assert.ok(section, "the agent has a 'Commands you may run' block");
  assert.deepEqual(section[1].trim().split("\n").map((l) => l.trim()), SHAPES);
});

test("every shape in SHAPES has a concrete command that the guard allows (so the list cannot drift from the code)", () => {
  const samples = {
    "ls -d <path>...": "ls -d /a /b",
    "test -f <path>": "test -f /a",
    "test -d <path>": "test -d /a",
    "node --version": "node --version",
    "node <engine> audit [--root <path>] [--json]": `node ${ENGINE} audit --root /r --json`,
    "npm ci --omit=dev --ignore-scripts": "npm ci --omit=dev --ignore-scripts",
  };
  assert.deepEqual(Object.keys(samples), SHAPES);
  for (const s of SHAPES) assert.equal(decide(samples[s], { cwd: SKILL_DIR }).allow, true, s);
});

test("the guard's own file is not a way around: it is read-only code with no dependency", () => {
  const src = readFileSync(GUARD, "utf8");
  assert.ok(!/from "(?!node:)/.test(src), "imports only node: modules");
  assert.ok(existsSync(join(PLUGIN, "hooks", "hooks.json")));
});

test("--ignore-scripts costs nothing: no package in the engine's lockfile has an install script", () => {
  const lock = JSON.parse(readFileSync(join(SKILL_DIR, "package-lock.json"), "utf8"));
  const withScripts = Object.entries(lock.packages).filter(([, p]) => p.hasInstallScript).map(([n]) => n);
  assert.deepEqual(withScripts, []);
});
