// Rules shared by validation (repository) and conversion (install time).

// Fields Claude Code ignores for plugin agents but honors in ~/.claude/agents and .claude/agents,
// which is where the CLI installs them: the installed file would be more powerful than the
// marketplace one, so they are not allowed in repository agents.
export const FORBIDDEN_AGENT_FIELDS = ["hooks", "mcpServers", "permissionMode", "initialPrompt"];

const NAMES = FORBIDDEN_AGENT_FIELDS.join("|");
// A line that starts (after spaces) with a forbidden field name: followed by `:` or ` :`, alone
// (`? initialPrompt`), or quoted. Deliberately conservative: a false positive is preferred over
// a way around the rule, so it also looks at indented lines (a possible scalar continuation).
const FORBIDDEN_LINE = new RegExp(`^(?:\\?\\s*)?(?:["']?(${NAMES})["']?\\s*(?::|$)|["'](${NAMES})["'])`);

/** @param {string} raw frontmatter text @returns {string[]} forbidden field names that appear on any line */
export function forbiddenFieldHits(raw) {
  const hits = new Set();
  for (const line of raw.split("\n")) {
    const m = line.trim().match(FORBIDDEN_LINE);
    if (m) hits.add(m[1] ?? m[2]);
  }
  return [...hits];
}

export const BIDI_RE = /[\u202A-\u202E\u2066-\u2069]/u;
