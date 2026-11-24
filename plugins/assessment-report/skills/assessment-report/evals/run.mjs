#!/usr/bin/env node
// Runner-agnostic harness for the model evals. It needs no API key and calls no model.
//   prepare --case M-01 --workspace <dir>      copy the fixture and write the prompt to run in any agent
//   score   --case M-01 --out <folder> [--root <assessed copy>] [--save <file>] [--json]
//   record  --model <id> --skill-version <v> --scores a.json,b.json [--reported-by runner|agent] [--commit <sha>] [--date YYYY-MM-DD]
//   results                                    regenerate evals/RESULTS.md from the result files
// Exit codes: 0 success, 1 failure, 2 usage error.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gitRevision } from "../scripts/lib/inventory.mjs";
import { ENGINE_VERSION } from "../scripts/lib/version.mjs";
import { materialize } from "./fake-secret.mjs";
import { caseDir, caseIds, checkKey, loadCase, loadKey } from "./keys.mjs";
import { RESULTS_DIR, resultFileName, withHash, writeResultsMd } from "./results.mjs";
import { scoreRun } from "./scorer.mjs";

const HELP = `assessment-report evals harness
  prepare --case <M-01..> --workspace <empty folder>
  score   --case <id> --out <output folder of the run> [--root <folder the run assessed>] [--save <file>] [--json]
  record  --model <id> --skill-version <version> --scores <file,file,...> [--reported-by runner|agent] [--commit <sha>] [--date YYYY-MM-DD]
  results
Cases: ${caseIds().join(", ")}`;

class Usage extends Error {}
const opts = (() => {
  const o = { _: [] };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith("--")) o._.push(argv[i]);
    else {
      const next = argv[i + 1];
      o[argv[i].slice(2)] = next === undefined || next.startsWith("--") ? true : (i++, next);
    }
  }
  return o;
})();
const need = (k) => {
  if (typeof opts[k] !== "string" || !opts[k].trim()) throw new Usage(`--${k} is required`);
  return opts[k].trim();
};
const caseOf = () => {
  const id = need("case");
  if (!caseIds().includes(id)) throw new Usage(`unknown case ${id}; cases: ${caseIds().join(", ")}`);
  return id;
};

function prompt(id, rootName) {
  const c = loadCase(id);
  const q = (xs) => (xs.length ? xs.map((x) => `  - ${x}`).join("\n") : "  - (none)");
  return `# Eval run ${id}: ${c.title}

Use the \`assessment-report\` skill to produce a technical assessment report.

Answers to the scope interview (do not ask again; do not invent anything else):

- Client: ${c.client}
- Assessed folder: ./${rootName} (read-only)
- Output folder: ./out
- Language: ${c.lang}
- Author: Eval Runner
- Version: 0.1
- Date: 2026-01-01
- Frameworks: none
- In scope: ${c.scope.in.length ? c.scope.in.join(", ") : "everything in the assessed folder"}
- Out of scope: ${c.scope.out.length ? c.scope.out.join(", ") : "nothing"}
- Questions to answer:
${q(c.scope.questions)}
- Assumptions:
${q(c.scope.assumptions)}

Give the engine your own model identifier with \`--model\`.

At the review step, present the packet as usual; the user (this harness) approves with the name "Eval Reviewer".
Stop after \`render\`. Do not run docs-generator.
`;
}

function cmdPrepare() {
  const id = caseOf();
  const ws = resolve(need("workspace"));
  if (existsSync(ws) && readdirSync(ws).length) throw new Usage(`${ws} is not empty`);
  const key = loadKey(id);
  mkdirSync(ws, { recursive: true });
  materialize(join(caseDir(id), key.root), join(ws, key.root));
  writeFileSync(join(ws, "PROMPT.md"), prompt(id, key.root));
  console.log(`Prepared ${ws}\nRun the prompt in ${join(ws, "PROMPT.md")} with any agent that has the assessment-report skill, from inside that folder, then:\n  node evals/run.mjs score --case ${id} --out ${join(ws, "out")} --root ${join(ws, key.root)}`);
}

function cmdScore() {
  const id = caseOf();
  const res = scoreRun({ caseId: id, out: resolve(need("out")), root: typeof opts.root === "string" ? resolve(opts.root) : undefined });
  if (res.error) {
    console.error(res.error);
    return 1;
  }
  if (typeof opts.save === "string") writeFileSync(resolve(opts.save), `${JSON.stringify(res, null, 2)}\n`);
  console.log(opts.json ? JSON.stringify(res, null, 2) : Object.entries(res.metrics).map(([k, v]) => `${k.padEnd(28)} ${v === null ? "n/a" : v}`).join("\n"));
  return 0;
}

function cmdRecord() {
  const model = need("model"); // exits 2 without it
  const skillVersion = need("skill-version");
  const files = need("scores").split(",").map((f) => resolve(f.trim()));
  const reportedBy = opts["reported-by"] === "runner" ? "runner" : "agent";
  const date = typeof opts.date === "string" ? opts.date : new Date().toISOString().slice(0, 10);
  const here = fileURLToPath(new URL("../../../../..", import.meta.url));
  const commit = typeof opts.commit === "string" ? opts.commit : gitRevision(here) || "unknown";
  const runs = [];
  const perCase = {};
  for (const f of files) {
    if (!existsSync(f)) throw new Usage(`score file not found: ${f}`);
    const s = JSON.parse(readFileSync(f, "utf8"));
    if (s.error || !s.metrics) throw new Usage(`${f} holds no scored run`);
    perCase[s.caseId] = (perCase[s.caseId] ?? 0) + 1;
    runs.push({ caseId: s.caseId, run: perCase[s.caseId], metrics: s.metrics, flaws: s.flaws, counts: s.counts });
  }
  const result = withHash({
    schemaVersion: "1.0",
    date,
    model: { id: model, reportedBy },
    skillVersion,
    engineVersion: ENGINE_VERSION,
    repositoryCommit: commit,
    runsPerCase: perCase,
    runs,
  });
  const target = join(RESULTS_DIR, resultFileName(result));
  if (existsSync(target)) throw new Usage(`${target} already exists; results are never overwritten or edited`);
  mkdirSync(RESULTS_DIR, { recursive: true });
  writeFileSync(target, `${JSON.stringify(result, null, 2)}\n`);
  writeResultsMd();
  console.log(`Wrote ${target} and regenerated RESULTS.md`);
  return 0;
}

try {
  const cmd = opts._[0];
  if (!cmd || opts.help) console.log(HELP);
  else if (cmd === "prepare") cmdPrepare();
  else if (cmd === "score") process.exitCode = cmdScore();
  else if (cmd === "record") process.exitCode = cmdRecord();
  else if (cmd === "results") {
    writeResultsMd();
    console.log("Regenerated RESULTS.md");
  } else if (cmd === "check-keys") {
    const problems = caseIds().flatMap((id) => checkKey(id));
    console.log(problems.length ? problems.join("\n") : "Keys and fixtures are consistent.");
    process.exitCode = problems.length ? 1 : 0;
  } else throw new Usage(`unknown command ${cmd}`);
} catch (e) {
  if (!(e instanceof Usage)) throw e;
  console.error(`${e.message}\n\n${HELP}`);
  process.exitCode = 2;
}
