import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import { KEY, FIXTURE_ROOT, REPO_ROOT, runBin, runInteractive, sandbox } from "./helpers.mjs";
import { decodeMarkdown, decodeToml } from "./decoders.mjs";
import { parseDocument } from "../src/lib/frontmatter.mjs";

const VERSION = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")).version;
let box;
beforeEach(() => (box = sandbox({ tools: [".claude", ".cursor"] })));
afterEach(() => box.cleanup());

const run = (...args) => runBin(args, box);
const json = (...args) => {
  const r = run(...args, "--json");
  return { ...r, data: JSON.parse(r.stdout) };
};
const home = (...p) => join(box.home, ...p);
const read = (...p) => readFileSync(home(...p), "utf8");

describe("List skills and agents", () => {
  test("every skill and agent appears once with its kind, plugin and description", () => {
    const r = run("list");
    assert.equal(r.code, 0);
    assert.match(r.stdout, /^skill\s+alpha\s+demo\s+Fixture skill alpha/m);
    assert.match(r.stdout, /^agent\s+readonly-reviewer\s+demo\s+Fixture read-only agent/m);
    assert.equal(r.stdout.match(/readonly-reviewer/g).length, 1);
    assert.ok(!/No agents available yet/.test(r.stdout));
  });
  test("--json is only an array and every entry has a kind", () => {
    const data = JSON.parse(run("list", "--json").stdout);
    assert.ok(Array.isArray(data));
    assert.deepEqual(new Set(data.map((i) => i.kind)), new Set(["skill", "agent"]));
    for (const i of data) assert.deepEqual(Object.keys(i).sort(), ["description", "kind", "name", "plugin"]);
    assert.deepEqual(data.map((i) => i.name), [...data.map((i) => i.name)].sort((a, b) => a.localeCompare(b)));
  });
  test("with no agents the list says so", () => {
    const root = mkdtempSync(join(tmpdir(), "agent-skills-noagents-"));
    cpSync(join(FIXTURE_ROOT, "plugins/demo/skills"), join(root, "plugins/demo/skills"), { recursive: true });
    const r = runBin(["list"], { ...box, root });
    assert.equal(r.code, 0);
    assert.match(r.stdout, /No agents available yet/);
    rmSync(root, { recursive: true, force: true });
  });
  test("the repository itself lists stacks-auditor as an agent", () => {
    const r = runBin(["list", "--json"], { ...box, root: REPO_ROOT });
    const auditor = JSON.parse(r.stdout).find((i) => i.name === "stacks-auditor");
    assert.equal(auditor.kind, "agent");
  });
});

describe("Supported tools and paths (agents)", () => {
  test("an agent for Codex at user scope goes to ~/.codex/agents/<name>.toml", () => {
    const r = run("add", "full-access", "--tool", "codex", "--scope", "user");
    assert.equal(r.code, 0, r.stderr);
    assert.ok(existsSync(home(".codex/agents/full-access.toml")));
    assert.ok(r.stdout.includes(home(".codex/agents/full-access.toml")));
  });
  test("an agent for Copilot at project scope goes to ./.github/agents/<name>.agent.md", () => {
    const r = run("add", "readonly-reviewer", "--tool", "copilot", "--scope", "project");
    assert.equal(r.code, 0, r.stderr);
    const d = decodeMarkdown(readFileSync(join(box.cwd, ".github/agents/readonly-reviewer.agent.md"), "utf8"));
    assert.equal(d.front.name, "readonly-reviewer");
    assert.equal(d.body, "\nReview the code and report findings with `file:line`.\n");
  });
  test("an agent for Claude Code keeps the source frontmatter and prompt", () => {
    const r = run("add", "quick-scout", "--tool", "claude");
    assert.equal(r.code, 0, r.stderr);
    const source = readFileSync(join(FIXTURE_ROOT, "plugins/demo/agents/quick-scout.md"), "utf8");
    const out = read(".claude/agents/quick-scout.md");
    assert.ok(out.startsWith(source));
    assert.match(out, new RegExp(`\\n<!-- agent-skills: sha256=[0-9a-f]{64} version=${VERSION.replaceAll(".", "\\.")} -->\\n$`));
  });
  test("every tool gets its own folder and extension", () => {
    const r = run("add", "full-access", "--tool", "claude,codex,gemini,cursor,copilot");
    assert.equal(r.code, 0, r.stderr);
    for (const p of [".claude/agents/full-access.md", ".codex/agents/full-access.toml", ".gemini/agents/full-access.md", ".cursor/agents/full-access.md", ".copilot/agents/full-access.agent.md"])
      assert.ok(existsSync(home(p)), p);
  });
});

