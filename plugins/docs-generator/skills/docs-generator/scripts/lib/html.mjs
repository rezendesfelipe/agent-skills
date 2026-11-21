// Renders the document model as one HTML page with print CSS for Paged.js.
import { pathToFileURL } from "node:url";
import { fontFaces } from "./theme.mjs";

const esc = (s = "") => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const fileUrl = (p) => pathToFileURL(p).href;

// ---- inline and block nodes ----------------------------------------------------------------

function inline(nodes = []) {
  return nodes
    .map((n) => {
      switch (n.type) {
        case "text": return esc(n.value);
        case "strong": return `<strong>${inline(n.children)}</strong>`;
        case "emphasis": return `<em>${inline(n.children)}</em>`;
        case "inlineCode": return `<code>${esc(n.value)}</code>`;
        case "break": return "<br>";
        case "link": return `<a href="${esc(n.url)}">${inline(n.children)}</a>`;
        case "image": return `<img src="${fileUrl(n.path)}" alt="${esc(n.alt)}">`;
        default: return inline(n.children);
      }
    })
    .join("");
}

function block(n) {
  switch (n.type) {
    case "heading":
      return `<h${n.depth} id="${n.id}">${inline(n.children)}</h${n.depth}>`;
    case "paragraph": {
      // A paragraph that holds only an image becomes a figure with its alt text as caption
      if (n.children.length === 1 && n.children[0].type === "image") {
        const img = n.children[0];
        return `<figure><img src="${fileUrl(img.path)}" alt="${esc(img.alt)}">${img.alt ? `<figcaption>${esc(img.alt)}</figcaption>` : ""}</figure>`;
      }
      return `<p>${inline(n.children)}</p>`;
    }
    case "list": {
      const tag = n.ordered ? "ol" : "ul";
      const start = n.ordered && n.start && n.start !== 1 ? ` start="${n.start}"` : "";
      return `<${tag}${start}>${n.children.map((li) => `<li>${li.children.map((c) => (c.type === "paragraph" ? inline(c.children) : block(c))).join("")}</li>`).join("")}</${tag}>`;
    }
    case "blockquote":
      return `<blockquote>${n.children.map(block).join("")}</blockquote>`;
    case "code":
      return `<pre><code>${esc(n.value)}</code></pre>`;
    case "table": {
      const align = (i) => (n.align?.[i] ? ` style="text-align:${n.align[i]}"` : "");
      const [head, ...rows] = n.children;
      const cells = (row, tag) => row.children.map((c, i) => `<${tag}${align(i)}>${inline(c.children)}</${tag}>`).join("");
      return `<table><thead><tr>${cells(head, "th")}</tr></thead><tbody>${rows.map((r) => `<tr>${cells(r, "td")}</tr>`).join("")}</tbody></table>`;
    }
    default:
      return "";
  }
}

const blocks = (list) => list.map(block).join("\n");

// ---- parts --------------------------------------------------------------------------------

function cover(m, t) {
  const L = m.labels;
  const logo = t.cover.logo ? `<img class="cover-logo" src="${fileUrl(t.cover.logo)}" alt="">` : "";
  return `
<section class="cover ${t.cover.style}" id="cover">
  <div class="cover-head">
    ${logo}
    <h1 class="cover-title">${esc(m.meta.title)}</h1>
    ${m.meta.subtitle ? `<p class="cover-subtitle">${esc(m.meta.subtitle)}</p>` : ""}
  </div>
  <dl class="cover-meta">
    <div><dt>${esc(L.author)}</dt><dd>${m.meta.authors.map(esc).join("<br>")}</dd></div>
    <div><dt>${esc(L.date)}</dt><dd>${esc(m.meta.dateText)}</dd></div>
    <div><dt>${esc(L.version)}</dt><dd>${esc(m.meta.version)}</dd></div>
  </dl>
</section>`;
}

