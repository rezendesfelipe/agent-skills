// Reads a source document (Markdown + YAML frontmatter), validates it and builds the document model
// that both renderers use.
import { existsSync, readFileSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import { imageSize } from "./images.mjs";

export const LANGS = ["pt-BR", "en", "es"];
const LOCALES_DIR = fileURLToPath(new URL("../../locales", import.meta.url));

/** Markdown node types the renderers support. Anything else is reported by `check`. */
const SUPPORTED = new Set([
  "root", "paragraph", "text", "heading", "strong", "emphasis", "link", "list", "listItem",
  "table", "tableRow", "tableCell", "blockquote", "code", "inlineCode", "image", "break",
]);
const NODE_HINTS = {
  html: "raw HTML is not supported; use Markdown",
  footnoteReference: "footnotes are not supported; list references under `sources`",
  footnoteDefinition: "footnotes are not supported; list references under `sources`",
  linkReference: "reference-style links are not supported; use inline links [text](url)",
  imageReference: "reference-style images are not supported; use ![alt](path)",
  definition: "reference definitions are not supported; use inline links",
  thematicBreak: "horizontal rules are not supported; use a heading to start a new part",
  delete: "strikethrough is not supported",
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const VAGUE_CHANGE = /^(document |documento )?(updated?|update|atualizado|atualização|actualizado|actualización|changes?|alterações|cambios)\.?$/i;

export function labels(lang) {
  return JSON.parse(readFileSync(join(LOCALES_DIR, `${lang}.json`), "utf8"));
}

export function formatDate(iso, lang) {
  return new Intl.DateTimeFormat(lang, { dateStyle: "long", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`));
}

const parser = unified().use(remarkParse).use(remarkGfm);

export function textOf(node) {
  if (!node) return "";
  if (node.type === "text" || node.type === "inlineCode") return node.value;
  if (node.type === "image") return node.alt ?? "";
  if (node.type === "break") return " ";
  return (node.children ?? []).map(textOf).join("");
}

function slugify(text) {
  return (
    text
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "section"
  );
}

function splitFrontmatter(text) {
  const m = text.match(/^﻿?---\r?\n([\s\S]*?)\r?\n---[ \t]*(\r?\n|$)/);
  if (!m) return null;
  return { yaml: m[1], body: text.slice(m[0].length), bodyLine: m[0].split("\n").length };
}

const isValidDate = (s) => ISO_DATE.test(s) && !Number.isNaN(new Date(`${s}T00:00:00Z`).getTime()) && new Date(`${s}T00:00:00Z`).toISOString().startsWith(s);

/**
 * @returns {{ model: object|null, errors: {where: string, message: string}[], warnings: {where: string, message: string}[] }}
 */
export function loadSource(sourcePath) {
  const errors = [];
  const warnings = [];
  const err = (where, message) => errors.push({ where, message });
  const warn = (where, message) => warnings.push({ where, message });
  const file = resolve(sourcePath);
  const baseDir = dirname(file);
  const rel = (p) => relative(baseDir, p) || p;

  if (!existsSync(file)) return { model: null, errors: [{ where: sourcePath, message: "file not found" }], warnings };
  const fm = splitFrontmatter(readFileSync(file, "utf8"));
  if (!fm) return { model: null, errors: [{ where: "frontmatter", message: "the file must start with YAML frontmatter between --- lines" }], warnings };

  let meta;
  try {
    // "failsafe" keeps every scalar as a string, so `version: 1.0` stays "1.0" and dates are not converted.
    meta = parseYaml(fm.yaml, { schema: "failsafe" }) ?? {};
  } catch (e) {
    return { model: null, errors: [{ where: "frontmatter", message: `invalid YAML: ${e.message.split("\n")[0]}` }], warnings };
  }
  if (typeof meta !== "object" || Array.isArray(meta)) return { model: null, errors: [{ where: "frontmatter", message: "must be a set of key: value fields" }], warnings };

  const str = (key, required) => {
    const v = meta[key];
    if (v === undefined || v === null || v === "") {
      if (required) err(key, "is required");
      return undefined;
    }
    if (typeof v !== "string") {
      err(key, "must be text");
      return undefined;
    }
    return v.trim();
  };

  const known = new Set(["title", "subtitle", "author", "date", "version", "lang", "summary", "sources", "annexes", "changes"]);
  for (const k of Object.keys(meta)) if (!known.has(k)) warn(k, "unknown field, ignored");

  const title = str("title", true);
  const subtitle = str("subtitle", false);
  const version = str("version", true);
  const date = str("date", true);
  if (date && !isValidDate(date)) err("date", `"${date}" must be an ISO date like 2026-11-20`);
  const lang = str("lang", false) ?? "pt-BR";
  if (!LANGS.includes(lang)) err("lang", `"${lang}" is not supported; use one of: ${LANGS.join(", ")}`);

  let authors = [];
  if (meta.author === undefined || meta.author === "") err("author", "is required");
  else if (typeof meta.author === "string") authors = [meta.author.trim()];
  else if (Array.isArray(meta.author) && meta.author.every((a) => typeof a === "string" && a.trim())) authors = meta.author.map((a) => a.trim());
  else err("author", "must be a name or a list of names");

  // Markdown blocks ------------------------------------------------------------------------
  const usedIds = new Set(["cover", "toc", "summary", "sources", "changes", "back-cover"]);
  const uniqueId = (text) => {
    const base = `s-${slugify(text)}`;
    let id = base, n = 2;
    while (usedIds.has(id)) id = `${base}-${n++}`;
    usedIds.add(id);
    return id;
  };

  /**
   * Parses Markdown, checks supported nodes, heading depth and images.
   * @param where label for errors; lineOffset converts node lines to file lines
   */
  const parseBlocks = (markdown, { where, fileLabel, lineOffset = 0, maxDepth, depthShift = 0, allowHeadings = true, imageBase }) => {
    const tree = parser.runSync(parser.parse(markdown));
    const at = (node) => `${fileLabel}:${(node.position?.start.line ?? 1) + lineOffset}`;
    const visit = (node) => {
      if (!SUPPORTED.has(node.type)) {
        err(at(node), NODE_HINTS[node.type] ?? `"${node.type}" is not supported`);
        return;
      }
      if (node.type === "heading") {
        if (!allowHeadings) err(at(node), `headings are not allowed in ${where}`);
        else if (node.depth > maxDepth)
          err(at(node), `heading level ${"#".repeat(node.depth)} is too deep: documents use at most 3 heading levels` +
            (depthShift ? ` (an annex allows # and ##, because its title is the first level)` : ""));
        node.depth += depthShift;
        node.id = uniqueId(textOf(node));
      }
      if (node.type === "image") {
        const path = resolve(imageBase, decodeURI(node.url));
        if (/^[a-z]+:\/\//i.test(node.url)) err(at(node), `images must be local files, not URLs: ${node.url}`);
        else if (!existsSync(path)) err(at(node), `image not found: ${rel(path)}`);
        else if (!/\.(png|jpe?g)$/i.test(path)) err(at(node), `image must be PNG or JPEG: ${rel(path)}`);
        else {
          const size = imageSize(readFileSync(path));
          if (!size) err(at(node), `could not read image size: ${rel(path)}`);
          else Object.assign(node, { path, width: size.width, height: size.height, format: size.format });
        }
      }
      for (const child of node.children ?? []) visit(child);
    };
    visit(tree);
    return tree.children;
  };

  const sourceName = relative(process.cwd(), file) || file;
  const body = parseBlocks(fm.body, { where: "the body", fileLabel: sourceName, lineOffset: fm.bodyLine - 1, maxDepth: 3, imageBase: baseDir });
  if (!body.length) err(sourceName, "the document body is empty");

  let summary = [];
  const summaryText = str("summary", true);
  if (summaryText) summary = parseBlocks(summaryText, { where: "the summary", fileLabel: "summary", allowHeadings: false, maxDepth: 0, imageBase: baseDir });

  // Sources --------------------------------------------------------------------------------
  const sources = [];
  if (meta.sources !== undefined && meta.sources !== "") {
    if (!Array.isArray(meta.sources)) err("sources", "must be a list");
    else
      meta.sources.forEach((s, i) => {
        const w = `sources[${i}]`;
        if (typeof s !== "object" || Array.isArray(s) || !s) return err(w, "must have at least a title");
        if (!s.title) err(`${w}.title`, "is required");
        if (s.url && !/^https?:\/\//.test(s.url)) err(`${w}.url`, "must start with http:// or https://");
        for (const k of ["date", "accessed"]) if (s[k] && !isValidDate(s[k])) err(`${w}.${k}`, `"${s[k]}" must be an ISO date like 2026-11-20`);
        sources.push({ title: s.title, url: s.url, author: s.author, date: s.date, accessed: s.accessed });
      });
  }
  const sourceLang = LANGS.includes(meta.lang) ? meta.lang : "pt-BR";
  for (const s of sources) {
    if (s.date && isValidDate(s.date)) s.dateText = formatDate(s.date, sourceLang);
    if (s.accessed && isValidDate(s.accessed)) s.accessedText = formatDate(s.accessed, sourceLang);
  }

  // Annexes --------------------------------------------------------------------------------
  const annexes = [];
  if (meta.annexes !== undefined && meta.annexes !== "") {
    if (!Array.isArray(meta.annexes)) err("annexes", "must be a list");
    else
      meta.annexes.forEach((a, i) => {
        const w = `annexes[${i}]`;
        if (typeof a !== "object" || Array.isArray(a) || !a) return err(w, "must have a title and a file");
        if (!a.title) err(`${w}.title`, "is required");
        if (!a.file) return err(`${w}.file`, "is required");
        const path = resolve(baseDir, a.file);
        if (!existsSync(path)) return err(`${w}.file`, `annex file not found: ${a.file}`);
        if (extname(path).toLowerCase() !== ".md") return err(`${w}.file`, `annex must be a Markdown (.md) file: ${a.file}`);
        let text = readFileSync(path, "utf8");
        let offset = 0;
        const afm = splitFrontmatter(text);
        if (afm) {
          text = afm.body;
          offset = afm.bodyLine - 1;
        }
        const letter = String.fromCharCode(65 + i);
        const blocks = parseBlocks(text, {
          where: `annex ${letter}`, fileLabel: rel(path), lineOffset: offset, maxDepth: 2, depthShift: 1, imageBase: dirname(path),
        });
        annexes.push({ letter, title: a.title, id: `annex-${letter.toLowerCase()}`, blocks });
      });
  }

  // Change log -----------------------------------------------------------------------------
  const changes = [];
  if (meta.changes === undefined || meta.changes === "") err("changes", "is required: list at least one change with version, date and description");
  else if (!Array.isArray(meta.changes) || !meta.changes.length) err("changes", "must be a list with at least one entry");
  else
    meta.changes.forEach((c, i) => {
      const w = `changes[${i}]`;
      if (typeof c !== "object" || Array.isArray(c) || !c) return err(w, "must have version, date and description");
      for (const k of ["version", "date", "description"]) if (!c[k]) err(`${w}.${k}`, "is required");
      if (c.date && !isValidDate(c.date)) err(`${w}.date`, `"${c.date}" must be an ISO date like 2026-11-20`);
      if (c.description && (VAGUE_CHANGE.test(c.description.trim()) || c.description.trim().length < 12))
        warn(`${w}.description`, `"${c.description}" is vague: say what changed and where, for example "Added section 3.2 on data retention"`);
      changes.push({ version: c.version, date: c.date, author: c.author, description: c.description, order: i });
    });
  changes.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "") || b.order - a.order);

  if (errors.length) return { model: null, errors, warnings };

  const L = labels(lang);
  const toc = [{ id: "summary", text: L.summary, level: 1 }];
  for (const b of body) if (b.type === "heading" && b.depth <= 2) toc.push({ id: b.id, text: textOf(b), level: b.depth });
  if (sources.length) toc.push({ id: "sources", text: L.sources, level: 1 });
  for (const a of annexes) toc.push({ id: a.id, text: `${L.annex} ${a.letter} — ${a.title}`, level: 1 });
  toc.push({ id: "changes", text: L.changes, level: 1 });

  return {
    model: {
      file,
      baseDir,
      meta: { title, subtitle, authors, date, dateText: formatDate(date, lang), version, lang },
      labels: L,
      summary,
      body,
      sources,
      annexes,
      changes: changes.map(({ order, ...c }) => ({ ...c, dateText: formatDate(c.date, lang) })),
      toc,
    },
    errors,
    warnings,
  };
}
