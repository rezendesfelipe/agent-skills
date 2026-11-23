// Repository checks for skills and the plugin marketplace manifest.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { parseFrontmatter } from "./frontmatter.mjs";
import { subdirs } from "./catalog.mjs";

// Paths in messages always use "/" so output is the same on every OS.
const relPath = (root, p) => relative(root, p).split(sep).join("/");

const NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export function validateSkill(skillDir, { root, expectedName = skillDir.split(/[\\/]/).pop() }) {
  const rel = (p) => relPath(root, p);
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

// A Claude Code subagent shipped by a plugin: plugins/<plugin>/agents/<name>.md.
// Stricter than Claude Code on two points: `name` is at most 64 characters and `tools` is required,
// because an agent without `tools` inherits every tool of the session.
export function validateAgent(file, { root }) {
  const rel = relPath(root, file);
  const out = [];
  const fm = parseFrontmatter(readFileSync(file, "utf8"));
  if (!fm) return [`${rel}: missing YAML frontmatter`];
  const expected = file.split(/[\\/]/).pop().replace(/\.md$/, "");
  if (!fm.name) out.push(`${rel}: frontmatter is missing "name"`);
  else {
    if (!NAME_RE.test(fm.name)) out.push(`${rel}: name "${fm.name}" must be kebab-case`);
    if (fm.name.length > 64) out.push(`${rel}: name is longer than 64 characters`);
    if (fm.name !== expected) out.push(`${rel}: name "${fm.name}" does not match the file name "${expected}"`);
  }
  if (!fm.description) out.push(`${rel}: frontmatter is missing "description"`);
  else if (fm.description.length > 1024) out.push(`${rel}: description is longer than 1024 characters`);
  if (!fm.tools) out.push(`${rel}: frontmatter is missing "tools" (an agent without it inherits every tool of the session)`);
  return out;
}

/** @returns {{errors: string[], skillCount: number, agentCount: number}} */
export function validateRepo(root, { template = "skill-name" } = {}) {
  const rel = (p) => relPath(root, p);
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

  // Subagents, and unique names across plugins
  let agentCount = 0;
  const agentsByName = new Map();
  for (const plugin of subdirs(pluginsDir)) {
    const agentsDir = join(pluginsDir, plugin, "agents");
    if (!existsSync(agentsDir)) continue;
    for (const f of readdirSync(agentsDir).filter((x) => x.endsWith(".md")).sort()) {
      agentCount++;
      const file = join(agentsDir, f);
      errors.push(...validateAgent(file, { root }));
      const name = parseFrontmatter(readFileSync(file, "utf8"))?.name ?? f.replace(/\.md$/, "");
      if (!agentsByName.has(name)) agentsByName.set(name, []);
      agentsByName.get(name).push(rel(file));
    }
  }
  for (const [name, files] of agentsByName) {
    if (files.length > 1) errors.push(`agent name "${name}" is used more than once: ${files.join(", ")}`);
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
  return { errors, skillCount, agentCount };
}
