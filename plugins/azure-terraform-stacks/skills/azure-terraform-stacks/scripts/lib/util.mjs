// Small helpers shared by check, audit and discovery.
import { existsSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

export const SKIP_DIRS = new Set([".git", ".terraform", ".terragrunt-cache", "node_modules"]);

// Relative file paths under dir (relative to root), skipping tool and VCS folders. Never follows symlinks to directories.
export function walk(dir, root = dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, root, out);
    else if (e.isFile() || (e.isSymbolicLink() && statSync(p).isFile())) out.push(relative(root, p).split("\\").join("/"));
  }
  return out;
}

// 1-based line of the first line that matches (string: includes, RegExp: test).
export const lineOf = (text, re) => {
  const lines = text.split("\n");
  const i = lines.findIndex((l) => (typeof re === "string" ? l.includes(re) : re.test(l)));
  return i < 0 ? undefined : i + 1;
};

// Like lineOf, but starts at the first line that matches `anchor`: "destroy" after the line of the action input.
export const lineAfter = (text, anchor, re) => {
  const lines = text.split("\n");
  const from = lines.findIndex((l) => (typeof anchor === "string" ? l.includes(anchor) : anchor.test(l)));
  if (from < 0) return lineOf(text, re);
  const i = lines.slice(from).findIndex((l) => (typeof re === "string" ? l.includes(re) : re.test(l)));
  return i < 0 ? undefined : from + i + 1;
};

const semver = (v) => v.replace(/^v/, "").split(".").map(Number);
export const older = (a, b) => { const x = semver(a), y = semver(b); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i]; return false; };
export const lowerBound = (c) => { const m = />=\s*([\d.]+)/.exec(c ?? ""); return m ? m[1] : null; };

// Blanks HCL comments (full-line # and //, and /* */ blocks) but keeps every line, so line numbers still match.
export function stripHclComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .split("\n")
    .map((l) => (/^\s*(#|\/\/)/.test(l) ? "" : l))
    .join("\n");
}

// Text between the braces of the block that opens at text[open] === "{"; null when unbalanced.
export function braceBody(text, open) {
  let depth = 0, inStr = false;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (inStr) { if (c === "\\") i++; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return text.slice(open + 1, i);
  }
  return null;
}
