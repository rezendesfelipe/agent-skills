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