describe("Add skills and agents", () => {
  test("a skill and an agent together", () => {
    const r = run("add", "alpha", "readonly-reviewer", "--tool", "claude");
    assert.equal(r.code, 0, r.stderr);
    assert.ok(existsSync(home(".claude/skills/alpha/SKILL.md")));
    assert.ok(existsSync(home(".claude/agents/readonly-reviewer.md")));
  });
  test("unknown name fails with exit 2, suggests list and writes nothing", () => {
    const r = run("add", "alpha", "no-such-name", "--tool", "claude");
    assert.equal(r.code, 2);
    assert.match(r.stderr, /No skill or agent has that name/);
    assert.match(r.stderr, /agent-skills list/);
    assert.ok(!existsSync(home(".claude/skills")));
  });
  test("an existing agent file is skipped without --force and exits non-zero", () => {
    mkdirSync(home(".claude/agents"), { recursive: true });
    writeFileSync(home(".claude/agents/readonly-reviewer.md"), "mine");
    const r = run("add", "readonly-reviewer", "--tool", "claude");
    assert.equal(r.code, 1);
    assert.match(r.stdout, /skipped/);
    assert.equal(read(".claude/agents/readonly-reviewer.md"), "mine");
  });
  test("--force over a file the user wrote makes a .bak copy and reports its path", () => {
    mkdirSync(home(".claude/agents"), { recursive: true });
    writeFileSync(home(".claude/agents/readonly-reviewer.md"), "mine");
    const r = json("add", "readonly-reviewer", "--tool", "claude", "--force");
    assert.equal(r.code, 0, r.stderr);
    assert.equal(read(".claude/agents/readonly-reviewer.md.bak"), "mine");
    assert.equal(r.data.results[0].backup, home(".claude/agents/readonly-reviewer.md.bak"));
    assert.match(read(".claude/agents/readonly-reviewer.md"), /name: readonly-reviewer/);
  });
  test("--force over an unedited installed file makes no backup", () => {
    run("add", "readonly-reviewer", "--tool", "claude");
    const r = run("add", "readonly-reviewer", "--tool", "claude", "--force");
    assert.equal(r.code, 0, r.stderr);
    assert.deepEqual(readdirSync(home(".claude/agents")), ["readonly-reviewer.md"]);
  });
  test("a symbolic link at the target is not written through, even with --force", (ctx) => {
    mkdirSync(home(".claude/agents"), { recursive: true });
    writeFileSync(home("victim.md"), "precious");
    try {
      symlinkSync(home("victim.md"), home(".claude/agents/readonly-reviewer.md"));
    } catch (e) {
      return ctx.skip(`cannot create symbolic links (${e.code})`);
    }
    const r = run("add", "readonly-reviewer", "--tool", "claude", "--force");
    assert.equal(r.code, 1);
    assert.match(r.stdout, /symbolic link/);
    assert.equal(read("victim.md"), "precious");
  });
  test("a dry run prints the planned path and writes nothing", () => {
    const r = run("add", "readonly-reviewer", "--tool", "claude,gemini", "--dry-run");
    assert.equal(r.code, 0);
    assert.match(r.stdout, /would-install/);
    assert.ok(r.stdout.includes(home(".gemini/agents/readonly-reviewer.md")));
    assert.ok(!existsSync(home(".gemini")));
    assert.ok(!existsSync(home(".claude/agents")));
  });
});

