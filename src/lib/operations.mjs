// Plans and runs `add` and `remove` for skills and agents. Everything that can refuse an agent is
// decided in the plan, before any file is written, so a refused agent leaves nothing behind (not
// even the skills it depends on).
import { existsSync } from "node:fs";
import { join } from "node:path";
import { agentOverlaps, TOOLS, skillsDir } from "./tools.mjs";
import { OK_STATUSES, install, planTargets, readMarker, remove } from "./install.mjs";
import { loadAgent } from "./agents/model.mjs";
import { convertAgent } from "./agents/convert.mjs";
import { isInstalledAgentFile, removeAgentFile, resolveAgentTarget, targetKind, writeAgentFile } from "./agents/files.mjs";

/**
 * @typedef {object} Entry one planned operation
 * @property {"skill"|"agent"} kind
 * @property {string} name
 * @property {string[]} tools
 * @property {string} path
 * @property {boolean} [dependency] a skill installed because an agent lists it
 * @property {string[]} [requiredBy]
 * @property {object} [item] catalog item
 * @property {object} [conversion] result of convertAgent for an agent
 * @property {string} [refused] reason, when the agent cannot be installed for this tool
 */

/** Plan for `add`: explicit skills, then the skills agents depend on, then the agents. */
export function planAdd({ items, tools, scope, env, catalog, version, allowBroader = false, force = false }) {
  const skills = new Map(catalog.filter((i) => i.kind === "skill").map((i) => [i.name, i]));
  const knownSkills = new Set(skills.keys());
  const entries = planTargets(items.filter((i) => i.kind === "skill"), tools, scope, env).map((t) => ({
    kind: "skill",
    name: t.skill.name,
    item: t.skill,
    tools: t.tools,
    path: t.path,
    dependency: false,
  }));
  const byPath = new Map(entries.map((e) => [e.path, e]));

  const agentEntries = [];
  const dependencyEntries = [];
  for (const item of items.filter((i) => i.kind === "agent")) {
    let agent = null;
    let readError;
    try {
      agent = loadAgent(item.file);
    } catch (e) {
      readError = `cannot read ${item.file}: ${e.message}`;
    }
    for (const tool of tools) {
      const target = resolveAgentTarget(tool, scope, env, item.name);
      const entry = {
        kind: "agent",
        name: item.name,
        item,
        tools: [tool],
        path: target.ok ? target.path : join(env.home, TOOLS[tool].agents.user, item.name + TOOLS[tool].agents.ext),
        target,
      };
      if (!target.ok) entry.refused = `refused for ${TOOLS[tool].label}: field "name": ${target.reason}`;
      else if (readError) entry.refused = `refused for ${TOOLS[tool].label}: ${readError}`;
      else {
        const conversion = convertAgent(agent, tool, { version, allowBroader, knownSkills });
        entry.conversion = conversion;
        if (!conversion.ok) entry.refused = conversion.message;
        else entry.skills = agent.skills;
      }
      agentEntries.push(entry);
    }
  }

  // Skills only for the (agent, tool) pairs that are going to be written.
  for (const e of agentEntries) {
    if (e.refused || !e.skills?.length) continue;
    const kind = targetKind(e.path);
    if (kind === "symlink" || kind === "other" || (kind === "file" && !force)) continue; // will be skipped
    const tool = e.tools[0];
    for (const skill of e.skills) {
      const path = join(skillsDir(tool, scope, env), skill);
      let dep = byPath.get(path);
      if (!dep) {
        dep = { kind: "skill", name: skill, item: skills.get(skill), tools: [], path, dependency: true, requiredBy: [] };
        byPath.set(path, dep);
        dependencyEntries.push(dep);
      }
      if (!dep.tools.includes(tool)) dep.tools.push(tool);
      if (dep.dependency && !dep.requiredBy.includes(e.name)) dep.requiredBy.push(e.name);
    }
  }
  return [...entries, ...dependencyEntries, ...agentEntries];
}

