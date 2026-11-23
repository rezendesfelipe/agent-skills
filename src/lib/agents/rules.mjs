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
  for (const line of raw.split(/[\n\r\u0085\u2028\u2029]/)) {
    const m = line.trim().match(FORBIDDEN_LINE);
    if (m) hits.add(m[1] ?? m[2]);
  }
  return [...hits];
}

export const BIDI_RE = /[\u202A-\u202E\u2066-\u2069]/u;

const hexOf = (ch) => "U+" + ch.codePointAt(0).toString(16).toUpperCase().padStart(4, "0");
// A decoded single-line value (name, tools entry, ...) may not hold any control or separator (a line break is reported on its own).
const VALUE_CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u2028\u2029]/u;

/**
 * Control and line-separator characters anywhere in the frontmatter: as written, and inside the
 * decoded value of every field the converter reads. One function for validation and conversion,
 * so the converter does not depend on validation having run.
 * @param {{badChars: string[], scalar(k: string): string|undefined, list(k: string): string[]|undefined, has(k: string): boolean}} doc
 * @returns {string[]} problems, without the file name
 */
export function frontmatterCharProblems(doc) {
  const out = doc.badChars.map(
    (ch) => `the frontmatter contains the control or line-separator character ${hexOf(ch)}, which YAML may read as a line break and so hide a field`,
  );
  for (const key of ["name", "description", "model"]) {
    const value = doc.scalar(key);
    if (value && /[\r\n]/.test(value)) out.push(`${key} must be on one line`);
    const bad = value?.match(VALUE_CONTROL);
    if (bad) out.push(`${key} contains the control or line-separator character ${hexOf(bad[0])}`);
  }
  for (const key of ["tools", "disallowedTools", "skills"]) {
    for (const entry of doc.has(key) ? doc.list(key) : []) {
      const bad = entry.match(VALUE_CONTROL) ?? entry.match(/[\r\n]/);
      if (bad) out.push(`an entry of "${key}" contains the control or line-separator character ${hexOf(bad[0])}`);
    }
  }
  return out;
}
