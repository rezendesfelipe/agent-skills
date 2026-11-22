// Every generated file, derived from the manifest only.
import { generateTerraform } from "./gen-terraform.mjs";
import { generatePipelines } from "./gen-pipelines.mjs";
import { generateGitops } from "./gen-gitops.mjs";

export function generateAll(m) {
  const files = new Map();
  for (const part of [generateTerraform(m), generatePipelines(m), generateGitops(m)]) {
    for (const [p, c] of part) files.set(p, c);
  }
  return new Map([...files.entries()].sort(([a], [b]) => a.localeCompare(b)));
}
