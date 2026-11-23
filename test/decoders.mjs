// Test-side decoders for the subset of YAML and TOML the converter emits. They are written
// independently of the serializer and are strict: a line that is not one of the emitted shapes
// throws, so an injected key or a broken string fails the test instead of being skipped.

const MARKER_MD = /^<!-- agent-skills: sha256=[0-9a-f]{64} version=\S+(?: broadened=tools)? -->$/;
const MARKER_TOML = /^# agent-skills: sha256=[0-9a-f]{64} version=\S+(?: broadened=tools)?$/;

function splitMarker(text, pattern) {
  assert(text.endsWith("\n"), "file must end with a newline");
  assert(!text.includes("\r"), "file must use LF");
  assert(!text.startsWith("\uFEFF"), "file must not start with a BOM");
  const lines = text.slice(0, -1).split("\n");
  const marker = lines.pop();
  assert(pattern.test(marker), `last line is not a marker: ${marker}`);
  return { before: lines.length ? lines.join("\n") + "\n" : "", marker };
}

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

/** Decodes `---\nkey: value\n...---\n<body><marker>` as written for Gemini, Cursor and Copilot. */
export function decodeMarkdown(text) {
  const { before, marker } = splitMarker(text, MARKER_MD);
  assert(before.startsWith("---\n"), "no frontmatter");
  const end = before.indexOf("\n---\n", 3);
  assert(end > 0, "frontmatter is not closed");
  const front = {};
  const keys = [];
  let current = null;
  for (const line of before.slice(4, end).split("\n")) {
    let m;
    if ((m = line.match(/^  - ("(?:[^"\\]|\\.)*")$/))) {
      assert(current && Array.isArray(front[current]), `list item without a list: ${line}`);
      front[current].push(JSON.parse(m[1]));
    } else if ((m = line.match(/^([a-z_]+):$/))) {
      current = m[1];
      keys.push(current);
      front[current] = [];
    } else if ((m = line.match(/^([a-z_]+): ("(?:[^"\\]|\\.)*"|true|local)$/))) {
      current = m[1];
      keys.push(current);
      front[current] = m[2] === "true" ? true : m[2] === "local" ? "local" : JSON.parse(m[2]);
    } else throw new Error(`unexpected frontmatter line: ${JSON.stringify(line)}`);
  }
  assert(new Set(keys).size === keys.length, "duplicate key");
  return { front, keys, body: before.slice(end + 5), marker };
}

const ESCAPES = { b: "\b", t: "\t", n: "\n", f: "\f", r: "\r", '"': '"', "\\": "\\" };

/** Reads a TOML basic string body starting at `i`, up to the first unescaped quote. */
function readBasic(s, i, { multiline }) {
  let out = "";
  for (; i < s.length; i++) {
    const ch = s[i];
    if (ch === '"') return [out, i];
    if (ch === "\n") {
      assert(multiline, "newline in a one-line string");
      out += ch;
    } else if (ch === "\\") {
      const n = s[++i];
      if (ESCAPES[n]) out += ESCAPES[n];
      else if (n === "u") out += String.fromCodePoint(parseInt(s.slice(i + 1, (i += 4) + 1), 16));
      else if (n === "U") out += String.fromCodePoint(parseInt(s.slice(i + 1, (i += 8) + 1), 16));
      else throw new Error(`bad escape \\${n}`);
    } else {
      const code = ch.codePointAt(0);
      assert(code >= 0x20 || ch === "\t", `raw control character U+${code.toString(16)}`);
      assert(code !== 0x7f, "raw DEL");
      out += ch;
    }
  }
  throw new Error("unterminated string");
}

/** Decodes the Codex file: name, description, developer_instructions, then the marker comment. */
export function decodeToml(text) {
  const { before, marker } = splitMarker(text, MARKER_TOML);
  const out = {};
  let i = 0;
  while (i < before.length) {
    const m = before.slice(i).match(/^([a-z_]+) = ("""\n|")/);
    assert(m, `unexpected TOML at: ${JSON.stringify(before.slice(i, i + 30))}`);
    const key = m[1];
    assert(!(key in out), `duplicate key ${key}`);
    const start = i + m[0].length;
    if (m[2] !== '"') {
      const [value, end] = readBasic(before, start, { multiline: true });
      assert(before.slice(end, end + 3) === '"""', "multi-line string must end with three quotes");
      assert(before[end + 3] === "\n", "newline after the closing quotes");
      out[key] = value;
      i = end + 4;
    } else {
      const [value, end] = readBasic(before, start, { multiline: false });
      assert(before[end + 1] === "\n", "one value per line");
      out[key] = value;
      i = end + 2;
    }
  }
  return { values: out, keys: Object.keys(out), marker };
}
