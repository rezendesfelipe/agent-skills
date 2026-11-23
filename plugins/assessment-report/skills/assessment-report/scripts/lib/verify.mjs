// The deterministic evidence verifier. Offline, no model, no child process.
// It proves that a citation exists where the report says it does, at the inventoried revision.
// It does not prove that the excerpt supports the claim (see references/evidence-and-confidence.md).
import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { decodeText, MAX_FILE_BYTES } from "./inventory.mjs";
import { matchAny } from "./glob.mjs";
import { hasSecretKind, scanString, scanValue } from "./secrets.mjs";
import { isInside, normLine, sha256, splitLines } from "./util.mjs";

export const FAILURE_CODES = [
  "path-escape",
  "not-found",
  "not-text",
  "too-large",
  "range-invalid",
  "quote-mismatch",
  "drift",
  "scope-empty",
  "absence-violated",
  "pattern-too-costly",
  "secret-in-quote",
];

export const MAX_EXCERPT_LINES = 20;
const MAX_PATTERN_LENGTH = 200;
const MAX_LINE_CHARS = 2000;
const MAX_ABSENCE_BYTES = 50 * 1024 * 1024;
const MAX_SHOWN_MATCHES = 5;

const pass = (extra = {}) => ({ status: "pass", machineChecked: true, ...extra });
const fail = (code, message, extra = {}) => ({ status: "fail", machineChecked: true, code, message, ...extra });
const unchecked = (message) => ({ status: "unchecked", machineChecked: false, message });

/** Resolves `rel` under `base`: relative, no `.git`, and (after symlinks) inside `base`. */
function containedPath(base, rel) {
  if (typeof rel !== "string" || !rel || isAbsolute(rel) || /^[A-Za-z]:/.test(rel) || rel.includes("\0"))
    return { error: fail("path-escape", `path "${rel}" must be relative to the root`) };
  const full = resolve(base, rel);
  const realBase = realpathSync(base);
  if (!isInside(full, resolve(base)) || rel.split(/[\\/]/).includes(".git"))
    return { error: fail("path-escape", `path "${rel}" is outside the root or inside .git`) };
  if (!existsSync(full)) {
    try {
      lstatSync(full);
    } catch {
      return { error: fail("not-found", `file not found: ${rel}`) };
    }
    return { error: fail("not-found", `broken symlink: ${rel}`) };
  }
  const real = realpathSync(full);
  if (!isInside(real, realBase) || real.split(/[\\/]/).includes(".git"))
    return { error: fail("path-escape", `path "${rel}" resolves outside the root`) };
  return { full: real };
}

function readTextFile(full, rel, maxBytes) {
  const st = statSync(full);
  if (!st.isFile()) return { error: fail("not-found", `not a regular file: ${rel}`) };
  if (st.size > maxBytes) return { error: fail("too-large", `file is ${st.size} bytes; the cap is ${maxBytes}: ${rel}`) };
  const buf = readFileSync(full);
  const text = decodeText(buf);
  if (text === null) return { error: fail("not-text", `file is not UTF-8 text: ${rel}`) };
  return { text, sha: sha256(buf) };
}

/** Finds the line ranges where a quote appears, to hint at drifted line numbers. */
function locateQuote(lines, quoteLines) {
  const hits = [];
  const n = quoteLines.length;
  for (let i = 0; i + n <= lines.length && hits.length < 3; i++) {
    let ok = true;
    for (let j = 0; j < n && ok; j++) ok = normLine(lines[i + j]) === quoteLines[j];
    if (ok) hits.push(`${i + 1}-${i + n}`);
  }
  return hits;
}

const quoteLinesOf = (quote) => splitLines(String(quote).replace(/^\r?\n/, "")).map(normLine);

