// Minimal YAML frontmatter reader for SKILL.md and agent files: top-level `key: value`
// pairs, quoted values, `>` / `|` block scalars and lists of scalars. No dependencies.

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
    } else if (value === "" && /^\s+-\s/.test(lines[i + 1] ?? "")) {
      // a YAML list of scalars ("tools:" followed by "  - Read" lines) is read as "Read, Grep"
      const items = [];
      while (i + 1 < lines.length && /^\s+-\s/.test(lines[i + 1])) items.push(lines[++i].replace(/^\s+-\s+/, "").trim().replace(/^(['"])(.*)\1$/, "$2"));
      value = items.join(", ");
    } else if (/^(['"]).*\1$/.test(value)) {
      value = value.slice(1, -1);
    }
    data[key] = value.trim();
  }
  return data;
}

// ---------------------------------------------------------------------------
// Agent files. Unlike `parseFrontmatter` above, which flattens everything to strings for
// skills, this reader keeps what agent conversion needs: the set of top-level keys, scalars
// (quoted, plain or block), lists (block, flow or comma-separated), the raw frontmatter text
// and the body. Line endings are normalized to LF and a leading byte order mark is dropped.

/** LF line endings and no byte order mark. */
export function normalizeText(text) {
  return text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
}

// `.` does not match U+2028 and U+2029 in JavaScript, so [^\n] is used wherever a line may carry them.
const QUOTED = /^("(?:[^"\\]|\\[^\n])*"|'(?:[^']|'')*')\s*(?:#[^\n]*)?$/;

function unquote(s) {
  const t = s.trim();
  if (t.startsWith('"') && t.endsWith('"') && t.length >= 2) {
    try {
      return JSON.parse(t);
    } catch {
      return t.slice(1, -1); // YAML-only escapes (\x41, \e ...) are kept as written
    }
  }
  if (t.startsWith("'") && t.endsWith("'") && t.length >= 2) return t.slice(1, -1).replace(/''/g, "'");
  return t;
}

const stripComment = (s) => s.replace(/(^|\s)#[^\n]*$/, "").trimEnd();

/** Splits on commas that are not inside (), [] or quotes: `Read, Bash(git log, x)` has two entries. */
export function splitList(s) {
  const out = [];
  let depth = 0;
  let quote = null;
  let cur = "";
  for (const ch of s) {
    if (quote) {
      cur += ch;
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      cur += ch;
    } else if (ch === "(" || ch === "[") {
      depth++;
      cur += ch;
    } else if (ch === ")" || ch === "]") {
      depth = Math.max(0, depth - 1);
      cur += ch;
    } else if (ch === "," && depth === 0) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out.map((x) => unquote(x)).filter((x) => x !== "");
}

function scalarOf({ inline, rest }) {
  if (/^[>|][+-]?\d?$/.test(inline)) {
    const lines = [];
    for (const l of rest) {
      if (l !== "" && !/^\s/.test(l)) break;
      lines.push(l.trim());
    }
    return (inline.startsWith(">") ? lines.join(" ") : lines.join("\n")).trim();
  }
  const q = inline.match(QUOTED);
  if (q) return unquote(q[1]);
  const parts = [stripComment(inline)];
  for (const l of rest) if (/^\s+\S/.test(l) && !/^\s*#/.test(l) && !/^\s*-\s/.test(l)) parts.push(stripComment(l.trim()));
  return parts.filter(Boolean).join(" ");
}

function listOf(entry) {
  const { inline, rest } = entry;
  if (inline.startsWith("[")) {
    const joined = stripComment([inline, ...rest.map((l) => l.trim())].join(" ").trim());
    const m = joined.match(/^\[([\s\S]*)\]$/);
    return splitList(m ? m[1] : joined.slice(1));
  }
  if (inline === "" && rest.some((l) => /^\s*-(\s|$)/.test(l))) {
    return rest
      .map((l) => l.match(/^\s*-\s+([^\n]*)$/))
      .filter(Boolean)
      .map((m) => unquote(stripComment(m[1])))
      .filter((x) => x !== "");
  }
  return splitList(scalarOf(entry));
}

/**
 * Reads an agent file (or any Markdown file with YAML frontmatter).
 * @returns {null | {text: string, raw: string, body: string, keys: string[], duplicates: string[], unrecognized: string[],
 *   has(key: string): boolean, scalar(key: string): string|undefined, list(key: string): string[]|undefined}}
 */
export function parseDocument(input) {
  const text = normalizeText(input);
  const m = text.match(/^---\n(?:([\s\S]*?)\n)?---[ \t]*(?:\n|$)/);
  if (!m) return null;
  const raw = m[1] ?? "";
  const entries = [];
  const unrecognized = [];
  for (const line of raw.split("\n")) {
    // A top-level line that is not `key: value` (nor a comment, a blank line or a list item) is YAML
    // this reader does not understand (`key :`, a quoted key, `? key`, a flow mapping ...), so it
    // could hide a field from `keys`. It is reported and callers reject the file.
    if (line !== "" && !/^\s/.test(line) && !line.startsWith("#") && !/^-(\s|$)/.test(line) && !/^([A-Za-z0-9_-]+):(?:[ \t]|$)/.test(line))
      unrecognized.push(line);
    const kv = line.match(/^([A-Za-z0-9_-]+):(?:[ \t]+([^\n]*)|[ \t]*)$/);
    if (kv) entries.push({ key: kv[1], inline: (kv[2] ?? "").trimEnd(), rest: [] });
    else if (entries.length) entries.at(-1).rest.push(line);
  }
  const byKey = new Map();
  const duplicates = [];
  for (const e of entries) {
    if (byKey.has(e.key)) duplicates.push(e.key);
    else byKey.set(e.key, e);
  }
  return {
    text,
    raw,
    body: text.slice(m[0].length),
    keys: [...byKey.keys()],
    duplicates: [...new Set(duplicates)],
    unrecognized,
    has: (key) => byKey.has(key),
    scalar: (key) => (byKey.has(key) ? scalarOf(byKey.get(key)) : undefined),
    list: (key) => (byKey.has(key) ? listOf(byKey.get(key)) : undefined),
  };
}