function toc(m) {
  const items = m.toc.map((e) => `<li class="toc-l${e.level}"><a href="#${e.id}"><span>${esc(e.text)}</span></a></li>`).join("\n");
  return `<nav class="part toc" id="toc"><h1 class="part-title">${esc(m.labels.toc)}</h1><ol>${items}</ol></nav>`;
}

function sources(m) {
  if (!m.sources.length) return "";
  const L = m.labels;
  const items = m.sources
    .map((s) => {
      const parts = [];
      if (s.author) parts.push(esc(s.author));
      parts.push(`<cite>${esc(s.title)}</cite>`);
      if (s.date) parts.push(esc(s.dateText ?? s.date));
      let line = parts.join(". ") + ".";
      if (s.url) line += ` <a href="${esc(s.url)}">${esc(s.url)}</a>`;
      if (s.accessed) line += ` ${esc(L.accessed)} ${esc(s.accessedText ?? s.accessed)}.`;
      return `<li>${line}</li>`;
    })
    .join("\n");
  return `<section class="part" id="sources"><h1 class="part-title">${esc(L.sources)}</h1><ol class="sources">${items}</ol></section>`;
}

function annexes(m) {
  return m.annexes
    .map(
      (a) =>
        `<section class="part annex" id="${a.id}"><h1 class="part-title">${esc(`${m.labels.annex} ${a.letter} — ${a.title}`)}</h1>\n${blocks(a.blocks)}</section>`,
    )
    .join("\n");
}

function changes(m) {
  const L = m.labels;
  const rows = m.changes
    .map((c) => `<tr><td>${esc(c.version)}</td><td>${esc(c.dateText)}</td><td>${esc(c.author ?? "")}</td><td>${esc(c.description)}</td></tr>`)
    .join("");
  return `<section class="part" id="changes"><h1 class="part-title">${esc(L.changes)}</h1>
<table class="changes"><thead><tr><th>${esc(L.version)}</th><th>${esc(L.date)}</th><th>${esc(L.author)}</th><th>${esc(L.description)}</th></tr></thead><tbody>${rows}</tbody></table></section>`;
}

function backCover(m, t) {
  return `<section class="back-cover" id="back-cover">
  <p class="back-title">${esc(m.meta.title)}</p>
  <p class="back-version">${esc(m.labels.version)} ${esc(m.meta.version)} · ${esc(m.meta.dateText)}</p>
  ${t.backCover.contact ? `<p class="back-contact">${esc(t.backCover.contact)}</p>` : ""}
  ${t.backCover.license ? `<p class="back-license">${esc(t.backCover.license)}</p>` : ""}
</section>`;
}

// ---- CSS ----------------------------------------------------------------------------------

function fontFaceCss(theme) {
  const out = [];
  const seen = new Set();
  for (const family of [theme.fonts.heading, theme.fonts.body, theme.fonts.mono]) {
    if (seen.has(family)) continue;
    seen.add(family);
    const faces = fontFaces(theme, family);
    const add = (path, weight, style) =>
      path && out.push(`@font-face { font-family: "${family}"; src: url("${fileUrl(path)}"); font-weight: ${weight}; font-style: ${style}; }`);
    add(faces.regular, 400, "normal");
    add(faces.bold, 700, "normal");
    add(faces.italic, 400, "italic");
    add(faces.boldItalic, 700, "italic");
  }
  return out.join("\n");
}

const family = (name) => (["sans-serif", "serif", "monospace"].includes(name) ? name : `"${name}", sans-serif`);

