// Small helpers shared by the engine. Node built-ins only.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

export class UsageError extends Error {}

export const sha256 = (data) => createHash("sha256").update(data).digest("hex");

/** JSON with sorted keys, so equal content always hashes equal. */
export function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .filter((k) => value[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export const hashOf = (value) => sha256(stableStringify(value));

export function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

/** Writes JSON through a temp file, so a crash never leaves half a file. */
export function writeJson(file, value) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(tmp, file);
}

export function writeText(file, text) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
}

export const posix = (p) => p.split(sep).join("/");

/** True when `child` is `parent` or inside it. Both must be real paths. */
export function isInside(child, parent) {
  const rel = relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

export function realOrResolve(p) {
  try {
    return realpathSync(p);
  } catch {
    return resolve(p);
  }
}

/** True when any segment of the path is `.git`. */
export const insideGit = (p) => resolve(p).split(sep).includes(".git");

/** Splits text into lines the way an editor counts them: CRLF or LF, no phantom last line. */
export function splitLines(text) {
  const lines = text.split(/\r\n|\n|\r/);
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/** Line comparison form: NFC, no trailing whitespace. */
export const normLine = (l) => l.normalize("NFC").replace(/[ \t\r]+$/, "");

export function fileExists(p) {
  return existsSync(p);
}

export function today() {
  return new Date().toISOString().slice(0, 10);
}
