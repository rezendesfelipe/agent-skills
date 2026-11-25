// seal-check: the manifest against the files, the catalog and the assessed root. Tamper-EVIDENT (hash checks), not tamper-proof
// against someone who can write the manifest too (the guard of PR 4 keeps the model from writing collected/).
import { existsSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { querySha } from "./catalog.mjs";
import { sha256 } from "./util.mjs";

const PART_FILE = /^[A-Z]{2}-[A-Z]{1,5}-\d{3}\.\d{3}\.jsonl$/;
const real = (p) => (realpathSync.native ?? realpathSync)(p);
const same = (a, b) => (process.platform === "win32" || process.platform === "darwin" ? a.toLowerCase() === b.toLowerCase() : a === b);

/** @returns {{ok: boolean, problems: string[]}} */
export function sealCheck({ runDir, catalog }) {
  const problems = [];
  const collected = join(runDir, "collected");
  const mpath = join(collected, "manifest.json");
  let manifest = null;
  if (!existsSync(mpath)) problems.push(`collected/manifest.json is missing: nothing is sealed`);
  else {
    try { manifest = JSON.parse(readFileSync(mpath, "utf8")); } catch (e) { problems.push(`collected/manifest.json is not valid JSON (${e.message})`); }
  }
  if (manifest) {
    if (manifest.catalog?.sha256 !== catalog.sha256) problems.push(`catalog hash differs: the manifest says ${String(manifest.catalog?.sha256).slice(0, 12)}, the shipped catalog is ${catalog.sha256.slice(0, 12)}`);
    const listed = new Set();
    for (const [id, e] of Object.entries(manifest.checks ?? {})) {
      const check = catalog.checks.find((c) => c.id === id);
      if (!check) { problems.push(`${id}: not in the shipped catalog`); continue; }
      if (e.catalogSha256 !== catalog.sha256) problems.push(`${id}: catalog hash of the entry differs from the shipped catalog`);
      const q = querySha(check);
      if (q && e.querySha256 && (e.querySha256.evaluated !== q.evaluated || e.querySha256.violations !== q.violations)) problems.push(`${id}: query hash differs from the shipped catalog (the query changed after collection)`);
      for (const p of e.parts ?? []) {
        listed.add(p.name);
        const f = join(collected, p.name);
        if (!existsSync(f)) { problems.push(`${p.name}: sealed part is missing`); continue; }
        const buf = readFileSync(f);
        if (sha256(buf) !== p.sha256) problems.push(`${p.name}: hash differs from the manifest (the part was edited after collection)`);
        else if (buf.toString("utf8").split("\n").length - 1 !== p.lines) problems.push(`${p.name}: line count differs from the manifest`);
      }
    }
    if (existsSync(collected))
      for (const f of readdirSync(collected)) if (PART_FILE.test(f) && !listed.has(f)) problems.push(`${f}: a part that the manifest does not seal`);
  }
  // the assessed root: the model writes scope.root in assessment.json, so it is compared by real path
  const apath = join(runDir, "assessment.json");
  if (existsSync(apath)) {
    let a = null;
    try { a = JSON.parse(readFileSync(apath, "utf8")); } catch (e) { problems.push(`assessment.json is not valid JSON (${e.message})`); }
    if (a) {
      const root = a?.scope?.root;
      if (typeof root !== "string" || !root) problems.push("assessment.json has no scope.root: the assessed root must be <run>/collected");
      else if (!isAbsolute(root)) problems.push(`scope.root "${root}" is not an absolute path; it must resolve to ${collected}`);
      else {
        let r = null;
        try { r = real(root); } catch { problems.push(`scope.root "${root}" does not exist; it must resolve to ${collected}`); }
        if (r !== null && existsSync(collected) && !same(r, real(collected))) problems.push(`scope.root "${root}" resolves to ${r}, not to ${real(collected)}: the assessed root is not the sealed folder`);
      }
    }
  }
  return { ok: problems.length === 0, problems };
}
