// Heuristic secret scanner. It cannot prove that a string is free of secrets, only catch common shapes.
// The method annex of every report says so.

const R = (kind, re) => ({ kind, re });

// What a value must not start with to count as a secret: a reference to another value, or an obvious placeholder.
export const PLACEHOLDER_SOURCE = "(?:var\\.|local\\.|data\\.|module\\.|env\\.|secrets?\\.|os\\.|process\\.|self\\.|config\\.|changeme|change-me|example|placeholder|redacted|none\\b|null\\b|true\\b|false\\b|read\\b|write\\b|x{3,}|\\*{3,}|your[_-]|my[_-]|todo|tbd)";
// Names that mean a secret. A prefix such as db_ or client. is allowed; a suffix such as _name or _id is not.
// There is no group for the prefix on purpose: the match already starts at the line start or right after a character
// that is not a letter or digit, and the separator that ends a prefix segment is such a character, so a name with a
// prefix is matched from its last segment. A repeated prefix group made the scan quadratic on a line of short tokens
// and separators.
const SECRET_NAME = "(?:password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key|secret[_-]?key|private[_-]?key|account[_-]?key|client[_-]?secret)";

const VALUE = ">?[^\\s\"'<>{}$(),;]{4,}";
// the look-ahead is bounded: an unbounded one is quadratic on a long token that holds many names and ends in "("
// A literal right after a tag, anchor or alias may be shorter than four characters, because the node name itself can be
// short ("&a", "*a"): only then is the minimum lowered. A short value on its own is still not flagged.
const SHORT_AFTER_NODE = "(?:[&*]|!!?)[A-Za-z0-9_-]+[ \\t]+[^\\s\"'<>{}$(),;]+";
const NOT_CALL = "(?![^\\s\"'<>{}$(),;]{0,256}\\()";
// Only for an unquoted value. Each form is narrow on purpose: a real password can look like a dotted word or start with
// "!", "&", "*", "|" or ">", so only what Terraform and YAML really write is excluded.
//  - a Terraform reference: a keyword prefix (var, local, data, module, each, count, path, terraform, self) with at least
//    one more segment, or a resource type that contains "_" (random_password, azurerm_key_vault_secret, aws_...) with at
//    least two more segments; segments are identifiers, each with an optional [n] or [*] index
//  - a YAML tag, anchor or alias that is the WHOLE value (only spaces or a comment after it), because the value is on the
//    next lines or defined elsewhere; a block indicator (|, >, |-, >+, |2) alone at the end of the line, also after a tag
//  - a tag, anchor or alias followed by a reference operand: !Ref or !ImportValue with one identifier, !GetAtt with a dotted
//    identifier, !Sub with an interpolation, a Terraform reference or an interpolation after any tag, anchor or alias, and a
//    flow sequence or mapping after another CloudFormation function tag (a known gap: its literals are not scanned)
//  - a word that describes a schema (required, optional, ...)
// A type tag, anchor, alias, custom tag or function tag followed by a literal on the same line is NOT excluded: it is
// flagged (a possible false positive on a non-secret literal is accepted).
const SEG = "[A-Za-z_][A-Za-z0-9_-]*(?:\\[(?:\\d+|\\*)\\])?";
const TERRAFORM_REFERENCE = `(?:(?:var|local|data|module|each|count|path|terraform|self)(?:\\[(?:\\d+|\\*)\\])?(?:\\.${SEG})+|[A-Za-z][A-Za-z0-9]*_[A-Za-z0-9_]*(?:\\[(?:\\d+|\\*)\\])?(?:\\.${SEG}){2,})(?=[\\s,;)]|$)`;
const FUNCTION_TAG = "!(?:Ref|Sub|GetAtt|Join|Select|Base64|FindInMap|ImportValue|If|Equals|Not|Or|And|Split|Cidr)";
// a tag that may stand alone: a core type, a CloudFormation function, or a well-known custom tag; "!Word" alone is not excluded
const KNOWN_TAG = `(?:!!(?:str|int|float|bool|null|seq|map|binary|set|omap|timestamp)|${FUNCTION_TAG}|!(?:vault|secret|encrypted))`;
const ANY_TAG = "(?:!!?[A-Za-z][A-Za-z_-]*|[&*][A-Za-z_-]+)";
const LINE_END = "(?=[ \\t]*(?:#|$))";
const BLOCK_INDICATOR = "[|>][-+]?\\d?";
const INTERPOLATION = "[\"']?\\$\\{";
const YAML_NODE = [
  `(?:${KNOWN_TAG}|[&*][A-Za-z_-]+)(?=[ \\t]*$|[ \\t]+#)`,
  `${KNOWN_TAG}[ \\t]+${BLOCK_INDICATOR}${LINE_END}`,
  `${BLOCK_INDICATOR}${LINE_END}`,
  `!(?:Ref|ImportValue)[ \\t]+[A-Za-z0-9_:-]+${LINE_END}`,
  `!GetAtt[ \\t]+[A-Za-z0-9_-]+(?:\\.[A-Za-z0-9_.-]+)+${LINE_END}`,
  `!Sub[ \\t]+["']?[^\\n]{0,200}?\\$\\{`,
  `${ANY_TAG}[ \\t]+(?:${INTERPOLATION}|${TERRAFORM_REFERENCE})`,
  `${FUNCTION_TAG}[ \\t]+[\\[{]`,
].join("|");
const UNQUOTED_REFERENCE = `(?:${TERRAFORM_REFERENCE}|${YAML_NODE}|(?:required|optional|sensitive|computed|string|number|bool|object|any)\\b)`;

