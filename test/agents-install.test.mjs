import assert from "node:assert/strict";
import { existsSync, linkSync, lstatSync, mkdirSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import { removeAgentFile, resolveAgentTarget, targetKind, writeAgentFile } from "../src/lib/agents/files.mjs";
import { loadAgent } from "../src/lib/agents/model.mjs";
import { convertAgent } from "../src/lib/agents/convert.mjs";
import { inspect, stamp } from "../src/lib/agents/marker.mjs";
import { sandbox, FIXTURE_ROOT } from "./helpers.mjs";

let box;
beforeEach(() => (box = sandbox()));
afterEach(() => box.cleanup());

const env = () => ({ home: box.home, cwd: box.cwd });
const target = (name = "doc-writer", tool = "claude", scope = "user") => {
  const t = resolveAgentTarget(tool, scope, env(), name);
  assert.ok(t.ok, t.reason);
  return t;
};
const content = (body = "Prompt.\n") => stamp(`---\nname: doc-writer\n---\n${body}`, "md", { version: "1.0.0" });

/** Creating a symbolic link needs privileges on Windows; the test is skipped when the OS says no. */
function trySymlink(t, to, link) {
  try {
    symlinkSync(to, link);
    return true;
  } catch (e) {
    if (["EPERM", "EACCES", "ENOSYS"].includes(e.code)) return t.skip(`cannot create symbolic links here (${e.code})`), false;
    throw e;
  }
}

describe("Safe paths", () => {
  test("hostile names are refused before touching the disk, with the reason", () => {
    for (const name of ["../../.bashrc", "../x", "a/b", "a\\b", "aux", "con", "nul", "com1", "lpt9", "", ".", "..", "A", "a b", "a".repeat(65), "x\u0000y"]) {
      const r = resolveAgentTarget("claude", "user", env(), name);
      assert.equal(r.ok, false, JSON.stringify(name));
      assert.match(r.reason, /refusing to build a path/);
    }
    assert.ok(!existsSync(join(box.home, ".claude")), "nothing was created");
  });
  test("a good name resolves to a direct child of the agents folder, per tool and scope", () => {
    const rel = (p) => p.slice(box.home.length + 1).replaceAll("\\", "/");
    assert.equal(rel(target("doc-writer", "claude").path), ".claude/agents/doc-writer.md");
    assert.equal(rel(target("doc-writer", "codex").path), ".codex/agents/doc-writer.toml");
    assert.equal(rel(target("doc-writer", "copilot").path), ".copilot/agents/doc-writer.agent.md");
    assert.equal(target("doc-writer", "copilot", "project").path.slice(box.cwd.length + 1).replaceAll("\\", "/"), ".github/agents/doc-writer.agent.md");
  });
});

describe("Writing", () => {
  test("a new file is created, with its folder, and not touched by a dry run", () => {
    const t = target();
    assert.deepEqual(writeAgentFile(t, content(), { dryRun: true }), { status: "would-install" });
    assert.ok(!existsSync(join(box.home, ".claude")));
    assert.deepEqual(writeAgentFile(t, content()), { status: "installed" });
    assert.equal(readFileSync(t.path, "utf8"), content());
    assert.ok(!readFileSync(t.path).subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])), "no BOM");
  });
  test("an existing file is skipped without --force and left unchanged", () => {
    const t = target();
    mkdirSync(t.dir, { recursive: true });
    writeFileSync(t.path, "mine");
    const r = writeAgentFile(t, content());
    assert.equal(r.status, "skipped");
    assert.match(r.message, /use --force/);
    assert.equal(readFileSync(t.path, "utf8"), "mine");
  });
  test("--force over a file the user wrote keeps a .bak copy and reports it", () => {
    const t = target();
    mkdirSync(t.dir, { recursive: true });
    writeFileSync(t.path, "mine");
    const r = writeAgentFile(t, content(), { force: true });
    assert.equal(r.status, "replaced");
    assert.equal(r.backup, `${t.path}.bak`);
    assert.match(r.message, /\.bak/);
    assert.equal(readFileSync(`${t.path}.bak`, "utf8"), "mine");
    assert.equal(readFileSync(t.path, "utf8"), content());
  });
  test("backup names are unique: .bak, .bak.1, .bak.2", () => {
    const t = target();
    mkdirSync(t.dir, { recursive: true });
    for (const n of [1, 2, 3]) {
      writeFileSync(t.path, `user version ${n}`);
      writeAgentFile(t, content(), { force: true });
    }
    assert.equal(readFileSync(`${t.path}.bak`, "utf8"), "user version 1");
    assert.equal(readFileSync(`${t.path}.bak.1`, "utf8"), "user version 2");
    assert.equal(readFileSync(`${t.path}.bak.2`, "utf8"), "user version 3");
  });
  test("--force over an edited installed file also keeps a backup", () => {
    const t = target();
    writeAgentFile(t, content());
    writeFileSync(t.path, readFileSync(t.path, "utf8").replace("Prompt.", "Edited."));
    const r = writeAgentFile(t, content("New.\n"), { force: true });
    assert.equal(r.status, "replaced");
    assert.match(readFileSync(r.backup, "utf8"), /Edited\./);
  });
  test("--force over an unedited installed file replaces it without a backup", () => {
    const t = target();
    writeAgentFile(t, content("One.\n"));
    const r = writeAgentFile(t, content("Two.\n"), { force: true });
    assert.deepEqual(r, { status: "replaced" });
    assert.match(readFileSync(t.path, "utf8"), /Two\./);
    assert.deepEqual(readdirSync(t.dir), ["doc-writer.md"], "no .bak and no temporary file left");
  });
  test("a dry run with --force says whether a backup would be made", () => {
    const t = target();
    mkdirSync(t.dir, { recursive: true });
    writeFileSync(t.path, "mine");
    const r = writeAgentFile(t, content(), { force: true, dryRun: true });
    assert.equal(r.status, "would-replace");
    assert.match(r.message, /\.bak/);
    assert.equal(readFileSync(t.path, "utf8"), "mine");
    assert.deepEqual(readdirSync(t.dir), ["doc-writer.md"]);
  });
  test("a file that appears between the check and the write is not overwritten", () => {
    const t = target();
    const r = writeAgentFile(t, content(), { hooks: { afterCheck: () => writeFileSync(t.path, "the other process") } });
    assert.equal(r.status, "skipped");
    assert.match(r.message, /appeared while installing/);
    assert.equal(readFileSync(t.path, "utf8"), "the other process");
  });
  test("the agents folder itself may be a symbolic link", (ctx) => {
    const real = join(box.home, "dotfiles-agents");
    mkdirSync(real, { recursive: true });
    mkdirSync(join(box.home, ".claude"), { recursive: true });
    if (!trySymlink(ctx, real, join(box.home, ".claude", "agents"))) return;
    const r = writeAgentFile(target(), content());
    assert.equal(r.status, "installed");
    assert.ok(existsSync(join(real, "doc-writer.md")));
  });
  test("a symbolic link at the target is never written through, with or without --force", (ctx) => {
    const t = target();
    mkdirSync(t.dir, { recursive: true });
    const victim = join(box.home, "victim.txt");
    writeFileSync(victim, "precious");
    if (!trySymlink(ctx, victim, t.path)) return;
    for (const force of [false, true]) {
      const r = writeAgentFile(t, content(), { force });
      assert.equal(r.status, "skipped");
      assert.match(r.message, /symbolic link/);
    }
    assert.equal(readFileSync(victim, "utf8"), "precious");
    assert.equal(targetKind(t.path), "symlink");
    assert.ok(lstatSync(t.path).isSymbolicLink());
  });
  test("a dangling symbolic link at the target is not written through either", (ctx) => {
    const t = target();
    mkdirSync(t.dir, { recursive: true });
    const missing = join(box.home, "does-not-exist.txt");
    if (!trySymlink(ctx, missing, t.path)) return;
    const r = writeAgentFile(t, content(), { force: true });
    assert.equal(r.status, "skipped");
    assert.match(r.message, /symbolic link/);
    assert.ok(!existsSync(missing), "the link target was not created");
    assert.ok(lstatSync(t.path).isSymbolicLink());
  });
  test("a directory at the target is skipped", () => {
    const t = target();
    mkdirSync(t.path, { recursive: true });
    assert.equal(writeAgentFile(t, content(), { force: true }).status, "skipped");
  });
  test("a failure is reported, not thrown (the agents folder path is a file)", () => {
    mkdirSync(join(box.home, ".claude"), { recursive: true });
    writeFileSync(join(box.home, ".claude", "agents"), "not a folder");
    const r = writeAgentFile(target(), content());
    assert.equal(r.status, "failed");
  });
  test("a hard link at the target is replaced by rename, not written through", (ctx) => {
    const t = target();
    mkdirSync(t.dir, { recursive: true });
    const other = join(box.home, "other.md");
    writeFileSync(other, "shared inode");
    try {
      linkSync(other, t.path);
    } catch (e) {
      return ctx.skip(`cannot create hard links (${e.code})`);
    }
    const r = writeAgentFile(t, content(), { force: true });
    assert.equal(r.status, "replaced");
    assert.equal(readFileSync(other, "utf8"), "shared inode");
  });
});