describe("Permissions are never silently widened (CLI)", () => {
  test("a restricted agent for Codex is refused: nothing written, reason printed, exit 1", () => {
    const r = run("add", "readonly-reviewer", "--tool", "codex");
    assert.equal(r.code, 1);
    assert.match(r.stdout, /refused/);
    assert.match(r.stdout, /a Codex agent cannot restrict its tools/);
    assert.match(r.stdout, /--allow-broader-access/);
    assert.ok(!existsSync(home(".codex")));
  });
  test("--yes does not imply --allow-broader-access", () => {
    const r = run("add", "readonly-reviewer", "--tool", "codex", "--yes");
    assert.equal(r.code, 1);
    assert.ok(!existsSync(home(".codex")));
  });
  test("--allow-broader-access writes the Codex file, says so, and the marker records it", () => {
    const r = run("add", "readonly-reviewer", "--tool", "codex", "--allow-broader-access");
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /broader access than its source asks/);
    const t = decodeToml(read(".codex/agents/readonly-reviewer.toml"));
    assert.deepEqual(t.keys, ["name", "description", "developer_instructions"]);
    assert.match(t.marker, / broadened=tools$/);
  });
  test("an agent the tool cannot express is refused for that tool while the rest is installed", () => {
    const r = json("add", "mcp-agent", "readonly-reviewer", "--tool", "gemini");
    assert.equal(r.code, 1);
    const byName = Object.fromEntries(r.data.results.map((x) => [x.name, x]));
    assert.equal(byName["mcp-agent"].status, "refused");
    assert.match(byName["mcp-agent"].message, /mcp__github__search cannot be translated/);
    assert.equal(byName["readonly-reviewer"].status, "installed");
    assert.ok(!existsSync(home(".gemini/agents/mcp-agent.md")));
  });
  test("a specifier removes the whole tool and the result says so", () => {
    const r = json("add", "shell-limited", "--tool", "gemini");
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.data.results[0].notes[0], /"Bash\(rm \*\)" removed the whole Bash tool/);
    assert.deepEqual(decodeMarkdown(read(".gemini/agents/shell-limited.md")).front.tools, ["read_file", "grep_search"]);
  });
  test("a refused agent leaves its skills behind: none installed for that tool", () => {
    const r = json("add", "skilled-agent", "--tool", "claude,codex");
    assert.equal(r.code, 1);
    assert.ok(existsSync(home(".claude/skills/alpha/SKILL.md")), "claude agent was written, so its skill is installed");
    assert.ok(!existsSync(home(".agents/skills/alpha")), "codex agent was refused, so no skill for codex");
    assert.ok(!existsSync(home(".codex")));
    assert.equal(r.data.results.find((x) => x.tools[0] === "codex").status, "refused");
  });
  test("a dry run reports the refusal and its reason, creates nothing, exits non-zero", () => {
    const r = run("add", "readonly-reviewer", "skilled-agent", "--tool", "codex", "--dry-run");
    assert.equal(r.code, 1);
    assert.match(r.stdout, /refused/);
    assert.match(r.stdout, /a Codex agent cannot restrict its tools/);
    assert.ok(!existsSync(home(".codex")));
    assert.ok(!existsSync(home(".agents")));
  });
  test("the dropped fields are in the result and in the text output", () => {
    const r = json("add", "quick-scout", "--tool", "gemini");
    assert.deepEqual(r.data.results[0].dropped, ["model", "color", "maxTurns"]);
    const text = run("add", "quick-scout", "--tool", "cursor");
    assert.match(text.stdout, /dropped for cursor: model, color, maxTurns/);
    assert.match(text.stdout, /read-only mode also allows commands that do not change state/);
  });
});

describe("Skills an agent depends on", () => {
  test("installing for claude keeps the skills field and installs the skill", () => {
    const r = json("add", "skilled-agent", "--tool", "claude");
    assert.equal(r.code, 0, r.stderr);
    assert.match(read(".claude/agents/skilled-agent.md"), /skills:\n  - alpha/);
    assert.ok(existsSync(home(".claude/skills/alpha/SKILL.md")));
    const dep = r.data.results.find((x) => x.kind === "skill");
    assert.equal(dep.dependency, true);
    assert.deepEqual(dep.requiredBy, ["skilled-agent"]);
  });
  test("for another tool the field is dropped and the skill goes to that tool's folder", () => {
    const r = run("add", "skilled-agent", "--tool", "gemini");
    assert.equal(r.code, 0, r.stderr);
    assert.ok(!/skills/.test(read(".gemini/agents/skilled-agent.md").split("---\n")[1]));
    assert.ok(existsSync(home(".gemini/skills/alpha/SKILL.md")));
  });
  test("a skill folder that already exists is left as it is, reported, and the agent is still installed", () => {
    mkdirSync(home(".claude/skills/alpha"), { recursive: true });
    writeFileSync(home(".claude/skills/alpha/SKILL.md"), "mine");
    const r = json("add", "skilled-agent", "--tool", "claude", "--force");
    assert.equal(r.code, 0, r.stderr);
    assert.equal(read(".claude/skills/alpha/SKILL.md"), "mine");
    assert.equal(r.data.results.find((x) => x.kind === "skill").status, "present");
    assert.equal(r.data.results.find((x) => x.kind === "agent").status, "installed");
  });
  test("a skill that is also chosen explicitly is installed once, with --force semantics", () => {
    const r = json("add", "alpha", "skilled-agent", "--tool", "claude");
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.data.results.filter((x) => x.kind === "skill").length, 1);
  });
  test("an agent file that already exists is skipped and its skills are not installed", () => {
    mkdirSync(home(".claude/agents"), { recursive: true });
    writeFileSync(home(".claude/agents/skilled-agent.md"), "mine");
    const r = run("add", "skilled-agent", "--tool", "claude");
    assert.equal(r.code, 1);
    assert.ok(!existsSync(home(".claude/skills")));
  });
  test("remove leaves the skills installed", () => {
    run("add", "skilled-agent", "--tool", "claude");
    const r = run("remove", "skilled-agent", "--tool", "claude");
    assert.equal(r.code, 0, r.stderr);
    assert.ok(!existsSync(home(".claude/agents/skilled-agent.md")));
    assert.ok(existsSync(home(".claude/skills/alpha/SKILL.md")));
  });
});

