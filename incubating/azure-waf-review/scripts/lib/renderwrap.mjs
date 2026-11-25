// The render wrapper, the only render the guard of PR 4 allows. It runs seal-check, then cap-check, then assess.mjs render --unreviewed
// with CONSTANT arguments from a trusted location, then seal-check again, and installs the report only if nothing changed meanwhile.
// TOCTOU: the gates and the renderer see the same bytes. assessment.json is read once into memory; both gates judge that snapshot; the
// renderer runs in a private staging folder (mode 0700, outside the run folder) on a copy of that snapshot, so a file replaced after
// the gates cannot change what is rendered. After the renderer, the run folder is checked again (seal-check, the hash of assessment.json
// and of the manifest equal to the snapshot's) and only then are the report and the new assess state moved into the run folder.
// A change in the window is refused and nothing is installed. A change that is undone before the second check cannot affect the report
// (it came from the snapshot) and is not detected; that is by design.
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { capCheckAndWrite } from "./capcheck.mjs";
import { sealCheck } from "./seal.mjs";
import { sha256 } from "./util.mjs";

/**
 * The renderer of assessment-report, found only by walking up from THIS file (never from the working folder, the run folder or an
 * environment variable, which an agent could point at a forged script). Both layouts are tried: the repository (plugins/assessment-report/
 * skills/assessment-report) and a sibling plugin folder of an installed marketplace. Not verified: the installed layout (PR 3 and 4).
 */
export function locateAssess(from = dirname(fileURLToPath(import.meta.url))) {
  let d = from;
  for (let i = 0; i < 10; i++) {
    for (const rel of [["plugins", "assessment-report", "skills", "assessment-report", "scripts", "assess.mjs"], ["assessment-report", "skills", "assessment-report", "scripts", "assess.mjs"]]) {
      const f = join(d, ...rel);
      if (existsSync(f)) return f;
    }
    const up = dirname(d);
    if (up === d) break;
    d = up;
  }
  return null;
}

const keep = (env, names) => Object.fromEntries(names.filter((n) => env[n] !== undefined).map((n) => [n, env[n]]));
const fileSha = (f) => { try { return sha256(readFileSync(f)); } catch { return null; } };

/** @returns {Promise<{ok: boolean, code: number, problems: string[], output: string, trace: string[]}>} */
export async function runRender({ runDir, catalog, hooks = {}, now = () => new Date().toISOString() }) {
  const trace = [];
  const mark = (s) => { trace.push(s); hooks.trace?.(s); };
  const fail = (...problems) => ({ ok: false, code: 1, problems, output: "", trace });
  const apath = join(runDir, "assessment.json");
  if (!existsSync(apath)) return fail("assessment.json is required: render needs the assessment the model wrote and the assess.mjs flow up to the summary. Nothing was rendered.");
  const assess = locateAssess();
  if (!assess) return fail("the renderer of assessment-report was not found next to this skill (plugins/assessment-report); install that plugin");
  const statePath = join(runDir, ".state", "run.json");
  if (!existsSync(statePath)) return fail("the assess.mjs flow has no state in this run folder (.state/run.json): run init, verify, classify, check and write the summary first");

  const snapshot = readFileSync(apath);
  const stateBytes = readFileSync(statePath);
  const invPath = join(runDir, "inventory.json");
  const invBytes = existsSync(invPath) ? readFileSync(invPath) : null;
  const h0 = sha256(snapshot);
  const manifestPath = join(runDir, "collected", "manifest.json");
  const m0 = fileSha(manifestPath);

  mark("seal-check");
  const s1 = sealCheck({ runDir, catalog, requireAssessment: true, assessmentText: snapshot });
  if (!s1.ok) return fail("seal-check failed (assess.mjs render was not called):", ...s1.problems.map((p) => `  - ${p}`));
  hooks.afterSeal?.();
  mark("cap-check");
  const c = capCheckAndWrite({ runDir, catalog, assessmentText: snapshot, now });
  if (!c.ok) return fail("cap-check failed (assess.mjs render was not called):", ...c.problems.map((p) => `  - ${p}`));
  hooks.afterCap?.();

  const staging = mkdtempSync(join(tmpdir(), "waf-render-"));
  try {
    try { chmodSync(staging, 0o700); } catch { /* not supported on this platform */ }
    writeFileSync(join(staging, "assessment.json"), snapshot, { mode: 0o600 });
    mkdirSync(join(staging, ".state"), { recursive: true, mode: 0o700 });
    writeFileSync(join(staging, ".state", "run.json"), stateBytes, { mode: 0o600 });
    if (invBytes) writeFileSync(join(staging, "inventory.json"), invBytes, { mode: 0o600 });
    const args = [assess, "render", "--unreviewed", "--out", staging];
    hooks.onSpawn?.(args);
    mark("assess-render");
    const r = spawnSync(process.execPath, args, { cwd: staging, encoding: "utf8", env: keep(process.env, ["PATH", "SystemRoot", "TEMP", "TMP", "TMPDIR", "LANG", "LC_ALL"]), shell: false, windowsHide: true });
    const output = `${r.stdout ?? ""}${r.stderr ?? ""}`.trim();
    if (r.status !== 0) return { ok: false, code: 1, problems: ["assess.mjs render refused:", ...output.split("\n").map((l) => `  ${l}`)], output, trace };
    hooks.afterAssess?.();

    mark("seal-check");
    const s2 = sealCheck({ runDir, catalog, requireAssessment: true });
    const problems = s2.ok ? [] : ["seal-check failed after the render:", ...s2.problems.map((p) => `  - ${p}`)];
    if (fileSha(apath) !== h0) problems.push("assessment.json changed while the gates and the renderer ran: it is not what was gated. Nothing was installed.");
    if (fileSha(manifestPath) !== m0) problems.push("collected/manifest.json changed while the render ran. Nothing was installed.");
    if (!existsSync(statePath) || sha256(readFileSync(statePath)) !== sha256(stateBytes)) problems.push(".state/run.json changed while the render ran. Nothing was installed.");
    if (!existsSync(join(staging, "report", "report.md"))) problems.push("assess.mjs render did not produce report/report.md");
    if (problems.length) return { ok: false, code: 1, problems, output, trace };

    rmSync(join(runDir, "report"), { recursive: true, force: true });
    cpSync(join(staging, "report"), join(runDir, "report"), { recursive: true });
    writeFileSync(statePath, readFileSync(join(staging, ".state", "run.json")), { mode: 0o600 });
    return { ok: true, code: 0, problems: [], output, trace };
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}
void sep;