export function css(theme) {
  const c = theme.colors, ty = theme.type, mg = theme.page.margins;
  const mono = theme.fonts.mono === "monospace" ? `ui-monospace, "Cascadia Mono", Consolas, "DejaVu Sans Mono", monospace` : family(theme.fonts.mono);
  return `
${fontFaceCss(theme)}

@page {
  size: ${theme.page.size};
  margin: ${mg.top}mm ${mg.right}mm ${mg.bottom}mm ${mg.left}mm;
  @bottom-left { content: string(doctitle); font-family: ${family(theme.fonts.body)}; font-size: ${ty.small}pt; color: ${c.textMuted}; vertical-align: top; padding-top: 6mm; }
  @bottom-right { content: counter(page); font-family: ${family(theme.fonts.body)}; font-size: ${ty.small}pt; color: ${c.textMuted}; vertical-align: top; padding-top: 6mm; font-variant-numeric: tabular-nums; }
}
@page cover { margin: 0; @bottom-left { content: none; } @bottom-right { content: none; } }
@page back { margin: 0; @bottom-left { content: none; } @bottom-right { content: none; } }

html { font-family: ${family(theme.fonts.body)}; font-size: ${ty.body}pt; line-height: ${ty.lineHeight}; color: ${c.text}; background: ${c.background}; }
body { margin: 0; widows: 2; orphans: 2; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
p, ul, ol, dl, blockquote, pre, table, figure { margin: 0 0 ${ty.paragraphSpacing}pt; }
h1, h2, h3, .part-title { font-family: ${family(theme.fonts.heading)}; font-weight: 700; line-height: 1.2; break-after: avoid; break-inside: avoid; }
h1, .part-title { font-size: ${ty.h1}pt; color: ${c.accent}; margin: ${ty.h1 * 1.2}pt 0 ${ty.h1 * 0.5}pt; }
h2 { font-size: ${ty.h2}pt; margin: ${ty.h2 * 1.4}pt 0 ${ty.h2 * 0.4}pt; }
h3 { font-size: ${ty.h3}pt; margin: ${ty.h3 * 1.4}pt 0 ${ty.h3 * 0.3}pt; }
.part-title { margin-top: 0; }
ul, ol { padding-left: 1.4em; }
li { margin-bottom: ${ty.paragraphSpacing / 2}pt; }
li > ul, li > ol { margin-top: ${ty.paragraphSpacing / 2}pt; }
a { color: ${c.accent}; text-decoration: underline; text-decoration-thickness: 0.5pt; text-underline-offset: 1.5pt; }
strong { font-weight: 700; }
code { font-family: ${mono}; font-size: 0.9em; }
pre { background: ${c.tableHeader}; padding: 8pt 10pt; border-radius: 3pt; white-space: pre-wrap; break-inside: avoid; }
pre code { font-size: ${ty.small}pt; line-height: 1.45; }
blockquote { margin-left: 0; padding: 2pt 0 2pt 12pt; border-left: 2.5pt solid ${c.accent}; color: ${c.text}; }
blockquote p:last-child { margin-bottom: 0; }
figure { margin-left: 0; margin-right: 0; break-inside: avoid; }
figure img { max-width: 100%; max-height: 180mm; display: block; }
figcaption { font-size: ${ty.small}pt; color: ${c.textMuted}; margin-top: 4pt; }
img { max-width: 100%; }

table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums lining-nums; font-size: ${Math.max(ty.small, ty.body - 1)}pt; line-height: 1.35; }
thead { display: table-header-group; }
tr { break-inside: avoid; }
th { text-align: left; font-weight: 700; background: ${c.tableHeader}; border-bottom: 1pt solid ${c.text}; padding: 5pt 8pt; vertical-align: bottom; }
td { border-bottom: 0.5pt solid ${c.border}; padding: 5pt 8pt; vertical-align: top; }
table.changes td:nth-child(1), table.changes td:nth-child(2) { white-space: nowrap; }

.part { break-before: page; }
main.body > h1:first-child { margin-top: 0; }

/* Cover */
.cover { page: cover; height: ${theme.page.size === "A4" ? "296mm" : "278.4mm"}; display: flex; flex-direction: column; justify-content: space-between; box-sizing: border-box; }
.cover-head { padding: 60mm ${mg.right}mm 18mm ${mg.left}mm; }
.cover.accent-band .cover-head { background: ${c.accent}; color: ${c.onAccent}; }
.cover-title { string-set: doctitle content(text); font-family: ${family(theme.fonts.heading)}; font-size: ${ty.title}pt; line-height: 1.1; font-weight: 700; margin: 0 0 10pt; max-width: 150mm; color: inherit; }
.cover.plain .cover-title { color: ${c.accent}; }
.cover-subtitle { font-size: ${ty.h2}pt; line-height: 1.3; margin: 0; max-width: 150mm; }
.cover-logo { max-height: 18mm; max-width: 60mm; display: block; margin-bottom: 14mm; }
.cover-meta { display: flex; gap: 14mm; padding: 0 ${mg.right}mm ${mg.bottom + 10}mm ${mg.left}mm; margin: 0; font-size: ${ty.body}pt; }
.cover-meta dt { font-size: ${ty.small}pt; color: ${c.textMuted}; text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 3pt; }
.cover-meta dd { margin: 0; }

/* Table of contents */
.toc ol { list-style: none; padding: 0; margin: 0; }
.toc li { margin: 0; }
.toc a { display: flex; gap: 8pt; color: ${c.text}; text-decoration: none; padding: 3pt 0; }
.toc a::after { content: target-counter(attr(href), page); margin-left: auto; font-variant-numeric: tabular-nums; color: ${c.textMuted}; }
.toc .toc-l1 a { font-weight: 700; padding-top: 8pt; }
.toc .toc-l2 a { padding-left: 14pt; }

/* Sources */
ol.sources li { margin-bottom: ${ty.paragraphSpacing}pt; }
ol.sources a { overflow-wrap: anywhere; }

/* Back cover */
.back-cover { page: back; break-before: page; height: ${theme.page.size === "A4" ? "296mm" : "278.4mm"}; box-sizing: border-box; padding: 0 ${mg.right}mm ${mg.bottom + 10}mm ${mg.left}mm; display: flex; flex-direction: column; justify-content: flex-end; border-top: ${theme.cover.style === "accent-band" ? `8mm solid ${c.accent}` : "none"}; }
.back-cover p { margin: 0 0 4pt; }
.back-title { font-family: ${family(theme.fonts.heading)}; font-weight: 700; font-size: ${ty.h2}pt; color: ${c.text}; }
.back-version, .back-contact, .back-license { font-size: ${ty.small}pt; color: ${c.textMuted}; }
`;
}