describe("Remove agents", () => {
  test("removes an unedited agent and reports not-found elsewhere (idempotent)", () => {
    run("add", "readonly-reviewer", "--tool", "claude");
    const r = json("remove", "readonly-reviewer", "--tool", "claude,gemini");
    assert.equal(r.code, 0, r.stderr);
    assert.deepEqual(r.data.results.map((x) => x.status).sort(), ["not-found", "removed"]);
    assert.ok(!existsSync(home(".claude/agents/readonly-reviewer.md")));
  });
  test("an edited agent stays, exit 1, and --force deletes it", () => {
    run("add", "readonly-reviewer", "--tool", "claude");
    const file = home(".claude/agents/readonly-reviewer.md");
    writeFileSync(file, readFileSync(file, "utf8").replace("Review the code", "Review my code"));
    const r = run("remove", "readonly-reviewer", "--tool", "claude");
    assert.equal(r.code, 1);
    assert.match(r.stdout, /modified since installation/);
    assert.ok(existsSync(file));
    assert.equal(run("remove", "readonly-reviewer", "--tool", "claude", "--force").code, 0);
    assert.ok(!existsSync(file));
  });
  test("an LF to CRLF conversion alone does not count as an edit", () => {
    run("add", "readonly-reviewer", "--tool", "gemini");
    const file = home(".gemini/agents/readonly-reviewer.md");
    writeFileSync(file, readFileSync(file, "utf8").replace(/\n/g, "\r\n"));
    assert.equal(run("remove", "readonly-reviewer", "--tool", "gemini").code, 0);
    assert.ok(!existsSync(file));
  });
  test("a file without a marker is left in place and reported", () => {
    mkdirSync(home(".claude/agents"), { recursive: true });
    writeFileSync(home(".claude/agents/readonly-reviewer.md"), "mine");
    const r = run("remove", "readonly-reviewer", "--tool", "claude");
    assert.equal(r.code, 1);
    assert.match(r.stdout, /not installed by agent-skills/);
    assert.equal(read(".claude/agents/readonly-reviewer.md"), "mine");
  });
  test("--dry-run keeps the file", () => {
    run("add", "readonly-reviewer", "--tool", "claude");
    const r = run("remove", "readonly-reviewer", "--tool", "claude", "--dry-run");
    assert.equal(r.code, 0);
    assert.match(r.stdout, /would-remove/);
    assert.ok(existsSync(home(".claude/agents/readonly-reviewer.md")));
  });
  test("a Codex file installed with --allow-broader-access can be removed", () => {
    run("add", "readonly-reviewer", "--tool", "codex", "--allow-broader-access");
    assert.equal(run("remove", "readonly-reviewer", "--tool", "codex").code, 0);
    assert.ok(!existsSync(home(".codex/agents/readonly-reviewer.toml")));
  });
});

describe("Overlap warnings for agents", () => {
  test("a read-only agent for claude and cursor warns that Cursor may load the Claude copy without its restriction", () => {
    const r = run("add", "readonly-reviewer", "--tool", "claude,cursor");
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /note: Cursor also reads ~\/\.claude\/agents and may load the claude copy of readonly-reviewer without its tool restriction/);
  });
  test("an unrestricted agent only gets the duplicate-listing note; project scope uses relative paths", () => {
    const r = run("add", "full-access", "--tool", "claude,cursor", "--scope", "project");
    assert.match(r.stdout, /note: Cursor also reads \.claude\/agents, so it may list full-access installed for claude twice/);
  });
  test("no note when only one of the tools is selected", () => {
    assert.ok(!/also reads/.test(run("add", "readonly-reviewer", "--tool", "cursor").stdout));
  });
  test("the skill notes are not printed when only agents were written", () => {
    const r = run("add", "full-access", "--tool", "gemini");
    assert.ok(!/Agent Skills enabled/.test(r.stdout));
  });
});

