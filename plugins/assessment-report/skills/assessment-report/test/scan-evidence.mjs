// Helper: what the verifier says about a secret found in a quote (kind and place, never the value).
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { verifyAssessment } from "../scripts/lib/verify.mjs";
import { buildInventory } from "../scripts/lib/inventory.mjs";
import { file, repoCopy, tmp } from "./helpers.mjs";

export async function evidenceMessageFor(content) {
  const repo = repoCopy();
  writeFileSync(join(repo, "infra", "settings.yml"), content);
  const first = content.split("\n")[0];
  const r = verifyAssessment({ evidence: [file("E-001", "infra/settings.yml", 1, 1, first)], findings: [] }, { root: repo, outDir: tmp(), inventory: buildInventory(repo, {}) });
  const x = r.results[0];
  return { code: x.code, text: JSON.stringify(r) };
}
