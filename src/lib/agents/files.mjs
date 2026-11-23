// Safe writes and removals of agent files in a tool's agents folder.
//
// The CLI runs on other people's machines and must not trust the data it is handed: names are
// checked again here, the target must be a direct child of the agents folder, a symbolic link is
// never written through, a new file is created exclusively and a replacement goes through a
// temporary sibling file and a rename.
import { constants, copyFileSync, lstatSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { basename, dirname, join, resolve } from "node:path";
import { agentNameProblem } from "../names.mjs";
import { TOOLS, agentsDir } from "../tools.mjs";
import { inspect, markerFormat } from "./marker.mjs";

/**
 * @returns {{ok: true, path: string, dir: string, ext: string} | {ok: false, reason: string}}
 */
export function resolveAgentTarget(tool, scope, env, name) {
  const problem = agentNameProblem(name);
  if (problem) return { ok: false, reason: `refusing to build a path: ${problem}` };
  const ext = TOOLS[tool].agents.ext;
  const dir = resolve(agentsDir(tool, scope, env));
  const path = resolve(join(dir, name + ext));
  const same = (a, b) => (process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b);
  if (!same(dirname(path), dir) || basename(path) !== name + ext)
    return { ok: false, reason: `refusing to write outside the agents folder (${path})` };
  return { ok: true, path, dir, ext };
}

/** @returns {"absent"|"symlink"|"file"|"other"} */
export function targetKind(path) {
  try {
    const st = lstatSync(path);
    return st.isSymbolicLink() ? "symlink" : st.isFile() ? "file" : "other";
  } catch (e) {
    if (e.code === "ENOENT" || e.code === "ENOTDIR") return "absent";
    throw e;
  }
}

const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/** rename, retried a few times on Windows when another process briefly holds the file. */
function renameWithRetry(from, to) {
  for (let attempt = 0; ; attempt++) {
    try {
      return renameSync(from, to);
    } catch (e) {
      if (!["EPERM", "EBUSY", "EACCES"].includes(e.code) || attempt >= 5) throw e;
      sleep(20 * (attempt + 1));
    }
  }
}

/** Copies `path` to `path.bak`, `path.bak.1`, ... without overwriting anything. */
function backup(path) {
  for (let n = 0; ; n++) {
    const candidate = n === 0 ? `${path}.bak` : `${path}.bak.${n}`;
    try {
      copyFileSync(path, candidate, constants.COPYFILE_EXCL);
      return candidate;
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
    }
  }
}

/**
 * Writes `content` as the agent file at `target.path`.
 * @param {{path: string, dir: string, ext: string}} target from resolveAgentTarget
 * @param {{force?: boolean, dryRun?: boolean, hooks?: {afterCheck?: () => void}}} options
 *   `hooks.afterCheck` runs between the existence check and the write (tests use it to race the install).
 * @returns {{status: string, message?: string, backup?: string}}
 *   status: installed, replaced, would-install, would-replace, skipped or failed
 */
export function writeAgentFile(target, content, { force = false, dryRun = false, hooks = {} } = {}) {
  const kind = targetKind(target.path);
  if (kind === "symlink") return { status: "skipped", message: "the target is a symbolic link; it was not written through and was left untouched" };
  if (kind === "other") return { status: "skipped", message: "the target exists and is not a regular file" };
  if (kind === "file" && !force) return { status: "skipped", message: "already exists (use --force to replace it)" };

  let backupNeeded = false;
  if (kind === "file") {
    const state = inspect(readFileSync(target.path, "utf8"), markerFormat(target.ext));
    backupNeeded = !(state.marked && state.intact); // only a file this CLI wrote and nobody edited is replaced without a copy
  }
  if (dryRun) {
    return {
      status: kind === "file" ? "would-replace" : "would-install",
      ...(backupNeeded ? { message: "the existing file was not written by agent-skills or was edited; a .bak copy would be made first" } : {}),
    };
  }

  try {
    mkdirSync(target.dir, { recursive: true });
    hooks.afterCheck?.();
    if (kind === "absent") {
      try {
        writeFileSync(target.path, content, { encoding: "utf8", flag: "wx" });
      } catch (e) {
        if (e.code === "EEXIST") return { status: "skipped", message: "the file appeared while installing; it was not overwritten" };
        throw e;
      }
      return { status: "installed" };
    }
    const saved = backupNeeded ? backup(target.path) : undefined;
    const temp = `${target.path}.tmp-${process.pid}-${randomBytes(4).toString("hex")}`;
    try {
      writeFileSync(temp, content, { encoding: "utf8", flag: "wx" });
      renameWithRetry(temp, target.path);
    } catch (e) {
      rmSync(temp, { force: true });
      throw e;
    }
    return { status: "replaced", ...(saved ? { backup: saved, message: `the previous file was copied to ${saved}` } : {}) };
  } catch (e) {
    return { status: "failed", message: e.message };
  }
}

/**
 * Deletes an agent file only when it carries a valid marker and still has the recorded content.
 * @returns {{status: "removed"|"would-remove"|"not-found"|"not-managed"|"modified"|"failed", message?: string}}
 */
export function removeAgentFile(target, { force = false, dryRun = false } = {}) {
  const kind = targetKind(target.path);
  if (kind === "absent") return { status: "not-found", message: "not installed here" };
  if (kind === "symlink") return { status: "not-managed", message: "the target is a symbolic link; not installed by agent-skills; left in place" };
  if (kind === "other") return { status: "not-managed", message: "not a regular file; left in place" };
  let state;
  try {
    state = inspect(readFileSync(target.path, "utf8"), markerFormat(target.ext));
  } catch (e) {
    return { status: "failed", message: e.message };
  }
  if (!state.marked) return { status: "not-managed", message: "not installed by agent-skills; left in place" };
  if (!state.intact && !force) return { status: "modified", message: "modified since installation; left in place (use --force to delete it)" };
  if (dryRun) return { status: "would-remove" };
  try {
    rmSync(target.path);
  } catch (e) {
    return { status: "failed", message: e.message };
  }
  return { status: "removed", ...(state.intact ? {} : { message: "it had been modified; deleted because of --force" }) };
}

/** True when `path` is an agent file with a well-formed marker (used to list what can be removed). */
export function isInstalledAgentFile(path, ext) {
  try {
    if (targetKind(path) !== "file") return false;
    return inspect(readFileSync(path, "utf8"), markerFormat(ext)).marked;
  } catch {
    return false;
  }
}

