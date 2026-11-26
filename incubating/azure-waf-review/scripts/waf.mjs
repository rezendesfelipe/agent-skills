#!/usr/bin/env node
// waf.mjs: the deterministic collector of the future azure-waf-review skill (OpenSpec change add-azure-waf-review-agent, PR 1a and 1b).
// Usage: node scripts/waf.mjs <command> [options]. Exit codes: 0 success, 1 a check or gate failed, 2 usage error or no login.
// Reads Azure only through a transport (the production transport starts `az` with constant arguments, and only with a valid consent.json
// that the USER produced with `consent`; --fixtures reads the synthetic tenant and is for tests and documentation). Writes only inside
// waf-review/<run-id>/ of the working directory, plus the alias file of --redact strict in the user's state directory.
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { PILLARS, loadCatalog } from "./lib/catalog.mjs";
import { capCheckAndWrite } from "./lib/capcheck.mjs";
import { ENGINE_VERSION, runCollect } from "./lib/collect.mjs";
import { readConsent, runConsent } from "./lib/consent.mjs";
import { isWsl, isolatedProfileProblem, resolveAz, classifyAzPath, runBaseProblem } from "./lib/platform.mjs";
import { purgeRun } from "./lib/purge.mjs";
import { runRender } from "./lib/renderwrap.mjs";
import { reverifyCheck } from "./lib/reverify.mjs";
import { hasTerminal, terminalIo } from "./lib/tty.mjs";
import { makeAliaser, sanitizeString } from "./lib/redact.mjs";
import { buildCoverage, buildMap, buildQuestionnaire, buildSummaries, coverageMarkdown, effectiveStates, readAnswers, readManifest } from "./lib/reports.mjs";
import { runConsentProblems, sealCheck } from "./lib/seal.mjs";
import { createAzTransport, createFixtureTransport } from "./lib/transport.mjs";
import { UsageError, assertNotLink, checkRunId, runSha, sha256, writeFileAtomic, writeJsonFile } from "./lib/util.mjs";

const HELP = `waf.mjs ${ENGINE_VERSION}: deterministic collector for the Azure Well-Architected review (read-only)

Run by the USER in the user's own terminal (a terminal is required; the agent never runs these, and the guard of PR 4 denies them):
  consent       --run-id <id> --stage nonprod|one-prod|root-mg --expected-subs <n> (--subscriptions <guid,...> | --management-group <id>)
                [--redact default|strict] [--query-budget <n>]
                reads the identity and the subscriptions, shows the screen, and writes waf-review/<id>/consent.json after your typed answers
  reverify      --run <id> --check <ID> [--resource <ARM id>]...   re-runs one check query with your login and writes reverify/<ID>.json
  purge         --run <id> [--transcripts <folder under ~/.claude/projects>]   deletes the run, its alias file and, if you name it, transcripts
Commands the agent may run:
  plan          --run-id <id> [--pillars security,reliability,...] [--json]
                needs the consent.json of that run id; scope, stage, redaction and budget come from it (no flag can set them)
  collect       --run <id> [--pillar <name>] [--check <ID>] [--resume]
                runs the catalog checks: paging to disk in parts of at most 1 MiB, one state per check, seals collected/manifest.json
  seal-check    --run <id> [--require-assessment]   the manifest, parts, summaries, consent, catalog hash and the real path of scope.root
  coverage      --run <id> [--json] per-pillar counts (writes coverage.json and coverage.md)
  questionnaire --run <id>          writes questionnaire.json for the checks nothing else can answer
  map           --run <id>          evidence entries and finding stubs for assessment-report (writes map.json)
  cap-check     --run <id>          after assess.mjs classify: refuses a Critical finding without a matching reverify (writes severity-summary.json only if it passes)
  render        --run <id>          seal-check, cap-check, assess.mjs render --unreviewed with constant arguments, seal-check again
  status        --run <id> [--json] the state of every check; with --json the counts the final message copies
For tests and documentation only: plan --fixtures <dir> and collect --fixtures <dir> read the synthetic tenant (and accept --redact on plan).
Later (PR 2): topology.
Options: --help, --version
Exit codes: 0 success, 1 a check or gate failed, 2 usage error or no login.
Without --fixtures, plan and collect need a valid consent.json produced by the user with consent.`;

