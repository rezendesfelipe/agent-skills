#!/usr/bin/env node
// waf.mjs: the deterministic collector of the future azure-waf-review skill (OpenSpec change add-azure-waf-review-agent, PR 1a).
// Usage: node scripts/waf.mjs <command> [options]. Exit codes: 0 success, 1 a check or gate failed, 2 usage error or no login.
// Reads Azure only through a transport (the production transport starts `az` with constant arguments; PR 1a runs only against
// fixtures, because the consent file that production needs ships in PR 1b). Writes only inside waf-review/<run-id>/ of the
// working directory, plus the alias file of --redact strict in the user's state directory.
import { chmodSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { PILLARS, loadCatalog } from "./lib/catalog.mjs";
import { ENGINE_VERSION, runCollect } from "./lib/collect.mjs";
import { runBaseProblem } from "./lib/platform.mjs";
import { makeAliaser, sanitizeString } from "./lib/redact.mjs";
import { buildCoverage, buildMap, buildQuestionnaire, buildSummaries, coverageMarkdown, effectiveStates, readAnswers, readManifest } from "./lib/reports.mjs";
import { sealCheck } from "./lib/seal.mjs";
import { createFixtureTransport } from "./lib/transport.mjs";
import { UsageError, writeFileAtomic, writeJsonFile } from "./lib/util.mjs";

const HELP = `waf.mjs ${ENGINE_VERSION}: deterministic collector for the Azure Well-Architected review (read-only)

Commands (PR 1a):
  plan          --run-id <id> --fixtures <dir> [--pillars security,reliability,...] [--redact default|strict] [--json]
                lists the subscriptions the identity can read, compares them with the management group and the typed count, writes run.json
  collect       --run <id> --fixtures <dir> [--pillar <name>] [--check <ID>] [--resume]
                runs the catalog checks: paging to disk in parts of at most 1 MiB, one state per check, seals collected/manifest.json
  seal-check    --run <id>          the manifest, the part hashes, the catalog hash and the real path of scope.root in assessment.json
  coverage      --run <id> [--json] per-pillar counts (writes coverage.json and coverage.md)
  questionnaire --run <id>          writes questionnaire.json for the checks nothing else can answer
  map           --run <id>          evidence entries and finding stubs for assessment-report (writes map.json)
  status        --run <id> [--json] the state of every check
Not in this build (PR 1b): consent, cap-check, render, reverify, purge. Later: topology.
Options: --help, --version
Exit codes: 0 success, 1 a check or gate failed, 2 usage error.
Without --fixtures, plan and collect refuse: a real tenant needs the user-run consent (PR 1b) and no run happens before it is merged.`;

const FLAGS = {
  plan: { value: ["run-id", "fixtures", "pillars", "redact"], bool: ["json"] },
  collect: { value: ["run", "fixtures", "pillar", "check"], bool: ["resume", "json"] },
  "seal-check": { value: ["run"], bool: ["json"] },
  coverage: { value: ["run"], bool: ["json"] },
  questionnaire: { value: ["run"], bool: ["json"] },
  map: { value: ["run"], bool: ["json"] },
  status: { value: ["run"], bool: ["json"] },
};
const LATER = new Set(["consent", "cap-check", "render", "reverify", "purge", "topology"]);
const RUN_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

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
      args[k] = v;
    } else throw new UsageError(`unknown option --${k} for ${cmd}`);
  }
  return args;
}

