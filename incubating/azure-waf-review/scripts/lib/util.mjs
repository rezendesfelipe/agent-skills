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
export function writeFileAtomic(file, text, mode = 0o600) {
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.tmp-${process.pid}`;
  writeFileSync(tmp, text, { mode });
  renameSync(tmp, file);
}

/** The sha-256 of what plan decided, so the manifest can seal it and seal-check and --resume can compare. Only fields that change the meaning of a run. */
export function runSha(run) {
  const s = run.scope ?? {};
  return sha256(stableStringify({
    runId: run.runId, redact: run.redact, fixtures: run.fixtures, pillars: run.pillars, queryBudget: run.queryBudget, catalog: run.catalog?.sha256,
    scope: { kind: s.kind, managementGroup: s.managementGroup, subscriptions: s.subscriptions, visible: s.visible, expected: s.expected, containers: s.containers, notCovered: s.notCovered, complete: s.complete },
  }));
}
export const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const writeJsonFile = (file, value, mode) => writeFileAtomic(file, `${JSON.stringify(value, null, 2)}\n`, mode);

export const lf = (t) => t.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
