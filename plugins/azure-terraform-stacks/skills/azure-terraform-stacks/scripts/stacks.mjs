#!/usr/bin/env node
// azure-terraform-stacks engine. Usage: node scripts/stacks.mjs <command> [options]
// Commands: check-manifest, plan, scaffold, add-stack, check, audit, bridge, diagram, check-diagram
// Every command accepts --root <repo> (default: current directory) and --json.
// Exit codes: 0 success, 1 validation or check failure, 2 usage error.
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import YAML from "./lib/yaml.mjs";
import { loadManifest, validateManifest } from "./lib/manifest.mjs";
import { generateAll } from "./lib/generate.mjs";
import { planFiles, writePlan } from "./lib/files.mjs";
import { runCheck, runDeep } from "./lib/check.mjs";
import { audit, formatAudit } from "./lib/audit.mjs";
import { bridge } from "./lib/bridge.mjs";
import { generateDiagrams, checkDiagram, untouched, exportDiagram } from "./lib/diagram.mjs";

const HELP = `azure-terraform-stacks engine

  check-manifest                      validate infra/stacks.yaml
  plan                                list files scaffold would create or update (writes nothing)
  scaffold [--force]                  write the files; existing files that differ are refused without --force
  add-stack --name <type-owner> --type <t> --owner <o> [--depends-on a,b] [--remote-state]
                                      add a stack to the manifest and write only what changes
  check [--deep]                      check the repository against the rules (--deep runs terraform, actionlint, kustomize, shellcheck when installed)
  audit                               read-only audit of a repository WITHOUT infra/stacks.yaml: inventory plus the rules that need no manifest
  bridge --stack <s> --env <e> --instance <i> --outputs <file> [--open-pr] [--provider github|azure-repos] [--base <branch>]
                                      write Terraform outputs into the Kustomize overlay; --open-pr opens (never merges) a pull request
  diagram [--env <e>] [--instance <i>] [--all] [--export svg,png] [--draft] [--force]
                                      write docs/architecture/<env>-<instance>.drawio
  check-diagram <file.drawio>         structural check of a diagram

Options: --root <repo> (default: current directory), --json`;

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) { args._.push(a); continue; }
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) args[key] = true; else { args[key] = next; i++; }
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const cmd = args._[0];
const json = Boolean(args.json);
const root = resolve(typeof args.root === "string" ? args.root : process.cwd());
const manifestPath = join(root, "infra", "stacks.yaml");

function done(code, result, text) {
  if (json) console.log(JSON.stringify(result, null, 2));
  else if (text) console.log(text);
  process.exit(code);
}
function usage(msg) {
  if (json) console.log(JSON.stringify({ ok: false, error: msg }));
  else console.error(`${msg}\n\n${HELP}`);
  process.exit(2);
}
const fmtErrors = (errors) => errors.map((e) => `  ✗ ${e.path || "(root)"}: ${e.message}`).join("\n");
const fmtWarnings = (w) => w.map((e) => `  ! ${e.path}: ${e.message}`).join("\n");

function requireManifest() {
  if (!existsSync(manifestPath)) usage(`no manifest at ${manifestPath}; write infra/stacks.yaml first (references/manifest-format.md)`);
  const r = loadManifest(manifestPath);
  if (!r.manifest) done(1, { ok: false, errors: r.errors, warnings: r.warnings }, `infra/stacks.yaml has ${r.errors.length} problem(s):\n${fmtErrors(r.errors)}${r.warnings.length ? `\n${fmtWarnings(r.warnings)}` : ""}`);
  return r;
}

if (!cmd || args.help || cmd === "help") { console.log(HELP); process.exit(cmd ? 0 : 2); }