const out = (s = "") => console.log(s);
const stateBase = () => (process.platform === "win32" ? join(process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"), "waf-review") : join(process.env.XDG_STATE_HOME || join(homedir(), ".local", "state"), "waf-review"));
const aliasFile = (runId) => join(stateBase(), runId, "aliases.json");

function runPaths(args, { create = false } = {}) {
  const id = create ? args["run-id"] ?? `run-${new Date().toISOString().replace(/[-:]/g, "").replace(/\..*/, "Z").replace("T", "-")}` : args.run;
  if (!id || !RUN_ID.test(id)) throw new UsageError(`${create ? "--run-id" : "--run"} must be 1 to 64 characters of letters, digits, dot, dash or underscore, not starting with one of the last three`);
  const base = join(process.cwd(), "waf-review");
  return { id, base, runDir: join(base, id) };
}

function requireFixtures(args, what) {
  if (!args.fixtures) {
    console.error(`${what} refused: a real tenant needs a valid consent.json produced by the user (waf.mjs consent, shipped in PR 1b). Until then only --fixtures <dir> runs, with synthetic data.`);
    process.exitCode = 1;
    return null;
  }
  if (!existsSync(resolve(args.fixtures))) throw new UsageError(`--fixtures ${args.fixtures} does not exist`);
  return createFixtureTransport(resolve(args.fixtures));
}

const loadRun = (runDir) => {
  const f = join(runDir, "run.json");
  if (!existsSync(f)) throw new UsageError(`no run.json in ${runDir}; run plan first`);
  return JSON.parse(readFileSync(f, "utf8"));
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
  const transport = requireFixtures(args, "plan");
  if (!transport) return;
  const { id, base, runDir } = runPaths(args, { create: true });
  const problem = runBaseProblem(realpathSync(process.cwd()), { platform: process.platform });
  if (problem) { console.error(`Refused: ${problem}. A typed acknowledgment is needed to use it; not available in this build.`); process.exitCode = 1; return; }
  let pillars = PILLARS;
  if (args.pillars !== undefined) {
    pillars = args.pillars.split(",").map((s) => s.trim());
    const bad = pillars.filter((p) => !PILLARS.includes(p));
    if (bad.length || !pillars.length) throw new UsageError(`unknown pillar(s): ${bad.join(", ") || "(empty)"}. Valid names: ${PILLARS.join(", ")}`);
    pillars = PILLARS.filter((p) => pillars.includes(p));
  }
  const redact = args.redact ?? "default";
  if (!["default", "strict"].includes(redact)) throw new UsageError("--redact is default or strict (there is no way to turn redaction off)");
  if (existsSync(join(runDir, "run.json"))) { console.error(`Refused: ${runDir} already has a run.json; choose another --run-id.`); process.exitCode = 1; return; }
  const catalog = loadCatalog();
  const list = await transport.azRead(["az", "account", "list", "--all"]);
  const accounts = (list.body ?? []).map((a) => ({ id: a.id, name: sanitizeString(a.name ?? ""), state: a.state }));
  const fx = transport.fixtureScope?.() ?? {};
  const scope = resolveScope({ accounts, containers: fx.containers, expected: fx.expected ?? accounts.length });
  if (!existsSync(base)) { mkdirSync(base, { recursive: true }); }
  if (!existsSync(join(base, ".gitignore"))) writeFileSync(join(base, ".gitignore"), "*\n");
  const run = {
    schema: "waf-run/1", runId: id, createdAt: new Date().toISOString(), engineVersion: ENGINE_VERSION, fixtures: true,
    catalog: { version: catalog.version, sha256: catalog.sha256 }, pillars, redact, queryBudget: 6000,
    scope: { kind: "subscriptions", managementGroup: fx.managementGroup ?? null, ...scope },
  };
  writeJsonFile(join(runDir, "run.json"), run);
  if (args.json) { out(JSON.stringify({ runId: id, pillars, scope: { visible: scope.visible, expected: scope.expected, complete: scope.complete, notCovered: scope.notCovered } }, null, 2)); return; }
  out(`Run ${id} planned in ${runDir} (fixtures, redaction ${redact}).`);
  out(`Pillars: ${pillars.join(", ")}. Catalog ${catalog.version} (${catalog.checks.length} checks, sha256 ${catalog.sha256.slice(0, 12)}).`);
  out(`Subscriptions readable: ${scope.visible}, expected: ${scope.expected}.`);
  for (const a of accounts) out(`  - ${JSON.stringify(a.name)} state ${a.state}`);
  if (scope.notCovered.length) { out("Not covered (checks that find nothing will be reported as scope-incomplete, never as pass):"); for (const n of scope.notCovered) out(`  - ${n.id}: ${n.state} (${n.reason})`); }
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
  const transport = requireFixtures(args, "collect");
  if (!transport) return;
  const { runDir } = runPaths(args);
  const run = loadRun(runDir);
  const catalog = loadCatalog();
  if (catalog.sha256 !== run.catalog.sha256) throw new UsageError("the catalog changed since plan; plan a new run");
  let pillars = run.pillars;
  if (args.pillar) {
    if (!PILLARS.includes(args.pillar)) throw new UsageError(`unknown pillar ${args.pillar}. Valid names: ${PILLARS.join(", ")}`);
    pillars = [args.pillar];
  }
  const aliaser = aliaserFor(run);
  const r = await runCollect({
    runDir, catalog, transport, scope: { kind: "subscriptions", subscriptions: run.scope.subscriptions, visible: run.scope.visible, expected: run.scope.expected, complete: run.scope.complete },
    pillars, only: args.check ? [args.check] : null, resume: Boolean(args.resume), redact: { mode: run.redact, runId: run.runId }, queryBudget: run.queryBudget,
    sleep: (ms) => new Promise((res) => setTimeout(res, ms)), aliaser, azVersion: "fixture", fixtures: true,
  });
  saveAliases(run, aliaser);
  const summarized = [...new Set(catalog.checks.filter((c) => pillars.includes(c.pillar)).map((c) => c.pillar))];
  buildSummaries({ runDir, catalog, manifest: r.manifest, pillars: summarized });
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
  const r = sealCheck({ runDir, catalog: loadCatalog() });
  if (r.ok) { out("seal-check passed: every part matches the manifest, the catalog hash matches, and the assessed root is the sealed folder."); return; }
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

function cmdStatus(args) {
  const s = statusOf(args);
  if (!s) return;
  const checks = Object.fromEntries([...s.states].map(([id, v]) => [id, v.label]));
  if (args.json) { out(JSON.stringify({ runId: s.run.runId, pillars: s.run.pillars, checks }, null, 2)); return; }
  for (const [id, label] of Object.entries(checks)) out(`${id}  ${label}`);
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

async function main() {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  if (!cmd || cmd === "--help" || cmd === "-h" || cmd === "help") { out(HELP); return; }
  if (cmd === "--version") { out(ENGINE_VERSION); return; }
  if (LATER.has(cmd)) throw new UsageError(`${cmd} is not in this build (consent, cap-check, render, reverify and purge ship in PR 1b; topology in PR 2)`);
  if (!FLAGS[cmd]) throw new UsageError(`unknown command "${cmd}". Run with --help.`);
  const args = parse(argv);
  if (cmd === "plan") return cmdPlan(args);
  if (cmd === "collect") return cmdCollect(args);
  if (cmd === "seal-check") return cmdSealCheck(args);
  if (cmd === "status") return cmdStatus(args);
  if (cmd === "coverage") return cmdCoverage(args);
  if (cmd === "questionnaire") return cmdQuestionnaire(args);
  if (cmd === "map") return cmdMap(args);
}

main().catch((e) => {
  if (e instanceof UsageError) { console.error(`Usage error: ${e.message}`); process.exitCode = 2; }
  else { console.error(`Error: ${e.message}`); process.exitCode = 1; }
});
