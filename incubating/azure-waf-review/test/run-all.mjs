// `npm test` entry point. Node 20 does not expand a glob such as test/*.test.mjs by itself, and on Windows the shell
// does not either, so the list of test files is built here and passed to `node --test`. Not a test file itself.
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = fileURLToPath(new URL(".", import.meta.url));
const files = readdirSync(dir).filter((f) => f.endsWith(".test.mjs")).sort().map((f) => join(dir, f));
if (!files.length) {
  console.error(`no *.test.mjs file found in ${dir}`);
  process.exit(1);
}
const r = spawnSync(process.execPath, ["--test", ...process.argv.slice(2), ...files], { stdio: "inherit" });
process.exit(r.status ?? 1);
