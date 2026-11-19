#!/usr/bin/env node
// Validates skills and the plugin marketplace manifest. No dependencies.
// Usage: node scripts/validate-skills.mjs [--template <dir-name>]
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname);
const errors = [];
const rel = (p) => relative(root, p);
const NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

function dirs(p) {
  if (!existsSync(p)) return [];
  return readdirSync(p).filter((d) => !d.startsWith(".") && statSync(join(p, d)).isDirectory());
}

export function parseFrontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---(\r?\n|$)/);
  if (!m) return null;
  const data = {};
  const lines = m[1].split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const kv = lines[i].match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!kv) continue;
    let [, key, value] = kv;
    if (/^[>|][+-]?$/.test(value)) {
      const block = [];
      while (i + 1 < lines.length && (/^\s+/.test(lines[i + 1]) || lines[i + 1] === "")) block.push(lines[++i].trim());
      value = block.join(value.startsWith(">") ? " " : "\n").trim();
    } else if (/^(['"]).*\1$/.test(value)) {
      value = value.slice(1, -1);
    }
    data[key] = value.trim();
  }
  return data;
}

export function validateSkill(skillDir, expectedName = skillDir.split(/[\\/]/).pop()) {
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

// Skills
const pluginsDir = join(root, "plugins");
let skillCount = 0;
for (const plugin of dirs(pluginsDir)) {
  for (const skill of dirs(join(pluginsDir, plugin, "skills"))) {
    skillCount++;
    errors.push(...validateSkill(join(pluginsDir, plugin, "skills", skill)));
  }
}

// Template (validated against its placeholder name)
errors.push(...validateSkill(join(root, "templates", "skill"), "skill-name"));

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
      if (!existsSync(resolve(root, p.source))) errors.push(`${rel(manifestPath)}: plugin "${p.name}" source "${p.source}" does not exist`);
    }
    for (const plugin of dirs(pluginsDir)) {
      if (!listed.has(join(pluginsDir, plugin))) errors.push(`plugins/${plugin}: not listed in ${rel(manifestPath)}`);
    }
  }
}

if (errors.length) {
  console.error(`✗ ${errors.length} problem(s):\n` + errors.map((e) => `  - ${e}`).join("\n"));
  process.exit(1);
}
console.log(`✓ ${skillCount} skill(s), template and marketplace manifest are valid`);
