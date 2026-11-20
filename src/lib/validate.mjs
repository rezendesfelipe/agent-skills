// Repository checks for skills and the plugin marketplace manifest.
import { existsSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { parseFrontmatter } from "./frontmatter.mjs";
import { subdirs } from "./catalog.mjs";

const NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export function validateSkill(skillDir, { root, expectedName = skillDir.split(/[\\/]/).pop() }) {
  const rel = (p) => relative(root, p);
  const file = join(skillDir, "SKILL.md");
  const out = [];
  if (!existsSync(file)) return [`${rel(skillDir)}: missing SKILL.md`];
  const fm = parseFrontmatter(readFileSync(file, "utf8"));
  if (!fm) return [`${rel(file)}: missing YAML frontmatter`];
  if (!fm.name) out.push(`${rel(file)}: frontmatter is missing "name"`);
  else {
    if (!NAME_RE.test(fm.name)) out.push(`${rel(file)}: name "${fm.name}" must be kebab-case`);
    if (fm.name.length > 64) out.push(`${rel(file)}: name is longer than 64 characters`);
    if (expectedName && fm.name !== expectedName)
      out.push(`${rel(file)}: name "${fm.name}" does not match folder "${expectedName}"`);
  }
  if (!fm.description) out.push(`${rel(file)}: frontmatter is missing "description"`);
  else if (fm.description.length > 1024) out.push(`${rel(file)}: description is longer than 1024 characters`);
  return out;
}

/** @returns {{errors: string[], skillCount: number}} */
export function validateRepo(root, { template = "skill-name" } = {}) {
  const rel = (p) => relative(root, p);
  const errors = [];
  const pluginsDir = join(root, "plugins");

  // Skills, and unique names across plugins
  let skillCount = 0;
  const byName = new Map();
  for (const plugin of subdirs(pluginsDir)) {
    for (const skill of subdirs(join(pluginsDir, plugin, "skills"))) {
      skillCount++;
      const dir = join(pluginsDir, plugin, "skills", skill);
      errors.push(...validateSkill(dir, { root }));
      if (!byName.has(skill)) byName.set(skill, []);
      byName.get(skill).push(rel(dir));
    }
  }
  for (const [name, dirs] of byName) {
    if (dirs.length > 1) errors.push(`skill name "${name}" is used more than once: ${dirs.join(", ")}`);
  }

  // Template (validated against its placeholder name)
  const templateDir = join(root, "templates", "skill");
  if (existsSync(templateDir)) errors.push(...validateSkill(templateDir, { root, expectedName: template }));

  // Manifest
  const manifestPath = join(root, ".claude-plugin", "marketplace.json");
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (e) {
    errors.push(`${rel(manifestPath)}: ${e.message}`);
  }
  if (manifest) {
    if (!manifest.name) errors.push(`${rel(manifestPath)}: missing "name"`);
    if (!manifest.owner?.name) errors.push(`${rel(manifestPath)}: missing "owner.name"`);
    if (!Array.isArray(manifest.plugins)) errors.push(`${rel(manifestPath)}: "plugins" must be an array`);
    else {
      const listed = new Set();
      for (const p of manifest.plugins) {
        if (!p.name || !p.source) {
          errors.push(`${rel(manifestPath)}: plugin entry needs "name" and "source": ${JSON.stringify(p)}`);
          continue;
        }
        listed.add(resolve(root, p.source));
        if (!existsSync(resolve(root, p.source)))
          errors.push(`${rel(manifestPath)}: plugin "${p.name}" source "${p.source}" does not exist`);
      }
      for (const plugin of subdirs(pluginsDir)) {
        if (!listed.has(join(pluginsDir, plugin))) errors.push(`plugins/${plugin}: not listed in ${rel(manifestPath)}`);
      }
    }
  }
  return { errors, skillCount };
}
