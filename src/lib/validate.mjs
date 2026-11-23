// Repository checks for skills and the plugin marketplace manifest.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { parseDocument, parseFrontmatter } from "./frontmatter.mjs";
import { effectiveTools } from "./agents/permissions.mjs";
import { MAX_NAME_LENGTH, NAME_RE, WINDOWS_RESERVED_RE } from "./names.mjs";
import { subdirs } from "./catalog.mjs";

// Paths in messages always use "/" so output is the same on every OS.
const relPath = (root, p) => relative(root, p).split(sep).join("/");

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

// Fields Claude Code ignores for plugin agents but honors in ~/.claude/agents and .claude/agents,
// which is where the CLI installs them: the installed file would be more powerful than the
// marketplace one, so they are not allowed in repository agents.
export const FORBIDDEN_AGENT_FIELDS = ["hooks", "mcpServers", "permissionMode", "initialPrompt"];
const MAX_PROMPT_CHARS = 30000; // GitHub Copilot's limit, the smallest among the supported tools
const BIDI_RE = /[\u202A-\u202E\u2066-\u2069]/u;
// C0 and C1 controls (U+0085 included) and the Unicode line and paragraph separators
const CONTROL_RE = /[\u0000-\u001F\u007F-\u009F\u2028\u2029]/u;
const MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._:/\[\]-]*$/;
const hex = (ch) => "U+" + ch.codePointAt(0).toString(16).toUpperCase().padStart(4, "0");

// A Claude Code subagent shipped by a plugin: plugins/<plugin>/agents/<name>.md.
// Stricter than Claude Code on two points: `name` is at most 64 characters and `tools` is required,
// because an agent without `tools` inherits every tool of the session.
// `expectedName` replaces the name taken from the file name (the template uses a placeholder);
// `skillNames` is the set of skills in the catalog (when given, `skills` entries must be in it).
export function validateAgent(file, { root, expectedName, skillNames } = {}) {
  const rel = relPath(root, file);
  const out = [];
  const text = readFileSync(file, "utf8");
  const bidi = text.match(BIDI_RE);
  if (bidi) out.push(`${rel}: contains the Unicode bidirectional control character ${hex(bidi[0])}, which can make the file read differently from what the model sees`);
  const fm = parseDocument(text);
  if (!fm) return [...out, `${rel}: missing YAML frontmatter`];
  for (const key of fm.duplicates) out.push(`${rel}: frontmatter key "${key}" appears more than once`);
  const expected = expectedName ?? file.split(/[\\/]/).pop().replace(/\.md$/, "");
  const name = fm.scalar("name");
  if (!name) out.push(`${rel}: frontmatter is missing "name"`);
  else {
    if (!NAME_RE.test(name)) out.push(`${rel}: name "${name}" must be kebab-case`);
    if (name.length > MAX_NAME_LENGTH) out.push(`${rel}: name is longer than ${MAX_NAME_LENGTH} characters`);
    if (WINDOWS_RESERVED_RE.test(name)) out.push(`${rel}: name "${name}" is a Windows reserved device name and cannot be a file name there`);
    if (name !== expected) out.push(`${rel}: name "${name}" does not match the file name "${expected}"`);
  }
  const description = fm.scalar("description");
  if (!description) out.push(`${rel}: frontmatter is missing "description"`);
  else {
    if (description.length > 1024) out.push(`${rel}: description is longer than 1024 characters`);
    if (/[\r\n]/.test(description)) out.push(`${rel}: description must be on one line`);
    const bad = description.replace(/[\r\n]/g, "").match(CONTROL_RE);
    if (bad) out.push(`${rel}: description contains the control character ${hex(bad[0])}`);
  }

  // tools: required, and something must be left after disallowedTools
  if (!fm.has("tools")) out.push(`${rel}: frontmatter is missing "tools" (an agent without it inherits every tool of the session)`);
  else {
    const tools = fm.list("tools");
    const disallowed = fm.has("disallowedTools") ? fm.list("disallowedTools") : [];
    if (!tools.length) out.push(`${rel}: "tools" must list at least one tool`);
    else {
      const { effective, specifierRemovals } = effectiveTools(tools, disallowed);
      if (!effective.length) {
        out.push(
          specifierRemovals.length
            ? `${rel}: no tool is left after disallowedTools: ${specifierRemovals.map((r) => `"${r.entry}" removes the whole ${r.tool} tool (Claude Code does not narrow a tool by a specifier)`).join("; ")}`
            : `${rel}: no tool is left after disallowedTools removes every tool listed in "tools"`,
        );
      }
    }
  }
  if (fm.has("disallowedTools") && !fm.list("disallowedTools").length) out.push(`${rel}: "disallowedTools" is empty; remove the field or list tools`);

  const model = fm.scalar("model");
  if (fm.has("model") && (!model || !MODEL_RE.test(model))) out.push(`${rel}: model "${model ?? ""}" must be inherit, a Claude alias (sonnet, opus, haiku, fable) or a model id`);

  if (fm.has("skills") && skillNames) {
    for (const skill of fm.list("skills"))
      if (!skillNames.has(skill)) out.push(`${rel}: skills lists "${skill}", which is not a skill in this repository`);
  }

  for (const field of FORBIDDEN_AGENT_FIELDS) {
    if (fm.keys.includes(field))
      out.push(`${rel}: field "${field}" is not allowed in repository agents: Claude Code ignores it for plugin agents but honors it for agents in ~/.claude/agents and .claude/agents, so the installed file would be more powerful than the marketplace one`);
  }

  if (!fm.body.trim()) out.push(`${rel}: the agent has no prompt (the body after the frontmatter is empty)`);
  else {
    const length = [...fm.body].length;
    if (length > MAX_PROMPT_CHARS) out.push(`${rel}: the prompt has ${length} characters, over the limit of ${MAX_PROMPT_CHARS}`);
  }
  return out;
}

