// Regenerates golden.json: node test/yaml-corpus/update.mjs [facade|package]  (default facade).
// For the first generation it was run with `package` (the npm package) and with `facade` (the vendored copy), and the two files were identical.
import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL, fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { runAll } from "./cases.mjs";
import { childCases } from "./cases.mjs";
import { GOLDEN, runChild } from "./run.mjs";

const mode = process.argv[2] === "package" ? "package" : "facade";
const here = dirname(fileURLToPath(import.meta.url));
const require_ = createRequire(join(here, "..", "..", "package.json")); // the oracle, a devDependency
const Y = mode === "package" ? require_("yaml") : (await import(pathToFileURL(join(here, "..", "..", "scripts", "lib", "yaml.mjs")).href)).default;
const golden = { inProcess: await runAll(Y), child: {} };
for (const name of Object.keys(childCases)) golden.child[name] = runChild(name, mode);
const out = process.argv[3] ?? GOLDEN;
writeFileSync(out, JSON.stringify(golden, null, 2) + "\n");
console.log(`wrote ${out} from ${mode}`);
