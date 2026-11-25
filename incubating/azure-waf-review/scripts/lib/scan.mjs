// The scanner of the collector: the scanner of assessment-report (secrets.mjs, a copy kept equal by a parity test) plus two shapes
// it does not know, found by the independent review: a bare storage account key and a Microsoft Entra client secret. The extra
// patterns are ours; they only ADD kinds, never remove one of the source scanner.
import { scanString as base } from "./secrets.mjs";

const EXTRA = [
  // a storage account key with no name around it: 64 bytes in base64, 88 characters ending in ==. A "/" before it is allowed (a URL path);
  // a longer base64 blob (a letter, digit or + before it) is another kind of data
  { kind: "azure-storage-key-bare", re: /(?<![A-Za-z0-9+])[A-Za-z0-9+/]{86}==(?![A-Za-z0-9+/=])/ },
  // a Microsoft Entra client secret value: three characters, a digit, Q~, then 31 to 34 characters
  { kind: "aad-client-secret", re: /(?<![A-Za-z0-9_.~-])[A-Za-z0-9_.-]{3}\dQ~[A-Za-z0-9_.~-]{31,34}(?![A-Za-z0-9_.~-])/ },
];

/** @returns {string[]} kinds found (empty when none) */
export function scanString(text) {
  if (typeof text !== "string" || !text) return [];
  const found = base(text);
  for (const { kind, re } of EXTRA) if (re.test(text)) found.push(kind);
  return found;
}
