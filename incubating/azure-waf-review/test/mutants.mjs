// Mutation check of the PR 1b controls (not a *.test.mjs file, so `npm test` does not run it): `node test/mutants.mjs [id ...]`.
// Each mutant turns ONE control off in the source, runs the test files that must notice, and restores the source. A mutant that
// SURVIVES is listed with the SECOND, independent rule that still stops the attack (defense in depth) or is a gap to fix.
// Slow on purpose (it runs the suites many times); it never runs in CI. The source is restored even when interrupted.
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ENGINE = join(dirname(fileURLToPath(import.meta.url)), "..");
const L = (f) => join("scripts", "lib", f);
/** [id, file, from, to, test files, second rule when it is expected to survive] */
export const MUTANTS = [
  ["C01 screen: no escaping of ESC and bidi", L("consent.mjs"), 'return t.replace(CTRL, (c) => `\\\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);', "return t;", ["consent.test.mjs"]],
  ["C02 typed count accepts spaces", L("consent.mjs"), "/^[1-9][0-9]{0,3}$/.test(s)", "/^\\s*[1-9][0-9]{0,3}\\s*$/.test(s)", ["consent.test.mjs"]],
  ["C03 profile not isolated is accepted", L("consent.mjs"), "if (profile) return refuse(", "if (false) return refuse(", ["consent.test.mjs"]],
  ["C04 Windows az inside WSL is accepted", L("consent.mjs"), "if (!az.ok || /\\.(exe|cmd|bat)$/i.test(String(azPath)))", "if (false)", ["consent.test.mjs"]],
  ["C05 write-capable role is accepted", L("consent.mjs"), "if (roles.write.length) return refuse(", "if (false) return refuse(", ["consent.test.mjs"], "consentProblems rejects a write role when the file is built (the run then throws)"],
  ["C06 typed and read counts may differ", L("consent.mjs"), "if (a.expected !== readable.length) {", "if (false) {", ["consent.test.mjs"], "consentProblems: the typed count must equal the count read"],
  ["C07 no confirmations for production stages", L("consent.mjs"), 'if (a.stage !== "nonprod") {\n    if (!(await typed(PHRASES.retention', 'if (false) {\n    if (!(await typed(PHRASES.retention', ["consent.test.mjs", "consent-forge.test.mjs"]],
  ["C08 the final yes is not required", L("consent.mjs"), '!== PHRASES.yes) return abort("consent")', '=== null) return abort("consent")', ["consent.test.mjs"]],
  ["C09 answers are trimmed", L("consent.mjs"), 'const lineOf = (s) => String(s).replace(/\\r$/, "");', 'const lineOf = (s) => String(s).trim();', ["consent.test.mjs"]],
  ["C10 the independent list is ignored for coverage", L("consent.mjs"), 'else if (!containers.has(id)) notCovered.push', 'else if (false) notCovered.push', ["consent.test.mjs"], "the typed count must still equal the readable count, and the difference is printed (onlyInAccountList)"],
  ["C11 piped answers are accepted", L("tty.mjs"), "Boolean(stdin.isTTY && stdout.isTTY)", "true", ["consent.test.mjs", "reverify.test.mjs"]],
  ["C12 consent text is not derived again", L("consent.mjs"), 'if (derived !== null && derived !== c.storedText)', 'if (false)', ["consent-forge.test.mjs"], "storedTextSha256 must equal the hash of storedText, and the fields are validated one by one"],
  ["C13 the stage rules of the file are not checked", L("consent.mjs"), 'else if (s.kind !== "subscriptions" || s.managementGroup !== null)', 'else if (false)', ["consent-forge.test.mjs"], "the text derived from the fields differs from the stored text"],
  ["C14 consent overwrites an existing file", L("consent.mjs"), 'if (existsSync(join(runDir, "consent.json")) || existsSync(join(runDir, "run.json"))) return refuse', 'if (false) return refuse', ["consent.test.mjs"]],
  ["C15 the tenant id is stored in full", L("consent.mjs"), "tenant: { last4: tenantId.slice(-4), sha256: sha256(tenantId) }", "tenant: { last4: tenantId.slice(-4), sha256: sha256(tenantId), id: tenantId }", ["consent.test.mjs"], "consentProblems refuses an unknown field of the tenant? (no): the test on the file text catches it"],
  ["S01 summary hash not compared", L("seal.mjs"), "if (sha256(buf) !== hash) {", "if (false) {", ["render.test.mjs"], "the summary must equal what collect writes from the sealed data (regeneration)"],
  ["S02 summary not regenerated", L("seal.mjs"), "if (want !== buf.toString(\"utf8\"))", "if (false)", ["render.test.mjs"], "the hash sealed in the manifest"],
  ["S03 unsealed summary accepted", L("seal.mjs"), "if (!(pillar in sums)) p.push(", "if (false) p.push(", ["render.test.mjs"]],
  ["S04 consent binding off", L("seal.mjs"), "if (run) problems.push(...consentBinding({ runDir, run, manifest }));", "", ["production.test.mjs"]],
  ["S05 manifest consent hash not compared", L("seal.mjs"), "if (manifest.consent?.sha256 !== rc.sha256) p.push(", "if (false) p.push(", ["production.test.mjs"]],
  ["S06 run.json consent hash not compared", L("seal.mjs"), "if (run.consent?.sha256 !== rc.sha256) p.push(", "if (false) p.push(", ["production.test.mjs"], "the manifest's consent hash (and runSha, which includes run.consent)"],
  ["S07 run.json scope not compared with the consent", L("seal.mjs"), "if (stableStringify(pick(run.scope)) !== stableStringify(pick(rc.consent.scope)))", "if (false)", ["production.test.mjs"], "runSha of run.json against the manifest"],
  ["S08 fixtures run may hold a consent", L("seal.mjs"), 'if (hasFile) p.push("this is a fixtures run', 'if (false) p.push("this is a fixtures run', ["production.test.mjs"]],
  ["S09 require-assessment ignored", L("seal.mjs"), "&& requireAssessment) problems.push(", "&& false) problems.push(", ["render.test.mjs"], "the render wrapper checks the file exists before and a read of a missing file fails closed"],
  ["G01 empty derived set accepted", L("capcheck.mjs"), "if (!derived.size) {", "if (false) {", ["capcheck.test.mjs"]],
  ["G02 Critical compared by exact string", L("capcheck.mjs"), 'export const looksCritical = (s) => /critical/i.test(', 'export const looksCritical = (s) => s === "Critical" || /xx^/i.test(', ["capcheck.test.mjs"]],
  ["G03 any reverify state accepted (the early check only)", L("capcheck.mjs"), '!["match", "partial"].includes(r.state)', "false", ["capcheck.test.mjs"], "EQUIVALENT ALONE: each scope branch judges the state again (check needs match, resource needs match or partial); the pair is killed together by G03c"],
  ["G03c both state rules off (a double mutant: G03 and G03b together)", L("capcheck.mjs"), [['!["match", "partial"].includes(r.state)', "false"], ['else if (r.state !== "match" && r.state !== "partial") refuse(`is ${r.state}`);', ""]], "", ["capcheck.test.mjs"]],
  ["G03b resource-scope state not judged in its branch", L("capcheck.mjs"), 'else if (r.state !== "match" && r.state !== "partial") refuse(`is ${r.state}`);', "", ["capcheck.test.mjs"], "EQUIVALENT ALONE: the early check on the state (G03); the pair is killed together by G03c"],
  ["G04 part hash of the reverify not compared", L("capcheck.mjs"), "if (!recorded || !sealed || recorded.sha256 !== actual || actual !== sealed.sha256) {", "if (false) {", ["capcheck.test.mjs"]],
  ["G05 resource coverage of the cited ARM ids not required", L("capcheck.mjs"), "else if (missing.length) refuse(", "else if (false) refuse(", ["capcheck.test.mjs"]],
  ["G06 stale severity-summary kept on failure", L("capcheck.mjs"), 'rmSync(f, { force: true });\n  if (r.ok) {', 'if (r.ok) {', ["capcheck.test.mjs"]],
  ["G07 map.json ignored in the derived set", L("capcheck.mjs"), "    if (map) {\n      for (const [cid, c] of Object.entries(map.checks)) {\n        if (c?.finding !== id) continue;", "    if (false) {\n      for (const [cid, c] of Object.entries(map.checks)) {\n        if (c?.finding !== id) continue;", ["capcheck.test.mjs"]],
  ["G08 query hash of the reverify not compared", L("capcheck.mjs"), "if (!sameJson(r.querySha256, entry.querySha256)) {", "if (false) {", ["capcheck.test.mjs"]],
  ["G09 catalog hash of the reverify: the second operand only", L("capcheck.mjs"), "r.catalogSha256 !== catalog.sha256 || r.catalogSha256 !== entry.catalogSha256", "r.catalogSha256 !== entry.catalogSha256", ["capcheck.test.mjs"], "the catalog hash the manifest entry carries is itself checked by seal-check against the shipped catalog"],
  ["G10 canonical part name not required", L("capcheck.mjs"), "typeof e.path !== \"string\" || !PART_FILE.test(e.path)", "typeof e.path !== \"string\"", ["capcheck.test.mjs"], "a path that is not a name in the manifest is not a sealed part"],
  ["G11 run id of the reverify not compared", L("capcheck.mjs"), "if (runId !== null && r.runId !== runId) {", "if (false) {", ["capcheck.test.mjs"]],
  ["G12 covered resources need not all match", L("capcheck.mjs"), "res.some((x) => x?.state !== \"match\") || ", "", ["capcheck.test.mjs"]],
  ["G13 unclassified finding accepted", L("capcheck.mjs"), "if (sev === undefined && f?.confidence !== \"unverified\") {", "if (false) {", ["capcheck.test.mjs"]],
  ["G14 reverify of every part not required for a check scope", L("capcheck.mjs"), "[...all].some((n) => !r.parts.some((p) => p?.name === n))", "false", ["capcheck.test.mjs"], "the cited part's hash must be recorded"],
  ["R01 cap-check skipped by the wrapper", L("renderwrap.mjs"), "const c = capCheckAndWrite({ runDir, catalog, assessmentText: snapshot, now });\n  if (!c.ok)", "const c = { ok: true };\n  if (!c.ok)", ["render.test.mjs"]],
  ["R02 second seal-check ignored", L("renderwrap.mjs"), "const problems = s2.ok ? [] :", "const problems = true ? [] :", ["render.test.mjs"]],
  ["R03 renderer reads the live assessment.json", L("renderwrap.mjs"), 'writeFileSync(join(staging, "assessment.json"), snapshot, { mode: 0o600 });', 'writeFileSync(join(staging, "assessment.json"), readFileSync(apath), { mode: 0o600 });', ["render.test.mjs"]],
  ["R04 assessment.json hash not compared after the render", L("renderwrap.mjs"), "if (fileSha(apath) !== h0)", "if (false)", ["render.test.mjs"]],
  ["R05 manifest hash not compared after the render", L("renderwrap.mjs"), "if (fileSha(manifestPath) !== m0)", "if (false)", ["render.test.mjs"], "the second seal-check recomputes every part hash against the manifest (a manifest edit that matters is a hash or count mismatch)"],
  ["R06 first seal-check skipped", L("renderwrap.mjs"), "if (!s1.ok) return fail(", "if (false) return fail(", ["render.test.mjs"], "the second seal-check (after) on the same files, and cap-check"],
  ["R07 renderer found from the working folder", L("renderwrap.mjs"), "export function locateAssess(from = dirname(fileURLToPath(import.meta.url))) {", "export function locateAssess(from = process.cwd()) {", ["render.test.mjs"]],
  ["R08 report installed even when a check failed", L("renderwrap.mjs"), "if (problems.length) return { ok: false, code: 1, problems, output, trace };", "", ["render.test.mjs"]],
  ["R09 assess render receives an extra argument", L("renderwrap.mjs"), 'const args = [assess, "render", "--unreviewed", "--out", staging];', 'const args = [assess, "render", "--unreviewed", "--out", staging, "--lang", "en"];', ["render.test.mjs"]],
  ["V01 a changed offender counts as match", L("reverify.mjs"), "return stableStringify(now1) === stableStringify(sealedById.get(id)) ? \"match\" : \"changed\";", "return \"match\";", ["reverify.test.mjs", "capcheck.test.mjs"]],
  ["V02 --resource may name any resource", L("reverify.mjs"), "if (!sealedById.has(raw.toLowerCase())) throw", "if (false) throw", ["reverify.test.mjs"]],
  ["V03 a partial run is match", L("reverify.mjs"), 'else if (scope === "resource" && universe.length < sealedById.size) state = "partial";', "", ["reverify.test.mjs", "capcheck.test.mjs"], "cap-check requires the cited ARM ids to be covered whatever the state says"],
  ["V04 a changed part on disk is compared anyway", L("reverify.mjs"), "if (sha256(buf) !== p.sha256) throw", "if (false) throw", ["reverify.test.mjs"]],
  ["V05 a check that did not fail is reverified", L("reverify.mjs"), 'if (!entry || entry.state !== "fail") throw', "if (!entry) throw", ["reverify.test.mjs"]],
  ["P01 plan accepts any az on PATH", "scripts/waf.mjs", "if (safeReal(found) !== safeReal(c.az.path)) throw", "if (false) throw", ["production.test.mjs"]],
  ["P02 plan ignores a changed tenant", "scripts/waf.mjs", "if (sha256(tenant) !== c.tenant.sha256) throw", "if (false) throw", ["production.test.mjs"]],
  ["P03 plan does not need the consent file", "scripts/waf.mjs", "if (!hasConsent) throw new Refusal(`plan refused", "if (false) throw new Refusal(`plan refused", ["production.test.mjs"], "productionContext reads and validates consent.json (a missing file is a problem)"],
  ["P04 fixtures and production mix on plan", "scripts/waf.mjs", "if (hasConsent) throw new Refusal(`${runDir} holds a consent.json, so it is a production run: --fixtures and production never mix`);\n    transport = fixtureTransport(args);\n  } else {\n    if (!hasConsent)", "if (false) throw new Refusal(``);\n    transport = fixtureTransport(args);\n  } else {\n    if (!hasConsent)", ["production.test.mjs"], "seal-check: a fixtures run holding a consent.json fails"],
  ["P05 collect ignores a consent that changed since plan", "scripts/waf.mjs", "if (ctx && run.consent?.sha256 !== ctx.consentSha) throw", "if (false) throw", ["production.test.mjs"]],
  ["P06 profile of the consent not compared", "scripts/waf.mjs", "if (resolvePath(process.env.AZURE_CONFIG_DIR) !== resolvePath(c.profile.dir)) throw", "if (false) throw", ["production.test.mjs"]],
  ["P07 --redact accepted without --fixtures", "scripts/waf.mjs", 'if (production && args.redact !== undefined) throw', 'if (false) throw', ["production.test.mjs"]],
  ["P08 production run collected with --fixtures", "scripts/waf.mjs", 'if (!ctx && run.fixtures !== true) throw', 'if (false) throw', ["production.test.mjs"]],
  ["U01 purge: run id not required exactly", L("purge.mjs"), "if (typed !== runId) return", "if (false) return", ["reverify.test.mjs"]],
  ["U02 purge follows a symbolic link run folder", L("purge.mjs"), "if (st.isSymbolicLink()) return", "if (false) return", ["reverify.test.mjs"], "the run folder must resolve inside waf-review/ and hold a run.json or consent.json (a link to an unrelated folder fails both)"],
  ["U03 purge deletes any folder", L("purge.mjs"), "if (!isRegular(join(runDir, \"run.json\")) && !isRegular(join(runDir, \"consent.json\"))) return", "if (false) return", ["reverify.test.mjs"]],
  ["U04 transcripts outside .claude/projects", L("purge.mjs"), "if (!okInside) return", "if (false) return", ["reverify.test.mjs"], "the user must type the folder name (U05); the test never types it right for a bad folder, because a surviving mutant would delete it"],
  ["U05 transcript folder name not typed", L("purge.mjs"), "if (lastLine(await io.ask(`Type the name of the transcript folder (${name}) to confirm: `)) !== name) return", "if (false) return", ["reverify.test.mjs"]],
  ["R10 symbolic links in the run folder are followed", L("renderwrap.mjs"), 'if (k === "link") return fail(', 'if (false) return fail(', ["render.test.mjs"]],
  ["U06 purge accepts the projects folder itself", L("purge.mjs"), "if (real(t) === real(projects)) return", "if (false) return", ["reverify.test.mjs"]],
  ["K01 isnull over a call accepted", L("kql.mjs"), "if (!/^[A-Za-z_]\\w*(?:\\.[A-Za-z_]\\w*)*$/.test(inner))", "if (false)", ["status-1b.test.mjs"]],
  ["J01 join risk not marked", L("collect.mjs"), "...(usesJoin(check) ? { joinRisk: true } : {}),", "", ["status-1b.test.mjs"]],
  ["T01 status gives severity from a stale summary", "scripts/waf.mjs", "if (sum.assessmentSha256 !== sha256(buf)) {", "if (false) {", ["status-1b.test.mjs"]],
  ["T02 status trusts the summary numbers", "scripts/waf.mjs", "if (SEV5.some((k) => sum.counts?.[k] !== recomputed[k])) {", "if (false) {", ["status-1b.test.mjs"]],
];