/** Verifies a quote at a line range of a text file under `base`. Shared by file, document, output and url+snapshot. */
function verifyLines(base, ev, { inventory, requireInventory, maxBytes }) {
  const rel = ev.path;
  const c = containedPath(base, rel);
  if (c.error) return c.error;
  const r = readTextFile(c.full, rel, maxBytes);
  if (r.error) return r.error;
  const lines = splitLines(r.text);
  const loc = `${rel}:${ev.startLine ?? "?"}-${ev.endLine ?? "?"}`;

  const start = ev.startLine;
  const end = ev.endLine;
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start || end > lines.length)
    return fail("range-invalid", `lines ${start}-${end} do not exist in ${rel} (${lines.length} lines)`, { location: loc });
  if (end - start + 1 > MAX_EXCERPT_LINES)
    return fail("range-invalid", `the excerpt has ${end - start + 1} lines; the limit is ${MAX_EXCERPT_LINES}`, { location: loc });

  if (ev.redacted) {
    if (typeof ev.quote === "string" && ev.quote !== "")
      return fail("secret-in-quote", "redacted evidence must not store a quote", { location: loc });
    const cited = lines.slice(start - 1, end).join("\n");
    if (!hasSecretKind(cited, ev.secretKind))
      return fail("quote-mismatch", `no secret of kind "${ev.secretKind}" at the cited lines`, { location: loc });
    return pass({ location: loc, message: `redacted ${ev.secretKind}` });
  }

  const cited = lines.slice(start - 1, end).map(normLine);
  const quoted = quoteLinesOf(ev.quote);
  if (cited.length !== quoted.length || cited.some((l, i) => l !== quoted[i])) {
    const where = locateQuote(lines, quoted);
    const hint = where.length ? ` The quote appears at lines ${where.join(", ")}.` : " The quote does not appear in the file.";
    const shown = scanString(cited.join("\n")).length ? "[withheld: looks like a secret]" : JSON.stringify(cited.join("\n").slice(0, 300));
    return fail("quote-mismatch", `lines ${start}-${end} of ${rel} read: ${shown}.${hint}`, { location: loc });
  }
  const secrets = scanString(ev.quote);
  if (secrets.length) return fail("secret-in-quote", `the quote looks like a secret (${secrets.join(", ")}); cite it with redacted: true`, { location: loc });

  if (inventory) {
    const entry = inventory.files.find((f) => f.path === rel.replace(/\\/g, "/"));
    if (entry && entry.sha256 !== r.sha) return fail("drift", `${rel} changed since the inventory; run inventory and verify again`, { location: loc });
    if (!entry && requireInventory) return fail("drift", `${rel} is not in the inventory (new or out of scope); run inventory and verify again`, { location: loc });
  }
  return pass({ location: loc, excerptSha256: sha256(cited.join("\n")) });
}