const FLAGS = {
  consent: { value: ["run-id", "stage", "expected-subs", "subscriptions", "management-group", "redact", "query-budget"], bool: [] },
  plan: { value: ["run-id", "run", "fixtures", "pillars", "redact"], bool: ["json"] },
  collect: { value: ["run", "fixtures", "pillar", "check"], bool: ["resume", "json"] },
  "seal-check": { value: ["run"], bool: ["json", "require-assessment"] },
  coverage: { value: ["run"], bool: ["json"] },
  questionnaire: { value: ["run"], bool: ["json"] },
  map: { value: ["run"], bool: ["json"] },
  status: { value: ["run"], bool: ["json"] },
  "cap-check": { value: ["run"], bool: ["json"] },
  render: { value: ["run"], bool: [] },
  reverify: { value: ["run", "check", "resource", "fixtures"], bool: [], list: ["resource"] },
  purge: { value: ["run", "transcripts"], bool: [] },
};
const LATER = new Set(["topology"]);
/** A refusal that is not a usage error: the message goes to stderr and the exit code is as given. */
class Refusal extends Error {
  constructor(message, code = 1) { super(message); this.code = code; }
}
function parse(argv) {
  const cmd = argv[0];
  const spec = FLAGS[cmd];
  const args = {};
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) throw new UsageError(`unexpected argument "${a}"`);
    const k = a.slice(2);
    if (spec.bool.includes(k)) args[k] = true;
    else if (spec.value.includes(k)) {
      const v = argv[++i];
      if (v === undefined || v.startsWith("--")) throw new UsageError(`--${k} needs a value`);
      if (spec.list?.includes(k)) (args[k] ??= []).push(v);
      else args[k] = v;
    } else throw new UsageError(`unknown option --${k} for ${cmd}`);
  }
  return args;
}

