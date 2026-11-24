#!/usr/bin/env node
// assessment-report engine. Usage: node scripts/assess.mjs <command> [options]
// Exit codes: 0 success, 1 a check, gate or order failure, 2 usage error.
// Reads the assessed material; writes only inside --out (default ./assessment-report/). No network.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import {
  hashAll, hashChecked, hashCore, loadAssessment, nextId, outPaths, saveAssessment,
} from "./lib/assessment.mjs";
import { classify, notVerifiedFindings, quickWins, recompute, shownFindings, tokenValues, verifyFirst } from "./lib/classify.mjs";
import { checkAssessment, computedMismatches, snapshotComputed } from "./lib/consistency.mjs";
import { allowedNext, checkGate, checkOrder, logEvent, loadState, newState, NODES, saveState } from "./lib/graph.mjs";
import { buildInventory } from "./lib/inventory.mjs";
import { checkRoadmap } from "./lib/roadmap.mjs";
import { loadSchema, SCHEMA_PATH, validateAssessment } from "./lib/schema.mjs";
import { parseCatalog, verifyAssessment } from "./lib/verify.mjs";
import { ENGINE_VERSION, SCHEMA_VERSION, SKILL_VERSION } from "./lib/version.mjs";
import { insideGit, isInside, readJson, realOrResolve, sha256, today, UsageError, writeJson } from "./lib/util.mjs";

const HELP = `assessment-report engine ${ENGINE_VERSION}

Flow (each command refuses to run out of order; "status" shows where you are):
  init        --model <id|unknown> [--root <assessed folder>] [--client ..] [--title ..] [--author ..] [--version ..]
              [--date YYYY-MM-DD] [--lang en|pt-BR|es] [--scope-file <json>] [--model-reported-by runner|agent]
              write a skeleton assessment.json from the scope answers; never overwrites
  inventory   [--max-size <bytes>]       list the files in scope with SHA-256 and the revision
  capture     --file evidence/<name> --command "<read-only command>"
              record the SHA-256 of saved command output so it can be cited as 'output' evidence
  verify      [--catalog <framework-id>=<file>]...   check every citation (offline); after two repairs, demote by code
  classify                                compute confidence, severity, the matrix and the quick wins
  check       [--json]                    roadmap rules and consistency of the whole assessment
  review      [--approve --by <name> [--date YYYY-MM-DD]]   show the review packet; approve only after the user's yes
  render      [--unreviewed]              write report/report.md, annexes and report.json
  finish                                  paths, run metadata and what was not verified
Other:
  status      [--json]                    current node and the allowed next nodes
  schema      [--validate <file>] [--json]   print the schema path, or validate a file against it

Options: --out <folder> (default ./assessment-report/), --json, --help, --version
Exit codes: 0 success, 1 failed check, gate or order, 2 usage error.`;

