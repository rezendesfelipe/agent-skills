// cap-check: the gate in code that refuses a Critical finding the user did not re-verify (design Decision 7, spec "Cap gate and render
// wrapper"). It reads assessment.json AFTER `assess.mjs classify`, the manifest, map.json (written by the engine) and reverify/*.json
// (written by the user's `reverify`). For every Critical finding it derives the set of sealed checks from the PATH of each `file`
// evidence (<check>.NNN.jsonl) united with the checks map.json records for that finding. An empty set is refused. Every derived check
// needs reverify/<check>.json with state match (or a resource-scope reverify that covers every cited ARM id) whose recorded part
// hashes equal the cited part and the manifest. Fail closed: anything it cannot read or does not understand is a refusal.
// Limits (instruction only): the non-Critical severities are not gated; reverify files and map.json are tamper-evident, and the model is
// kept from writing them by the guard of PR 4, not by this code; a human who runs assess.mjs render directly is not gated.
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { PART_FILE } from "./seal.mjs";
import { sha256, writeJsonFile } from "./util.mjs";

export const SEVERITIES = ["Critical", "High", "Medium", "Low", "Info"];
const INVISIBLE = /[\s\u200b-\u200f\u2028-\u202e\u2060-\u2069\ufeff]/g;
/** Anything that reads as "critical" once case, spaces and invisible characters are removed counts as Critical (fail closed). */
export const looksCritical = (s) => /critical/i.test(String(typeof s === "string" ? s : JSON.stringify(s ?? "")).normalize("NFKC").replace(INVISIBLE, ""));
const idOf = (line) => { try { const j = JSON.parse(line); return typeof j?.id === "string" ? j.id.toLowerCase() : null; } catch { return null; } };

function partLines(runDir, name) {
  const t = readFileSync(join(runDir, "collected", name), "utf8").replace(/\r\n?/g, "\n");
  const lines = t.split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines;
}
const readJsonOr = (f) => { try { return { value: JSON.parse(readFileSync(f, "utf8")) }; } catch (e) { return { error: e.message }; } };
const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * @param {{runDir: string, catalog: object, assessmentText?: string}} o  assessmentText lets the render wrapper gate the exact bytes it will render.
 * @returns {{ok: boolean, problems: string[], criticals: {finding: string, checks: string[]}[], counts: object, assessmentSha256: string|null, runId: string|null}}
 */
