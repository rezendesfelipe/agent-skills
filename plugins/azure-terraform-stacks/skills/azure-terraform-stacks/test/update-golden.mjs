// Regenerates test/golden/<fixture>/ from the fixtures. Review the diff before committing.
import { rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { HERE, FIXTURES, manifestOf } from "./helpers.mjs";
import { generateAll } from "../scripts/lib/generate.mjs";
import { generateDiagrams } from "../scripts/lib/diagram.mjs";

for (const f of FIXTURES) {
  const out = join(HERE, "golden", f);
  rmSync(out, { recursive: true, force: true });
  const m = manifestOf(f);
  const files = generateAll(m);
  if (m.profile === "private-aks-postgres") for (const [p, c] of generateDiagrams(m, { all: true }).files) files.set(p, c);
  for (const [p, c] of files) { mkdirSync(dirname(join(out, p)), { recursive: true }); writeFileSync(join(out, p), c); }
  console.log(`${f}: ${files.size} files`);
}