// ---------------------------------------------------------------------------------------------------------
function parseArgs(argv) {
  const args = { _: [], catalog: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) {
      args._.push(a);
      continue;
    }
    const key = a.slice(2);
    const next = argv[i + 1];
    const val = next === undefined || next.startsWith("--") ? true : (i++, next);
    if (key === "catalog") args.catalog.push(val);
    else args[key] = val;
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const cmd = args._[0];
const json = Boolean(args.json);
const out = resolve(typeof args.out === "string" ? args.out : "assessment-report");
const P = outPaths(out);

const print = (s = "") => console.log(s);
const fmtErr = (e) => `  - ${e.where ? `${e.where}: ` : ""}${e.message}${e.code ? ` [${e.code}]` : ""}`;

function usage(message) {
  throw new UsageError(message);
}

/** Sets the exit code and unwinds to main, so buffered output is flushed on every platform. */
class ExitSignal extends Error {}
function exit(code) {
  process.exitCode = code;
  throw new ExitSignal();
}

function load() {
  const state = loadState(out);
  const assessment = loadAssessment(out);
  if (!state || !assessment) {
    console.error(`No assessment in ${out}. Check --out, or run \`init\` first (node scripts/assess.mjs init --model <id|unknown> ...).`);
    exit(2);
  }
  return { state, assessment };
}

/** Out-of-order refusal. Exits 1 without changing state. */
function enforceOrder(state, command) {
  const o = checkOrder(state, command);
  if (o) {
    print(`Refused (out of order): ${o.message}`);
    exit(1);
  }
}

function enforceGate(state, assessment, command, opts) {
  const g = checkGate(state, assessment, command, opts);
  if (g) {
    print(`Refused: ${g.message}`);
    if (g.returnTo === "verify") {
      state.current = "verify";
      logEvent(state, command, false, "gate");
      saveState(out, state);
      print('The flow is back at "verify".');
    }
    exit(1);
  }
}

const finding = (a, id) => a.findings.find((f) => f.id === id);

function formatResultLine(r, ev) {
  const loc = r.location ? ` ${r.location}` : "";
  return `  ${r.evidence} [${r.code}]${loc}: ${r.message}${r.matches ? `\n${r.matches.map((m) => `      ${m}`).join("\n")}` : ""}${ev ? "" : ""}`;
}

// ---------------------------------------------------------------------------------------------------------
function cmdInit() {
  if (args.model === undefined || args.model === true || String(args.model).trim() === "")
    usage('init needs --model <identifier of the model running this assessment> (or --model unknown). The model identifier is recorded in every report.');
  if (insideGit(out)) usage(`--out ${out} is inside a .git folder; choose another output folder`);
  const root = resolve(typeof args.root === "string" ? args.root : process.cwd());
  if (!existsSync(root) || !statSync(root).isDirectory()) usage(`--root ${root} is not a folder`);
  if (realOrResolve(out) === realOrResolve(root)) usage("--out must not be the assessed folder itself; use a subfolder or another folder");
  if (existsSync(P.assessment)) {
    print(`Refused: ${P.assessment} already exists; init never overwrites. Delete the output folder or choose another --out.`);
    exit(1);
  }
  let scopeFile = {};
  if (typeof args["scope-file"] === "string") {
    try {
      scopeFile = readJson(resolve(args["scope-file"]));
    } catch (e) {
      usage(`cannot read --scope-file: ${e.message}`);
    }
  }
  const lang = typeof args.lang === "string" ? args.lang : (scopeFile.lang ?? "en");
  const placeholders = [];
  const val = (flag, label) => {
    const v = typeof args[flag] === "string" && args[flag].trim() ? args[flag].trim() : scopeFile[flag];
    if (typeof v === "string" && v.trim()) return v.trim();
    placeholders.push(label);
    return `[REPLACE: ${label}]`;
  };
  const reportedBy = args["model-reported-by"] === "runner" ? "runner" : "agent";
  const assessment = {
    schemaVersion: SCHEMA_VERSION,
    meta: {
      title: val("title", "title"),
      client: val("client", "client"),
      author: val("author", "author"),
      version: val("version", "version"),
      date: val("date", "date"),
      lang,
      skillVersion: SKILL_VERSION,
      engineVersion: ENGINE_VERSION,
      model: { id: String(args.model).trim(), reportedBy },
      revision: "",
    },
    scope: {
      in: scopeFile.in ?? [],
      out: scopeFile.out ?? [],
      questions: scopeFile.questions ?? [],
      assumptions: scopeFile.assumptions ?? [],
      root,
      ...(scopeFile.capacity ? { capacity: scopeFile.capacity } : {}),
      ...(scopeFile.scale ? { scale: scopeFile.scale } : {}),
    },
    frameworks: scopeFile.frameworks ?? [],
    evidence: [],
    findings: [],
    actions: [],
    summary: "",
  };
  if (scopeFile.subtitle) assessment.meta.subtitle = scopeFile.subtitle;
  const errs = validateAssessment(assessment);
  if (errs.length) usage(`the scope answers are not valid:\n${errs.map((e) => `  - ${e.path}: ${e.message}`).join("\n")}`);
  saveAssessment(out, assessment);
  const state = newState();
  logEvent(state, "init", true);
  saveState(out, state);
  print(`Created ${P.assessment}`);
  print(`Model: ${assessment.meta.model.id} (reported by ${reportedBy})${assessment.meta.model.id === "unknown" ? " - the report will say the model is unknown" : ""}`);
  if (placeholders.length) print(`Placeholders to replace before check: ${placeholders.join(", ")} (never infer them; ask the user)`);
  if (!args.lang && !scopeFile.lang) print("Language defaulted to en; ask the user and set meta.lang (en, pt-BR or es).");
  print("Next: inventory");
}

function cmdInventory() {
  const { state, assessment } = load();
  enforceOrder(state, "inventory");
  const root = assessment.scope.root;
  if (!existsSync(root)) usage(`the assessed folder no longer exists: ${root}`);
  const maxBytes = typeof args["max-size"] === "string" ? Number(args["max-size"]) : undefined;
  if (maxBytes !== undefined && !(maxBytes > 0)) usage("--max-size must be a positive number of bytes");
  const inv = buildInventory(root, { outDir: out, scopeIn: assessment.scope.in, scopeOut: assessment.scope.out, maxBytes });
  writeJson(P.inventory, inv);
  assessment.meta.revision = inv.revision;
  saveAssessment(out, assessment);
  state.current = "investigate";
  state.verifiedHash = state.checkedHash = state.reviewedHash = null;
  state.repairAttempts = 0;
  logEvent(state, "inventory", true);
  saveState(out, state);
  const reasons = {};
  for (const e of inv.exclusions) reasons[e.reason] = (reasons[e.reason] ?? 0) + 1;
  print(`Inventory: ${inv.files.length} file(s) in scope, revision ${inv.revision} (${inv.revisionKind}).`);
  if (inv.exclusions.length) print(`Left out: ${Object.entries(reasons).map(([k, v]) => `${v} ${k}`).join(", ")} (see inventory.json).`);
  print("Next: investigate (read-only), write evidence and findings in assessment.json, then run verify.");
}

function cmdCapture() {
  const { state } = load();
  if (typeof args.file !== "string" || typeof args.command !== "string") usage('capture needs --file evidence/<name> and --command "<the command whose output the file holds>"');
  const full = resolve(out, args.file);
  if (!isInside(realOrResolve(full), realOrResolve(P.evidenceDir)) || !existsSync(full)) usage(`--file must be an existing file inside ${P.evidenceDir}`);
  if (basename(full).startsWith(".")) usage("--file must not be a dot file");
  const text = readFileSync(full);
  const rel = relative(out, full).split("\\").join("/");
  const captures = existsSync(P.captures) ? readJson(P.captures) : {};
  const capturedAt = new Date().toISOString();
  captures[rel] = { sha256: sha256(text), command: args.command, capturedAt };
  writeJson(P.captures, captures);
  logEvent(state, "capture", true, rel);
  saveState(out, state);
  print(`Recorded ${rel} (sha256 ${captures[rel].sha256.slice(0, 12)}...).`);
  print(`Cite it as: { "kind": "output", "path": "${rel}", "command": ${JSON.stringify(args.command)}, "capturedAt": "${capturedAt}", "quote": "<lines of the file>" }`);
}

function loadCatalogs(state) {
  for (const spec of args.catalog) {
    const m = typeof spec === "string" ? spec.match(/^([^=]+)=(.+)$/) : null;
    if (!m) usage("--catalog needs <framework-id>=<file>");
    state.catalogs[m[1]] = resolve(m[2]);
  }
  const catalogs = {};
  for (const [id, file] of Object.entries(state.catalogs)) {
    if (!existsSync(file)) usage(`catalog for ${id} not found: ${file}`);
    catalogs[id] = parseCatalog(readFileSync(file, "utf8"));
  }
  return catalogs;
}

function cmdVerify() {
  const { state, assessment } = load();
  enforceOrder(state, "verify");
  if (!existsSync(P.inventory)) {
    print("Refused: no inventory.json. Run inventory first.");
    exit(1);
  }
  const schemaErrors = validateAssessment(assessment).filter((e) => !/^(verification|roadmapViolations)/.test(e.path));
  if (schemaErrors.length) {
    print(`assessment.json does not match the schema (${schemaErrors.length} problem(s)):\n${schemaErrors.map((e) => `  - ${e.path}: ${e.message}`).join("\n")}`);
    logEvent(state, "verify", false, "schema");
    saveState(out, state);
    exit(1);
  }
  const catalogs = loadCatalogs(state);
  const inventory = readJson(P.inventory);
  const captures = existsSync(P.captures) ? readJson(P.captures) : null;
  const root = assessment.scope.root;
  const result = verifyAssessment(assessment, { root, outDir: out, inventory, captures, catalogs });

  // Problems about the assessment itself
  const problems = [...result.problems];
  const evIds = new Set(assessment.evidence.map((e) => e.id));
  assessment.findings.forEach((f, i) => {
    if (!f.evidence.length) problems.push({ code: "no-evidence", where: `findings[${i}]`, message: `${f.id} lists no evidence` });
    for (const id of f.evidence) if (!evIds.has(id)) problems.push({ code: "dangling-reference", where: `findings[${i}].evidence`, message: `${f.id} cites ${id}, which does not exist` });
  });
  const warnings = [];
  const cited = new Set(assessment.findings.flatMap((f) => f.evidence));
  for (const e of assessment.evidence) if (!cited.has(e.id)) warnings.push(`${e.id} is cited by no finding (orphan evidence)`);

  // Computed fields must be the engine's, not a hand edit
  const merged = { ...assessment, verification: { results: result.results, controls: result.controls, problems: [] } };
  const mismatches = computedMismatches(assessment, recompute(merged), state.computed ?? {});
  for (const m of mismatches) problems.push({ code: m.code, where: m.where, message: m.message });

  // Record: excerpt hashes are computed fields; failures are never removed
  const next = structuredClone(assessment);
  for (const ev of next.evidence) {
    const r = result.results.find((x) => x.evidence === ev.id);
    if (r?.status === "pass" && r.excerptSha256) ev.excerptSha256 = r.excerptSha256;
    else delete ev.excerptSha256;
  }
  next.verification = {
    results: result.results.map(({ excerptSha256, ...r }) => r),
    controls: result.controls,
    problems,
  };
  const failed = result.results.some((r) => r.status === "fail") || problems.length > 0;
  const failures = result.results.filter((r) => r.status === "fail");
  const passN = result.results.filter((r) => r.status === "pass").length;
  const uncheckedN = result.results.filter((r) => r.status === "unchecked").length;

  let demoted = [];
  if (!failed) {
    state.repairAttempts = 0;
    state.verifiedHash = hashCore(next);
    state.current = "classify";
    state.checkedHash = state.reviewedHash = null;
  } else if (state.repairAttempts < 2) {
    state.repairAttempts++;
    state.verifiedHash = null;
    state.current = "repair";
  } else {
    // Demotion by code: findings with no passing machine-checked evidence stay in the record and are
    // classified as unverified. Failing evidence and the verification log are kept.
    const fresh = recompute(next);
    demoted = next.findings.filter((f) => fresh.get(f.id).confidence === "unverified").map((f) => f.id);
    state.repairAttempts = 0;
    state.verifiedHash = hashCore(next);
    state.current = "classify";
    state.checkedHash = state.reviewedHash = null;
  }
  saveAssessment(out, next);
  logEvent(state, "verify", !failed, failed ? `${failures.length} failed` : undefined);
  saveState(out, state);

  if (json) {
    print(JSON.stringify({ ok: !failed, node: state.current, pass: passN, unchecked: uncheckedN, failures, problems, warnings, demoted }, null, 2));
  } else {
    print(`Verified: ${passN} pass, ${failures.length} fail, ${uncheckedN} not machine-checked.`);
    if (failures.length) print(`Failures:\n${failures.map((r) => formatResultLine(r)).join("\n")}`);
    if (problems.length) print(`Problems:\n${problems.map(fmtErr).join("\n")}`);
    if (warnings.length) print(`Warnings:\n${warnings.map((w) => `  - ${w}`).join("\n")}`);
    if (!failed) print("All machine-checkable evidence passes. Next: classify");
    else if (state.current === "repair") print(`Repair attempt ${state.repairAttempts} of 2: fix each citation (or ask the user for the file), then run verify again. Never argue a failure away.`);
    else print(`Repair limit reached: demoted by code: ${demoted.length ? demoted.join(", ") : "(no finding lost all its evidence)"}. Failing evidence stays in the verification log. Next: classify`);
  }
  exit(failed ? 1 : 0);
}

function cmdClassify() {
  const { state, assessment } = load();
  enforceOrder(state, "classify");
  enforceGate(state, assessment, "classify");
  const r = classify(assessment);
  if (r.errors.length) {
    print(`classify cannot compute severity:\n${r.errors.map((e) => `  - ${e}`).join("\n")}`);
    logEvent(state, "classify", false);
    saveState(out, state);
    exit(1);
  }
  saveAssessment(out, r.assessment);
  state.computed = snapshotComputed(r.assessment);
  state.current = "roadmap";
  state.roadmapAttempts = 0;
  state.checkedHash = state.reviewedHash = null;
  logEvent(state, "classify", true);
  saveState(out, state);
  const a = r.assessment;
  if (json) return print(JSON.stringify({ ok: true, findings: a.findings.map((f) => ({ id: f.id, confidence: f.confidence, severity: f.severity, severityUncapped: f.severityUncapped })) }, null, 2));
  for (const f of a.findings)
    print(`  ${f.id}  ${String(f.severity).padEnd(8)} ${f.confidence.padEnd(12)}${f.severityUncapped ? ` (uncapped ${f.severityUncapped})` : ""}  ${f.title}`);
  const gen = a.actions.filter((x) => x.generated);
  if (gen.length) print(`Created wave-1 action(s) to collect evidence: ${gen.map((x) => x.id).join(", ")}`);
  print(`Quick wins: ${quickWins(a).map((f) => f.id).join(", ") || "none"}. Verify first: ${verifyFirst(a).map((f) => f.id).join(", ") || "none"}.`);
  print("Next: roadmap. Write the actions in assessment.json (waves, effort, risk, dependsOn), then run check.");
}

function cmdCheck() {
  const { state, assessment } = load();
  enforceOrder(state, "check");
  enforceGate(state, assessment, "check");
  const rm = checkRoadmap(assessment);
  const res = checkAssessment(assessment, { acceptRoadmapViolations: true });
  let accepted = false;
  if (rm.errors.length) {
    if (state.roadmapAttempts < 2) {
      state.roadmapAttempts++;
      state.current = "roadmap";
      logEvent(state, "check", false, "roadmap");
      saveState(out, state);
      const all = [...rm.errors, ...res.errors];
      if (json) print(JSON.stringify({ ok: false, node: "roadmap", errors: all, warnings: res.warnings }, null, 2));
      else print(`Roadmap check failed (retry ${state.roadmapAttempts} of 2):\n${all.map(fmtErr).join("\n")}\nFix the roadmap in assessment.json, then run check again.`);
      exit(1);
    }
    accepted = true;
  }
  const next = structuredClone(assessment);
  if (accepted) next.roadmapViolations = rm.errors.map((e) => e.message);
  else delete next.roadmapViolations;
  if (res.errors.length) {
    const level = res.errors.some((e) => e.level === "finding") ? "repair" : "roadmap";
    state.current = level;
    logEvent(state, "check", false, level);
    saveState(out, state);
    if (json) print(JSON.stringify({ ok: false, node: level, errors: res.errors, warnings: res.warnings }, null, 2));
    else {
      print(`Check failed: ${res.errors.length} problem(s)\n${res.errors.map(fmtErr).join("\n")}`);
      print(level === "repair" ? "Fix the findings or evidence (then run verify again)." : "Fix the roadmap or decisions, then run check again.");
    }
    exit(1);
  }
  saveAssessment(out, next);
  state.checkedHash = hashChecked(next);
  state.reviewedHash = null;
  state.current = "narrate";
  logEvent(state, "check", true, accepted ? "roadmap violations accepted after 2 retries" : undefined);
  saveState(out, state);
  if (json) return print(JSON.stringify({ ok: true, node: "narrate", warnings: res.warnings, roadmapViolations: next.roadmapViolations ?? [], totals: rm.totals }, null, 2));
  print("Check passed.");
  for (const w of res.warnings) print(`  warning: ${w.where ? `${w.where}: ` : ""}${w.message}`);
  if (accepted) print(`Roadmap violations remain after 2 retries and will be listed in the report:\n${next.roadmapViolations.map((v) => `  - ${v}`).join("\n")}`);
  print("Next: narrate. Write the summary (use {{count.*}} tokens, no headings) and the decisions, then run review.");
}

function reviewPacket(a) {
  const lines = [];
  const crit = shownFindings(a).filter((f) => f.severity === "Critical" || f.severity === "High");
  lines.push("REVIEW PACKET (show this to the user; Critical and High findings first, with their quotes)");
  lines.push(`Findings: ${shownFindings(a).length} shown, ${notVerifiedFindings(a).length} not verified. Model: ${a.meta.model.id}.`);
  for (const f of crit) {
    lines.push(`\n${f.id} [${f.severity}, ${f.confidence}] ${f.title}\n  ${f.statement}\n  rationale: impact - ${f.rationale?.impact ?? "?"}; likelihood - ${f.rationale?.likelihood ?? "?"}`);
    for (const id of f.evidence) {
      const e = a.evidence.find((x) => x.id === id);
      const r = a.verification?.results.find((x) => x.evidence === id);
      if (!e) continue;
      const where = e.kind === "file" || e.kind === "document" ? `${e.path}:${e.startLine}-${e.endLine}` : e.kind === "absence" ? `absence in ${e.scope.join(", ")}` : e.kind;
      lines.push(`  ${id} ${where} [${r?.status ?? "?"}]${e.redacted ? " (redacted)" : e.quote ? `\n    ${String(e.quote).split("\n").join("\n    ")}` : e.text ? `\n    ${e.text}` : ""}`);
    }
  }
  const nv = notVerifiedFindings(a);
  if (nv.length) lines.push(`\nNOT VERIFIED:\n${nv.map((f) => `  ${f.id} ${f.title}`).join("\n")}`);
  const vf = verifyFirst(a);
  if (vf.length) lines.push(`\nVERIFY FIRST (potential severity if true):\n${vf.map((f) => `  ${f.id} ${f.potentialSeverity} ${f.title}`).join("\n")}`);
  if (a.roadmapViolations?.length) lines.push(`\nROADMAP VIOLATIONS LEFT:\n${a.roadmapViolations.map((v) => `  ${v}`).join("\n")}`);
  const vals = tokenValues(a);
  lines.push(`\nSUMMARY (tokens expanded):\n${(a.summary ?? "").replace(/\{\{\s*([a-z0-9.]+)\s*\}\}/gi, (m, k) => (k.toLowerCase() in vals ? vals[k.toLowerCase()] : m))}`);
  return lines.join("\n");
}

function cmdReview() {
  const { state, assessment } = load();
  enforceOrder(state, "review");
  const res = checkAssessment(assessment, { acceptRoadmapViolations: true, requireSummary: true });
  if (!args.approve) {
    state.current = "review";
    logEvent(state, "review", true, "shown");
    saveState(out, state);
    print(reviewPacket(assessment));
    if (res.errors.length) print(`\nProblems to fix before approval:\n${res.errors.map(fmtErr).join("\n")}`);
    print("\nIf the user edits anything, the flow returns to verify. Approve only after the user's explicit yes: review --approve --by <name>");
    return;
  }
  enforceGate(state, assessment, "review-approve");
  if (typeof args.by !== "string" || !args.by.trim()) usage("review --approve needs --by <the reviewer's name>, given by the user");
  if (res.errors.length) {
    print(`Refused: cannot approve with problems:\n${res.errors.map(fmtErr).join("\n")}`);
    exit(1);
  }
  const next = structuredClone(assessment);
  next.meta.review = { by: args.by.trim(), at: typeof args.date === "string" ? args.date : today() };
  saveAssessment(out, next);
  state.reviewedHash = hashAll(next);
  state.reviewer = next.meta.review;
  state.current = "render";
  logEvent(state, "review", true, `approved by ${args.by}`);
  saveState(out, state);
  print(`Approved by ${next.meta.review.by} on ${next.meta.review.at}. Next: render`);
}

async function cmdRender() {
  const { state, assessment } = load();
  enforceOrder(state, "render");
  const unreviewed = Boolean(args.unreviewed);
  enforceGate(state, assessment, "render", { unreviewed });
  const res = checkAssessment(assessment, { acceptRoadmapViolations: true, requireSummary: true });
  if (res.errors.length) {
    print(`Refused: ${res.errors.length} problem(s) remain:\n${res.errors.map(fmtErr).join("\n")}`);
    exit(1);
  }
  const { renderReport, scanRendered } = await import("./lib/render.mjs");
  // An approval counts only if nothing changed after it; otherwise the report says it was not reviewed.
  const approved = Boolean(assessment.meta.review) && state.reviewedHash === hashAll(assessment);
  const toRender = structuredClone(assessment);
  if (!approved) delete toRender.meta.review;
  const files = renderReport(toRender, { unreviewed: !approved });
  const leaks = scanRendered(files);
  if (leaks.length) {
    print(`Refused:\n${leaks.map(fmtErr).join("\n")}`);
    exit(1);
  }
  const { writeText } = await import("./lib/util.mjs");
  for (const [name, text] of Object.entries(files)) writeText(join(P.report, name), text);
  state.current = "delegate";
  state.unreviewed = !approved;
  logEvent(state, "render", true, state.unreviewed ? "unreviewed" : undefined);
  saveState(out, state);
  print(`Wrote ${Object.keys(files).length} file(s) in ${P.report}: ${Object.keys(files).join(", ")}`);
  if (state.unreviewed) print("The report is stamped as NOT human-reviewed.");
  print("Next: hand report/report.md to the docs-generator skill (it asks which theme to use), then run finish. Without docs-generator, deliver report.md and report.json and say PDF and DOCX need that plugin.");
}

function cmdFinish() {
  const { state, assessment } = load();
  enforceOrder(state, "finish");
  const a = assessment;
  const placeholders = ["title", "client", "author", "version", "date"].filter((k) => /\[REPLACE/.test(a.meta[k]));
  state.current = "finish";
  logEvent(state, "finish", true);
  saveState(out, state);
  const nv = notVerifiedFindings(a);
  const lines = [
    `Done. Files: ${P.report} (report.md, annex-*.md, report.json) and ${P.assessment}.`,
    `Run: skill ${a.meta.skillVersion}, engine ${a.meta.engineVersion}, model ${a.meta.model.id} (reported by ${a.meta.model.reportedBy}), revision ${a.meta.revision}.`,
    a.meta.review && !state.unreviewed ? `Reviewed by ${a.meta.review.by} on ${a.meta.review.at}.` : "NOT human-reviewed.",
    `Not verified (${nv.length}): ${nv.map((f) => f.id).join(", ") || "none"}.`,
    `Not machine-checked evidence: ${a.verification.results.filter((r) => r.status === "unchecked").map((r) => r.evidence).join(", ") || "none"}.`,
  ];
  if (a.roadmapViolations?.length) lines.push(`Roadmap violations left (listed in the report): ${a.roadmapViolations.length}.`);
  if (placeholders.length) lines.push(`Placeholders still to replace: ${placeholders.join(", ")}.`);
  if (a.frameworks.length && a.verification.controls.some((c) => c.status === "unchecked")) lines.push("Framework mappings are unchecked (no catalog supplied).");
  print(lines.join("\n"));
}

function cmdStatus() {
  const state = loadState(out);
  if (!state) {
    if (json) print(JSON.stringify({ initialized: false, next: ["init"] }));
    else print(`No run in ${out}. Next: init`);
    return;
  }
  const next = allowedNext(state);
  if (json) return print(JSON.stringify({ initialized: true, current: state.current, repairAttempts: state.repairAttempts, roadmapAttempts: state.roadmapAttempts, next, reviewed: Boolean(state.reviewedHash) }, null, 2));
  print(`Current node: ${state.current} (${NODES[state.current]?.type ?? "?"}): ${NODES[state.current]?.does ?? ""}`);
  print(`Repair attempts: ${state.repairAttempts} of 2. Roadmap retries: ${state.roadmapAttempts} of 2.`);
  print(`Allowed next: ${next.map((n) => `${n.node}${n.command ? ` (${n.command})` : ""}`).join(", ") || "(end)"}`);
}

function cmdSchema() {
  if (typeof args.validate === "string") {
    let data;
    try {
      data = readJson(resolve(args.validate));
    } catch (e) {
      usage(`cannot read ${args.validate}: ${e.message}`);
    }
    const errors = validateAssessment(data);
    if (json) print(JSON.stringify({ ok: !errors.length, errors }, null, 2));
    else if (errors.length) print(`Invalid (${errors.length}):\n${errors.map((e) => `  - ${e.path}: ${e.message}`).join("\n")}`);
    else print("Valid.");
    exit(errors.length ? 1 : 0);
  }
  print(json ? JSON.stringify(loadSchema(), null, 2) : `${SCHEMA_PATH} (schemaVersion ${SCHEMA_VERSION})`);
}

// ---------------------------------------------------------------------------------------------------------
async function main() {
  if (args.version === true) return print(ENGINE_VERSION);
  if (!cmd || args.help) {
    print(HELP);
    return;
  }
  switch (cmd) {
    case "init": return cmdInit();
    case "inventory": return cmdInventory();
    case "capture": return cmdCapture();
    case "verify": return cmdVerify();
    case "classify": return cmdClassify();
    case "check": return cmdCheck();
    case "review": return cmdReview();
    case "render": return cmdRender();
    case "finish": return cmdFinish();
    case "status": return cmdStatus();
    case "schema": return cmdSchema();
    default: usage(`unknown command "${cmd}"`);
  }
}

try {
  await main();
} catch (e) {
  if (e instanceof ExitSignal) {
    // exit code already set
  } else if (e instanceof UsageError) {
    console.error(`${e.message}\n\nRun with --help for the commands.`);
    process.exitCode = 2;
  } else throw e;
}
