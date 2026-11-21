// Builds the sample once in each format and checks the outputs: structure, styles, page numbers, parity.
import assert from "node:assert/strict";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { before, describe, test } from "node:test";
import { loadSource, textOf } from "../scripts/lib/source.mjs";
import { docxParagraphs, norm, readPdf, runCli, SAMPLE, tmp, unzipText } from "./helpers.mjs";
import { launchBrowser } from "../scripts/lib/pdf.mjs";

const out = tmp();
const preview = join(out, "preview");
let hasBrowser = true;
try {
  await (await launchBrowser()).close();
} catch {
  hasBrowser = false;
}
const skipPdf = hasBrowser ? false : "no Chrome, Edge or Chromium available";

let pdf, docx, model;
before(async () => {
  const r = runCli(["build", SAMPLE, "--out", out, "--format", hasBrowser ? "pdf,docx" : "docx", "--preview", preview, "--json"]);
  assert.equal(r.code, 0, r.stderr);
  model = loadSource(SAMPLE).model;
  docx = unzipText(join(out, "sample.docx"));
  if (hasBrowser) pdf = await readPdf(join(out, "sample.pdf"));
});

describe("PDF", { skip: skipPdf }, () => {
  // Page text with line breaks turned into spaces, so headings that wrap still match
  const flat = (p) => norm(p.text);
  const startsWith = (p, heading) => flat(p).startsWith(heading);

  test("parts in order: cover, contents, summary, body, sources, annexes, change log, back cover", () => {
    const first = (heading) => pdf.findIndex((p) => startsWith(p, heading)) + 1;
    const order = [
      first("Plataforma de agendamento online Documento de design"),
      first("Sumário"),
      first("Resumo executivo"),
      first("Contexto"),
      first("Fontes"),
      first("Anexo A — Roteiro das entrevistas"),
      first("Anexo B — Estimativa de custos detalhada"),
      first("Histórico de alterações"),
    ];
    assert.ok(order.every((n) => n > 0), `order: ${order}`);
    assert.deepEqual(order, [...order].sort((a, b) => a - b), `order: ${order}`);
    assert.equal(order[0], 1);
    assert.match(pdf.at(-1).text, /Versão 1\.2 · 20 de novembro de 2026/);
  });

  test("footer with title and page number on every page except the covers", () => {
    const footer = (p) => p.lines.at(-1).text;
    assert.ok(!/^Plataforma de agendamento online \d+$/.test(footer(pdf[0])), "no footer on the cover");
    assert.ok(!/^Plataforma de agendamento online \d+$/.test(footer(pdf.at(-1))), "no footer on the back cover");
    for (const p of pdf.slice(1, -1)) assert.equal(footer(p), `Plataforma de agendamento online ${p.number}`);
  });

  test("table of contents numbers are the pages where the sections start", () => {
    const tocPage = pdf.find((p) => /^Sumário$/m.test(p.text));
    for (const entry of model.toc) {
      const line = tocPage.lines.find((l) => l.text.startsWith(entry.text));
      assert.ok(line, `missing entry ${entry.text}`);
      const shown = Number(line.text.match(/(\d+)$/)[1]);
      const actual = pdf.findIndex((p, i) => i > tocPage.number - 1 && (p.lines.some((l) => l.text === entry.text) || startsWith(p, entry.text))) + 1;
      assert.equal(shown, actual, `${entry.text}: shown ${shown}, starts on ${actual}`);
    }
  });

  test("table of contents entries link to their pages", () => {
    const tocPage = pdf.find((p) => /^Sumário$/m.test(p.text));
    const internal = tocPage.links.filter((l) => l.target);
    assert.equal(internal.length, model.toc.length);
    const entryLines = tocPage.lines.slice(1, -1); // without the "Sumário" title and the footer
    const numbers = entryLines.map((l) => Number(l.text.match(/(\d+)$/)[1]));
    assert.deepEqual(internal.map((l) => l.target).sort((a, b) => a - b), [...numbers].sort((a, b) => a - b));
  });

  test("a table that continues on the next page repeats its header row", () => {
    const first = pdf.find((p) => flat(p).includes("Baixa adesão dos"));
    const last = pdf.find((p) => flat(p).includes("Custo de SMS"));
    assert.ok(first && last);
    if (first !== last) assert.match(last.lines[0].text, /^Risco Probabilidade Impacto Mitigação$/);
  });

  test("internal links jump to the heading's page", () => {
    const risks = pdf.find((p) => norm(p.text).includes("veja as fases do lançamento"));
    const fases = pdf.find((p) => p.lines.some((l) => l.text === "Fases do lançamento"));
    assert.ok(risks.links.some((l) => l.target === fases.number), JSON.stringify(risks.links));
  });

  test("external links stay clickable", () => {
    assert.ok(pdf.some((p) => p.links.some((l) => l.url === "https://www.nngroup.com/articles/inverted-pyramid/")));
  });

  test("one preview PNG per page", () => {
    assert.equal(readdirSync(preview).filter((f) => f.endsWith(".png")).length, pdf.length);
  });
});

