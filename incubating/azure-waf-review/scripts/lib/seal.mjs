// seal-check: the manifest against the files, the catalog, run.json and the assessed root. Tamper-EVIDENT (hash checks), not
// tamper-proof against someone who can write the manifest and run.json together (the guard of PR 4 keeps the model from writing
// collected/). Everything in collected/ must be accounted for: the manifest, summary/<pillar>.md files and the sealed parts.
import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { PILLARS, querySha } from "./catalog.mjs";
import { runSha, sha256 } from "./util.mjs";

export const PART_FILE = /^[A-Z]{2}-[A-Z]{1,5}-\d{3}\.\d{3}\.jsonl$/;
const real = (p) => (realpathSync.native ?? realpathSync)(p);
const same = (a, b) => (process.platform === "win32" || process.platform === "darwin" ? a.toLowerCase() === b.toLowerCase() : a === b);
const sumLines = (e) => (e.parts ?? []).reduce((a, p) => a + (Number.isInteger(p.lines) ? p.lines : 0), 0);

/** @returns {{ok: boolean, problems: string[], notes: string[]}} */
export function sealCheck({ runDir, catalog }) {
  const problems = [];
  const notes = [];
  const collected = join(runDir, "collected");
  const mpath = join(collected, "manifest.json");
  let manifest = null;
  if (!existsSync(mpath)) problems.push("collected/manifest.json is missing: nothing is sealed");
  else {
    try { manifest = JSON.parse(readFileSync(mpath, "utf8")); } catch (e) { problems.push(`collected/manifest.json is not valid JSON (${e.message})`); }
  }
  let run = null;
  try { run = JSON.parse(readFileSync(join(runDir, "run.json"), "utf8")); } catch { problems.push("run.json is missing or not valid JSON: the scope of the run is not sealed"); }

  if (manifest) {
    if (manifest.catalog?.sha256 !== catalog.sha256) problems.push(`catalog hash differs: the manifest says ${String(manifest.catalog?.sha256).slice(0, 12)}, the shipped catalog is ${catalog.sha256.slice(0, 12)}`);
    if (run) {
      if (manifest.run?.sha256 !== runSha(run)) problems.push("run.json differs from the one sealed in the manifest (it was edited after collect, or the manifest has no run hash): the scope, pillars, redaction and budget of the run are not trusted");
      if (manifest.runId !== run.runId) problems.push(`the manifest is for run id ${JSON.stringify(manifest.runId)} and run.json for ${JSON.stringify(run.runId)}`);
      if (manifest.redact !== run.redact) problems.push(`the manifest says redact=${manifest.redact} and run.json says redact=${run.redact}`);
    }
    const listed = new Set();
    for (const [id, e] of Object.entries(manifest.checks ?? {})) {
      const check = catalog.checks.find((c) => c.id === id);
      if (!check) { problems.push(`${id}: not in the shipped catalog`); continue; }
      if (e.catalogSha256 !== catalog.sha256) problems.push(`${id}: catalog hash of the entry differs from the shipped catalog`);
      const q = querySha(check);
      if (q && e.querySha256 && (e.querySha256.evaluated !== q.evaluated || e.querySha256.violations !== q.violations)) problems.push(`${id}: query hash differs from the shipped catalog (the query changed after collection)`);
      for (const p of e.parts ?? []) {
        if (typeof p.name !== "string" || !PART_FILE.test(p.name) || !p.name.startsWith(`${id}.`)) { problems.push(`${id}: ${JSON.stringify(p.name)} is not a valid part name (<check>.NNN.jsonl of this check)`); continue; }
        listed.add(p.name);
        const f = join(collected, p.name);
        let st = null;
        try { st = lstatSync(f); } catch { problems.push(`${p.name}: sealed part is missing`); continue; }
        if (st.isSymbolicLink() || !st.isFile()) { problems.push(`${p.name}: a sealed part must be a regular file, not a symbolic link or a folder`); continue; }
        const buf = readFileSync(f);
        if (sha256(buf) !== p.sha256) problems.push(`${p.name}: hash differs from the manifest (the part was edited after collection)`);
        else if (buf.toString("utf8").split("\n").length - 1 !== p.lines) problems.push(`${p.name}: line count differs from the manifest`);
      }
      // counts and states must agree with the parts
      const n = sumLines(e);
      const has = (e.parts ?? []).length > 0;
      if (e.state === "fail" && !(has && e.violations > 0 && n === e.violations)) problems.push(`${id}: state fail but violations (${e.violations}) does not equal the lines of its parts (${n})`);
      else if (e.state === "pass" && !(has && n === 0 && e.evaluated > 0 && e.violations === 0)) problems.push(`${id}: state pass needs parts with no line, evaluated above zero and no violation`);
      else if (e.state === "not-applicable" && !(has && n === 0 && e.evaluated === 0 && e.violations === 0)) problems.push(`${id}: state not-applicable needs evaluated zero and no line`);
      else if (!["fail", "pass", "not-applicable"].includes(e.state) && has) problems.push(`${id}: state ${e.state} must not have parts`);
      if (e.source === "collector" && run?.scope) {
        const s = run.scope;
        if (e.scopeComplete !== s.complete || e.visibleSubscriptions !== s.visible || e.expectedSubscriptions !== s.expected) problems.push(`${id}: the scope recorded in the entry (complete=${e.scopeComplete}, visible=${e.visibleSubscriptions}, expected=${e.expectedSubscriptions}) differs from run.json`);
        if (s.complete === false && (e.state === "pass" || e.state === "not-applicable")) problems.push(`${id}: a clean result with an incomplete scope must be scope-incomplete, not ${e.state}`);
      }
    }
    // everything in collected/ must be accounted for
    if (existsSync(collected)) {
      for (const name of readdirSync(collected)) {
        let st;
        try { st = lstatSync(join(collected, name)); } catch { continue; }
        if (name === "manifest.json") { if (st.isSymbolicLink() || !st.isFile()) problems.push("manifest.json must be a regular file"); continue; }
        if (name === "summary") {
          if (st.isSymbolicLink() || !st.isDirectory()) { problems.push("summary must be a plain folder"); continue; }
          for (const f of readdirSync(join(collected, "summary"))) {
            const fs = lstatSync(join(collected, "summary", f));
            if (!(fs.isFile() && !fs.isSymbolicLink() && /^[a-z]+\.md$/.test(f) && PILLARS.includes(f.slice(0, -3)))) problems.push(`summary/${f}: not a summary file of a pillar (a stranger in collected/summary)`);
          }
          continue;
        }
        if (listed.has(name) && st.isFile() && !st.isSymbolicLink()) continue;
        if (st.isSymbolicLink()) problems.push(`${name}: a symbolic link in collected/`);
        else problems.push(`${name}: not in the manifest (a stranger in collected/; every file there must be sealed)`);
      }
    }
  }
  // the assessed root: the model writes scope.root in assessment.json, so it is compared by real path
  const apath = join(runDir, "assessment.json");
  if (!existsSync(apath)) notes.push("assessment.json does not exist yet: the scope.root seal was NOT checked (waf.mjs render, in PR 1b, requires the file and this seal)");
  else {
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
  return { ok: problems.length === 0, problems, notes };
}
