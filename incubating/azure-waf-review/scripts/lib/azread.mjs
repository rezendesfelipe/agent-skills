// The closed `az` argument list, the child environment allowlist and the URL allowlist (design Decision 5, "Collector hardening").
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const AZ_READ_FILE = fileURLToPath(new URL("../../catalog/az-read.json", import.meta.url));
export const AZ_READ_VECTORS = JSON.parse(readFileSync(AZ_READ_FILE, "utf8")).vectors.map((v) => v.argv);

const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True only for an exact vector of the list (the `{guid}` placeholder takes a GUID and nothing else). */
export function isAllowedAzVector(argv) {
  if (!Array.isArray(argv) || !argv.length || argv.some((a) => typeof a !== "string")) return false;
  return AZ_READ_VECTORS.some((v) => v.length === argv.length && v.every((tok, i) => (tok === "{guid}" ? GUID_RE.test(argv[i]) : tok === argv[i])));
}

/** Arguments for execFile (without the leading `az`). `--only-show-errors` on every call except `--version`. */
export function azArgs(vector) {
  if (!isAllowedAzVector(vector)) throw new Error(`az vector is not on the closed list: ${JSON.stringify(vector)}`);
  const rest = vector.slice(1);
  return vector[1] === "--version" ? rest : [...rest, "--only-show-errors"];
}

export const ALLOWED_ENV = ["PATH", "HOME", "AZURE_CONFIG_DIR", "LANG", "LC_ALL", "TERM", "TMPDIR", "HTTPS_PROXY", "HTTP_PROXY", "NO_PROXY", "SSL_CERT_FILE", "REQUESTS_CA_BUNDLE"];
/** Extra variables the Windows launcher needs (not verified until manual test M-10). */
export const WINDOWS_ENV = ["SystemRoot", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "COMSPEC", "PATHEXT", "TEMP", "TMP", "ProgramFiles", "ProgramFiles(x86)", "ProgramData"];

/** The environment of the `az` child: the allowlist only, plus telemetry off. Nothing else is inherited (no provider or cloud key). */
export function childEnv(parent = process.env, { platform = process.platform } = {}) {
  const names = platform === "win32" ? [...ALLOWED_ENV, ...WINDOWS_ENV] : ALLOWED_ENV;
  const out = {};
  for (const name of names) {
    const key = platform === "win32" ? Object.keys(parent).find((k) => k.toUpperCase() === name.toUpperCase()) : name in parent ? name : undefined;
    if (key !== undefined && parent[key] !== undefined && parent[key] !== "") out[name] = parent[key];
  }
  out.AZURE_CORE_COLLECT_TELEMETRY = "false";
  return out;
}

export const MGMT_HOST = "management.azure.com";
export const ARG_PATH = "/providers/Microsoft.ResourceGraph/resources";

/** Only https://management.azure.com, GET anywhere with an api-version, and the one read-only POST of Resource Graph. */
export function isAllowedUrl(url, method) {
  // characters we never need: other parsers (the az rest library) read them differently from WHATWG, so refuse before parsing
  if (typeof url !== "string" || /[\\@%#\s\u0000-\u001f\u007f-\uffff]/.test(url)) return false;
  // only the canonical text: lower-case scheme and host, no port, no dot segments, no empty segments, a plain query
  if (!url.startsWith(`https://${MGMT_HOST}/`)) return false;
  let u;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.href !== url) return false;
  const segs = u.pathname.split("/").slice(1);
  if (!segs.length || segs.some((x) => x === "" || x === "." || x === "..")) return false;
  if (!/^\?[A-Za-z0-9._-]+=[A-Za-z0-9._-]*(&[A-Za-z0-9._-]+=[A-Za-z0-9._-]*)*$/.test(u.search)) return false;
  if (u.protocol !== "https:" || u.hostname !== MGMT_HOST || u.username || u.password || u.port) return false;
  if (!u.searchParams.get("api-version")) return false;
  const m = String(method).toUpperCase();
  if (m === "GET") return true;
  return m === "POST" && u.pathname === ARG_PATH;
}
