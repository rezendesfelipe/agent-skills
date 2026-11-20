import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import { spawnSync } from "node:child_process";
import { BIN, KEY, runBin, runInteractive, sandbox } from "./helpers.mjs";

let box;
beforeEach(() => (box = sandbox({ tools: [".claude", ".cursor"] })));
afterEach(() => box.cleanup());

const run = (...args) => runBin(args, box);
const userDir = (rel, skill) => join(box.home, rel, skill);

describe("Package and command", () => {
  test("--help lists commands and tools and exits 0", () => {
    const r = run("--help");
    assert.equal(r.code, 0);
    for (const word of ["list", "add", "remove", "claude", "codex", "gemini", "cursor", "copilot"]) assert.match(r.stdout, new RegExp(word));
  });

  test("Node older than 20 is rejected", () => {
    const fake = "data:text/javascript,Object.defineProperty(process,'versions',{value:{...process.versions,node:'18.19.0'}})";
    const r = spawnSync(process.execPath, ["--import", fake, BIN, "--help"], { encoding: "utf8" });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /Node\.js 20 or later/);
  });
});

describe("Supported tools and paths", () => {
  test("codex at user scope goes to ~/.agents/skills", () => {
    const r = run("add", "alpha", "--tool", "codex", "--scope", "user");
    assert.equal(r.code, 0, r.stderr);
    assert.ok(existsSync(userDir(".agents/skills", "alpha/SKILL.md")));
  });

  test("copilot at project scope goes to ./.github/skills", () => {
    const r = run("add", "alpha", "--tool", "copilot", "--scope", "project");
    assert.equal(r.code, 0, r.stderr);
    assert.ok(existsSync(join(box.cwd, ".github/skills/alpha/SKILL.md")));
  });

  test("unknown tool fails with exit 2 and writes nothing", () => {
    const r = run("add", "alpha", "--tool", "windsurf");
    assert.equal(r.code, 2);
    assert.match(r.stderr, /windsurf/);
    assert.match(r.stderr, /claude, codex, gemini, cursor, copilot/);
    assert.ok(!existsSync(join(box.home, ".claude/skills")));
  });
});

describe("List skills", () => {
  test("lists every bundled skill with plugin and description", () => {
    const r = run("list");
    assert.equal(r.code, 0);
    assert.match(r.stdout, /alpha\s+demo\s+Fixture skill alpha/);
    assert.match(r.stdout, /beta\s+demo\s+Fixture skill beta/);
  });

  test("--json prints only a JSON array", () => {
    const r = run("list", "--json");
    const data = JSON.parse(r.stdout);
    assert.deepEqual(data.map((s) => s.name), ["alpha", "beta"]);
    assert.deepEqual(Object.keys(data[0]).sort(), ["description", "name", "plugin"]);
  });
});

describe("Add skills", () => {
  test("several skills for several tools, all paths printed", () => {
    const r = run("add", "alpha", "beta", "--tool", "claude,gemini");
    assert.equal(r.code, 0, r.stderr);
    for (const toolDir of [".claude/skills", ".gemini/skills"])
      for (const skill of ["alpha", "beta"]) {
        assert.ok(existsSync(userDir(toolDir, skill)));
        assert.ok(r.stdout.includes(userDir(toolDir, skill)));
      }
  });

  test("copies every file and writes the install marker", () => {
    run("add", "alpha", "--tool", "claude");
    const dir = userDir(".claude/skills", "alpha");
    assert.equal(readFileSync(join(dir, "references/notes.md"), "utf8").trim(), "reference file");
    const marker = JSON.parse(readFileSync(join(dir, ".agent-skills.json"), "utf8"));
    assert.equal(marker.package, "@frcloudsolutions/agent-skills");
    assert.equal(marker.skill, "alpha");
  });

  test("unknown skill fails, suggests list, writes nothing", () => {
    const r = run("add", "no-such-skill", "--tool", "claude");
    assert.equal(r.code, 2);
    assert.match(r.stderr, /no-such-skill/);
    assert.match(r.stderr, /agent-skills list/);
    assert.ok(!existsSync(join(box.home, ".claude/skills")));
  });

  test("existing folder is skipped without --force", () => {
    const dir = userDir(".claude/skills", "alpha");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "SKILL.md"), "mine");
    const r = run("add", "alpha", "--tool", "claude");
    assert.equal(r.code, 1);
    assert.match(r.stdout, /skipped/);
    assert.equal(readFileSync(join(dir, "SKILL.md"), "utf8"), "mine");
  });

  test("--force replaces the folder with the bundled version", () => {
    const dir = userDir(".claude/skills", "alpha");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "stale.txt"), "old");
    const r = run("add", "alpha", "--tool", "claude", "--force");
    assert.equal(r.code, 0, r.stderr);
    assert.ok(!existsSync(join(dir, "stale.txt")));
    assert.match(readFileSync(join(dir, "SKILL.md"), "utf8"), /name: alpha/);
  });

  test("notes overlap and Gemini settings", () => {
    const r = run("add", "alpha", "--tool", "claude,cursor,gemini");
    assert.match(r.stdout, /Cursor also reads \.claude\/skills/);
    assert.match(r.stdout, /Gemini CLI may need Agent Skills enabled/);
  });
});

