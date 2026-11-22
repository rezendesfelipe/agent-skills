// File planning and writing: create / update / unchanged, never overwrite without force.
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { dirname, join } from "node:path";

export const ALLOWED = [/^infra\//, /^\.github\/workflows\//, /^docs\/architecture\//];

export function planFiles(root, files) {
  const out = [];
  for (const [path, content] of files) {
    if (!ALLOWED.some((re) => re.test(path))) throw new Error(`refusing to write outside infra/, .github/workflows/ and docs/architecture/: ${path}`);
    const abs = join(root, path);
    if (!existsSync(abs)) out.push({ path, status: "create", content });
    else out.push({ path, status: readFileSync(abs, "utf8") === content ? "unchanged" : "update", content });
  }
  return out;
}

// Writes "create" entries; "update" entries only when allowed (force, or listed in allowUpdate).
export function writePlan(root, plan, { force = false, allowUpdate = () => false } = {}) {
  const written = [];
  const refused = [];
  for (const f of plan) {
    if (f.status === "unchanged") continue;
    if (f.status === "update" && !force && !allowUpdate(f.path)) { refused.push(f.path); continue; }
    const abs = join(root, f.path);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, f.content);
    if (f.path.endsWith(".sh")) chmodSync(abs, 0o755);
    written.push(f.path);
  }
  return { written, refused };
}
