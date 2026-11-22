// CI only: scaffold every fixture into a temporary repository, run check --deep with the
// real tools, and, when draw.io is installed, export the diagrams and check every icon rendered.
// Usage: node test/ci-deep.mjs [--require-drawio]
import { spawnSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { ENGINE, FIXTURES, tempRepo } from "./helpers.mjs";

const requireDrawio = process.argv.includes("--require-drawio");
let failed = false;
const run = (root, ...a) => spawnSync(process.execPath, [ENGINE, ...a, "--root", root], { encoding: "utf8" });

for (const f of FIXTURES) {
  const root = tempRepo(f);
  spawnSync("git", ["init", "-q"], { cwd: root });
  const c = run(root, "check", "--deep");
  console.log(`\n=== ${f}: check --deep (exit ${c.status})\n${c.stdout}${c.stderr}`);
  if (c.status !== 0 || /skipped: .*(terraform|actionlint)/.test(c.stdout)) failed = true;

  if (!["full", "alz"].includes(f)) continue;
  const d = run(root, "diagram", "--export", "svg,png");
  console.log(`=== ${f}: diagram (exit ${d.status})\n${d.stdout}${d.stderr}`);
  const svg = join(root, "docs/architecture/prod-brs-01.svg");
  if (!existsSync(svg)) { if (requireDrawio) failed = true; continue; }
  const icons = (readFileSync(join(root, "docs/architecture/prod-brs-01.drawio"), "utf8").match(/image=img\/lib\/azure2\//g) ?? []).length;
  const embedded = (readFileSync(svg, "utf8").match(/<image\b[^>]*href="data:image\//g) ?? []).length;
  console.log(`${f}: ${icons} icons in the diagram, ${embedded} embedded images in the SVG`);
  if (embedded < icons) { console.log(`${f}: some icons did not render`); failed = true; }
  if (!existsSync(join(root, "docs/architecture/prod-brs-01.png"))) failed = true;
}
process.exit(failed ? 1 : 0);
