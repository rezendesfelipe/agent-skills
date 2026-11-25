// Helpers shared by the corpus test, the parity test and the golden updater.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
export const GOLDEN = join(here, "golden.json");

/** One child case in its own process, with a heap limit and a generous timeout (never a tight one). */
export function runChild(name, mode) {
  const r = spawnSync(process.execPath, ["--max-old-space-size=256", join(here, "child.mjs"), name, mode], { encoding: "utf8", timeout: 120000, cwd: join(here, "..", "..") });
  let steps = null;
  try { steps = JSON.parse(r.stdout.trim().split("\n").pop()); } catch { /* the process ended without a result */ }
  return { status: r.status, signal: r.signal, steps };
}
