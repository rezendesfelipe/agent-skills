// Finds the skills bundled under <root>/plugins/<plugin>/skills/<skill>/SKILL.md.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { parseDocument, parseFrontmatter } from "./frontmatter.mjs";

export function subdirs(path) {
  if (!existsSync(path)) return [];
  return readdirSync(path)
    .filter((d) => !d.startsWith(".") && statSync(join(path, d)).isDirectory())
    .sort();
}

/** @returns {{kind: "skill", name: string, plugin: string, description: string, dir: string}[]} sorted by name */
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
      skills.push({ kind: "skill", name: fm.name || folder, plugin, description: fm.description || "", dir });
    }
  }
  return skills.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Agents bundled under <root>/plugins/<plugin>/agents/<name>.md (direct children only: tools
 * treat nested Markdown files as separate agents, and validation rejects them). The name comes
 * from the file name; a file whose frontmatter `name` differs is left out (validation reports it).
 * @returns {{kind: "agent", name: string, plugin: string, description: string, file: string}[]} sorted by name
 */
export function findAgents(root) {
  const agents = [];
  const pluginsDir = join(root, "plugins");
  for (const plugin of subdirs(pluginsDir)) {
    const agentsDir = join(pluginsDir, plugin, "agents");
    if (!existsSync(agentsDir)) continue;
    for (const entry of readdirSync(agentsDir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
      const file = join(agentsDir, entry.name);
      const name = entry.name.slice(0, -".md".length);
      const doc = parseDocument(readFileSync(file, "utf8"));
      if (!doc || doc.scalar("name") !== name) continue;
      agents.push({ kind: "agent", name, plugin, description: doc.scalar("description") || "", file });
    }
  }
  return agents.sort((a, b) => a.name.localeCompare(b.name));
}

/** Every skill and every agent, sorted by name. */
export function findCatalog(root) {
  return [...findSkills(root), ...findAgents(root)].sort((a, b) => a.name.localeCompare(b.name));
}
