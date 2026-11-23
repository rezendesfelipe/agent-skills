// Heuristic secret scanner. It cannot prove that a string is free of secrets, only catch common shapes.
// The method annex of every report says so.

const R = (kind, re) => ({ kind, re });

/** Order matters only for reporting; every pattern is tried. */
export const SECRET_PATTERNS = [
  R("private-key", /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----/),
  R("aws-access-key", /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/),
  R("github-token", /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})\b/),
  R("slack-token", /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/),
  R("google-api-key", /\bAIza[0-9A-Za-z_-]{35}\b/),
  R("stripe-key", /\b[sr]k_live_[0-9A-Za-z]{16,}\b/),
  R("jwt", /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/),
  // name = "long random-looking value"; values that look like references or placeholders are ignored
  R("generic-credential", /\b(?:password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key|client[_-]?secret)\w*["']?\s*[:=]\s*["']?(?![<{$(]|var\.|local\.|data\.|module\.|env\.|secrets\.|os\.|process\.)(?=[A-Za-z0-9/+_\-.]*\d)(?=[A-Za-z0-9/+_\-.]*[A-Za-z])[A-Za-z0-9/+_\-.]{16,}/i),
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
