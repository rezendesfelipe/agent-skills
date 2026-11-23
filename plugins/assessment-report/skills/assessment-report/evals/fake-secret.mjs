// The planted fake secret is never written in the repository as a literal. Fixtures hold a marker, and the harness,
// the scorer and the tests build the value at run time from parts that do not look like a secret on their own,
// in a temporary folder.
import { cpSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const MARKER = "{{FAKE_SECRET}}";
const PARTS = ["Hm4Tq8", "Zr2Lw6", "Nv9Xb3", "Kd5Jp7"];
export const fakeSecretValue = () => PARTS.join("");

const fill = (s) => s.split(MARKER).join(fakeSecretValue());

/** Deep copy of a JSON value with the marker replaced in every string. */
export function substituteDeep(v) {
  if (typeof v === "string") return fill(v);
  if (Array.isArray(v)) return v.map(substituteDeep);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, substituteDeep(x)]));
  return v;
}

/** Copies a fixture folder, replacing the marker in text files. @returns {string} the copy */
export function materialize(src, dest = mkdtempSync(join(tmpdir(), "assess-fixture-"))) {
  cpSync(src, dest, { recursive: true });
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else {
        const buf = readFileSync(p);
        if (buf.includes(0)) continue;
        const text = buf.toString("utf8");
        if (text.includes(MARKER)) writeFileSync(p, fill(text));
      }
    }
  };
  walk(dest);
  return dest;
}