/** Markdown files below plugins/<plugin>/agents/<folder>/, which tools would treat as separate agents. */
function nestedAgentFiles(dir) {
  const found = [];
  const walk = (current, depth) => {
    for (const entry of readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) walk(path, depth + 1);
      else if (depth > 0 && entry.name.endsWith(".md")) found.push(path);
    }
  };
  walk(dir, 0);
  return found;
}

/** @returns {{errors: string[], skillCount: number, agentCount: number}} */
export function validateRepo(root, { template = "skill-name", agentTemplateName = "agent-name" } = {}) {
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
  const skillNames = new Set(byName.keys());
  for (const plugin of subdirs(pluginsDir)) {
    const agentsDir = join(pluginsDir, plugin, "agents");
    if (!existsSync(agentsDir)) continue;
    for (const nested of nestedAgentFiles(agentsDir))
      errors.push(`${rel(nested)}: agent files must be directly inside plugins/${plugin}/agents/, because tools treat nested Markdown files as separate agents`);
    for (const f of readdirSync(agentsDir, { withFileTypes: true }).filter((x) => x.isFile() && x.name.endsWith(".md")).map((x) => x.name).sort()) {
      agentCount++;
      const file = join(agentsDir, f);
      errors.push(...validateAgent(file, { root, skillNames }));
      const name = parseDocument(readFileSync(file, "utf8"))?.scalar("name") ?? f.replace(/\.md$/, "");
      if (!agentsByName.has(name)) agentsByName.set(name, []);
      agentsByName.get(name).push(rel(file));
    }
  }
  for (const [name, files] of agentsByName) {
    if (files.length > 1) errors.push(`agent name "${name}" is used more than once: ${files.join(", ")}`);
    if (byName.has(name)) errors.push(`name "${name}" is used by a skill and an agent: ${[...byName.get(name), ...files].join(", ")}`);
  }

  // Templates (validated against their placeholder names)
  const templateDir = join(root, "templates", "skill");
  if (existsSync(templateDir)) errors.push(...validateSkill(templateDir, { root, expectedName: template }));
  const agentTemplate = join(root, "templates", "agent", `${agentTemplateName}.md`);
  if (existsSync(agentTemplate)) errors.push(...validateAgent(agentTemplate, { root, expectedName: agentTemplateName, skillNames }));

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
