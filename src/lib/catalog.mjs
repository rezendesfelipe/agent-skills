// Finds the skills bundled under <root>/plugins/<plugin>/skills/<skill>/SKILL.md.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { parseFrontmatter } from "./frontmatter.mjs";

export function subdirs(path) {
  if (!existsSync(path)) return [];
  return readdirSync(path)
    .filter((d) => !d.startsWith(".") && statSync(join(path, d)).isDirectory())
    .sort();
}

/** @returns {{name: string, plugin: string, description: string, dir: string}[]} sorted by name */
export function findSkills(root) {
  const skills = [];
  const pluginsDir = join(root, "plugins");
  for (const plugin of subdirs(pluginsDir)) {
    const skillsDir = join(pluginsDir, plugin, "skills");
    for (const folder of subdirs(skillsDir)) {
      const dir = join(skillsDir, folder);
      const file = join(dir, "SKILL.md");
      if (!existsSync(file)) continue;
      const fm = parseFrontmatter(readFileSync(file, "utf8")) ?? {};
      skills.push({ name: fm.name || folder, plugin, description: fm.description || "", dir });
    }
  }
  return skills.sort((a, b) => a.name.localeCompare(b.name));
}
