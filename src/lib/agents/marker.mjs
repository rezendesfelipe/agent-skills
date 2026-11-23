// The install marker: the last line of every agent file the CLI writes. It records the version
// of the CLI, the SHA-256 of everything before it and, when the agent was installed with broader
// access than its source asks, `broadened=tools`.
//
// It detects edits. It is NOT authentication: anyone who can write the file can forge a valid
// marker (design, Decision 4).
import { createHash } from "node:crypto";
import { normalizeText } from "../frontmatter.mjs";

const BODY = "sha256=([0-9a-fA-F]{64}) version=([0-9A-Za-z.+-]+)(?: (broadened=tools))?";
const PATTERNS = {
  md: new RegExp(`^<!-- agent-skills: ${BODY} -->$`),
  toml: new RegExp(`^# agent-skills: ${BODY}$`),
};

/** "md" for Markdown agent files, "toml" for Codex. */
export const markerFormat = (ext) => (ext === ".toml" ? "toml" : "md");

export const sha256 = (text) => createHash("sha256").update(text, "utf8").digest("hex");

/** @param {string} content text before the marker, LF line endings, ending with a newline */
export function markerLine(format, content, { version, broadened = false }) {
  if (!/^[0-9A-Za-z.+-]+$/.test(version)) throw new RangeError(`version "${version}" cannot be written in a marker`);
  const body = `sha256=${sha256(content)} version=${version}${broadened ? " broadened=tools" : ""}`;
  return format === "toml" ? `# agent-skills: ${body}` : `<!-- agent-skills: ${body} -->`;
}

/** Appends the marker line. `content` is normalized to LF and a final newline first. */
export function stamp(content, format, { version, broadened = false }) {
  let text = normalizeText(content);
  if (!text.endsWith("\n")) text += "\n";
  return text + markerLine(format, text, { version, broadened }) + "\n";
}

/**
 * Reads the marker from the last non-empty line, and only when it has the exact form.
 * @returns {{marked: boolean, intact?: boolean, version?: string, broadened?: boolean}}
 *   intact: the content before the marker still has the recorded hash.
 */
export function inspect(fileText, format) {
  const lines = normalizeText(fileText).split("\n");
  while (lines.length && lines.at(-1).trim() === "") lines.pop();
  if (!lines.length) return { marked: false };
  const m = lines.at(-1).match(PATTERNS[format]);
  if (!m) return { marked: false };
  const before = lines.slice(0, -1).join("\n") + (lines.length > 1 ? "\n" : "");
  return {
    marked: true,
    intact: sha256(before) === m[1].toLowerCase(),
    version: m[2],
    broadened: m[3] === "broadened=tools",
  };
}
