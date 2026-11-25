// Redaction before anything is written: closed projection, typed scalars, control characters, the secret scanner on VALUES,
// tag values hashed, and (strict mode) stable aliases. Design Decision 5 and spec "Redaction before write".
import { scanString } from "./scan.mjs";
import { sha256 } from "./util.mjs";

export const MAX_STRING = 256;
export const TAG_ALLOWLIST = new Set(["env", "environment", "tier", "criticality", "workload", "costcenter"]);
export const ALIAS_CLASSES = ["subscription", "resourceGroup", "resource"];

/** Removes OSC and CSI sequences, then every remaining control, bidi, zero-width character; line breaks become one space; caps the length. */
export function sanitizeString(s, { cap = true } = {}) {
  let t = String(s)
    .replace(/\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)?/g, "")
    .replace(/(?:\u001b\[|\u009b)[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\u001b[@-Z\\-_]?/g, "")
    .replace(/\r\n|[\r\n\t]/g, " ")
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2028\u2029\u2066-\u2069\u061c\ufeff]/g, "");
  return cap && t.length > MAX_STRING ? t.slice(0, MAX_STRING) : t;
}

/**
 * A tag value is data a person typed (often a name or an e-mail address): it is PSEUDONYMIZED, not redacted, unless the key is on
 * the allowlist. The hash is 32 bits salted with the run id, which is in run.json and in the manifest: a dictionary of likely values
 * reverses it. It keeps the model from reading the text (an injection), it does not keep a person's name secret.
 */
export function tagValue(key, value, runId) {
  if (value === "" || value === null || value === undefined) return "";
  const raw = String(value);
  if (TAG_ALLOWLIST.has(String(key).toLowerCase())) return sanitizeString(raw);
  return `tag:${sha256(`${runId}\0${String(key).toLowerCase()}\0${raw}`).slice(0, 8)}`;
}

/** Stable aliases (`sub-01`, `rg-01`, `res-001`). The map is returned to the caller, who stores it outside the run folder. */
export function makeAliaser(initial = {}) {
  const maps = { subscription: new Map(), resourceGroup: new Map(), resource: new Map() };
  const prefix = { subscription: ["sub", 2], resourceGroup: ["rg", 2], resource: ["res", 3] };
  for (const [cls, m] of Object.entries(initial)) if (maps[cls]) for (const [k, v] of Object.entries(m)) maps[cls].set(k.toLowerCase(), { orig: k, alias: v });
  const value = (cls, original) => {
    const key = String(original).toLowerCase();
    const m = maps[cls];
    if (!m.has(key)) {
      const [p, w] = prefix[cls];
      m.set(key, { orig: String(original), alias: `${p}-${String(m.size + 1).padStart(w, "0")}` });
    }
    return m.get(key).alias;
  };
  const armId = (id) => {
    const parts = String(id).split("/");
    const out = [];
    let expect = null; // what the next segment is
    let afterProviders = 0;
    for (let i = 0; i < parts.length; i++) {
      const seg = parts[i];
      if (i === 0 || seg === "") { out.push(seg); continue; }
      const low = seg.toLowerCase();
      if (low === "providers" && (expect === "type" || expect === null)) { out.push(seg); expect = "ns"; afterProviders++; continue; }
      if (expect === "sub") { out.push(value("subscription", seg)); expect = null; continue; }
      if (expect === "rg") { out.push(value("resourceGroup", seg)); expect = null; continue; }
      if (expect === "ns") { out.push(seg); expect = "type"; continue; }
      if (expect === "type") { out.push(seg); expect = "name"; continue; }
      if (expect === "name") { out.push(value("resource", seg)); expect = "type"; continue; }
      if (low === "subscriptions") { out.push(seg); expect = "sub"; continue; }
      if (low === "resourcegroups") { out.push(seg); expect = "rg"; continue; }
      if (low === "providers") { out.push(seg); expect = "ns"; afterProviders++; continue; }
      out.push(afterProviders ? seg : value("resource", seg));
    }
    return out.join("/");
  };
  const map = () => Object.fromEntries(Object.entries(maps).map(([cls, m]) => [cls, Object.fromEntries([...m.values()].map((e) => [e.orig, e.alias]))]));
  return { value, armId, map };
}

/**
 * Projects one raw row to the declared output fields, in their order. A value that is not the declared scalar type (an object,
 * an array, a string where a bool was declared) becomes null and is reported in `dropped`: it is never stringified.
 * @returns {{row: object, dropped: string[], redactions: number, pseudonymized: number}}
 */
export function projectRow(raw, fields, { mode = "default", runId = "", aliaser = null } = {}) {
  const row = {};
  const dropped = [];
  let redactions = 0;
  let pseudonymized = 0;
  for (const f of fields) {
    const v = raw?.[f.name];
    if (v === undefined || v === null) { row[f.name] = null; continue; }
    const bad = () => { row[f.name] = null; dropped.push(f.name); };
    if (f.type === "bool") { typeof v === "boolean" ? (row[f.name] = v) : bad(); continue; }
    if (f.type === "number") { typeof v === "number" && Number.isFinite(v) ? (row[f.name] = v) : bad(); continue; }
    if (typeof v !== "string") { bad(); continue; }
    if (f.type === "enum") { f.values?.includes(v) ? (row[f.name] = v) : bad(); continue; }
    let out;
    if (f.tagKey) {
      out = tagValue(f.tagKey, v, runId);
      if (out.startsWith("tag:")) pseudonymized++;
      else { const kinds = scanString(out); if (kinds.length) { out = `[redacted:${kinds[0]}]`; redactions++; } }
    } else {
      // scan the WHOLE cleaned value, then cut: a secret that straddles the cut would otherwise stay half written
      out = sanitizeString(v, { cap: false });
      const kinds = scanString(out);
      if (kinds.length) { out = `[redacted:${kinds[0]}]`; redactions++; }
      else if (out.length > MAX_STRING) out = out.slice(0, MAX_STRING);
    }
    if (mode === "strict" && aliaser) {
      if (out.startsWith("/subscriptions/")) out = aliaser.armId(out);
      else if (f.alias) out = aliaser.value(f.alias, out);
    }
    row[f.name] = out;
  }
  return { row, dropped, redactions, pseudonymized };
}