const filter = process.argv.slice(2);
const results = [];
const originals = new Map();
const restore = () => { for (const [f, t] of originals) writeFileSync(f, t); originals.clear(); };
process.on("SIGINT", () => { restore(); process.exit(130); });
process.on("exit", restore);
for (const [id, file, from, to, tests, second] of MUTANTS) {
  if (filter.length && !filter.some((x) => id.startsWith(x))) continue;
  const f = join(ENGINE, file);
  const src = readFileSync(f, "utf8");
  // a patch is [from, to]; a double mutant is a list of them, applied in order (each must match once)
  const patches = Array.isArray(from) ? from : [[from, to]];
  let text = src;
  let badN = 0;
  for (const [a, b] of patches) { const n = text.split(a).length - 1; if (n !== 1) badN = n || -1; text = text.replace(a, () => b); }
  if (badN) { results.push({ id, status: `BAD PATCH (${badN} matches)` }); continue; }
  originals.set(f, src);
  writeFileSync(f, text);
  const r = spawnSync(process.execPath, ["--test", ...tests.map((t) => join(ENGINE, "test", t))], { encoding: "utf8" });
  restore();
  results.push({ id, status: r.status === 0 ? "SURVIVED" : "killed", second });
  console.log(`${results.at(-1).status.padEnd(9)} ${id}${r.status === 0 && second ? `  (second rule: ${second})` : ""}`);
}
const bad = results.filter((r) => r.status.startsWith("BAD"));
for (const b of bad) console.log(`${b.status} ${b.id}`);
const surv = results.filter((r) => r.status === "SURVIVED");
console.log(`\n${results.length} mutants: ${results.filter((r) => r.status === "killed").length} killed, ${surv.length} survived, ${bad.length} bad patches`);
console.log(`survivors without a named second rule: ${surv.filter((r) => !r.second).map((r) => r.id).join(", ") || "none"}`);
process.exitCode = bad.length || surv.some((r) => !r.second) ? 1 : 0;
