// Converts an agent written in Claude Code's subagent format into the file of each supported tool.
//
// Nothing here touches the disk. The result says whether the agent is carried or refused, what
// was dropped, and the exact file content. An agent never gets more access than its author gave
// it: when a tool cannot express the restriction the agent is refused, and only
// --allow-broader-access (`allowBroader`) writes it without the restriction.
import { FORBIDDEN_AGENT_FIELDS } from "../validate.mjs";
import { agentNameProblem } from "../names.mjs";
import { TOOLS } from "../tools.mjs";
import { effectiveTools, isRestricted, restrictionFor, specifierNotes } from "./permissions.mjs";
import { markerFormat, stamp } from "./marker.mjs";
import { hasLoneSurrogate, tomlMultiline, tomlString, yamlString } from "./serialize.mjs";

// Fields translated or handled by the converter; every other key of the source is Claude-only.
const HANDLED_FIELDS = new Set(["name", "description", "tools", "disallowedTools", "skills"]);

export const READ_ONLY_NOTE = "Cursor's read-only mode also allows commands that do not change state.";

const frontmatter = (lines) => `---\n${lines.join("\n")}\n---\n`;
const yamlList = (key, values) => [`${key}:`, ...values.map((v) => `  - ${yamlString(v)}`)];

/**
 * @param {ReturnType<import("./model.mjs").agentFromText>} agent
 * @param {string} tool one of the ids of TOOLS
 * @param {{version: string, allowBroader?: boolean, knownSkills?: Set<string>}} options
 * @returns {{ok: true, tool: string, ext: string, content: string, dropped: string[], notes: string[],
 *   broadened: boolean, broader?: string, restricted: boolean}
 *   | {ok: false, tool: string, field: string, reason: string, message: string, bypassable: boolean}}
 */
export function convertAgent(agent, tool, { version, allowBroader = false, knownSkills } = {}) {
  const label = TOOLS[tool].label;
  const ext = TOOLS[tool].agents.ext;
  const refuse = (field, reason, bypassable = false) => ({
    ok: false,
    tool,
    field,
    reason,
    bypassable,
    message:
      `refused for ${label}: field "${field}": ${reason}` +
      (bypassable ? ". Use --allow-broader-access to install it without the restriction" : ""),
  });

  if (!agent) return refuse("frontmatter", "the file has no YAML frontmatter");
  // The same fields validation rejects, checked again for every tool, claude included.
  for (const field of FORBIDDEN_AGENT_FIELDS)
    if (agent.keys.includes(field))
      return refuse(field, "Claude Code ignores it for plugin agents but honors it for installed agents, so the installed file would be more powerful than the marketplace one");
  const problem = agentNameProblem(agent.name);
  if (problem) return refuse("name", problem);
  if (!agent.description) return refuse("description", "it is missing");
  if (!agent.body.trim()) return refuse("prompt", "the agent has no prompt");
  if ([agent.name, agent.description, agent.body, ...(agent.tools ?? [])].some(hasLoneSurrogate))
    return refuse("prompt", "the text contains a lone surrogate, which cannot be written as UTF-8");
  if (!agent.tools?.length) return refuse("tools", "it is missing or empty, and an agent without it would inherit every tool of the session");
  const { effective, specifierRemovals } = effectiveTools(agent.tools, agent.disallowed);
  if (!effective.length) return refuse("tools", "no tool is left after disallowedTools");
  if (knownSkills) {
    const unknown = agent.skills.filter((s) => !knownSkills.has(s));
    if (unknown.length) return refuse("skills", `the skill(s) ${unknown.join(", ")} are not in the catalog`);
  }

  const notes = specifierNotes(specifierRemovals);
  const restricted = isRestricted(effective);
  let restriction = restrictionFor(tool, effective);
  let broadened = false;
  let broader;
  if (restriction.mode === "refuse") {
    if (!allowBroader) return refuse(restriction.field, `${restriction.reason} (the agent allows ${effective.join(", ")})`, true);
    broadened = true;
    broader = `${label} gets no tool restriction: ${restriction.reason}, so this agent has broader access than its source asks (source allows ${effective.join(", ")})`;
    restriction = { mode: "none" };
  }

  let content;
  if (tool === "claude") {
    content = stamp(agent.text, "md", { version });
  } else {
    const { name, description, body } = agent;
    if (tool === "codex") {
      content = stamp(
        `name = ${tomlString(name)}\ndescription = ${tomlString(description)}\ndeveloper_instructions = ${tomlMultiline(body)}\n`,
        "toml",
        { version, broadened },
      );
    } else {
      const lines = [`name: ${yamlString(name)}`, `description: ${yamlString(description)}`];
      if (tool === "gemini") lines.push("kind: local");
      if (restriction.mode === "tools") lines.push(...yamlList("tools", restriction.tools));
      if (restriction.mode === "readonly") {
        lines.push("readonly: true");
        notes.push(READ_ONLY_NOTE);
      }
      content = stamp(frontmatter(lines) + body, "md", { version, broadened });
    }
  }

  const dropped =
    tool === "claude"
      ? []
      : agent.keys.filter((k) => !HANDLED_FIELDS.has(k) && !(k === "model" && (agent.model === "inherit" || agent.model === undefined)));
  if (tool !== "claude" && agent.skills.length)
    notes.push(`the skills field is not written for ${label}, which finds installed skills by itself; ${agent.skills.join(", ")} installed alongside`);
  return { ok: true, tool, ext, content, dropped, notes, broadened, broader, restricted, format: markerFormat(ext) };
}
