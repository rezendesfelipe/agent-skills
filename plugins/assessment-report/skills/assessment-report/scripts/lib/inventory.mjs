// Inventory: the files in scope with size and SHA-256, the revision, and what was left out and why.
// Read-only and offline. Git is read from the .git folder directly, never by running git.
import { lstatSync, readFileSync, readdirSync, realpathSync, existsSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { matchAny } from "./glob.mjs";
import { isInside, posix, sha256 } from "./util.mjs";

export const MAX_FILE_BYTES = 1024 * 1024;
const SKIP_DIRS = new Set([".git", "node_modules"]);

export function isBinary(buf) {
  const n = Math.min(buf.length, 8000);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true;
  return false;
}

/** Strict UTF-8 text check. */
export function decodeText(buf) {
  if (isBinary(buf)) return null;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch {
    return null;
  }
}

/** Reads HEAD from .git without running git. Returns "" when the root is not a git work tree. */
export function gitRevision(root) {
  try {
    const gitPath = join(root, ".git");
    let gitDir = gitPath;
    if (existsSync(gitPath) && statSync(gitPath).isFile()) {
      const m = readFileSync(gitPath, "utf8").match(/^gitdir:\s*(.+)$/m);
      if (!m) return "";
      gitDir = resolve(root, m[1].trim());
    }
    const head = readFileSync(join(gitDir, "HEAD"), "utf8").trim();
    if (/^[0-9a-f]{40}$/.test(head)) return head;
    const ref = head.match(/^ref:\s*(.+)$/)?.[1];
    if (!ref) return "";
    const refFile = join(gitDir, ref);
    if (existsSync(refFile)) return readFileSync(refFile, "utf8").trim();
    for (const base of [gitDir, join(gitDir, "..", "..")]) {
      const packed = join(base, "packed-refs");
      if (existsSync(packed)) {
        const line = readFileSync(packed, "utf8").split("\n").find((l) => l.endsWith(` ${ref}`));
        if (line) return line.split(" ")[0];
      }
    }
    // linked worktree: refs live in the common dir
    const common = join(gitDir, "commondir");
    if (existsSync(common)) {
      const cdir = resolve(gitDir, readFileSync(common, "utf8").trim());
      const f = join(cdir, ref);
      if (existsSync(f)) return readFileSync(f, "utf8").trim();
    }
  } catch {
    // fall through
  }
  return "";
}

/**
 * @param {string} root assessed root
 * @param {{outDir?: string, scopeIn?: string[], scopeOut?: string[], maxBytes?: number}} opts
 */
export function buildInventory(root, { outDir, scopeIn = [], scopeOut = [], maxBytes = MAX_FILE_BYTES } = {}) {
  const realRoot = realpathSync(root);
  const realOut = outDir ? resolve(outDir) : null;
  const files = [];
  const exclusions = [];
  const excludeDir = (rel, reason) => exclusions.push({ path: rel, reason });

  const walk = (dir) => {
    let names;
    try {
      names = readdirSync(dir).sort();
    } catch {
      return;
    }
    for (const name of names) {
      const full = join(dir, name);
      const rel = posix(relative(root, full));
      if (SKIP_DIRS.has(name)) {
        excludeDir(`${rel}/`, name === ".git" ? "git-metadata" : "dependencies");
        continue;
      }
      if (realOut && resolve(full) === realOut) {
        excludeDir(`${rel}/`, "output-folder");
        continue;
      }
      let st;
      try {
        st = lstatSync(full);
      } catch {
        continue;
      }
      if (st.isSymbolicLink()) {
        let target;
        try {
          target = realpathSync(full);
        } catch {
          excludeDir(rel, "broken-symlink");
          continue;
        }
        if (!isInside(target, realRoot)) {
          excludeDir(rel, "symlink-outside-root");
          continue;
        }
        st = statSync(full);
      }
      if (st.isDirectory()) walk(full);
      else if (st.isFile()) {
        if (scopeIn.length && !matchAny(scopeIn, rel)) continue;
        if (scopeOut.length && matchAny(scopeOut, rel)) {
          excludeDir(rel, "out-of-scope");
          continue;
        }
        if (st.size > maxBytes) {
          excludeDir(rel, "too-large");
          continue;
        }
        const buf = readFileSync(full);
        if (decodeText(buf) === null) {
          excludeDir(rel, "not-text");
          continue;
        }
        files.push({ path: rel, size: st.size, sha256: sha256(buf) });
      }
    }
  };
  walk(root);

  files.sort((a, b) => (a.path < b.path ? -1 : 1));
  exclusions.sort((a, b) => (a.path < b.path ? -1 : 1));
  const inventoryHash = sha256(files.map((f) => `${f.path}\0${f.sha256}`).join("\n"));
  const commit = gitRevision(root);
  return {
    schemaVersion: "1.0",
    revision: commit || `inventory:${inventoryHash.slice(0, 16)}`,
    revisionKind: commit ? "git-commit" : "inventory-hash",
    inventoryHash,
    maxFileBytes: maxBytes,
    scope: { in: scopeIn, out: scopeOut },
    files,
    exclusions,
  };
}
