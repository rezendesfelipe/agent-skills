// Reads an agent source file (Claude Code's subagent format) into the fields conversion needs.
import { readFileSync } from "node:fs";
import { parseDocument } from "../frontmatter.mjs";

/**
 * @param {string} text contents of plugins/<plugin>/agents/<name>.md
 * @returns {null | {text: string, body: string, keys: string[], name: string, description: string,
 *   tools: string[]|null, disallowed: string[], model: string|undefined, skills: string[]}}
 */
export function agentFromText(text) {
  const doc = parseDocument(text);
  if (!doc) return null;
  return {
    text: doc.text,
    body: doc.body,
    keys: doc.keys,
    name: doc.scalar("name") ?? "",
    description: doc.scalar("description") ?? "",
    tools: doc.has("tools") ? doc.list("tools") : null,
    disallowed: doc.has("disallowedTools") ? doc.list("disallowedTools") : [],
    model: doc.has("model") ? doc.scalar("model") : undefined,
    skills: doc.has("skills") ? doc.list("skills") : [],
  };
}

export const loadAgent = (file) => agentFromText(readFileSync(file, "utf8"));
