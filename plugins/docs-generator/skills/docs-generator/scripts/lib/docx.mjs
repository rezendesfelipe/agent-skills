// Renders the document model as a native Word document with real styles.
import { readFileSync } from "node:fs";
import {
  AlignmentType, Bookmark, BorderStyle, Document, ExternalHyperlink, Footer, HeadingLevel, HeightRule, ImageRun, InternalHyperlink,
  LevelFormat, Packer, PageNumber, Paragraph, SectionType, ShadingType, Table, TableCell, TableOfContents, TableRow,
  TabStopType, TextRun, VerticalAlign, WidthType,
} from "docx";
import { estimatePageNumbers } from "docx/layout";
import { fontFaces, officeAccents, officeFont } from "./theme.mjs";
import { imageSize } from "./images.mjs";

const PAGE = { A4: { width: 11906, height: 16838 }, Letter: { width: 12240, height: 15840 } };
const mm = (v) => Math.round((v / 25.4) * 1440); // millimetres → twips
const pt = (v) => Math.round(v * 20); // points → twips
const half = (v) => Math.round(v * 2); // points → half-points
const hex = (c) => c.replace("#", "").toUpperCase();
const NONE = { style: BorderStyle.NONE, size: 0, color: "auto" };

/** Builds the DOCX and returns it as a Buffer. */
export async function renderDocx(model, theme) {
  const m = model, t = theme, c = t.colors, ty = t.type, L = m.labels;
  const page = PAGE[t.page.size];
  const mg = t.page.margins;
  const textWidth = page.width - mm(mg.left) - mm(mg.right); // twips
  const textWidthPx = Math.floor((textWidth / 1440) * 96);
  const headingFont = officeFont(t.fonts.heading), bodyFont = officeFont(t.fonts.body), monoFont = officeFont(t.fonts.mono);
  let olInstance = 0;

  // ---- inline content --------------------------------------------------------------------
  const runs = (nodes = [], fmt = {}) =>
    nodes.flatMap((n) => {
      switch (n.type) {
        case "text": return [new TextRun({ text: n.value, bold: fmt.bold, italics: fmt.italic, style: fmt.link ? "Hyperlink" : undefined })];
        case "strong": return runs(n.children, { ...fmt, bold: true });
        case "emphasis": return runs(n.children, { ...fmt, italic: true });
        case "inlineCode": return [new TextRun({ text: n.value, font: monoFont, size: half(ty.body - 1), bold: fmt.bold })];
        case "break": return [new TextRun({ text: "", break: 1 })];
        case "link":
          if (n.url.startsWith("#")) return [new InternalHyperlink({ anchor: bookmarkName(n.url.slice(1)), children: runs(n.children, { ...fmt, link: true }) })];
          return [new ExternalHyperlink({ link: n.url, children: runs(n.children, { ...fmt, link: true }) })];
        case "image": return [image(n, Math.min(textWidthPx, n.width))];
        default: return runs(n.children, fmt);
      }
    });

  function image(n, maxWidth) {
    const scale = Math.min(1, maxWidth / n.width, 680 / n.height);
    return new ImageRun({
      type: n.format,
      data: readFileSync(n.path),
      transformation: { width: Math.round(n.width * scale), height: Math.round(n.height * scale) },
      altText: { name: n.alt || "image", description: n.alt || "", title: n.alt || "" },
    });
  }

  // ---- blocks ----------------------------------------------------------------------------
  const HEADINGS = { 1: HeadingLevel.HEADING_1, 2: HeadingLevel.HEADING_2, 3: HeadingLevel.HEADING_3 };

  function blocks(list, ctx = {}) {
    return list.flatMap((n, i) => block(n, { ...ctx, first: i === 0 }));
  }

  function block(n, ctx) {
    switch (n.type) {
      case "heading":
      {
        // Bookmarked with the heading's id, so internal links (#s-…) work as in the PDF
        const children = [new Bookmark({ id: bookmarkName(n.id), children: runs(n.children) })];
        if (ctx.annex) return [new Paragraph({ style: `AnnexHeading${n.depth}`, children })];
        return [new Paragraph({ heading: HEADINGS[n.depth], pageBreakBefore: ctx.first && ctx.breakFirst, children })];
      }
      case "paragraph":
        if (n.children.length === 1 && n.children[0].type === "image") {
          const img = n.children[0];
          const out = [new Paragraph({ keepNext: Boolean(img.alt), children: [image(img, textWidthPx)] })];
          if (img.alt) out.push(new Paragraph({ style: "Caption", children: [new TextRun(img.alt)] }));
          return out;
        }
        return [new Paragraph({ style: ctx.style, children: runs(n.children) })];
      case "list":
        return list(n, 0);
      case "blockquote":
        return blocks(n.children, { ...ctx, style: "Quote", first: false });
      case "code":
        return [new Paragraph({ style: "Code", children: n.value.split("\n").map((line, i) => new TextRun({ text: line, break: i ? 1 : 0 })) })];
      case "table":
        return [table(n.children.map((r) => r.children.map((cell) => cell.children)), n.align), spacer()];
      default:
        return [];
    }
  }

  function list(n, level) {
    const instance = n.ordered ? ++olInstance : 0;
    const out = [];
    for (const li of n.children) {
      li.children.forEach((child, j) => {
        if (child.type === "list") out.push(...list(child, level + 1));
        else if (child.type === "paragraph" && j === 0)
          out.push(new Paragraph({
            style: "ListParagraph",
            numbering: n.ordered ? { reference: "ol", level, instance } : { reference: "ul", level },
            children: runs(child.children),
          }));
        else out.push(...block(child, {}));
      });
    }
    return out;
  }

  const spacer = () => new Paragraph({ spacing: { before: 0, after: pt(ty.paragraphSpacing) }, children: [] });

  /**
   * Table with a header row, thin horizontal rules and no vertical lines.
   * @param rows rows of cells; each cell is a list of Markdown inline nodes
   */
  function table(rows, align = [], widths) {
    const cellMargins = { top: pt(4), bottom: pt(4), left: pt(6), right: pt(6) };
    const alignOf = (i) => ({ right: AlignmentType.RIGHT, center: AlignmentType.CENTER })[align[i]] ?? AlignmentType.LEFT;
    return new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      columnWidths: widths,
      borders: {
        top: NONE, left: NONE, right: NONE, insideVertical: NONE,
        bottom: { style: BorderStyle.SINGLE, size: 4, color: hex(c.border) },
        insideHorizontal: { style: BorderStyle.SINGLE, size: 4, color: hex(c.border) },
      },
      rows: rows.map((cells, r) =>
        new TableRow({
          tableHeader: r === 0,
          cantSplit: true,
          children: cells.map((children, i) =>
            new TableCell({
              margins: cellMargins,
              verticalAlign: r === 0 ? VerticalAlign.BOTTOM : VerticalAlign.TOP,
              shading: r === 0 ? { type: ShadingType.CLEAR, fill: hex(c.tableHeader), color: "auto" } : undefined,
              borders: r === 0 ? { bottom: { style: BorderStyle.SINGLE, size: 8, color: hex(c.text) } } : undefined,
              children: [new Paragraph({
                style: "TableText",
                alignment: alignOf(i),
                children: runs(children, { bold: r === 0 }),
              })],
            }),
          ),
        }),
      ),
    });
  }

  const partTitle = (text, { pageBreak = true } = {}) => new Paragraph({ heading: HeadingLevel.HEADING_1, pageBreakBefore: pageBreak, children: [new TextRun(text)] });

  // ---- parts -----------------------------------------------------------------------------
  const coverBand = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: { top: NONE, bottom: NONE, left: NONE, right: NONE, insideHorizontal: NONE, insideVertical: NONE },
    rows: [
      new TableRow({
        height: { value: mm(140), rule: HeightRule.ATLEAST },
        children: [
          new TableCell({
            verticalAlign: VerticalAlign.BOTTOM,
            margins: { left: mm(mg.left), right: mm(mg.right), top: mm(20), bottom: mm(18) },
            shading: t.cover.style === "accent-band" ? { type: ShadingType.CLEAR, fill: hex(c.accent), color: "auto" } : undefined,
            children: [
              ...(t.cover.logo ? [new Paragraph({ spacing: { after: mm(14) }, children: [logo(t.cover.logo)] })] : []),
              new Paragraph({ style: "Title", children: [new TextRun(m.meta.title)] }),
              ...(m.meta.subtitle ? [new Paragraph({ style: "Subtitle", children: [new TextRun(m.meta.subtitle)] })] : []),
            ],
          }),
        ],
      }),
    ],
  });

  function logo(path) {
    const buf = readFileSync(path);
    const s = imageSize(buf);
    const h = 68; // ~18 mm at 96 dpi
    return new ImageRun({ type: s.format, data: buf, transformation: { width: Math.round((s.width / s.height) * h), height: h }, altText: { name: "logo", description: "", title: "" } });
  }

  const metaCell = (label, lines) =>
    new TableCell({
      margins: { left: 0, right: mm(10), top: 0, bottom: 0 },
      children: [
        new Paragraph({ style: "CoverLabel", children: [new TextRun(label.toUpperCase())] }),
        ...lines.map((l) => new Paragraph({ style: "CoverValue", children: [new TextRun(l)] })),
      ],
    });
  const coverMeta = new Table({
    indent: { size: mm(mg.left), type: WidthType.DXA },
    borders: { top: NONE, bottom: NONE, left: NONE, right: NONE, insideHorizontal: NONE, insideVertical: NONE },
    rows: [new TableRow({ children: [metaCell(L.author, m.meta.authors), metaCell(L.date, [m.meta.dateText]), metaCell(L.version, [m.meta.version])] })],
  });

  const tocPart = [
    new Paragraph({ style: "TOCHeading", children: [new TextRun(L.toc)] }),
    new TableOfContents(L.toc, { hyperlink: true, headingStyleRange: "1-2", tabLeader: "none" }),
  ];

  const summaryPart = [partTitle(L.summary), ...blocks(m.summary)];
  const bodyPart = blocks(m.body, { breakFirst: true });

  const sourcesInstance = ++olInstance; // one numbered list for all sources
  const sourcesPart = m.sources.length
    ? [
        partTitle(L.sources),
        ...m.sources.map((s) => {
          const children = [];
          if (s.author) children.push(new TextRun(`${s.author}. `));
          children.push(new TextRun({ text: s.title, italics: true }), new TextRun(". "));
          if (s.date) children.push(new TextRun(`${s.dateText ?? s.date}. `));
          if (s.url) children.push(new ExternalHyperlink({ link: s.url, children: [new TextRun({ text: s.url, style: "Hyperlink" })] }), new TextRun(" "));
          if (s.accessed) children.push(new TextRun(`${L.accessed} ${s.accessedText ?? s.accessed}.`));
          return new Paragraph({ style: "ListParagraph", numbering: { reference: "ol", level: 0, instance: sourcesInstance }, children });
        }),
      ]
    : [];

  const annexPart = m.annexes.flatMap((a) => [partTitle(`${L.annex} ${a.letter} — ${a.title}`), ...blocks(a.blocks, { annex: true })]);

  const changesPart = [
    partTitle(L.changes),
    table(
      [
        [L.version, L.date, L.author, L.description].map(textNode),
        ...m.changes.map((ch) => [ch.version, ch.dateText, ch.author ?? "", ch.description].map(textNode)),
      ],
      [],
      [12, 26, 18, 44].map((p) => Math.round((textWidth * p) / 100)),
    ),
  ];

  // Back cover: an accent band at the top of the page; the text sits in the footer, so it stays at the
  // bottom of the page however Word lays out the rest.
  const backBand = t.cover.style === "accent-band"
    ? [new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        borders: { top: NONE, bottom: NONE, left: NONE, right: NONE, insideHorizontal: NONE, insideVertical: NONE },
        rows: [new TableRow({ height: { value: mm(8), rule: HeightRule.EXACT }, children: [new TableCell({ shading: { type: ShadingType.CLEAR, fill: hex(c.accent), color: "auto" }, children: [new Paragraph({ children: [] })] })] })],
      })]
    : [];
  const sideIndent = { left: mm(mg.left), right: mm(mg.right) };
  const backFooter = new Footer({
    children: [
      new Paragraph({ style: "BackTitle", indent: sideIndent, children: [new TextRun(m.meta.title)] }),
      new Paragraph({ style: "BackDetail", indent: sideIndent, children: [new TextRun(`${L.version} ${m.meta.version} · ${m.meta.dateText}`)] }),
      ...(t.backCover.contact ? [new Paragraph({ style: "BackDetail", indent: sideIndent, children: [new TextRun(t.backCover.contact)] })] : []),
      ...(t.backCover.license ? [new Paragraph({ style: "BackDetail", indent: sideIndent, children: [new TextRun(t.backCover.license)] })] : []),
    ],
  });

  // ---- styles ----------------------------------------------------------------------------
  const heading = (size, color, before, after) => ({
    run: { font: headingFont, size: half(size), bold: true, color: hex(color) },
    paragraph: { spacing: { before: pt(before), after: pt(after), line: 240 }, keepNext: true, keepLines: true },
  });
  const styles = {
    default: {
      document: {
        run: { font: bodyFont, size: half(ty.body), color: hex(c.text) },
        paragraph: { spacing: { after: pt(ty.paragraphSpacing), line: Math.round(240 * ty.lineHeight) } },
      },
      heading1: heading(ty.h1, c.accent, ty.h1 * 1.2, ty.h1 * 0.5),
      heading2: heading(ty.h2, c.text, ty.h2 * 1.4, ty.h2 * 0.4),
      heading3: heading(ty.h3, c.text, ty.h3 * 1.4, ty.h3 * 0.3),
      title: { run: { font: headingFont, size: half(ty.title), bold: true, color: hex(t.cover.style === "accent-band" ? c.onAccent : c.accent) }, paragraph: { spacing: { after: pt(10), line: 264 } } },
      hyperlink: { run: { color: hex(c.accent), underline: { type: "single", color: hex(c.accent) } } },
      listParagraph: { paragraph: { spacing: { after: pt(ty.paragraphSpacing / 2) } } },
    },
    paragraphStyles: [
      { id: "Subtitle", name: "Subtitle", basedOn: "Normal", run: { size: half(ty.h2), color: hex(t.cover.style === "accent-band" ? c.onAccent : c.text) }, paragraph: { spacing: { after: 0, line: 312 } } },
      { id: "AnnexHeading2", name: "Annex Heading 2", basedOn: "Normal", next: "Normal", ...heading(ty.h2, c.text, ty.h2 * 1.4, ty.h2 * 0.4) },
      { id: "AnnexHeading3", name: "Annex Heading 3", basedOn: "Normal", next: "Normal", ...heading(ty.h3, c.text, ty.h3 * 1.4, ty.h3 * 0.3) },
      { id: "TOCHeading", name: "TOC Heading", basedOn: "Normal", next: "Normal", ...heading(ty.h1, c.accent, 0, ty.h1 * 0.5) },
      { id: "TOC1", name: "toc 1", basedOn: "Normal", next: "Normal", run: { bold: true }, paragraph: { spacing: { before: pt(8), after: pt(3) } } },
      { id: "TOC2", name: "toc 2", basedOn: "Normal", next: "Normal", paragraph: { indent: { left: pt(14) }, spacing: { after: pt(3) } } },
      { id: "Code", name: "Code", basedOn: "Normal", run: { font: monoFont, size: half(ty.small) }, paragraph: { spacing: { line: 252, after: pt(ty.paragraphSpacing) }, shading: { type: ShadingType.CLEAR, fill: hex(c.tableHeader), color: "auto" }, indent: { left: pt(6), right: pt(6) }, keepLines: true } },
      { id: "Quote", name: "Quote", basedOn: "Normal", paragraph: { indent: { left: pt(12) }, border: { left: { style: BorderStyle.SINGLE, size: 20, color: hex(c.accent), space: 9 } } } },
      { id: "Caption", name: "caption", basedOn: "Normal", run: { size: half(ty.small), color: hex(c.textMuted) }, paragraph: { spacing: { before: pt(4), after: pt(ty.paragraphSpacing * 1.5) } } },
      { id: "TableText", name: "Table Text", basedOn: "Normal", run: { size: half(Math.max(ty.small, ty.body - 1)) }, paragraph: { spacing: { after: 0, line: 264 } } },
      { id: "FooterText", name: "Footer Text", basedOn: "Normal", run: { size: half(ty.small), color: hex(c.textMuted) }, paragraph: { spacing: { after: 0 } } },
      { id: "CoverLabel", name: "Cover Label", basedOn: "Normal", run: { size: half(ty.small), color: hex(c.textMuted), characterSpacing: 16 }, paragraph: { spacing: { after: pt(3) } } },
      { id: "CoverValue", name: "Cover Value", basedOn: "Normal", paragraph: { spacing: { after: 0 } } },
      { id: "BackTitle", name: "Back Cover Title", basedOn: "Normal", run: { font: headingFont, size: half(ty.h2), bold: true }, paragraph: { spacing: { after: pt(4) } } },
      { id: "BackDetail", name: "Back Cover Detail", basedOn: "Normal", run: { size: half(ty.small), color: hex(c.textMuted) }, paragraph: { spacing: { after: pt(4) } } },
    ],
  };

  const level = (lvl, format, text) => ({
    level: lvl, format, text, alignment: AlignmentType.START,
    style: { paragraph: { indent: { left: pt(18 + lvl * 18), hanging: pt(14) } } },
  });
  const numbering = {
    config: [
      { reference: "ol", levels: [0, 1, 2].map((l) => level(l, [LevelFormat.DECIMAL, LevelFormat.LOWER_LETTER, LevelFormat.LOWER_ROMAN][l], `%${l + 1}.`)) },
      { reference: "ul", levels: [0, 1, 2].map((l) => level(l, LevelFormat.BULLET, ["•", "–", "·"][l])) },
    ],
  };

  // ---- fonts and theme -------------------------------------------------------------------
  // Word embeds TrueType/OpenType files only; WOFF/WOFF2 faces (fine for the PDF) are left out.
  const fonts = [];
  const embeddable = (p) => (p && /\.(ttf|otf)$/i.test(p) ? p : undefined);
  for (const family of new Set([t.fonts.heading, t.fonts.body])) {
    const faces = fontFaces(t, family);
    const f = Object.fromEntries(Object.entries(faces).map(([k, p]) => [k, embeddable(p)]));
    if (!f.regular) continue;
    fonts.push({
      name: family,
      data: readFileSync(f.regular),
      ...(f.bold && { bold: readFileSync(f.bold) }),
      ...(f.italic && { italic: readFileSync(f.italic) }),
      ...(f.boldItalic && { boldItalic: readFileSync(f.boldItalic) }),
    });
  }
  const accents = officeAccents(t).map(hex);

  // ---- sections --------------------------------------------------------------------------
  const pageProps = (margins, footerDistance = mm(14)) => ({ size: page, margin: { ...margins, header: mm(12), footer: footerDistance } });
  // Covers: no side or top margin (the bands reach the page edges); their text is in the footer, bottom-anchored
  // at the same height as in the PDF.
  const coverMargins = { top: 0, right: 0, bottom: mm(80), left: 0 };
  const coverFooterDistance = mm(mg.bottom + 10);
  const bodyMargins = { top: mm(mg.top), right: mm(mg.right), bottom: mm(mg.bottom), left: mm(mg.left) };
  const footer = new Footer({
    children: [
      new Paragraph({
        style: "FooterText",
        tabStops: [{ type: TabStopType.RIGHT, position: textWidth }],
        children: [new TextRun(m.meta.title), new TextRun({ children: ["\t", PageNumber.CURRENT] })],
      }),
    ],
  });

  const doc = new Document({
    creator: m.meta.authors.join(", "),
    title: m.meta.title,
    description: m.meta.subtitle ?? "",
    styles,
    numbering,
    fonts,
    theme: {
      name: t.name,
      colors: {
        dark1: hex(c.text), light1: hex(c.background), dark2: hex(c.textMuted), light2: hex(c.tableHeader),
        accent1: hex(c.accent), accent2: accents[0], accent3: accents[1], accent4: accents[2], accent5: accents[3], accent6: accents[4],
        hyperlink: hex(c.accent), followedHyperlink: hex(c.textMuted),
      },
      fonts: { headings: headingFont, body: bodyFont },
    },
    pageNumbers: estimatePageNumbers,
    sections: [
      {
        properties: { page: pageProps(coverMargins, coverFooterDistance) },
        footers: { default: new Footer({ children: [coverMeta] }) },
        children: [coverBand, new Paragraph({ children: [] })],
      },
      {
        properties: { type: SectionType.NEXT_PAGE, page: pageProps(bodyMargins) },
        footers: { default: footer },
        children: [...tocPart, ...summaryPart, ...bodyPart, ...sourcesPart, ...annexPart, ...changesPart],
      },
      {
        properties: { type: SectionType.NEXT_PAGE, page: pageProps(coverMargins, coverFooterDistance) },
        footers: { default: backFooter },
        children: [...backBand, new Paragraph({ children: [] })],
      },
    ],
  });
  return Packer.toBuffer(doc);
}

const textNode = (value) => [{ type: "text", value: String(value) }];

/** Word bookmark names: letters, digits and underscores, at most 40 characters. */
export const bookmarkName = (id) => id.replace(/[^A-Za-z0-9_]/g, "_").slice(0, 40);