switch (cmd) {
  case "check-manifest": {
    if (!existsSync(manifestPath)) usage(`no manifest at ${manifestPath}`);
    const r = loadManifest(manifestPath);
    const ok = Boolean(r.manifest);
    done(ok ? 0 : 1, { ok, errors: r.errors, warnings: r.warnings },
      ok ? `✓ infra/stacks.yaml is valid${r.warnings.length ? `\n${fmtWarnings(r.warnings)}` : ""}` : `infra/stacks.yaml has ${r.errors.length} problem(s):\n${fmtErrors(r.errors)}`);
    break;
  }
  case "plan": {
    const { manifest } = requireManifest();
    const plan = planFiles(root, generateAll(manifest));
    const counts = plan.reduce((a, f) => ({ ...a, [f.status]: (a[f.status] ?? 0) + 1 }), {});
    done(0, { ok: true, files: plan.map(({ path, status }) => ({ path, status })), counts },
      plan.map((f) => `${f.status.padEnd(9)} ${f.path}`).join("\n") + `\n\n${Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(", ")}`);
    break;
  }
  case "scaffold": {
    const { manifest } = requireManifest();
    const plan = planFiles(root, generateAll(manifest));
    const { written, refused } = writePlan(root, plan, { force: Boolean(args.force) });
    const ok = refused.length === 0;
    done(ok ? 0 : 1, { ok, written, refused },
      `${written.length} file(s) written${refused.length ? `\n${refused.length} existing file(s) differ and were not changed (use --force after the user confirms):\n${refused.map((p) => `  ${p}`).join("\n")}` : ""}`);
    break;
  }
  case "add-stack": {
    for (const k of ["name", "type", "owner"]) if (typeof args[k] !== "string") usage(`add-stack needs --${k}`);
    requireManifest();
    const doc = YAML.parseDocument(readFileSync(manifestPath, "utf8"));
    const stacks = doc.get("stacks");
    if (stacks.items.some((s) => s.get("name") === args.name)) usage(`stack ${args.name} already exists`);
    const entry = { name: args.name, type: args.type, owner: args.owner };
    if (typeof args["depends-on"] === "string") entry.dependsOn = args["depends-on"].split(",").map((x) => x.trim()).filter(Boolean);
    if (args["remote-state"]) entry.remoteState = true;
    const node = doc.createNode(entry); node.flow = true;
    stacks.items.push(node);
    const text = doc.toString();
    const r = validateManifest(YAML.parse(text), { root });
    if (!r.manifest) done(1, { ok: false, errors: r.errors }, `the new stack makes the manifest invalid; nothing written:\n${fmtErrors(r.errors)}`);
    writeFileSync(manifestPath, text);
    const plan = planFiles(root, generateAll(r.manifest));
    // only new files, plus the files that list every stack
    const shared = (p) => /^(infra\/pipelines\/|\.github\/workflows\/|infra\/scripts\/)/.test(p);
    const { written, refused } = writePlan(root, plan, { force: Boolean(args.force), allowUpdate: shared });
    done(refused.length ? 1 : 0, { ok: !refused.length, written, refused },
      `added ${args.name} to infra/stacks.yaml; ${written.length} file(s) written${refused.length ? `\nnot changed (differ; use --force after the user confirms):\n${refused.map((p) => `  ${p}`).join("\n")}` : ""}`);
    break;
  }
  case "check": {
    const { manifest, warnings } = requireManifest();
    const findings = runCheck(root, manifest);
    const deep = args.deep ? runDeep(root, manifest) : null;
    const errors = findings.filter((f) => f.severity === "error");
    const counted = findings.filter((f) => f.severity !== "info");
    const deepFailed = deep ? deep.results.filter((r) => !r.ok) : [];
    const ok = errors.length === 0 && deepFailed.length === 0;
    const text = [
      counted.length ? counted.map((f) => `${f.severity === "error" ? "✗" : "!"} [${f.rule}] ${f.file}${f.line ? `:${f.line}` : ""}: ${f.message}\n    see ${f.ref}`).join("\n") : "✓ no findings",
      findings.some((f) => f.severity === "info") ? `\npending:\n${findings.filter((f) => f.severity === "info").map((f) => `  - ${f.file}: ${f.message}`).join("\n")}` : "",
      warnings.length ? `\nmanifest warnings:\n${fmtWarnings(warnings)}` : "",
      deep ? `\ndeep checks:\n${deep.results.map((r) => `  ${r.ok ? "✓" : "✗"} ${r.check}${r.ok ? "" : `\n${r.output.split("\n").map((l) => `      ${l}`).join("\n")}`}`).join("\n")}${deep.skipped.length ? `\n  skipped: ${deep.skipped.join("; ")}` : ""}` : "",
    ].join("");
    done(ok ? 0 : 1, { ok, findings, deep }, text);
    break;
  }
  case "audit": {
    // Works without a manifest, writes nothing and runs no external tool.
    const r = audit(root);
    done(r.ok ? 0 : 1, r, formatAudit(r));
    break;
  }
  case "bridge": {
    for (const k of ["stack", "env", "instance", "outputs"]) if (typeof args[k] !== "string") usage(`bridge needs --${k}`);
    const { manifest } = requireManifest();
    const r = bridge(root, manifest, {
      stack: args.stack, env: args.env, instance: args.instance, outputsFile: resolve(args.outputs),
      openPr: Boolean(args["open-pr"]), provider: typeof args.provider === "string" ? args.provider : null, base: typeof args.base === "string" ? args.base : null,
    });
    done(r.ok ? 0 : 1, r, r.message);
    break;
  }
  case "diagram": {
    const { manifest } = requireManifest();
    const r = generateDiagrams(manifest, { env: args.env, instance: args.instance, all: Boolean(args.all) });
    if (r.errors.length) done(1, { ok: false, errors: r.errors }, r.errors.map((e) => `✗ ${e}`).join("\n"));
    const written = [], edited = [], exports = [];
    for (const [p, xml] of r.files) {
      const abs = join(root, p);
      if (existsSync(abs) && !args.force) {
        const cur = readFileSync(abs, "utf8");
        if (cur !== xml && !untouched(cur)) { edited.push(p); continue; }
      }
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, xml);
      written.push(p);
      if (typeof args.export === "string" || args.draft) {
        const formats = args.draft ? ["png"] : String(args.export).split(",").map((x) => x.trim());
        exports.push({ file: p, ...exportDiagram(abs, formats, { draft: Boolean(args.draft) }) });
      }
    }
    const lines = [
      written.length ? `wrote ${written.join(", ")}` : "",
      edited.length ? `not changed (edited in draw.io since generated; use --force to overwrite): ${edited.join(", ")}` : "",
      ...exports.map((e) => [
        e.exported?.length ? `exported ${e.exported.join(", ")}` : "",
        e.skipped?.length ? `skipped ${e.skipped.join(", ")} for ${e.file}: ${e.hint}` : "",
        e.failed?.length ? `export failed for ${e.file}: ${e.failed.join("; ")}` : "",
      ].filter(Boolean).join("\n")),
    ].filter(Boolean);
    const failed = exports.some((e) => e.failed?.length);
    done(edited.length || failed ? 1 : 0, { ok: !edited.length && !failed, written, edited, exports }, lines.join("\n"));
    break;
  }
  case "check-diagram": {
    const file = args._[1];
    if (!file) usage("check-diagram needs a .drawio file");
    const m = existsSync(manifestPath) ? loadManifest(manifestPath).manifest : null;
    const problems = checkDiagram(readFileSync(resolve(file), "utf8"), m);
    done(problems.length ? 1 : 0, { ok: !problems.length, problems }, problems.length ? problems.map((p) => `✗ ${p}`).join("\n") : `✓ ${file} passes the structural checks`);
    break;
  }
  default:
    usage(`unknown command ${cmd}`);
}
