// Small helpers. Node built-ins only.
import { createHash } from "node:crypto";
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export class UsageError extends Error {}

export const sha256 = (data) => createHash("sha256").update(data).digest("hex");

/** JSON with sorted keys, so equal content always hashes equal (and a CRLF checkout hashes like an LF one). */
export function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value).filter((k) => value[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(",")}}`;
  return JSON.stringify(value);
}

/** Writes through a temp file so a crash never leaves half a file. LF only. */
export function writeFileAtomic(file, text, mode) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  writeFileSync(tmp, text, mode ? { mode } : undefined);
  renameSync(tmp, file);
}
export const writeJsonFile = (file, value, mode) => writeFileAtomic(file, `${JSON.stringify(value, null, 2)}\n`, mode);

export const lf = (t) => t.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
