// Tool permissions of an agent: effective tools, restriction and what each tool can express.
//
// Claude Code's `disallowedTools` removes the WHOLE tool of an entry even when the entry has a
// specifier such as `Bash(git push *)` (https://code.claude.com/docs/en/sub-agents, checked
// 2026-11-23), so the effective tools are `tools` minus the base name of every entry.

/** Claude Code tool names the converter understands. Anything else cannot leave Claude Code. */
export const VOCABULARY = ["Read", "Grep", "Glob", "Edit", "Write", "Bash", "WebFetch", "WebSearch"];
export const READ_ONLY_TOOLS = new Set(["Read", "Grep", "Glob", "WebFetch", "WebSearch"]);
// Gemini CLI built-in tool names, https://geminicli.com/docs/reference/tools/ (checked 2026-11-23).
// Deliberately narrow: no read_many_files or list_directory. A narrower agent is safe, a wider one is not.
export const GEMINI_TOOL_NAMES = {
  Read: "read_file",
  Grep: "grep_search",
  Glob: "glob",
  Edit: "replace",
  Write: "write_file",
  Bash: "run_shell_command",
  WebFetch: "web_fetch",
  WebSearch: "google_web_search",
};
/** Tools that can change files or run commands: a "read-only" agent has none of them. */
export const WRITING_TOOLS = ["Edit", "Write", "Bash", "NotebookEdit"];

/** `Bash(git push *)` -> `Bash` */
export const baseName = (entry) => entry.replace(/\(.*$/s, "").trim();

/**
 * @param {string[]} tools
 * @param {string[]} disallowed
 * @returns {{effective: string[], specifierRemovals: {entry: string, tool: string}[]}}
 */
export function effectiveTools(tools = [], disallowed = []) {
  const removed = new Set(disallowed.map(baseName));
  const effective = [...new Set(tools.filter((t) => !removed.has(baseName(t))))];
  const specifierRemovals = disallowed
    .filter((entry) => entry.includes("(") && tools.some((t) => baseName(t) === baseName(entry)))
    .map((entry) => ({ entry, tool: baseName(entry) }));
  return { effective, specifierRemovals };
}

/** Restricted: the effective tools do not contain every tool of the vocabulary. */
export const isRestricted = (effective) => !VOCABULARY.every((tool) => effective.includes(tool));
export const unmappedTools = (effective) => effective.filter((tool) => !VOCABULARY.includes(tool));

export function specifierNote({ entry, tool }) {
  return (
    `disallowedTools entry "${entry}" removed the whole ${tool} tool, because Claude Code does not narrow a tool by a specifier. ` +
    `To keep ${tool} and block only some commands, use permissions.deny in settings.`
  );
}

/**
 * What a tool can do with the restriction of an agent.
 * @returns {{mode: "native"|"none"|"tools"|"readonly"|"refuse", tools?: string[], reason?: string}}
 *   native: the file keeps its own fields (Claude Code); none: nothing to restrict;
 *   tools: write this tool list; readonly: write readonly: true; refuse: cannot be expressed.
 */
export function restrictionFor(tool, effective) {
  if (tool === "claude") return { mode: "native" };
  const unmapped = unmappedTools(effective);
  if (unmapped.length)
    return { mode: "refuse", field: "tools", reason: `the tool(s) ${unmapped.join(", ")} cannot be translated outside Claude Code` };
  const restricted = isRestricted(effective);
  switch (tool) {
    case "copilot":
      return restricted ? { mode: "tools", tools: effective } : { mode: "none" };
    case "gemini":
      return restricted ? { mode: "tools", tools: effective.map((t) => GEMINI_TOOL_NAMES[t]) } : { mode: "none" };
    case "cursor": {
      if (!restricted) return { mode: "none" };
      const writing = effective.filter((t) => !READ_ONLY_TOOLS.has(t));
      if (!writing.length) return { mode: "readonly" };
      return { mode: "refuse", field: "tools", reason: `Cursor can only express a read-only agent, and the agent can use ${writing.join(", ")}` };
    }
    case "codex":
      return restricted ? { mode: "refuse", field: "tools", reason: "a Codex agent cannot restrict its tools" } : { mode: "none" };
    default:
      return { mode: "refuse", field: "tools", reason: `unknown tool "${tool}"` };
  }
}