describe("Scriptable behavior (agents)", () => {
  test("--json results carry kind, name and the old skill field; agents add dropped, notes, broader", () => {
    const r = json("add", "quick-scout", "readonly-reviewer", "alpha", "--tool", "claude");
    for (const x of r.data.results) assert.equal(x.skill, x.name);
    const kinds = Object.fromEntries(r.data.results.map((x) => [x.name, x.kind]));
    assert.deepEqual(kinds, { alpha: "skill", "quick-scout": "agent", "readonly-reviewer": "agent" });
    const c = json("add", "readonly-reviewer", "--tool", "codex", "--allow-broader-access");
    assert.equal(typeof c.data.results[0].broader, "string");
    assert.equal(c.data.results[0].restricted, undefined, "internal flag is not part of the result");
  });
  test("--help documents the agents folders and --allow-broader-access", () => {
    const r = run("--help");
    assert.match(r.stdout, /--allow-broader-access/);
    assert.match(r.stdout, /agents ~\/\.codex\/agents \| \.\/\.codex\/agents/);
    assert.match(r.stdout, /agents ~\/\.copilot\/agents \| \.\/\.github\/agents/);
  });
  test("partial failure: one tool succeeds, one is refused, both reported, exit 1", () => {
    const r = json("add", "readonly-reviewer", "--tool", "claude,codex");
    assert.equal(r.code, 1);
    assert.deepEqual(r.data.results.map((x) => x.status).sort(), ["installed", "refused"]);
    assert.ok(existsSync(home(".claude/agents/readonly-reviewer.md")));
  });
});

describe("Interactive selection with agents", () => {
  test("add lists skills and agents with their kind", async () => {
    const r = await runInteractive(["add"], { ...box, keys: [KEY.ctrlC] });
    assert.match(r.stderr, /\[skill\] alpha/);
    assert.match(r.stderr, /\[agent\] full-access/);
    assert.match(r.stderr, /Fixture skill alpha/);
  });
  test("a mixed selection installs both, and the summary lists agents installed with broader access", async () => {
    // items: alpha, beta, full-access, mcp-agent, quick-scout, readonly-reviewer, ...: pick alpha and readonly-reviewer;
    // tools: claude and cursor are preselected, move to codex and add it; scope: default; confirm.
    const withCodex = [KEY.space, KEY.down, KEY.down, KEY.down, KEY.down, KEY.down, KEY.space, KEY.enter, KEY.down, KEY.space, KEY.enter, KEY.enter, "y"];
    const r = await runInteractive(["add", "--allow-broader-access"], { ...box, keys: withCodex });
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stderr, /Broader access than the source asks/);
    assert.match(r.stderr, /readonly-reviewer for codex/);
    assert.ok(existsSync(home(".claude/skills/alpha")));
    assert.ok(existsSync(home(".codex/agents/readonly-reviewer.toml")));
    assert.ok(existsSync(home(".claude/agents/readonly-reviewer.md")));
  });
  test("--yes with an interactive terminal still does not allow broader access", async () => {
    const r = await runInteractive(["add", "readonly-reviewer", "--tool", "codex", "--scope", "user", "--yes"], { ...box, keys: [] });
    assert.equal(r.code, 1);
    assert.ok(!existsSync(home(".codex")));
    assert.ok(!r.stderr.includes("Continue?"));
  });
  test("the summary shows refusals and asks before anything is written", async () => {
    const r = await runInteractive(["add", "readonly-reviewer", "--tool", "codex", "--scope", "user"], { ...box, keys: ["y"] });
    assert.match(r.stderr, /refused .*readonly-reviewer\.toml/);
    assert.match(r.stderr, /a Codex agent cannot restrict its tools/);
    assert.equal(r.code, 1);
  });
  test("remove lists the skills and agents the CLI installed", async () => {
    run("add", "alpha", "readonly-reviewer", "--tool", "claude");
    const r = await runInteractive(["remove"], { ...box, keys: [KEY.enter, KEY.enter, "a", KEY.enter, "y"] });
    assert.equal(r.code, 0, r.stderr);
    const prompt = r.stderr.slice(r.stderr.indexOf("Which skills or agents"));
    assert.match(prompt, /\[skill\] alpha/);
    assert.match(prompt, /\[agent\] readonly-reviewer/);
    assert.ok(!/beta/.test(prompt));
    assert.ok(!existsSync(home(".claude/agents/readonly-reviewer.md")));
    assert.ok(!existsSync(home(".claude/skills/alpha")));
  });
  test("non-interactive add without a name lists skills and agents", () => {
    const r = run("add", "--tool", "claude");
    assert.equal(r.code, 2);
    assert.match(r.stderr, /Missing skill or agent name/);
    assert.match(r.stderr, /readonly-reviewer/);
  });
});