const out = (s = "") => console.log(s);
const stateBase = () => (process.platform === "win32" ? join(process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"), "waf-review") : join(process.env.XDG_STATE_HOME || join(homedir(), ".local", "state"), "waf-review"));
const aliasFile = (runId) => join(stateBase(), runId, "aliases.json");

function runPaths(args, { create = false } = {}) {
  const id = create ? args["run-id"] ?? `run-${new Date().toISOString().replace(/[-:]/g, "").replace(/\..*/, "Z").replace("T", "-")}` : args.run;
  checkRunId(id, create ? "--run-id" : "--run");
  const base = join(process.cwd(), "waf-review");
  if (create && existsSync(base) && readdirSync(base).some((e) => e.toLowerCase() === id.toLowerCase() && e !== id))
    throw new UsageError(`a run folder that differs from ${JSON.stringify(id)} only in letter case already exists; a case-insensitive disk would treat them as one`);
  return { id, base, runDir: join(base, id) };
}

function fixtureTransport(args) {
  if (!existsSync(resolve(args.fixtures))) throw new UsageError(`--fixtures ${args.fixtures} does not exist`);
  return createFixtureTransport(resolve(args.fixtures));
}
const safeReal = (p) => { try { return realpathSync(p); } catch { return resolvePath(p); } };

/**
 * Everything a production command (plan, collect, reverify) checks before it asks Azure for anything, against what the USER consented to:
 * the consent file is valid, the `az` on PATH is the consented one (a PATH an agent changed cannot swap it), the profile is the consented,
 * isolated one, the folder is acceptable, and the login is still the consented tenant and identity type. Not verified: native Windows.
 */
async function productionContext(runDir, runId) {
  const rc = readConsent(runDir, runId);
  if (rc.problems.length) throw new Refusal(`no valid consent for run ${runId}:\n${rc.problems.map((m) => `  - ${m}`).join("\n")}\nA real tenant needs a consent.json that the USER produced: ask them to run, in their own terminal, \`node scripts/waf.mjs consent --run-id ${runId} --stage <nonprod|one-prod|root-mg> --expected-subs <n> ...\`. The agent cannot answer for them.`);
  const c = rc.consent;
  if (process.platform === "win32") throw new Refusal("native Windows is not supported by the production transport in this build (it fails closed; manual test M-10). Use WSL Ubuntu.");
  const found = resolveAz({ pathEnv: process.env.PATH });
  if (!found) throw new Refusal("az was not found on PATH (an absolute PATH entry is needed); install the Azure CLI inside this Linux distro", 2);
  if (safeReal(found) !== safeReal(c.az.path)) throw new Refusal(`the az on PATH (${found}) is not the one the consent recorded (${c.az.path}); ask the user to run consent again if the az changed`);
  const wsl = isWsl();
  const cl = classifyAzPath(found, { wsl, platform: process.platform });
  if (!cl.ok) throw new Refusal(`az launcher refused: ${cl.reason}`);
  const prof = isolatedProfileProblem({ env: process.env, home: process.env.HOME || homedir(), platform: process.platform });
  if (prof) throw new Refusal(`the Azure CLI profile is not isolated: ${prof}`);
  if (resolvePath(process.env.AZURE_CONFIG_DIR) !== resolvePath(c.profile.dir)) throw new Refusal("AZURE_CONFIG_DIR is not the profile the user consented to");
  const folder = runBaseProblem(safeReal(process.cwd()), { platform: process.platform });
  if (folder && c.acks.outputFolder !== true) throw new Refusal(`${folder}; the consent has no typed acknowledgment for it`);
  const transport = createAzTransport({ azPath: found, platform: process.platform, wsl });
  const ver = await transport.azRead(["az", "--version"]);
  const show = await transport.azRead(["az", "account", "show"]);
  if (show.status !== 200 || !show.body) throw new Refusal("no valid Azure login in the profile: the user signs in with `az login` in their own terminal; this engine never logs in", 2);
  const tenant = String(show.body.tenantId ?? "").toLowerCase();
  if (sha256(tenant) !== c.tenant.sha256) throw new Refusal("the Azure login is now another tenant than the one the user consented to; ask them to run consent again");
  const ut = show.body.user?.type === "user" ? "user" : show.body.user?.type === "servicePrincipal" ? "servicePrincipal" : "other";
  if (ut !== c.identity.type) throw new Refusal("the signed-in identity type changed since consent; ask the user to run consent again");
  const azVersion = sanitizeString(String(ver.text ?? "").trim().split("\n")[0] ?? "", { cap: true }).slice(0, 80) || "azure-cli (version not read)";
  return { consent: c, consentSha: rc.sha256, transport, azVersion };
}

const loadRun = (runDir) => {
  const f = join(runDir, "run.json");
  if (!existsSync(f)) throw new UsageError(`no run.json in ${runDir}; run plan first`);
  const run = JSON.parse(readFileSync(f, "utf8"));
  // run.json is not trusted blindly: its run id forms a path (the alias file) and must be the folder's own name
  checkRunId(run.runId, "run.json: runId");
  if (run.runId !== runDir.split(/[\\/]/).pop()) throw new UsageError(`run.json: runId ${JSON.stringify(run.runId)} does not match the run folder`);
  return run;
};

/** The subscriptions to query, and why the scope is or is not complete. The typed count is not the only protection. */
export function resolveScope({ accounts, containers, expected }) {
  const enabled = accounts.filter((a) => a.state === "Enabled");
  const notCovered = [];
  for (const a of accounts) if (a.state !== "Enabled") notCovered.push({ id: a.id, state: a.state, reason: "subscription state" });
  const readable = new Set(enabled.map((a) => a.id));
  for (const id of containers ?? []) if (!readable.has(id) && !notCovered.some((n) => n.id === id)) notCovered.push({ id, state: "not-readable", reason: "under the management group, not readable by the identity" });
  const query = containers?.length ? enabled.filter((a) => containers.includes(a.id)) : enabled;
  const complete = notCovered.length === 0 && query.length === expected;
  return { subscriptions: query.map((a) => a.id), visible: query.length, expected, containers: containers ?? [], notCovered, complete };
}

async function cmdPlan(args) {
  const production = !args.fixtures;
  if (production && args.redact !== undefined) throw new UsageError("--redact comes from consent.json: the agent cannot set it (it is accepted only with --fixtures, for tests)");
  if (production && !(args["run-id"] ?? args.run)) throw new UsageError("--run-id <id> is required: the id the user used for consent");
  if (args["run-id"] && args.run && args["run-id"] !== args.run) throw new UsageError("--run-id and --run name different runs");
  const ids = { ...args, "run-id": args["run-id"] ?? args.run };
  const { id, base, runDir } = runPaths(ids, { create: true });
  const hasConsent = existsSync(join(runDir, "consent.json"));
  let transport;
  let ctx = null;
  if (!production) {
    if (hasConsent) throw new Refusal(`${runDir} holds a consent.json, so it is a production run: --fixtures and production never mix`);
    transport = fixtureTransport(args);
  } else {
    if (!hasConsent) throw new Refusal(`plan refused: ${runDir} has no consent.json. A real tenant needs one produced by the USER: ask them to run \`node scripts/waf.mjs consent --run-id ${id} ...\` in their own terminal. The agent cannot answer for them.`);
    ctx = await productionContext(runDir, id);
    transport = ctx.transport;
  }
  assertNotLink(base);
  const problem = runBaseProblem(realpathSync(process.cwd()), { platform: process.platform });
  if (problem && !(ctx && ctx.consent.acks.outputFolder === true)) throw new Refusal(`Refused: ${problem}. The user gives a typed acknowledgment for it at consent; there is no other way.`);
  let pillars = PILLARS;
  if (args.pillars !== undefined) {
    pillars = args.pillars.split(",").map((s) => s.trim());
    const bad = pillars.filter((p) => !PILLARS.includes(p));
    if (bad.length || !pillars.length) throw new UsageError(`unknown pillar(s): ${bad.join(", ") || "(empty)"}. Valid names: ${PILLARS.join(", ")}`);
    pillars = PILLARS.filter((p) => pillars.includes(p));
  }
  const redact = ctx ? ctx.consent.redact : args.redact ?? "default";
  if (!["default", "strict"].includes(redact)) throw new UsageError("--redact is default or strict (there is no way to turn redaction off)");
  if (existsSync(join(runDir, "run.json"))) throw new Refusal(`Refused: ${runDir} already has a run.json; choose another --run-id.`);
  const catalog = loadCatalog();
  let accounts;
  let scope;
  let managementGroup;
  if (ctx) {
    const c = ctx.consent;
    accounts = c.accounts.map((a) => ({ id: a.id, name: a.name ?? null, state: a.state }));
    scope = { subscriptions: c.scope.subscriptions, visible: c.scope.visible, expected: c.scope.expected, containers: c.scope.containers, notCovered: c.scope.notCovered, complete: c.scope.complete };
    managementGroup = c.scope.managementGroup;
  } else {
    const list = await transport.azRead(["az", "account", "list", "--all"]);
    accounts = (list.body ?? []).map((a) => ({ id: a.id, name: sanitizeString(a.name ?? ""), state: a.state }));
    const fx = transport.fixtureScope?.() ?? {};
    scope = resolveScope({ accounts, containers: fx.containers, expected: fx.expected ?? accounts.length });
    managementGroup = fx.managementGroup ?? null;
  }
  if (!existsSync(base)) { mkdirSync(base, { recursive: true, mode: 0o700 }); try { chmodSync(base, 0o700); } catch { /* not supported on this platform */ } }
  if (!existsSync(join(base, ".gitignore"))) writeFileSync(join(base, ".gitignore"), "*\n", { mode: 0o600 });
  const run = {
    schema: "waf-run/1", runId: id, createdAt: new Date().toISOString(), engineVersion: ENGINE_VERSION, fixtures: !ctx,
    ...(ctx ? { stage: ctx.consent.stage, stagesSkipped: ctx.consent.acks.previousStage?.stagesSkipped ?? [], consent: { sha256: ctx.consentSha, textSha256: ctx.consent.textSha256, stage: ctx.consent.stage } } : {}),
    catalog: { version: catalog.version, sha256: catalog.sha256 }, pillars, redact, queryBudget: ctx ? ctx.consent.queryBudget : 6000,
    scope: { kind: ctx ? ctx.consent.scope.kind : "subscriptions", managementGroup, ...scope },
  };
  writeJsonFile(join(runDir, "run.json"), run);
  // In strict mode this stdout reaches the model: only aliases and counts, never a real name or subscription id.
  const strict = redact === "strict";
  const al = strict ? makeAliaser() : null;
  const show = (x) => (strict ? al.value("subscription", x) : x);
  const shownAccounts = accounts.map((a) => ({ id: show(a.id), name: strict ? null : a.name, state: a.state }));
  const shownNot = scope.notCovered.map((n) => ({ id: show(n.id), state: n.state, reason: n.reason }));
  if (strict) saveAliases(run, al);
  if (args.json) { out(JSON.stringify({ runId: id, stage: run.stage ?? null, fixtures: run.fixtures, pillars, redact, scope: { visible: scope.visible, expected: scope.expected, complete: scope.complete, notCovered: shownNot } }, null, 2)); return; }
  out(`Run ${id} planned in ${runDir} (${ctx ? `stage ${ctx.consent.stage}, from the user's consent` : "fixtures"}, redaction ${redact}).`);
  out(`Pillars: ${pillars.join(", ")}. Catalog ${catalog.version} (${catalog.checks.length} checks, sha256 ${catalog.sha256.slice(0, 12)}).`);
  out(`Subscriptions readable: ${scope.visible}, expected: ${scope.expected}.`);
  for (const a of shownAccounts) out(strict ? `  - ${a.id} state ${a.state}` : `  - ${JSON.stringify(a.name ?? "")} state ${a.state}`);
  if (scope.notCovered.length) { out("Not covered (checks that find nothing will be reported as scope-incomplete, never as pass):"); for (const n of shownNot) out(`  - ${n.id}: ${n.state} (${n.reason})`); }
  else out("Scope: complete.");
}

function aliaserFor(run) {
  if (run.redact !== "strict") return null;
  const f = aliasFile(run.runId);
  return makeAliaser(existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : {});
}
function saveAliases(run, aliaser) {
  if (!aliaser) return;
  const f = aliasFile(run.runId);
  mkdirSync(join(f, ".."), { recursive: true, mode: 0o700 });
  try { chmodSync(join(f, ".."), 0o700); } catch { /* not supported on this platform */ }
  writeFileAtomic(f, `${JSON.stringify(aliaser.map(), null, 2)}\n`, 0o600);
  try { chmodSync(f, 0o600); } catch { /* not supported on this platform */ }
}

async function cmdCollect(args) {
  const { id: runId, runDir } = runPaths(args);
  let transport;
  let ctx = null;
  if (args.fixtures) {
    if (existsSync(join(runDir, "consent.json"))) throw new Refusal(`${runDir} holds a consent.json, so it is a production run: --fixtures and production never mix`);
    transport = fixtureTransport(args);
  } else {
    if (!existsSync(join(runDir, "consent.json"))) throw new Refusal(`collect refused: ${runDir} has no consent.json. A real tenant needs one produced by the USER (\`waf.mjs consent\`, in their own terminal); without --fixtures nothing runs.`);
    // run.json against the consent BEFORE anything is asked of Azure (productionContext starts az)
    const early = runConsentProblems({ run: loadRun(runDir), rc: readConsent(runDir, runId) });
    if (early.length) throw new Refusal(`run.json no longer matches the consent; nothing was asked of Azure:\n${early.map((m) => `  - ${m}`).join("\n")}\nAsk the user to run consent again and plan a new run.`);
    ctx = await productionContext(runDir, runId);
    transport = ctx.transport;
  }
  const run = loadRun(runDir);
  if (ctx && run.fixtures !== false) throw new Refusal("this run was planned with --fixtures (synthetic data); it cannot be collected from a tenant");
  if (!ctx && run.fixtures !== true) throw new Refusal("this is a production run (planned from a consent.json): collect it without --fixtures");
  if (ctx && run.consent?.sha256 !== ctx.consentSha) throw new Refusal("consent.json changed since plan (its hash is not the one sealed in run.json); ask the user to run consent again and plan a new run");
  const catalog = loadCatalog();
  if (catalog.sha256 !== run.catalog.sha256) throw new UsageError("the catalog changed since plan; plan a new run");
  let pillars = run.pillars;
  if (args.pillar) {
    if (!PILLARS.includes(args.pillar)) throw new UsageError(`unknown pillar ${args.pillar}. Valid names: ${PILLARS.join(", ")}`);
    pillars = [args.pillar];
  }
  const aliaser = aliaserFor(run);
  const lock = join(runDir, ".lock");
  try { writeFileSync(lock, `${process.pid}\n`, { flag: "wx", mode: 0o600 }); } catch { console.error(`Refused: ${lock} exists, so another collect holds this run. Delete the file only if no collect is running.`); process.exitCode = 1; return; }
  let r;
  try {
  r = await runCollect({
    runDir, catalog, transport, scope: { kind: "subscriptions", subscriptions: run.scope.subscriptions, visible: run.scope.visible, expected: run.scope.expected, complete: run.scope.complete },
    pillars, only: args.check ? [args.check] : null, resume: Boolean(args.resume), redact: { mode: run.redact, runId: run.runId }, runSha256: runSha(run), consentSha256: ctx?.consentSha ?? null, stagesSkipped: run.stagesSkipped ?? [], queryBudget: run.queryBudget,
    sleep: (ms) => new Promise((res) => setTimeout(res, ms)), aliaser, azVersion: ctx ? ctx.azVersion : "fixture", fixtures: !ctx,
  });
  } finally { rmSync(lock, { force: true }); }
  saveAliases(run, aliaser);
  const summarized = [...new Set(catalog.checks.filter((c) => pillars.includes(c.pillar)).map((c) => c.pillar))];
  const hashes = buildSummaries({ runDir, catalog, manifest: r.manifest, pillars: summarized });
  r.manifest.summaries = { ...(r.manifest.summaries ?? {}), ...hashes };
  writeJsonFile(join(runDir, "collected", "manifest.json"), r.manifest);
  const counts = {};
  for (const e of Object.values(r.manifest.checks)) { const k = e.state === "not-verified" ? `not-verified:${e.reason}` : e.state; counts[k] = (counts[k] ?? 0) + 1; }
  out(`Collected ${Object.keys(r.manifest.checks).length} check(s) in ${runDir}${path_sep()}collected; queries used: ${r.queries}.`);
  for (const [k, n] of Object.entries(counts).sort()) out(`  ${k}: ${n}`);
  if (r.budgetReached) { out(`Query budget reached. Not done: ${r.notDone.join(", ")}`); process.exitCode = 1; }
}
const path_sep = () => (process.platform === "win32" ? "\\" : "/");

function cmdSealCheck(args) {
  const { runDir } = runPaths(args);
  loadRun(runDir);
  const r = sealCheck({ runDir, catalog: loadCatalog(), requireAssessment: Boolean(args["require-assessment"]) });
  for (const n of r.notes) out(`note: ${n}`);
  if (r.ok) { out("seal-check passed: every file in collected/ is sealed, every part matches the manifest, the catalog hash and run.json match, and nothing contradicts the sealed counts."); return; }
  out(`seal-check FAILED (${r.problems.length}):`);
  for (const p of r.problems) out(`  - ${p}`);
  process.exitCode = 1;
}

function statusOf(args) {
  const { runDir } = runPaths(args);
  const run = loadRun(runDir);
  const catalog = loadCatalog();
  const manifest = existsSync(join(runDir, "collected", "manifest.json")) ? readManifest(runDir) : { checks: {} };
  const a = readAnswers(runDir, catalog);
  if (a.error) { console.error(a.error); process.exitCode = 1; return null; }
  return { runDir, run, catalog, manifest, answers: a.answers, states: effectiveStates({ catalog, manifest, answers: a.answers, pillars: run.pillars }) };
}

const SEV5 = ["Critical", "High", "Medium", "Low", "Info"];
/** The numbers the final message of the agent copies. Everything is derived by code from files; no string of the tenant is in the output. */
function statusJson(s) {
  const checks = Object.fromEntries([...s.states].map(([id, v]) => [id, v.label]));
  const notVerified = {};
  for (const v of s.states.values()) if (v.state === "not-verified") notVerified[v.reason] = (notVerified[v.reason] ?? 0) + 1;
  const o = { runId: s.run.runId, pillars: s.run.pillars, stage: s.run.stage ?? null, stagesSkipped: s.run.stagesSkipped ?? [], fixtures: s.run.fixtures !== false, engineVersion: ENGINE_VERSION, catalogVersion: s.catalog.version, mcpUsed: false, humanReviewed: false, checks, notVerified, findings: null, confidence: null, severity: null, severityNote: "assessment.json does not exist yet", reportRendered: existsSync(join(s.runDir, "report", "report.md")) };
  const apath = join(s.runDir, "assessment.json");
  if (!existsSync(apath)) return o;
  let buf;
  let a;
  try { buf = readFileSync(apath); a = JSON.parse(buf.toString("utf8")); } catch { o.severityNote = "assessment.json cannot be read"; return o; }
  const fs = Array.isArray(a.findings) ? a.findings : [];
  o.findings = fs.length;
  o.confidence = { verified: 0, corroborated: 0, reported: 0, unverified: 0 };
  for (const f of fs) if (f?.confidence in o.confidence) o.confidence[f.confidence]++;
  const recomputed = Object.fromEntries(SEV5.map((k) => [k, fs.filter((f) => f?.severity === k).length]));
  const sf = join(s.runDir, "severity-summary.json");
  if (!existsSync(sf)) { o.severityNote = "cap-check has not passed for this assessment.json: no severity count is given"; return o; }
  let sum;
  try { sum = JSON.parse(readFileSync(sf, "utf8")); } catch { o.severityNote = "severity-summary.json cannot be read"; return o; }
  if (sum.assessmentSha256 !== sha256(buf)) { o.severityNote = "severity-summary.json is stale: assessment.json changed after cap-check passed; run cap-check again"; return o; }
  if (SEV5.some((k) => sum.counts?.[k] !== recomputed[k])) { o.severityNote = "severity-summary.json disagrees with the findings of assessment.json: no severity count is given"; return o; }
  o.severity = recomputed;
  o.severityNote = null;
  return o;
}

function cmdStatus(args) {
  const s = statusOf(args);
  if (!s) return;
  if (args.json) { out(JSON.stringify(statusJson(s), null, 2)); return; }
  for (const [id, v] of s.states) out(`${id}  ${v.label}`);
}

function cmdCoverage(args) {
  const s = statusOf(args);
  if (!s) return;
  const { cov } = buildCoverage({ catalog: s.catalog, manifest: s.manifest, answers: s.answers, pillars: s.run.pillars, runId: s.run.runId });
  writeJsonFile(join(s.runDir, "coverage.json"), cov);
  const md = coverageMarkdown(cov);
  writeFileAtomic(join(s.runDir, "coverage.md"), md);
  out(args.json ? JSON.stringify(cov, null, 2) : md);
}

function cmdQuestionnaire(args) {
  const s = statusOf(args);
  if (!s) return;
  const qn = buildQuestionnaire({ catalog: s.catalog, manifest: s.manifest, pillars: s.run.pillars });
  writeJsonFile(join(s.runDir, "questionnaire.json"), qn);
  out(`questionnaire.json: ${qn.items.length} item(s). Answers go in questionnaire.answers.json as {"answers":[{"id":"Q-...","answer":"yes|partial|no|unknown|not-applicable","note":""}]}. The model must not infer an answer.`);
}

function cmdMap(args) {
  const { runDir } = runPaths(args);
  const run = loadRun(runDir);
  if (!existsSync(join(runDir, "collected", "manifest.json"))) throw new UsageError("no collected/manifest.json; run collect first");
  const m = buildMap({ runDir, catalog: loadCatalog(), manifest: readManifest(runDir), runId: run.runId });
  writeJsonFile(join(runDir, "map.json"), m);
  out(`map.json: ${m.findings.length} finding stub(s), ${m.evidence.length} evidence entr${m.evidence.length === 1 ? "y" : "ies"}. Merge them into assessment.json, then run assess.mjs verify.`);
}

function needTerminal(cmd) {
  if (!hasTerminal()) throw new UsageError(`${cmd} runs only in a terminal that you are typing in (stdin and stdout must be a TTY). Piped answers are refused: the confirmations are yours, and nobody can type them for you. Run it yourself, in your own terminal.`);
}

async function cmdConsent(args) {
  needTerminal("consent");
  const argsIn = { runId: args["run-id"], stage: args.stage, expectedSubs: args["expected-subs"], subscriptions: args.subscriptions, managementGroup: args["management-group"], redact: args.redact, queryBudget: args["query-budget"] };
  const found = resolveAz({ pathEnv: process.env.PATH });
  const wsl = isWsl();
  let transport = null;
  if (found) { try { transport = createAzTransport({ azPath: found, platform: process.platform, wsl }); } catch { transport = null; } }
  const io = terminalIo();
  try {
    const r = await runConsent({ args: argsIn, transport, io, cwd: process.cwd(), cwdReal: safeReal(process.cwd()), env: process.env, platform: process.platform, wsl, azPath: found ?? "" });
    if (!r.ok) { console.error(`Consent not written: ${r.message}`); process.exitCode = r.code; }
  } finally { io.close(); }
}

function cmdCapCheck(args) {
  const { runDir } = runPaths(args);
  loadRun(runDir);
  const r = capCheckAndWrite({ runDir, catalog: loadCatalog() });
  if (r.ok) { out(`cap-check passed: ${r.criticals.length} Critical finding(s), each with a matching reverify. severity-summary.json written.`); return; }
  out(`cap-check FAILED (${r.problems.length}); severity-summary.json was not written:`);
  for (const p of r.problems) out(`  - ${p}`);
  process.exitCode = 1;
}

async function cmdRender(args) {
  const { runDir } = runPaths(args);
  const run = loadRun(runDir);
  const r = await runRender({ runDir, catalog: loadCatalog(), hooks: {} });
  if (run.fixtures !== false) out("FIXTURES RUN: the data is the synthetic tenant, not a real one.");
  if (r.ok) { out(`render passed: ${r.trace.join(" -> ")}.`); if (r.output) out(r.output); return; }
  out(`render REFUSED at ${r.trace.at(-1) ?? "start"}:`);
  for (const p of r.problems) out(p.startsWith("  ") ? p : `  ${p}`);
  process.exitCode = 1;
}

async function cmdReverify(args) {
  needTerminal("reverify");
  if (!args.check) throw new UsageError("reverify needs --check <ID>");
  const { id, runDir } = runPaths(args);
  const run = loadRun(runDir);
  const catalog = loadCatalog();
  let transport;
  if (run.fixtures !== false) { if (!args.fixtures) throw new UsageError("this is a fixtures run: pass --fixtures <dir>"); transport = fixtureTransport(args); }
  else {
    if (args.fixtures) throw new Refusal("a production run is never reverified from fixtures");
    const early = runConsentProblems({ run, rc: readConsent(runDir, id) });
    if (early.length) throw new Refusal(`run.json no longer matches the consent; nothing was asked of Azure:\n${early.map((m) => `  - ${m}`).join("\n")}`);
    transport = (await productionContext(runDir, id)).transport;
  }
  const rec = await reverifyCheck({ runDir, catalog, transport, checkId: args.check, resources: args.resource ?? [], sleep: (ms) => new Promise((res) => setTimeout(res, ms)), aliaser: aliaserFor(run) });
  out(`reverify ${args.check}: ${rec.state} (scope ${rec.scope}, ${rec.covered.length} ARM id(s) compared) written to reverify/${args.check}.json`);
  if (rec.state !== "match") process.exitCode = 1;
}

async function cmdPurge(args) {
  needTerminal("purge");
  const io = terminalIo();
  try {
    const r = await purgeRun({ cwd: process.cwd(), runId: checkRunId(args.run, "--run"), stateBase: stateBase(), io, transcripts: args.transcripts ?? null, home: process.env.HOME || homedir() });
    out(r.ok ? `purge: ${r.message}` : `purge refused: ${r.message}`);
    if (!r.ok) process.exitCode = 1;
  } finally { io.close(); }
}

async function main() {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  if (!cmd || cmd === "--help" || cmd === "-h" || cmd === "help") { out(HELP); return; }
  if (cmd === "--version") { out(ENGINE_VERSION); return; }
  if (LATER.has(cmd)) throw new UsageError(`${cmd} is not in this build (topology ships in PR 2)`);
  if (!FLAGS[cmd]) throw new UsageError(`unknown command "${cmd}". Run with --help.`);
  const args = parse(argv);
  if (cmd === "plan") return cmdPlan(args);
  if (cmd === "collect") return cmdCollect(args);
  if (cmd === "seal-check") return cmdSealCheck(args);
  if (cmd === "status") return cmdStatus(args);
  if (cmd === "coverage") return cmdCoverage(args);
  if (cmd === "questionnaire") return cmdQuestionnaire(args);
  if (cmd === "map") return cmdMap(args);
  if (cmd === "consent") return cmdConsent(args);
  if (cmd === "cap-check") return cmdCapCheck(args);
  if (cmd === "render") return cmdRender(args);
  if (cmd === "reverify") return cmdReverify(args);
  if (cmd === "purge") return cmdPurge(args);
}

main().catch((e) => {
  if (e instanceof UsageError) { console.error(`Usage error: ${e.message}`); process.exitCode = 2; }
  else if (e instanceof Refusal) { console.error(e.message); process.exitCode = e.code; }
  else { console.error(`Error: ${e.message}`); process.exitCode = 1; }
});
