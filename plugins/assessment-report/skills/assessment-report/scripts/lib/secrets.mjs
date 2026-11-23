// Heuristic secret scanner. It cannot prove that a string is free of secrets, only catch common shapes.
// The method annex of every report says so.

const R = (kind, re) => ({ kind, re });

// What a value must not start with to count as a secret: a reference to another value, or an obvious placeholder.
const PLACEHOLDER = "(?:var\\.|local\\.|data\\.|module\\.|env\\.|secrets?\\.|os\\.|process\\.|self\\.|config\\.|changeme|change-me|example|placeholder|redacted|none\\b|null\\b|true\\b|false\\b|read\\b|write\\b|x{3,}|\\*{3,}|your[_-]|my[_-]|todo|tbd)";
// Names that mean a secret. A prefix such as db_ or client. is allowed; a suffix such as _name or _id is not.
const SECRET_NAME = "(?:[A-Za-z0-9]+[_.-])*(?:password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key|secret[_-]?key|private[_-]?key|account[_-]?key|client[_-]?secret)";

const VALUE = "[^\\s\"'<>{}$(),;]{4,}";
const NOT_CALL = "(?![^\\s\"'<>{}$(),;]*\\()";
// Only for an unquoted value: a resource address (random_password.db.result, azurerm_key_vault_secret.x.value), a YAML tag,
// anchor, alias or block indicator (!vault, !!str, &a, *a, |, >) or a word that describes a schema (required, optional).
const UNQUOTED_REFERENCE = "(?:(?:[A-Za-z_][\\w-]*(?:\\[[^\\]]*\\])?\\.){2,}[\\w-]+(?:\\[[^\\]]*\\])?(?=[\\s,;)]|$)|[!&*|>]|(?:required|optional|sensitive|computed|string|number|bool|object|any)\\b)";

/** Order matters only for reporting; every pattern is tried. */
export const SECRET_PATTERNS = [
  R("private-key", /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----/),
  R("aws-access-key", /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/),
  R("github-token", /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})\b/),
  R("slack-token", /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/),
  R("google-api-key", /\bAIza[0-9A-Za-z_-]{35}\b/),
  R("stripe-key", /\b[sr]k_live_[0-9A-Za-z]{16,}\b/),
  R("jwt", /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/),
  // user:password@host in a URL or connection string; references and placeholders are ignored
  R("url-credential", /\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@"'<>{}$]+:(?![<{$%]|var\.|local\.|\*+@)[^\s@/"'<>{}]{3,}@[^\s"']/i),
  // Azure Storage and Service Bus connection strings
  R("azure-storage-key", /\b(?:AccountKey|SharedAccessKey)=[A-Za-z0-9+/]{20,}={0,2}/),
  R("bearer-token", /\bBearer\s+(?![<{$])[A-Za-z0-9._~+/-]{20,}=*/),
  // shared access signature in a URL
  R("sas-signature", /[?&]sig=[A-Za-z0-9%+/=]{16,}/),
  // name = "value" or name: value for names that mean a secret. The value may be short or letters only.
  R("generic-credential", new RegExp(`(?:^|[^A-Za-z0-9])${SECRET_NAME}["']?\\s*[:=]\\s*(?:["'](?!${PLACEHOLDER})${NOT_CALL}${VALUE}|(?!${PLACEHOLDER})(?!${UNQUOTED_REFERENCE})${NOT_CALL}${VALUE})`, "i")),
];

export const SECRET_KINDS = SECRET_PATTERNS.map((p) => p.kind);

/** @returns {string[]} kinds of secret found in the text (empty when none) */
export function scanString(text) {
  if (typeof text !== "string" || !text) return [];
  const found = [];
  for (const { kind, re } of SECRET_PATTERNS) if (re.test(text)) found.push(kind);
  return found;
}

/** Does the text hold a secret of this kind? */
export function hasSecretKind(text, kind) {
  const p = SECRET_PATTERNS.find((x) => x.kind === kind);
  return Boolean(p && p.re.test(text));
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