export function renderHtml(model, theme, { pagedScript }) {
  const m = model;
  return `<!doctype html>
<html lang="${m.meta.lang}">
<head>
<meta charset="utf-8">
<title>${esc(m.meta.title)}</title>
<meta name="author" content="${esc(m.meta.authors.join(", "))}">
<style>${css(theme)}</style>
<script>window.PagedConfig = { auto: true, after: () => { window.__pagedDone = true; } };</script>
<script src="${fileUrl(pagedScript)}"></script>
<script>
// Repeat a table's header row on every page the table continues on (Paged.js does not).
class RepeatTableHeaders extends Paged.Handler {
  afterPageLayout(pageElement, page, breakToken, chunker) {
    for (const table of pageElement.querySelectorAll("table[data-split-from]")) {
      if (table.querySelector("thead")) continue;
      const original = chunker.source.querySelector('[data-ref="' + table.dataset.splitFrom + '"]');
      const thead = original && original.querySelector("thead");
      if (thead) table.insertBefore(thead.cloneNode(true), table.firstChild);
    }
  }
}
Paged.registerHandlers(RepeatTableHeaders);
</script>
</head>
<body>
${cover(m, theme)}
${toc(m)}
<section class="part" id="summary"><h1 class="part-title">${esc(m.labels.summary)}</h1>
${blocks(m.summary)}</section>
<main class="part body">
${blocks(m.body)}
</main>
${sources(m)}
${annexes(m)}
${changes(m)}
${backCover(m, theme)}
</body>
</html>`;
}