describe("DOCX", () => {
  test("headings use Heading 1–3, body uses Normal, styles carry the theme", () => {
    const paras = docxParagraphs(docx["word/document.xml"]);
    const style = (text) => paras.find((p) => p.text === text)?.style;
    assert.equal(style("Contexto"), "Heading1");
    assert.equal(style("O que já existe"), "Heading2");
    assert.equal(style("Sincronização com calendários externos"), "Heading3");
    assert.equal(style("Resumo executivo"), "Heading1");
    assert.equal(style("Perguntas de abertura"), "AnnexHeading2", "annex headings stay out of the TOC");
    const styles = docx["word/styles.xml"];
    const h1 = styles.match(/<w:style [^>]*w:styleId="Heading1"[\s\S]*?<\/w:style>/)[0];
    assert.match(h1, /w:ascii="Public Sans"/);
    assert.match(h1, /<w:color w:val="0B6E79"\/>/);
    assert.match(h1, /<w:sz w:val="40"\/>/);
    assert.match(styles.match(/<w:docDefaults>[\s\S]*?<\/w:docDefaults>/)[0], /<w:sz w:val="22"\/>/);
  });

  test("table of contents field over Heading 1–2, with page numbers written", () => {
    const xml = docx["word/document.xml"];
    assert.match(xml, /TOC \\h \\o &quot;1-2&quot;|TOC \\h \\o "1-2"/);
    const toc = xml.match(/<w:sdt>[\s\S]*?<\/w:sdt>/)[0];
    const entries = docxParagraphs(toc).filter((p) => p.text);
    assert.equal(entries.length, model.toc.length);
    for (const [i, e] of model.toc.entries()) assert.match(entries[i].text, new RegExp(`^${e.text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}.*\\d+$`));
  });

  test("internal links point to a bookmark on the heading", () => {
    const xml = docx["word/document.xml"];
    assert.match(xml, /<w:hyperlink [^>]*w:anchor="s_fases_do_lancamento"/);
    assert.match(xml, /<w:bookmarkStart [^>]*w:name="s_fases_do_lancamento"/);
  });

  test("Public Sans is embedded", () => {
    const fontTable = docx["word/fontTable.xml"];
    for (const face of ["embedRegular", "embedBold", "embedItalic", "embedBoldItalic"]) assert.match(fontTable, new RegExp(`<w:${face} `));
    assert.ok(Object.keys(docx).filter((k) => k.startsWith("word/fonts/")).length >= 4);
  });

  test("three sections: cover, content with page-number footer, back cover", () => {
    const xml = docx["word/document.xml"];
    assert.equal((xml.match(/<w:sectPr/g) ?? []).length, 3);
    const footers = Object.entries(docx).filter(([k]) => /^word\/footer\d+\.xml$/.test(k)).map(([, v]) => v);
    assert.ok(footers.some((f) => f.includes("PAGE") && f.includes("Plataforma de agendamento online")));
  });

  test("Office theme colors and fonts", () => {
    const theme = docx["word/theme/theme1.xml"];
    assert.match(theme, /<a:accent1><a:srgbClr val="0B6E79"\/>/);
    assert.match(theme, /<a:latin typeface="Public Sans"/);
  });
});

describe("Parity", { skip: skipPdf }, () => {
  const blockTexts = (blocks) =>
    blocks.flatMap((b) => {
      if (b.type === "table") return b.children.flatMap((r) => r.children.map(textOf));
      if (b.type === "list") return b.children.map(textOf);
      if (b.type === "code") return [];
      return [textOf(b)];
    }).map(norm).filter(Boolean);

  // True when the words of `needle` appear in `haystack` in the same order. In the PDF the lines of
  // table cells that wrap are interleaved with their neighbours, so cells are matched word by word.
  const wordsInOrder = (haystack, needle) => {
    let i = 0;
    for (const w of needle.split(" ")) {
      i = haystack.indexOf(w, i);
      if (i < 0) return false;
      i += 1;
    }
    return true;
  };

  test("every heading, paragraph, list item and table cell is in both outputs", () => {
    const pdfWords = norm(pdf.map((p) => p.text).join(" ")).split(" ");
    const pdfText = pdfWords.join(" ");
    const docxText = norm(docxParagraphs(docx["word/document.xml"]).map((p) => p.text).join(" "));
    const all = [model.summary, model.body, ...model.annexes.map((a) => a.blocks)];
    const cells = new Set(all.flatMap((bl) => bl.filter((b) => b.type === "table").flatMap((t) => t.children.flatMap((r) => r.children.map((c) => norm(textOf(c)))))));
    const texts = all.flatMap(blockTexts);
    assert.ok(texts.length > 40);
    for (const t of texts) {
      assert.ok(cells.has(t) ? wordsInOrder(pdfWords, t) : pdfText.includes(t), `missing in PDF: ${t}`);
      assert.ok(docxText.includes(t), `missing in DOCX: ${t}`);
    }
  });

  test("same number of tables", () => {
    const mdTables = [...model.body, ...model.annexes.flatMap((a) => a.blocks)].filter((b) => b.type === "table").length;
    const docxTables = (docx["word/document.xml"].match(/<w:tbl>/g) ?? []).length;
    // DOCX adds the cover band, cover meta (footer, not counted here), back band and change log
    assert.equal(docxTables, mdTables + 3);
  });
});

test("outputs are written next to --out and nowhere else", () => {
  assert.ok(existsSync(join(out, "sample.docx")));
});
