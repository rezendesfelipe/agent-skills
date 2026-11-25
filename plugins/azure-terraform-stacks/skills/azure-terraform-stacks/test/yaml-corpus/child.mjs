// Runs one child case in this process: node child.mjs <case> <facade|package>. Prints one JSON line.
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { childCases, parityOnlyChildCases } from "./cases.mjs";

const [name, mode] = process.argv.slice(2);
const here = dirname(fileURLToPath(import.meta.url));
const require_ = createRequire(join(here, "..", "..", "package.json")); // the oracle, a devDependency
const Y = mode === "package" ? require_("yaml") : (await import(pathToFileURL(join(here, "..", "..", "scripts", "lib", "yaml.mjs")).href)).default;
const build = childCases[name] ?? parityOnlyChildCases[name];
const sources = build();
const steps = sources.map((src) => {
  try {
    const v = Y.parse(src);
    return { ok: typeof v === "object" ? `object:${Object.keys(v ?? {}).length}` : String(v).length };
  } catch (e) {
    // a stack-depth message names a column that depends on the Node version and the platform: keep only name and code
    return e?.code === "RESOURCE_EXHAUSTION" ? { error: e.name, code: e.code } : { error: e?.name, code: e?.code, message: String(e?.message).split("\n")[0] };
  }
});
console.log(JSON.stringify(steps));