describe("Interactive selection", () => {
  test("add with no arguments asks skills, tools, scope, then confirms", async () => {
    const r = await runInteractive(["add"], {
      ...box,
      keys: [KEY.space, KEY.enter, KEY.enter, KEY.enter, "y"],
    });
    assert.equal(r.code, 0, r.stderr);
    const order = ["Which skills", "Install for which tools", "Scope?", "Continue?"].map((q) => r.stderr.indexOf(q));
    assert.ok(order.every((i, n) => i >= 0 && (n === 0 || i > order[n - 1])), `questions out of order: ${order}`);
    assert.match(r.stderr, /alpha.*Fixture skill alpha/);
    assert.ok(existsSync(userDir(".claude/skills", "alpha")));
    assert.ok(existsSync(userDir(".cursor/skills", "alpha")));
    assert.ok(!existsSync(userDir(".claude/skills", "beta")));
  });

  test("flags skip questions; only the summary is shown", async () => {
    const r = await runInteractive(["add", "alpha", "--tool", "claude", "--scope", "project"], { ...box, keys: ["y"] });
    assert.equal(r.code, 0, r.stderr);
    assert.ok(!r.stderr.includes("Which skills"));
    assert.ok(!r.stderr.includes("which tools"));
    assert.ok(!r.stderr.includes("Scope?"));
    assert.match(r.stderr, /Continue\?/);
    assert.ok(existsSync(join(box.cwd, ".claude/skills/alpha")));
  });

  test("--yes skips the summary", async () => {
    const r = await runInteractive(["add", "alpha", "--tool", "claude", "--scope", "user", "--yes"], { ...box, keys: [] });
    assert.equal(r.code, 0, r.stderr);
    assert.ok(!r.stderr.includes("Continue?"));
  });

  test("detected tools are preselected", async () => {
    const r = await runInteractive(["add", "alpha", "--scope", "user", "--yes"], { ...box, keys: [KEY.enter] });
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stderr, /◉ Claude Code/);
    assert.match(r.stderr, /◉ Cursor/);
    assert.match(r.stderr, /◯ OpenAI Codex/);
  });

  test("remove with no arguments lists only CLI-installed skills", async () => {
    run("add", "alpha", "--tool", "claude");
    const r = await runInteractive(["remove"], {
      ...box,
      keys: [KEY.enter, KEY.enter, KEY.space, KEY.enter, "y"],
    });
    assert.equal(r.code, 0, r.stderr);
    const skillsPrompt = r.stderr.slice(r.stderr.indexOf("Which skills"));
    assert.match(skillsPrompt, /alpha/);
    assert.ok(!/beta/.test(skillsPrompt));
    assert.ok(!existsSync(userDir(".claude/skills", "alpha")));
  });

  test("Ctrl+C cancels without changes", async () => {
    const r = await runInteractive(["add"], { ...box, keys: [KEY.ctrlC] });
    assert.equal(r.code, 1);
    assert.match(r.stderr, /Cancelled/);
    assert.ok(!existsSync(join(box.home, ".claude/skills")));
  });

  test("confirming an empty selection cancels", async () => {
    const r = await runInteractive(["add"], { ...box, keys: [KEY.enter] });
    assert.equal(r.code, 1);
    assert.match(r.stderr, /Nothing selected/);
  });

  test("declining the summary cancels", async () => {
    const r = await runInteractive(["add", "alpha", "--tool", "claude", "--scope", "user"], { ...box, keys: ["n"] });
    assert.equal(r.code, 1);
    assert.ok(!existsSync(userDir(".claude/skills", "alpha")));
  });

  test("non-interactive add without skill fails with exit 2 and lists skills", () => {
    const r = run("add", "--tool", "claude");
    assert.equal(r.code, 2);
    assert.match(r.stderr, /Missing skill name/);
    assert.match(r.stderr, /alpha, beta/);
  });

  test("non-interactive add without --tool fails with exit 2 and lists detected tools", () => {
    const r = run("add", "alpha");
    assert.equal(r.code, 2);
    assert.match(r.stderr, /Missing --tool/);
    assert.match(r.stderr, /Detected tools: claude, cursor/);
    assert.ok(!existsSync(join(box.home, ".claude/skills")));
  });
});