describe("Removing", () => {
  test("an unedited file is deleted; absent is idempotent", () => {
    const t = target();
    writeAgentFile(t, content());
    assert.deepEqual(removeAgentFile(t, { dryRun: true }), { status: "would-remove" });
    assert.ok(existsSync(t.path));
    assert.deepEqual(removeAgentFile(t), { status: "removed" });
    assert.ok(!existsSync(t.path));
    assert.equal(removeAgentFile(t).status, "not-found");
  });
  test("an edited file is left in place, and --force deletes it", () => {
    const t = target();
    writeAgentFile(t, content());
    writeFileSync(t.path, readFileSync(t.path, "utf8").replace("Prompt.", "Edited."));
    const r = removeAgentFile(t);
    assert.equal(r.status, "modified");
    assert.match(r.message, /modified since installation/);
    assert.ok(existsSync(t.path));
    assert.equal(removeAgentFile(t, { force: true }).status, "removed");
    assert.ok(!existsSync(t.path));
  });
  test("a file that only changed line endings is still deleted", () => {
    const t = target();
    writeAgentFile(t, content());
    writeFileSync(t.path, readFileSync(t.path, "utf8").replace(/\n/g, "\r\n"));
    assert.equal(removeAgentFile(t).status, "removed");
  });
  test("a file without a marker is left in place, even with --force", () => {
    const t = target();
    mkdirSync(t.dir, { recursive: true });
    writeFileSync(t.path, "---\nname: doc-writer\n---\nMine.\n");
    for (const force of [false, true]) {
      const r = removeAgentFile(t, { force });
      assert.equal(r.status, "not-managed");
      assert.match(r.message, /not installed by agent-skills/);
    }
    assert.ok(existsSync(t.path));
  });
  test("a malformed marker counts as no marker", () => {
    const t = target();
    mkdirSync(t.dir, { recursive: true });
    writeFileSync(t.path, `Body.\n<!-- agent-skills: sha256=${"a".repeat(63)}z version=1.0.0 -->\n`);
    assert.equal(removeAgentFile(t, { force: true }).status, "not-managed");
  });
  test("a forged hash is treated as an edited file", () => {
    const t = target();
    mkdirSync(t.dir, { recursive: true });
    writeFileSync(t.path, `Body.\n<!-- agent-skills: sha256=${"a".repeat(64)} version=1.0.0 -->\n`);
    assert.equal(removeAgentFile(t).status, "modified");
  });
  test("a symbolic link is never followed", (ctx) => {
    const t = target();
    mkdirSync(t.dir, { recursive: true });
    const victim = join(box.home, "victim.md");
    writeFileSync(victim, content());
    if (!trySymlink(ctx, victim, t.path)) return;
    assert.equal(removeAgentFile(t, { force: true }).status, "not-managed");
    assert.ok(existsSync(victim));
  });
  test("a Codex file is checked with its own comment marker", () => {
    const t = target("readonly-reviewer", "codex");
    const c = convertAgent(loadAgent(join(FIXTURE_ROOT, "plugins/demo/agents/readonly-reviewer.md")), "codex", { version: "1.0.0", allowBroader: true });
    assert.equal(writeAgentFile(t, c.content).status, "installed");
    assert.deepEqual(inspect(readFileSync(t.path, "utf8"), "toml"), { marked: true, intact: true, version: "1.0.0", broadened: true });
    assert.equal(removeAgentFile(t).status, "removed");
  });
});
