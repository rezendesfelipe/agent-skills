// Loading and checking answer keys and fixtures.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { validateAssessment } from "../scripts/lib/schema.mjs";
import { splitLines } from "../scripts/lib/util.mjs";

export const EVALS = fileURLToPath(new URL(".", import.meta.url));
export const MODEL_CASES = join(EVALS, "cases", "model");
// Answer keys live outside the plugin folder, which installations copy: an agent under evaluation must not find them.
export const KEYS_DIR = join(EVALS, "..", "..", "..", "..", "..", "evals", "assessment-report");
export const KEY_SCHEMA = JSON.parse(readFileSync(join(EVALS, "key.schema.json"), "utf8"));

export const caseIds = () => readdirSync(MODEL_CASES).filter((d) => /^M-\d{2}$/.test(d)).sort();
export const caseDir = (id) => join(MODEL_CASES, id);
export const loadCase = (id) => JSON.parse(readFileSync(join(caseDir(id), "case.json"), "utf8"));
export const loadKey = (id) => JSON.parse(readFileSync(join(KEYS_DIR, id, "key.json"), "utf8"));
export const fixtureRoot = (id) => join(caseDir(id), loadKey(id).root);

/** @returns {string[]} problems; empty when the key is valid and every location exists in its fixture */
export function checkKey(id, key = loadKey(id)) {
  const problems = [];
  for (const e of validateAssessment(key, KEY_SCHEMA)) problems.push(`${id}: key ${e.path} ${e.message}`);
  if (key.caseId !== id) problems.push(`${id}: key.caseId is ${key.caseId}`);
  const root = fixtureRoot(id);
  const places = [
    ...key.flaws.map((x) => [x.id, x.locations]),
    ...key.decoys.map((x) => [x.id, x.locations]),
    ...key.notVerifiable.map((x) => [x.id, x.locations]),
  ];
  for (const [what, locs] of places)
    for (const l of locs) {
      const p = join(root, l.path);
      if (!existsSync(p)) {
        problems.push(`${id} ${what}: ${l.path} does not exist in the fixture`);
        continue;
      }
      const lines = splitLines(readFileSync(p, "utf8"));
      if (l.startLine < 1 || l.endLine < l.startLine || l.endLine > lines.length)
        problems.push(`${id} ${what}: lines ${l.startLine}-${l.endLine} are outside ${l.path} (${lines.length} lines)`);
      else if (!lines.slice(l.startLine - 1, l.endLine).join("\n").includes(l.anchor))
        problems.push(`${id} ${what}: anchor "${l.anchor}" is not in ${l.path}:${l.startLine}-${l.endLine}`);
    }
  if (key.injection && !existsSync(join(root, key.injection.path))) problems.push(`${id}: injection file ${key.injection.path} is missing`);
  if (key.fakeSecret) {
    const p = join(root, key.fakeSecret.path);
    const lines = existsSync(p) ? splitLines(readFileSync(p, "utf8")) : [];
    if (!(lines[key.fakeSecret.line - 1] ?? "").includes(key.fakeSecret.marker)) problems.push(`${id}: the fake secret marker is not at ${key.fakeSecret.path}:${key.fakeSecret.line}`);
  }
  if (!key.decoys.length && !key.noDecoysReason) problems.push(`${id}: the key lists no decoy and gives no noDecoysReason`);
  return problems;
}
