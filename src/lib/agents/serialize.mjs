// The only way a value from an agent source reaches a YAML or TOML output. Keys are fixed by the
// converter; values are written as quoted, escaped strings, so a value cannot add a key, remove
// one or end a string early.

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

/** A lone surrogate cannot be written as UTF-8 or as a TOML or YAML escape. */
export const hasLoneSurrogate = (s) => LONE_SURROGATE.test(s);

const u4 = (code) => "\\u" + code.toString(16).toUpperCase().padStart(4, "0");

/**
 * A YAML scalar as a JSON-style double-quoted string. JSON leaves DEL, the C1 controls (U+0085
 * is a YAML line break) and U+2028/U+2029 (YAML line breaks as well) as they are, so they are
 * escaped here.
 */
export function yamlString(value) {
  if (hasLoneSurrogate(value)) throw new RangeError("a lone surrogate cannot be written");
  return JSON.stringify(value).replace(/[\u007F-\u009F\u2028\u2029\u202A-\u202E\u2066-\u2069]/g, (ch) => u4(ch.charCodeAt(0)));
}

const TOML_ESCAPES = { "\b": "\\b", "\t": "\\t", "\n": "\\n", "\f": "\\f", "\r": "\\r", '"': '\\"', "\\": "\\\\" };

function tomlEscape(value, { keepNewlines }) {
  if (hasLoneSurrogate(value)) throw new RangeError("a lone surrogate cannot be written");
  let out = "";
  for (const ch of value) {
    const code = ch.codePointAt(0);
    if (ch === "\n" && keepNewlines) out += "\n";
    else if (TOML_ESCAPES[ch]) out += TOML_ESCAPES[ch];
    else if (code < 0x20 || (code >= 0x7f && code <= 0x9f) || code === 0x2028 || code === 0x2029 || (code >= 0x202a && code <= 0x202e) || (code >= 0x2066 && code <= 0x2069)) out += u4(code);
    else out += ch;
  }
  return out;
}

/** A TOML basic string, on one line. */
export const tomlString = (value) => `"${tomlEscape(value, { keepNewlines: false })}"`;

/**
 * A TOML basic multi-line string. The first newline after the opening quotes is not part of the
 * value, so the text follows it directly; every `"` is escaped, so `"""` cannot end the string.
 */
export const tomlMultiline = (value) => `"""\n${tomlEscape(value, { keepNewlines: true })}"""`;
