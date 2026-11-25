// purge: the user deletes a run folder, its alias file and, if they point at it, local Claude Code transcripts (what the model saw).
// Everything is validated BEFORE the first prompt and the first deletion; the run id is typed exactly; a symbolic link is removed as a link
// and never followed; the transcript folder must be inside <home>/.claude/projects. The retention of transcripts by the provider is not
// verified and is outside what this deletes.
import { existsSync, lstatSync, readdirSync, realpathSync, rmSync } from "node:fs";
import { basename, join, resolve, sep } from "node:path";
import { UsageError, checkRunId } from "./util.mjs";

const lastLine = (s) => String(s).replace(/\r$/, "");
const isRegular = (f) => { try { const st = lstatSync(f); return st.isFile() && !st.isSymbolicLink(); } catch { return false; } };
const real = (p) => (realpathSync.native ?? realpathSync)(p);

function countFiles(dir) {
  let n = 0;
  const walk = (d) => { for (const e of readdirSync(d, { withFileTypes: true })) { if (e.isDirectory() && !e.isSymbolicLink()) walk(join(d, e.name)); else n++; } };
  try { walk(dir); } catch { /* counted as far as it could be read */ }
  return n;
}

/** @returns {Promise<{ok: boolean, message: string, removed?: object}>} */
export async function purgeRun({ cwd, runId, stateBase, io, transcripts = null, home = process.env.HOME ?? "" }) {
  checkRunId(runId, "--run");
  const base = join(cwd, "waf-review");
  const runDir = join(base, runId);
  let st;
  try { st = lstatSync(runDir); } catch { return { ok: false, message: `${runDir} does not exist` }; }
  if (st.isSymbolicLink()) return { ok: false, message: `${runDir} is a symbolic link; purge never follows one. Remove the link yourself.` };
  if (!st.isDirectory()) return { ok: false, message: `${runDir} is not a folder` };
  if (!isRegular(join(runDir, "run.json")) && !isRegular(join(runDir, "consent.json"))) return { ok: false, message: `${runDir} has no run.json or consent.json: it is not a run folder of this engine, so it is not deleted` };
  if (!real(runDir).startsWith(real(base) + sep)) return { ok: false, message: `${runDir} resolves outside ${base}` };

  let tdir = null;
  if (transcripts !== null) {
    const t = resolve(transcripts);
    let ts;
    try { ts = lstatSync(t); } catch { return { ok: false, message: `${t} does not exist` }; }
    if (ts.isSymbolicLink() || !ts.isDirectory()) return { ok: false, message: `${t} must be a real folder, not a symbolic link` };
    const projects = home ? join(home, ".claude", "projects") : "";
    let okInside = false;
    try { const rp = real(projects); const rt = real(t); okInside = rt === rp || rt.startsWith(rp + sep); } catch { okInside = false; }
    if (!okInside) return { ok: false, message: `${t} is not inside ${projects || "<home>/.claude/projects"}: purge deletes transcripts of Claude Code only there` };
    tdir = { path: t, real: real(t), isRoot: real(t) === real(projects) };
  }

  const typed = lastLine(await io.ask(`This deletes the run folder ${runDir} and its alias file${tdir ? ` and the transcripts in ${tdir.path}` : ""}. It cannot be undone.\nType the run id to confirm: `));
  if (typed !== runId) return { ok: false, message: "the typed run id was not exact; nothing was deleted" };
  if (tdir) {
    const name = basename(tdir.real);
    if (lastLine(await io.ask(`Type the name of the transcript folder (${name}) to confirm: `)) !== name) return { ok: false, message: "the typed folder name was not exact; nothing was deleted" };
  }
  const removed = { run: countFiles(runDir), aliases: 0, transcripts: 0 };
  rmSync(runDir, { recursive: true, force: true });
  if (stateBase) {
    const a = join(stateBase, runId);
    if (existsSync(a) && !lstatSync(a).isSymbolicLink()) { removed.aliases = countFiles(a); rmSync(a, { recursive: true, force: true }); }
  }
  if (tdir) {
    removed.transcripts = countFiles(tdir.real);
    if (tdir.isRoot) for (const e of readdirSync(tdir.real)) rmSync(join(tdir.real, e), { recursive: true, force: true });
    else rmSync(tdir.real, { recursive: true, force: true });
  }
  return { ok: true, message: `deleted ${removed.run} file(s) of the run, ${removed.aliases} alias file(s) and ${removed.transcripts} transcript file(s)`, removed };
}
void UsageError;