/** Runs a plan. @returns {object[]} results, one per entry, in plan order */
export function runAdd(entries, { force = false, dryRun = false, version, hooks } = {}) {
  return entries.map((e) => {
    const base = { kind: e.kind, name: e.name, skill: e.name, tools: e.tools, path: e.path };
    if (e.kind === "skill") {
      if (e.dependency) {
        if (existsSync(e.path))
          return { ...base, dependency: true, requiredBy: e.requiredBy, status: "present", message: `already installed; left as it is (needed by ${e.requiredBy.join(", ")})` };
        return { ...base, dependency: true, requiredBy: e.requiredBy, ...install({ skill: e.item, tools: e.tools, path: e.path }, { force: false, dryRun, version }) };
      }
      return { ...base, ...install({ skill: e.item, tools: e.tools, path: e.path }, { force, dryRun, version }) };
    }
    if (e.refused) return { ...base, status: "refused", message: e.refused };
    const c = e.conversion;
    const r = writeAgentFile(e.target, c.content, { force, dryRun, hooks });
    return {
      ...base,
      ...r,
      ...(c.dropped.length ? { dropped: c.dropped } : {}),
      ...(c.notes.length ? { notes: c.notes } : {}),
      ...(c.broadened ? { broader: c.broader } : {}),
      restricted: c.restricted,
    };
  });
}

/** Overlap notes for agents: a tool that also reads another tool's agents folder. */
export function agentOverlapNotes(results, tools, scope) {
  const written = results.filter((r) => r.kind === "agent" && OK_STATUSES.has(r.status));
  const notes = [];
  for (const o of agentOverlaps(tools, scope)) {
    const readerAgents = new Set(written.filter((r) => r.tools[0] === o.reader).map((r) => r.name));
    const shared = written.filter((r) => r.tools[0] === o.other && readerAgents.has(r.name));
    if (!shared.length) continue;
    const label = TOOLS[o.reader].label;
    const restricted = shared.filter((r) => r.restricted).map((r) => r.name);
    notes.push(
      restricted.length
        ? `${label} also reads ${o.path} and may load the ${o.other} copy of ${restricted.join(", ")} without its tool restriction, because ${label} is not documented to apply that copy's tools field. Install ${restricted.length > 1 ? "them" : "it"} for ${o.reader} only, or for ${o.other} only.`
        : `${label} also reads ${o.path}, so it may list ${shared.map((r) => r.name).join(", ")} installed for ${o.other} twice.`,
    );
  }
  return notes;
}

/** Plan for `remove`. */
export function planRemove({ items, tools, scope, env }) {
  const entries = planTargets(items.filter((i) => i.kind === "skill"), tools, scope, env).map((t) => ({
    kind: "skill",
    name: t.skill.name,
    item: t.skill,
    tools: t.tools,
    path: t.path,
  }));
  for (const item of items.filter((i) => i.kind === "agent")) {
    for (const tool of tools) {
      const target = resolveAgentTarget(tool, scope, env, item.name);
      entries.push({ kind: "agent", name: item.name, item, tools: [tool], path: target.ok ? target.path : item.name, target });
    }
  }
  return entries;
}

export function runRemove(entries, { force = false, dryRun = false } = {}) {
  return entries.map((e) => {
    const base = { kind: e.kind, name: e.name, skill: e.name, tools: e.tools, path: e.path };
    if (e.kind === "skill") return { ...base, ...remove({ skill: e.item, tools: e.tools, path: e.path }, { dryRun }) };
    if (!e.target.ok) return { ...base, status: "refused", message: e.target.reason };
    return { ...base, ...removeAgentFile(e.target, { force, dryRun }) };
  });
}

/** Skills and agents of the catalog that this CLI installed for at least one of the tools. */
export function installedItems(catalog, tools, scope, env) {
  return catalog.filter((item) =>
    tools.some((tool) => {
      if (item.kind === "skill") return readMarker(join(skillsDir(tool, scope, env), item.name));
      const target = resolveAgentTarget(tool, scope, env, item.name);
      return target.ok && isInstalledAgentFile(target.path, target.ext);
    }),
  );
}