/** Cost bound for absence patterns: no nesting of quantifiers, no backreferences, short. */
export function patternProblem(pattern, flags = "") {
  if (typeof pattern !== "string" || !pattern) return "pattern is empty";
  if (pattern.length > MAX_PATTERN_LENGTH) return `pattern is longer than ${MAX_PATTERN_LENGTH} characters`;
  if (/\\[1-9]|\\k</.test(pattern)) return "backreferences are not allowed";
  if (/\([^()]*[+*][^()]*\)[+*{]/.test(pattern) || /\([^()]*\{\d+,\d*\}[^()]*\)[+*{]/.test(pattern)) return "nested quantifiers can backtrack without bound";
  if (/\(\?<?[=!]/.test(pattern)) return "lookaround is not allowed";
  try {
    new RegExp(pattern, flags);
  } catch (e) {
    return `not a valid regular expression (${e.message})`;
  }
  return null;
}

function verifyAbsence(ev, { root, inventory }) {
  const problem = patternProblem(ev.pattern, ev.flags ?? "");
  if (problem) return fail("pattern-too-costly", problem);
  const files = (inventory?.files ?? listFiles(root)).map((f) => f.path).filter((p) => matchAny(ev.scope, p));
  if (!files.length) return fail("scope-empty", `the scope ${JSON.stringify(ev.scope)} matches no file`);
  const re = new RegExp(ev.pattern, ev.flags ?? "");
  const matches = [];
  let budget = MAX_ABSENCE_BYTES;
  let total = 0;
  for (const rel of files) {
    const c = containedPath(root, rel);
    if (c.error) continue;
    let text;
    try {
      const st = statSync(c.full);
      if (st.size > MAX_FILE_BYTES) continue;
      budget -= st.size;
      if (budget < 0) return fail("pattern-too-costly", `the scope covers more than ${MAX_ABSENCE_BYTES} bytes`);
      text = decodeText(readFileSync(c.full));
    } catch {
      continue;
    }
    if (text === null) continue;
    splitLines(text).forEach((line, i) => {
      if (re.test(line.slice(0, MAX_LINE_CHARS))) {
        total++;
        if (matches.length < MAX_SHOWN_MATCHES) {
          const shown = scanString(line).length ? "[line withheld: looks like a secret]" : line.trim().slice(0, 120);
          matches.push(`${rel}:${i + 1}: ${shown}`);
        }
      }
    });
  }
  if (total) return fail("absence-violated", `the pattern matches ${total} line(s) in the scope; first matches below`, { matches, location: ev.scope.join(", ") });
  return pass({ location: ev.scope.join(", "), message: `not found in ${files.length} file(s) of the scope` });
}

/** Lists text files without an inventory (only used when verify runs before any inventory exists). */
function listFiles(root) {
  const out = [];
  const walk = (dir, prefix) => {
    for (const name of readdirSync(dir).sort()) {
      if (name === ".git" || name === "node_modules") continue;
      const full = join(dir, name);
      const st = lstatSync(full);
      if (st.isDirectory()) walk(full, `${prefix}${name}/`);
      else if (st.isFile()) out.push({ path: `${prefix}${name}` });
    }
  };
  walk(root, "");
  return out;
}

function verifyOutput(ev, { outDir, captures }) {
  const evidenceDir = join(outDir, "evidence");
  if (!existsSync(evidenceDir)) return fail("not-found", "no evidence folder; save the command output under <out>/evidence/ first");
  const c = containedPath(evidenceDir, ev.path.replace(/^evidence[\\/]/, ""));
  if (c.error) return c.error;
  const r = readTextFile(c.full, ev.path, MAX_FILE_BYTES);
  if (r.error) return r.error;
  const rec = captures?.[ev.path.replace(/\\/g, "/")] ?? captures?.[`evidence/${ev.path.replace(/^evidence[\\/]/, "")}`];
  if (!rec) return fail("drift", `no capture record for ${ev.path}; run: assess.mjs capture --file ${ev.path} --command "<command>"`);
  if (rec.sha256 !== r.sha) return fail("drift", `${ev.path} changed since it was captured`);
  const q = quoteLinesOf(ev.quote);
  const lines = splitLines(r.text);
  const hits = locateQuote(lines, q);
  if (!hits.length) return fail("quote-mismatch", `the quote was not found in ${ev.path}`);
  const secrets = scanString(ev.quote);
  if (secrets.length) return fail("secret-in-quote", `the quote looks like a secret (${secrets.join(", ")})`);
  return pass({ location: `${ev.path}:${hits[0]}`, message: "the saved output matches its capture; the command was not re-run", excerptSha256: sha256(q.join("\n")) });
}

/**
 * Verifies every evidence item and the free-text strings of the assessment.
 * @returns {{results: object[], controls: object[], problems: object[], failed: boolean}}
 */
export function verifyAssessment(assessment, { root, outDir, inventory = null, captures = null, catalogs = {}, maxBytes = MAX_FILE_BYTES }) {
  const results = [];
  for (const ev of assessment.evidence ?? []) {
    let r;
    try {
      switch (ev.kind) {
        case "file":
        case "document":
          r = verifyLines(root, ev, { inventory, requireInventory: Boolean(inventory), maxBytes });
          break;
        case "absence":
          r = verifyAbsence(ev, { root, inventory });
          break;
        case "output":
          r = verifyOutput(ev, { outDir, captures });
          break;
        case "url":
          // Never fetched. Only a snapshot saved by the user can be checked, and then as a file.
          if (ev.snapshot) {
            if (!Number.isInteger(ev.startLine) || !Number.isInteger(ev.endLine))
              r = fail("range-invalid", "a url with a snapshot needs startLine and endLine");
            else r = verifyLines(join(outDir, "evidence"), { ...ev, path: ev.snapshot.replace(/^evidence[\\/]/, "") }, { inventory: null, maxBytes });
          } else r = unchecked("URL recorded; it is never fetched and no snapshot was provided");
          break;
        case "statement":
          r = unchecked(`statement by ${ev.source} on ${ev.date}; nothing to check by code`);
          break;
        default:
          r = fail("not-found", `unknown evidence kind "${ev.kind}"`);
      }
    } catch (e) {
      r = fail("not-found", `could not read the evidence: ${e.message}`);
    }
    results.push({ evidence: ev.id, kind: ev.kind, ...r });
  }

  // Secret scan of every string of the assessment (except the engine's own verification block).
  const problems = [];
  const { verification, ...content } = assessment;
  for (const hit of scanValue(content)) {
    const m = hit.path.match(/^evidence\[(\d+)\]\./);
    const ev = m ? assessment.evidence[Number(m[1])] : null;
    const res = ev ? results.find((r) => r.evidence === ev.id) : null;
    if (res && res.status !== "fail") Object.assign(res, fail("secret-in-quote", `${hit.path} looks like a secret (${hit.kind}); use redacted: true`, { location: res.location }));
    else if (!res) problems.push({ code: "secret-in-quote", where: hit.path, message: `looks like a secret (${hit.kind}); remove it` });
  }

  // Control IDs against a user-supplied catalog, when there is one.
  const controls = [];
  for (const f of assessment.findings ?? []) {
    for (const c of f.controls ?? []) {
      const cat = catalogs[c.framework];
      if (cat === undefined) controls.push({ finding: f.id, framework: c.framework, controlId: c.controlId, status: "unchecked" });
      else controls.push({ finding: f.id, framework: c.framework, controlId: c.controlId, status: catalogHas(cat, c.controlId) ? "pass" : "fail" });
    }
  }
  for (const c of controls)
    if (c.status === "fail") problems.push({ code: "control-not-in-catalog", where: c.finding, message: `${c.framework} control ${c.controlId} is not in the supplied catalog` });

  const failed = results.some((r) => r.status === "fail") || problems.length > 0;
  return { results, controls, problems, failed };
}

/** A catalog is a JSON list of control IDs, or any text the IDs can be found in (whole-token match). */
export function parseCatalog(text) {
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return { ids: new Set(parsed.map(String)), text: null };
    if (parsed && typeof parsed === "object") return { ids: new Set(Object.keys(parsed)), text: null };
  } catch {
    // plain text
  }
  return { ids: null, text };
}

export function catalogHas(cat, controlId) {
  if (cat.ids) return cat.ids.has(controlId);
  const esc = controlId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^A-Za-z0-9_.-])${esc}($|[^A-Za-z0-9_-])`, "m").test(cat.text);
}