/** Order matters only for reporting; every pattern is tried. */
export const SECRET_PATTERNS = [
  R("private-key", /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----/),
  R("aws-access-key", /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/),
  R("github-token", /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})\b/),
  R("slack-token", /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/),
  R("google-api-key", /\bAIza[0-9A-Za-z_-]{35}\b/),
  R("stripe-key", /\b[sr]k_live_[0-9A-Za-z]{16,}\b/),
  R("jwt", /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/),
  // user:password@host in a URL or connection string; references and placeholders are ignored.
  // The scheme part is bounded: an unbounded one is quadratic on a line of letters and dots.
  R("url-credential", /\b[a-z][a-z0-9+.-]{0,31}:\/\/[^\s:/@"'<>{}$]+:(?![<{$%]|var\.|local\.|\*+@)[^\s@/"'<>{}]{3,}@[^\s"']/i),
  // Azure Storage and Service Bus connection strings
  R("azure-storage-key", /\b(?:AccountKey|SharedAccessKey)=[A-Za-z0-9+/]{20,}={0,2}/),
  R("bearer-token", /\bBearer\s+(?![<{$])[A-Za-z0-9._~+/-]{20,}=*/),
  // shared access signature in a URL
  R("sas-signature", /[?&]sig=[A-Za-z0-9%+/=]{16,}/),
  // name = "value" or name: value for names that mean a secret. The value may be short or letters only.
  R("generic-credential", new RegExp(`(?:^|[^A-Za-z0-9])${SECRET_NAME}["']?\\s*[:=]\\s*(?:["'](?!${PLACEHOLDER_SOURCE})${NOT_CALL}${VALUE}|(?!${PLACEHOLDER_SOURCE})(?!${UNQUOTED_REFERENCE})${NOT_CALL}(?:${VALUE}|${SHORT_AFTER_NODE}))`, "im")),
];

export const SECRET_KINDS = SECRET_PATTERNS.map((p) => p.kind);

// A line longer than MAX_SCAN_LINE_CHARS is scanned in overlapping windows, never truncated or skipped, so a pattern that
// regresses to super-linear time is bounded per window and a secret anywhere in a minified line is still found.
// Initial value to calibrate: window of 8,192 characters.
export const MAX_SCAN_LINE_CHARS = 8192;
// Initial value to calibrate: overlap of 512 characters. A match whose relevant span is not longer than the overlap is
// found across a window boundary; a user:credential@ part longer than the overlap can be missed at a boundary.
export const SCAN_WINDOW_OVERLAP = 512;

const LONG_LINE = new RegExp(`[^\\n\\r\\u2028\\u2029]{${MAX_SCAN_LINE_CHARS + 1},}`, "g");

/** Pieces of the text to scan: the whole text when no line is long (so a pattern that spans a line break still works). */
function* pieces(text) {
  if (text.length <= MAX_SCAN_LINE_CHARS) { yield text; return; }
  LONG_LINE.lastIndex = 0;
  let from = 0;
  let m;
  while ((m = LONG_LINE.exec(text))) {
    if (m.index > from) yield text.slice(from, m.index);
    const step = MAX_SCAN_LINE_CHARS - SCAN_WINDOW_OVERLAP;
    for (let i = 0; ; i += step) {
      yield m[0].slice(i, i + MAX_SCAN_LINE_CHARS);
      if (i + MAX_SCAN_LINE_CHARS >= m[0].length) break;
    }
    from = m.index + m[0].length;
  }
  if (from === 0) yield text;
  else if (from < text.length) yield text.slice(from);
}

const matches = (re, text) => { for (const piece of pieces(text)) if (re.test(piece)) return true; return false; };

/** @returns {string[]} kinds of secret found in the text (empty when none) */
export function scanString(text) {
  if (typeof text !== "string" || !text) return [];
  const found = [];
  for (const { kind, re } of SECRET_PATTERNS) if (matches(re, text)) found.push(kind);
  return found;
}

/** Does the text hold a secret of this kind? */
export function hasSecretKind(text, kind) {
  const p = SECRET_PATTERNS.find((x) => x.kind === kind);
  return Boolean(p && typeof text === "string" && matches(p.re, text));
}

/** Walks every string value (and key) of a JSON value. @returns {{path: string, kind: string}[]} */
export function scanValue(value, path = "") {
  const out = [];
  if (typeof value === "string") {
    for (const kind of scanString(value)) out.push({ path, kind });
  } else if (Array.isArray(value)) {
    value.forEach((v, i) => out.push(...scanValue(v, `${path}[${i}]`)));
  } else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) out.push(...scanValue(v, path ? `${path}.${k}` : k));
  }
  return out;
}
