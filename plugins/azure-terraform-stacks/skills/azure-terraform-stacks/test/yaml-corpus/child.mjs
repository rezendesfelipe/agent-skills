// Runs one child case in this process: node child.mjs <case> <facade|package>. Prints one JSON line.
import { pathToFileURL } from "node:url";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { childCases, parityOnlyChildCases } from "./cases.mjs";

const [name, mode] = process.argv.slice(2);
const here = dirname(fileURLToPath(import.meta.url));
// the oracle is loaded the way the engine loaded it before vendoring: an ES import of the CommonJS entry file
const Y = mode === "package" ? (await import(pathToFileURL(join(here, "..", "..", "node_modules", "yaml", "dist", "index.js")).href)).default : (await import(pathToFileURL(join(here, "..", "..", "scripts", "lib", "yaml.mjs")).href)).default;
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