describe("The published stacks-auditor agent through the CLI", () => {
  const audit = (...args) => {
    const r = runBin(["add", "stacks-auditor", ...args, "--dry-run", "--json"], { ...box, root: REPO_ROOT });
    return { ...r, data: JSON.parse(r.stdout) };
  };
  const real = (tool, ...extra) => runBin(["add", "stacks-auditor", "--tool", tool, ...extra], { ...box, root: REPO_ROOT });
  test("it keeps Bash: no result carries a note that Bash was removed", () => {
    const r = audit("--tool", "claude,gemini,copilot");
    assert.equal(r.code, 0, r.stderr);
    for (const x of r.data.results) {
      assert.equal(x.status, "would-install", `${x.kind} ${x.name}`);
      for (const n of x.notes ?? []) assert.ok(!/removed the whole Bash tool/.test(n), n);
    }
  });
  test("Gemini lists the shell tool and Copilot lists Bash, and the skill goes with each", () => {
    assert.equal(real("gemini").code, 0);
    assert.deepEqual(decodeMarkdown(read(".gemini/agents/stacks-auditor.md")).front.tools, ["read_file", "grep_search", "glob", "run_shell_command"]);
    assert.ok(existsSync(home(".gemini/skills/azure-terraform-stacks/scripts/stacks.mjs")));
    assert.equal(real("copilot").code, 0);
    assert.deepEqual(decodeMarkdown(read(".copilot/agents/stacks-auditor.agent.md")).front.tools, ["Read", "Grep", "Glob", "Bash"]);
    assert.ok(existsSync(home(".copilot/skills/azure-terraform-stacks/scripts/stacks.mjs")));
  });
  test("Cursor and Codex are refused without --allow-broader-access, and install with it (skill included)", () => {
    for (const [tool, agentFile, skillsDir, who] of [
      ["cursor", ".cursor/agents/stacks-auditor.md", ".cursor/skills", /Cursor can only express a read-only agent, and the agent can use Bash/],
      ["codex", ".codex/agents/stacks-auditor.toml", ".agents/skills", /a Codex agent cannot restrict its tools/],
    ]) {
      const refused = real(tool);
      assert.equal(refused.code, 1, tool);
      assert.match(refused.stdout, who);
      assert.ok(!existsSync(home(agentFile)), `${tool}: nothing written when refused`);
      const ok = real(tool, "--allow-broader-access");
      assert.equal(ok.code, 0, ok.stderr);
      assert.match(ok.stdout, /broader access/);
      assert.ok(existsSync(home(agentFile)), tool);
      assert.ok(existsSync(home(skillsDir, "azure-terraform-stacks/scripts/stacks.mjs")), `${tool}: the skill is installed with the agent`);
    }
  });
  test("add stacks-auditor also installs the skill azure-terraform-stacks, as a dependency of the agent", () => {
    const r = audit("--tool", "claude");
    assert.equal(r.code, 0, r.stderr);
    assert.deepEqual(r.data.results.map((x) => `${x.kind}:${x.name}`).sort(), ["agent:stacks-auditor", "skill:azure-terraform-stacks"]);
    const skill = r.data.results.find((x) => x.kind === "skill");
    assert.equal(skill.dependency, true);
    assert.deepEqual(skill.requiredBy, ["stacks-auditor"]);
  });
  test("no forbidden field (hooks, mcpServers, permissionMode, initialPrompt) is in the published file", () => {
    // The repository's own parser: it reads CRLF checkouts (Windows) and any line break YAML accepts.
    const doc = parseDocument(readFileSync(join(REPO_ROOT, "plugins/azure-terraform-stacks/agents/stacks-auditor.md"), "utf8"));
    assert.ok(doc, "the published agent has frontmatter");
    for (const k of ["hooks", "mcpServers", "permissionMode", "initialPrompt", "disallowedTools"]) assert.equal(doc.has(k), false, k);
    assert.deepEqual(doc.keys, ["name", "description", "tools", "skills"]);
  });
});
