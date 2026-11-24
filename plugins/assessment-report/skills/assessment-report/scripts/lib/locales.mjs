// Fixed labels (section titles, severity and confidence names, table headers) by language.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const LANGS = ["en", "pt-BR", "es"];
export const LOCALES_DIR = fileURLToPath(new URL("../../locales", import.meta.url));

export function loadLabels(lang) {
  if (!LANGS.includes(lang)) throw new Error(`unsupported language "${lang}"; use one of ${LANGS.join(", ")}`);
  return JSON.parse(readFileSync(`${LOCALES_DIR}/${lang}.json`, "utf8"));
}

/** Replaces {name} placeholders; an unknown placeholder is left as it is. */
export function fmt(template, vars = {}) {
  return template.replace(/\{([a-zA-Z0-9]+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
}

/** Flat list of key paths, to compare locales. */
export function keyPaths(obj, prefix = "") {
  return Object.entries(obj).flatMap(([k, v]) => (v && typeof v === "object" ? keyPaths(v, `${prefix}${k}.`) : [`${prefix}${k}`]));
}
