import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { strFromU8, unzipSync } from "fflate";

export const SKILL = fileURLToPath(new URL("..", import.meta.url));
export const FIXTURES = join(SKILL, "test", "fixtures");
export const SAMPLE = join(FIXTURES, "sample.md");
export const CLI = join(SKILL, "scripts", "docs.mjs");

export const tmp = (prefix = "docs-generator-test-") => mkdtempSync(join(tmpdir(), prefix));

/** Copies the fixtures to a temp folder, so tests can write sources next to them. */
export function fixtureCopy() {
  const dir = tmp();
  cpSync(FIXTURES, dir, { recursive: true });
  return dir;
}

/** Writes a source document from frontmatter fields (YAML text) and a body. */
export function writeSource(dir, name, frontmatter, body = "# Section\n\nText.\n") {
  const path = join(dir, name);
  writeFileSync(path, `---\n${frontmatter.trim()}\n---\n${body}`);
  return path;
}

export const MINIMAL = `
title: Test document
author: Test Author
date: 2026-11-20
version: "1.0"
summary: The conclusion comes first.
changes:
  - version: "1.0"
    date: 2026-11-20
    description: Created the document with sections 1 and 2.
`;

export function runCli(args, { env = {}, cwd = SKILL } = {}) {
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd, env: { ...process.env, ...env }, encoding: "utf8" });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}

/** Files of a zip (docx, xltx, thmx) as strings. */
export function unzipText(path) {
  return Object.fromEntries(Object.entries(unzipSync(readFileSync(path))).map(([k, v]) => [k, strFromU8(v)]));
}

/** Plain text of each paragraph in a WordprocessingML part. */
export function docxParagraphs(xml) {
  return [...xml.matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)].map((m) => {
    const p = m[0];
    const style = p.match(/<w:pStyle w:val="([^"]+)"/)?.[1] ?? null;
    const text = [...p.matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>/g)].map((t) => t[1]).join("");
    return { style, text: decode(text) };
  });
}

const decode = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

/** Text lines and link annotations of every page of a PDF, with pdf.js. */
export async function readPdf(path) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(path)), useSystemFonts: false, verbosity: 0 }).promise;
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const rows = new Map();
    for (const it of content.items) {
      if (!("str" in it) || !it.str.trim()) continue;
      const y = Math.round(it.transform[5]);
      if (!rows.has(y)) rows.set(y, []);
      rows.get(y).push({ x: it.transform[4], w: it.width, str: it.str });
    }
    // Items of one line are joined with a space only where there is a gap between them, so ligatures
    // ("fi") and style changes inside a word do not split it.
    const join = (items) =>
      items.sort((a, b) => a.x - b.x).reduce((s, it, i, arr) => {
        if (i === 0) return it.str;
        const prev = arr[i - 1];
        const gap = it.x - (prev.x + prev.w);
        return s + (gap > 1 && !s.endsWith(" ") && !it.str.startsWith(" ") ? " " : "") + it.str;
      }, "");
    const lines = [...rows.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([y, items]) => ({ y, text: join(items).replace(/\s+/g, " ").trim() }));
    const links = [];
    for (const a of await page.getAnnotations()) {
      if (a.subtype !== "Link") continue;
      let target = null;
      if (a.dest) {
        const dest = typeof a.dest === "string" ? await doc.getDestination(a.dest) : a.dest;
        if (dest?.[0]) target = (await doc.getPageIndex(dest[0])) + 1;
      }
      links.push({ url: a.url ?? null, target, rect: a.rect });
    }
    pages.push({ number: i, lines, text: lines.map((l) => l.text).join("\n"), links });
  }
  return pages;
}

export const norm = (s) => s.replace(/\s+/g, " ").trim();