export function capCheck({ runDir, catalog, assessmentText }) {
  const problems = [];
  const out = (extra = {}) => ({ ok: problems.length === 0, problems, criticals: [], counts: null, assessmentSha256: null, runId: null, ...extra });
  let buf = assessmentText === undefined ? undefined : Buffer.isBuffer(assessmentText) ? assessmentText : Buffer.from(String(assessmentText), "utf8");
  if (buf === undefined) {
    try { buf = readFileSync(join(runDir, "assessment.json")); } catch { problems.push("assessment.json does not exist: cap-check runs after assess.mjs classify"); return out(); }
  }
  const text = buf.toString("utf8");
  let a;
  try { a = JSON.parse(text); } catch (e) { problems.push(`assessment.json is not valid JSON (${e.message})`); return out(); }
  const mp = readJsonOr(join(runDir, "collected", "manifest.json"));
  if (mp.error) { problems.push(`collected/manifest.json cannot be read (${mp.error})`); return out(); }
  const manifest = mp.value;
  const runId = manifest.runId ?? null;
  const findings = Array.isArray(a.findings) ? a.findings : [];
  const evidence = new Map((Array.isArray(a.evidence) ? a.evidence : []).map((e) => [e?.id, e]));
  const counts = Object.fromEntries([...SEVERITIES, "notRated"].map((k) => [k, 0]));

  // map.json: optional, but if it exists it must be readable and agree with the manifest
  let map = null;
  const mapFile = join(runDir, "map.json");
  if (existsSync(mapFile)) {
    const m = readJsonOr(mapFile);
    if (m.error || typeof m.value !== "object" || m.value === null || typeof m.value.checks !== "object" || m.value.checks === null) problems.push(`map.json cannot be read or has no checks (${m.error ?? "shape"}): it is part of the gate`);
    else {
      map = m.value;
      for (const [cid, c] of Object.entries(map.checks)) {
        const e = manifest.checks?.[cid];
        for (const p of c?.parts ?? []) {
          if (typeof p?.name !== "string" || !PART_FILE.test(p.name)) { problems.push(`map.json names ${JSON.stringify(p?.name)}, which is not a collected part name`); continue; }
          const sealed = e?.parts?.find((x) => x.name === p?.name);
          if (!sealed || sealed.sha256 !== p.sha256) problems.push(`map.json lists ${p?.name} for ${cid} with a hash the manifest does not have: map.json is stale or edited`);
        }
      }
    }
  }

  const criticals = [];
  for (const f of findings) {
    const sev = f?.severity;
    if (typeof sev === "string" && SEVERITIES.includes(sev)) counts[sev]++;
    else if (sev === "n/a") counts.notRated++;
    else if (sev === undefined && f?.confidence === "unverified") counts.notRated++;
    if (sev === undefined && f?.confidence !== "unverified") { problems.push(`${f?.id}: has no computed severity; run assess.mjs classify before cap-check`); continue; }
    if (!looksCritical(sev)) continue;
    const id = f.id;
    const derived = new Map(); // check -> Set(part names)
    const cited = new Map(); // check -> Set(lowercase ARM ids on the cited lines)
    const add = (check, part) => { if (!derived.has(check)) { derived.set(check, new Set()); cited.set(check, new Set()); } if (part) derived.get(check).add(part); };
    let bad = false;
    for (const eid of Array.isArray(f.evidence) ? f.evidence : []) {
      const e = evidence.get(eid);
      if (!e) { problems.push(`${id}: cites evidence ${JSON.stringify(eid)}, which does not exist`); bad = true; continue; }
      if (e.kind !== "file") continue; // statement, output and absence evidence derive no sealed check
      if (typeof e.path !== "string" || !PART_FILE.test(e.path)) { problems.push(`${id}: ${eid} cites ${JSON.stringify(e.path)}, which is not the canonical name of a collected part (<check>.NNN.jsonl); a Critical may rest only on sealed parts, so this evidence derives no sealed check`); bad = true; continue; }
      const check = e.path.split(".")[0];
      const sealed = manifest.checks?.[check]?.parts?.find((p) => p.name === e.path);
      if (!sealed) { problems.push(`${id}: ${eid} cites ${e.path}, which is not a part sealed in the manifest`); bad = true; continue; }
      add(check, e.path);
      try {
        const lines = partLines(runDir, e.path);
        for (let n = e.startLine; Number.isInteger(n) && n <= e.endLine && n <= lines.length; n++) { const x = idOf(lines[n - 1]); if (x) cited.get(check).add(x); }
      } catch { problems.push(`${id}: ${e.path} cannot be read`); bad = true; }
    }
    if (map) {
      for (const [cid, c] of Object.entries(map.checks)) {
        if (c?.finding !== id) continue;
        const e = manifest.checks?.[cid];
        if (!e?.parts?.length) { problems.push(`${id}: map.json ties it to ${cid}, which has no sealed part`); bad = true; continue; }
        add(cid, null);
        for (const p of c.parts ?? []) {
          derived.get(cid).add(p.name);
          try { const lines = partLines(runDir, p.name); for (let n = p.startLine; Number.isInteger(n) && n <= p.endLine && n <= lines.length; n++) { const x = idOf(lines[n - 1]); if (x) cited.get(cid).add(x); } } catch { /* reported by the hash comparison below */ }
        }
      }
    }
    if (!derived.size) { if (!bad) problems.push(`${id}: Critical with no sealed check: its evidence derives an empty set of checks (no collected part is cited and map.json has no entry for it), so there is nothing a reverify could confirm`); continue; }
    criticals.push({ finding: id, checks: [...derived.keys()] });
    for (const [check, parts] of derived) {
      const entry = manifest.checks?.[check];
      const names = parts.size ? [...parts] : (entry?.parts ?? []).map((p) => p.name);
      const rf = join(runDir, "reverify", `${check}.json`);
      const need = `ask the user to run \`waf.mjs reverify --check ${check}\` in their terminal, or lower impact or likelihood with an honest rationale`;
      if (!existsSync(rf)) { problems.push(`${id}: ${check} has no reverify/${check}.json with state match: ${need}`); continue; }
      const rr = readJsonOr(rf);
      if (rr.error || typeof rr.value !== "object" || rr.value === null) { problems.push(`${id}: reverify/${check}.json cannot be read (${rr.error ?? "shape"}): ${need}`); continue; }
      const r = rr.value;
      const refuse = (why) => problems.push(`${id}: reverify/${check}.json ${why}: ${need}`);
      if (r.schema !== "waf-reverify/1") { refuse("has an unknown schema"); continue; }
      if (r.checkId !== check) { refuse(`is for check ${JSON.stringify(r.checkId)}`); continue; }
      if (runId !== null && r.runId !== runId) { refuse(`is for run ${JSON.stringify(r.runId)}, not ${JSON.stringify(runId)}`); continue; }
      if (r.catalogSha256 !== catalog.sha256 || r.catalogSha256 !== entry.catalogSha256) { refuse("was taken against another catalog version"); continue; }
      if (!sameJson(r.querySha256, entry.querySha256)) { refuse("was taken with another query than the sealed one"); continue; }
      if (typeof r.state !== "string" || !["match", "partial"].includes(r.state)) { refuse(`has state ${JSON.stringify(r.state)}, not match`); continue; }
      // the part hashes: the reverify must record the cited part with the hash the file and the manifest have
      let hashOk = true;
      for (const name of names) {
        const recorded = Array.isArray(r.parts) ? r.parts.find((p) => p?.name === name) : null;
        const sealed = entry.parts.find((p) => p.name === name);
        let actual = null;
        try { actual = sha256(readFileSync(join(runDir, "collected", name))); } catch { /* missing */ }
        if (!recorded || !sealed || recorded.sha256 !== actual || actual !== sealed.sha256) { refuse(`records a hash of ${name} that differs from the cited part or the manifest (a reverify of another version of the data does not release the finding)`); hashOk = false; break; }
      }
      if (!hashOk) continue;
      const ids = cited.get(check);
      if (r.scope === "check") {
        if (r.state !== "match") { refuse(`is ${r.state}, not match`); continue; }
        const all = new Set(entry.parts.map((p) => p.name));
        if (!Array.isArray(r.parts) || [...all].some((n) => !r.parts.some((p) => p?.name === n))) refuse("does not cover every part of the check");
      } else if (r.scope === "resource") {
        const res = Array.isArray(r.resources) ? r.resources : [];
        const covered = new Set(Array.isArray(r.covered) ? r.covered.map((x) => String(x).toLowerCase()) : []);
        if (res.some((x) => x?.state !== "match") || res.length !== covered.size || res.some((x) => !covered.has(String(x?.id).toLowerCase()))) { refuse("has a covered resource that did not match, or a covered list that differs from its resource results"); continue; }
        const missing = [...ids].filter((x) => !covered.has(x));
        if (!ids.size) refuse("cannot be compared: no ARM id was read from the cited lines");
        else if (missing.length) refuse(`is partial: it covers ${ids.size - missing.length} of the ${ids.size} ARM ids the finding cites (${r.state})`);
        else if (r.state !== "match" && r.state !== "partial") refuse(`is ${r.state}`);
      } else refuse(`has scope ${JSON.stringify(r.scope)}, not check or resource`);
    }
  }
  return out({ criticals, counts, assessmentSha256: sha256(buf), runId });
}

/** cap-check, then severity-summary.json only when it passes (a stale one is removed when it does not). */
export function capCheckAndWrite({ runDir, catalog, assessmentText, now = () => new Date().toISOString() }) {
  const r = capCheck({ runDir, catalog, assessmentText });
  const f = join(runDir, "severity-summary.json");
  rmSync(f, { force: true });
  if (r.ok) {
    const a = JSON.parse((assessmentText === undefined ? readFileSync(join(runDir, "assessment.json")) : Buffer.from(assessmentText)).toString("utf8"));
    writeJsonFile(f, { schema: "waf-severity-summary/1", runId: r.runId, assessmentSha256: r.assessmentSha256, generatedAt: now(), counts: r.counts, findings: (a.findings ?? []).map((x) => ({ id: x.id, severity: x.severity ?? "n/a" })) });
  }
  return r;
}
