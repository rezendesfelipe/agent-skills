// Small helpers. Node built-ins only.
import { createHash, randomBytes } from "node:crypto";
import { lstatSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
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
export function writeFileAtomic(file, text, mode = 0o600) {
  const dir = dirname(file);
  assertNotLink(dir);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  assertNotLink(dir);
  // a random name and O_EXCL: a symbolic link planted at a guessed name is an error, never followed; rename replaces a link at `file` itself
  const tmp = `${file}.tmp-${randomBytes(8).toString("hex")}`;
  writeFileSync(tmp, text, { mode, flag: "wx" });
  renameSync(tmp, file);
}
/** Throws when `dir` is a symbolic link (nothing is written through one). Absent is fine. */
export function assertNotLink(dir) {
  let st = null;
  try { st = lstatSync(dir); } catch (e) { if (e.code !== "ENOENT") throw e; }
  if (st?.isSymbolicLink()) throw new Error(`${dir} is a symbolic link: nothing is written through one`);
}

/** The sha-256 of what plan decided, so the manifest can seal it and seal-check and --resume can compare. Only fields that change the meaning of a run. */
export function runSha(run) {
  const s = run.scope ?? {};
  return sha256(stableStringify({
    runId: run.runId, redact: run.redact, fixtures: run.fixtures, pillars: run.pillars, queryBudget: run.queryBudget, catalog: run.catalog?.sha256,
    stage: run.stage ?? null, consent: run.consent?.sha256 ?? null, stagesSkipped: run.stagesSkipped ?? [],
    scope: { kind: s.kind, managementGroup: s.managementGroup, subscriptions: s.subscriptions, visible: s.visible, expected: s.expected, containers: s.containers, notCovered: s.notCovered, complete: s.complete },
  }));
}
export const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const writeJsonFile = (file, value, mode) => writeFileAtomic(file, `${JSON.stringify(value, null, 2)}\n`, mode);

export const lf = (t) => t.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");

const RUN_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;
/** A run id is a folder name on every platform: no reserved Windows device name, no trailing dot, letters digits dot dash underscore. */
export function checkRunId(id, what) {
  if (typeof id !== "string" || !RUN_ID.test(id) || /[. ]$/.test(id) || id.includes("..") || RESERVED.test(id))
    throw new UsageError(`${what} must be 1 to 64 characters of letters, digits, dot, dash or underscore, starting with a letter or digit, not ending in a dot, and not a reserved Windows name (CON, NUL, AUX, PRN, COM1 to COM9, LPT1 to LPT9)`);
  return id;
}
/** Hash of a JSON file's parsed content in canonical form (key order and line endings do not matter). */
export const canonicalSha = (value) => sha256(stableStringify(value));
