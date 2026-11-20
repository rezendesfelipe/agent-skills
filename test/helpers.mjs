import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";
import { main } from "../src/cli/main.mjs";

export const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
export const FIXTURE_ROOT = fileURLToPath(new URL("./fixtures/repo", import.meta.url));
export const BIN = join(REPO_ROOT, "bin", "agent-skills.mjs");

/** Temporary home and project folders, removed by `cleanup`. */
export function sandbox({ agents = [] } = {}) {
  const base = mkdtempSync(join(tmpdir(), "agent-skills-test-"));
  const home = join(base, "home");
  const cwd = join(base, "project");
  mkdirSync(home, { recursive: true });
  mkdirSync(cwd, { recursive: true });
  for (const dir of agents) mkdirSync(join(home, dir), { recursive: true });
  return { home, cwd, cleanup: () => rmSync(base, { recursive: true, force: true }) };
}

/** Runs the real binary as a child process (never a TTY). */
export function runBin(args, { home, cwd, root = FIXTURE_ROOT }) {
  const r = spawnSync(process.execPath, [BIN, ...args], {
    cwd,
    env: { ...process.env, HOME: home, USERPROFILE: home, AGENT_SKILLS_ROOT: root },
    encoding: "utf8",
  });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}

export function collector() {
  const stream = new PassThrough();
  let text = "";
  stream.on("data", (d) => (text += d));
  stream.columns = 120;
  stream.rows = 30;
  return { stream, text: () => text };
}

export function fakeTTY() {
  const input = new PassThrough();
  input.isTTY = true;
  input.isRaw = false;
  input.setRawMode = (v) => {
    input.isRaw = v;
    return input;
  };
  return input;
}

export const KEY = { up: "\x1b[A", down: "\x1b[B", space: " ", enter: "\r", ctrlC: "\x03" };
const tick = () => new Promise((r) => setTimeout(r, 15));

/** Writes keys one at a time with short pauses, so each prompt receives its own keys. */
export async function type(input, keys) {
  for (const k of keys) {
    await tick();
    input.write(k);
  }
}

/** Runs main() in-process as if attached to a terminal, typing `keys`. */
export async function runInteractive(args, { home, cwd, keys, root = FIXTURE_ROOT }) {
  const stdin = fakeTTY();
  const out = collector();
  const err = collector();
  const done = main(args, { stdin, stdout: out.stream, stderr: err.stream, home, cwd, root, interactive: true });
  await type(stdin, keys);
  const code = await done;
  return { code, stdout: out.text(), stderr: err.text() };
}