describe("Remove skills", () => {
  test("removes a CLI-installed skill", () => {
    run("add", "alpha", "--tool", "claude");
    const r = run("remove", "alpha", "--tool", "claude");
    assert.equal(r.code, 0, r.stderr);
    assert.ok(!existsSync(userDir(".claude/skills", "alpha")));
  });

  test("leaves a folder without the marker in place", () => {
    const dir = userDir(".claude/skills", "alpha");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "SKILL.md"), "mine");
    const r = run("remove", "alpha", "--tool", "claude");
    assert.equal(r.code, 1);
    assert.match(r.stdout, /not installed by agent-skills/);
    assert.ok(existsSync(join(dir, "SKILL.md")));
  });
});

describe("Scriptable behavior", () => {
  test("--dry-run prints the target and writes nothing", () => {
    const r = run("add", "alpha", "--tool", "claude", "--dry-run");
    assert.equal(r.code, 0);
    assert.ok(r.stdout.includes(userDir(".claude/skills", "alpha")));
    assert.match(r.stdout, /would-install/);
    assert.ok(!existsSync(join(box.home, ".claude/skills")));
  });

  test("remove --dry-run keeps the folder", () => {
    run("add", "alpha", "--tool", "claude");
    const r = run("remove", "alpha", "--tool", "claude", "--dry-run");
    assert.equal(r.code, 0);
    assert.ok(existsSync(userDir(".claude/skills", "alpha")));
  });

  test("partial failure keeps successes, reports both, exits non-zero", () => {
    mkdirSync(userDir(".cursor/skills", "alpha"), { recursive: true });
    const r = run("add", "alpha", "--tool", "claude,cursor", "--json");
    assert.equal(r.code, 1);
    const data = JSON.parse(r.stdout);
    assert.equal(data.ok, false);
    assert.deepEqual(data.results.map((x) => x.status).sort(), ["installed", "skipped"]);
    assert.ok(existsSync(userDir(".claude/skills", "alpha/SKILL.md")));
  });

  test("--json keeps stdout to one JSON object and notes on stderr", () => {
    const r = run("add", "alpha", "--tool", "gemini", "--json");
    const data = JSON.parse(r.stdout);
    assert.equal(data.ok, true);
    assert.equal(data.results[0].path, userDir(".gemini/skills", "alpha"));
    assert.match(r.stderr, /note: Gemini CLI/);
  });

  test("usage errors in --json mode are JSON too", () => {
    const r = run("add", "nope", "--tool", "claude", "--json");
    assert.equal(r.code, 2);
    assert.equal(JSON.parse(r.stdout).ok, false);
  });

  test("tools sharing a folder get one copy", () => {
    const r = run("add", "alpha", "--tool", "codex,codex", "--json");
    assert.equal(JSON.parse(r.stdout).results.length, 1);
    assert.deepEqual(readdirSync(join(box.home, ".agents/skills")), ["alpha"]);
  });
});

describe("Remove is idempotent", () => {
  test("removing a skill that is not installed for a tool is reported and succeeds", () => {
    const r = run("remove", "alpha", "--tool", "codex", "--json");
    assert.equal(r.code, 0);
    assert.equal(JSON.parse(r.stdout).results[0].status, "not-found");
  });
});
