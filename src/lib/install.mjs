// Plans and performs skill installs and removals in agents' skills folders.
import { cpSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { skillsDir } from "./agents.mjs";

export const PACKAGE_NAME = "@frcloudsolutions/agent-skills";
export const MARKER = ".agent-skills.json";
const SKIP = new Set(["node_modules", MARKER]);

/**
 * One target per (skill, folder). Agents that resolve to the same folder share a target.
 * @returns {{skill: object, agents: string[], path: string}[]}
 */
export function planTargets(skills, agents, scope, env) {
  const targets = new Map();
  for (const skill of skills) {
    for (const agent of agents) {
      const path = join(skillsDir(agent, scope, env), skill.name);
      if (!targets.has(path)) targets.set(path, { skill, agents: [], path });
      targets.get(path).agents.push(agent);
    }
  }
  return [...targets.values()];
}

export function readMarker(path) {
  try {
    const data = JSON.parse(readFileSync(join(path, MARKER), "utf8"));
    return data?.package === PACKAGE_NAME ? data : null;
  } catch {
    return null;
  }
}

/** @returns {"installed"|"replaced"|"skipped"|"would-install"|"would-replace"} */
export function install(target, { force = false, dryRun = false, version, now = new Date() }) {
  const exists = existsSync(target.path);
  if (exists && !force) return { status: "skipped", message: "already exists (use --force to replace it)" };
  if (dryRun) return { status: exists ? "would-replace" : "would-install" };
  if (exists) rmSync(target.path, { recursive: true, force: true });
  cpSync(target.skill.dir, target.path, {
    recursive: true,
    filter: (src) => !SKIP.has(basename(src)),
  });
  const marker = { package: PACKAGE_NAME, version, skill: target.skill.name, installedAt: now.toISOString() };
  writeFileSync(join(target.path, MARKER), JSON.stringify(marker, null, 2) + "\n");
  return { status: exists ? "replaced" : "installed" };
}

/** @returns {"removed"|"would-remove"|"not-found"|"not-managed"} */
export function remove(target, { dryRun = false }) {
  if (!existsSync(target.path)) return { status: "not-found", message: "not installed here" };
  if (!readMarker(target.path)) return { status: "not-managed", message: "not installed by agent-skills; left in place" };
  if (dryRun) return { status: "would-remove" };
  rmSync(target.path, { recursive: true, force: true });
  return { status: "removed" };
}

// "not-found" counts as success: removal is idempotent, the requested end state already holds.
export const OK_STATUSES = new Set(["installed", "replaced", "would-install", "would-replace", "removed", "would-remove", "not-found"]);

/** Skills from the catalog that this CLI installed for at least one of the agents. */
export function installedSkills(catalog, agents, scope, env) {
  return catalog.filter((skill) =>
    agents.some((agent) => readMarker(join(skillsDir(agent, scope, env), skill.name))),
  );
}
