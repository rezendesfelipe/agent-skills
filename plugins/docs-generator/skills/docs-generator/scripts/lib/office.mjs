// Writes an Office theme (.thmx) and an Excel template (.xltx) from a docs-generator theme, as OOXML parts
// zipped with fflate. No content: colors, fonts, named cell styles and a default table style only.
import { strToU8, zipSync } from "fflate";
import { officeAccents, officeFont } from "./theme.mjs";

const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const NS = {
  a: "http://schemas.openxmlformats.org/drawingml/2006/main",
  ct: "http://schemas.openxmlformats.org/package/2006/content-types",
  rel: "http://schemas.openxmlformats.org/package/2006/relationships",
  r: "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
  main: "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
};
const REL = {
  officeDocument: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument",
  theme: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme",
  worksheet: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet",
  styles: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles",
};
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const rgb = (c) => c.replace("#", "").toUpperCase();
const argb = (c) => "FF" + rgb(c);

/** Office color slots for a theme: dk1, lt1, dk2, lt2, accent1–6, hlink, folHlink. */
export function colorSlots(theme) {
  const c = theme.colors;
  const [a2, a3, a4, a5, a6] = officeAccents(theme);
  return {
    dk1: c.text, lt1: c.background, dk2: c.textMuted, lt2: c.tableHeader,
    accent1: c.accent, accent2: a2, accent3: a3, accent4: a4, accent5: a5, accent6: a6,
    hlink: c.accent, folHlink: c.textMuted,
  };
}

export function themeXml(theme) {
  const slots = colorSlots(theme);
  const clr = Object.entries(slots).map(([k, v]) => `<a:${k}><a:srgbClr val="${rgb(v)}"/></a:${k}>`).join("");
  const font = (name) => `<a:latin typeface="${esc(name)}"/><a:ea typeface=""/><a:cs typeface=""/>`;
  const solid = (mod = "") => `<a:solidFill><a:schemeClr val="phClr">${mod}</a:schemeClr></a:solidFill>`;
  const ln = (w) => `<a:ln w="${w}" cap="flat" cmpd="sng" algn="ctr">${solid()}<a:prstDash val="solid"/><a:miter lim="800000"/></a:ln>`;
  return (
    XML +
    `<a:theme xmlns:a="${NS.a}" name="${esc(theme.name)}"><a:themeElements>` +
    `<a:clrScheme name="${esc(theme.name)}">${clr}</a:clrScheme>` +
    `<a:fontScheme name="${esc(theme.name)}"><a:majorFont>${font(officeFont(theme.fonts.heading))}</a:majorFont><a:minorFont>${font(officeFont(theme.fonts.body))}</a:minorFont></a:fontScheme>` +
    `<a:fmtScheme name="${esc(theme.name)}">` +
    `<a:fillStyleLst>${solid()}${solid('<a:tint val="50000"/>')}${solid('<a:shade val="80000"/>')}</a:fillStyleLst>` +
    `<a:lnStyleLst>${ln(6350)}${ln(12700)}${ln(19050)}</a:lnStyleLst>` +
    `<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>` +
    `<a:bgFillStyleLst>${solid()}${solid('<a:tint val="95000"/>')}${solid('<a:shade val="80000"/>')}</a:bgFillStyleLst>` +
    `</a:fmtScheme></a:themeElements><a:objectDefaults/><a:extraClrSchemeLst/></a:theme>`
  );
}

const rels = (list) =>
  XML + `<Relationships xmlns="${NS.rel}">` + list.map(([id, type, target]) => `<Relationship Id="${id}" Type="${type}" Target="${target}"/>`).join("") + `</Relationships>`;

const zip = (files) => zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)])), { level: 6 });

/** Office theme file: applies colors and fonts in Excel, Word and PowerPoint (Design/Page Layout → Themes → Browse). */
export function buildThmx(theme) {
  return zip({
    "[Content_Types].xml":
      XML +
      `<Types xmlns="${NS.ct}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>` +
      `<Override PartName="/theme/theme/themeManager.xml" ContentType="application/vnd.openxmlformats-officedocument.themeManager+xml"/>` +
      `<Override PartName="/theme/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/></Types>`,
    "_rels/.rels": rels([["rId1", REL.officeDocument, "theme/theme/themeManager.xml"]]),
    "theme/theme/themeManager.xml": XML + `<a:themeManager xmlns:a="${NS.a}"/>`,
    "theme/theme/_rels/themeManager.xml.rels": rels([["rId1", REL.theme, "theme1.xml"]]),
    "theme/theme/theme1.xml": themeXml(theme),
  });
}

/** Number formats and sheet name per language. */
const LOCALE = {
  "pt-BR": { currency: '"R$" #,##0.00', date: "dd/mm/yyyy", sheet: "Planilha1" },
  en: { currency: '"$"#,##0.00', date: "mm/dd/yyyy", sheet: "Sheet1" },
  es: { currency: '#,##0.00 "€"', date: "dd/mm/yyyy", sheet: "Hoja1" },
};

/** Named cell styles of the template, in order. builtinId maps a style to Excel's built-in one of the same role. */
export const CELL_STYLES = ["Normal", "Title", "Heading 1", "Heading 2", "Body", "Number", "Currency", "Percent", "Date", "Note"];

export function stylesXml(theme, lang = "pt-BR") {
  const t = theme, c = t.colors, ty = t.type, loc = LOCALE[lang] ?? LOCALE["pt-BR"];
  const body = esc(officeFont(t.fonts.body)), head = esc(officeFont(t.fonts.heading));
  // Theme color indexes in SpreadsheetML: 0 lt1, 1 dk1, 2 lt2, 3 dk2, 4 accent1
  const fonts = [
    `<font><sz val="${ty.body}"/><color theme="1"/><name val="${body}"/><family val="2"/><scheme val="minor"/></font>`,
    `<font><b/><sz val="${Math.round(ty.h1 * 0.9)}"/><color theme="4"/><name val="${head}"/><family val="2"/><scheme val="major"/></font>`,
    `<font><b/><sz val="${ty.h2}"/><color theme="1"/><name val="${head}"/><family val="2"/><scheme val="major"/></font>`,
    `<font><b/><sz val="${ty.h3}"/><color theme="1"/><name val="${head}"/><family val="2"/><scheme val="major"/></font>`,
    `<font><sz val="${ty.small}"/><color theme="3"/><name val="${body}"/><family val="2"/><scheme val="minor"/></font>`,
  ];
  const fills = [
    `<fill><patternFill patternType="none"/></fill>`,
    `<fill><patternFill patternType="gray125"/></fill>`,
    `<fill><patternFill patternType="solid"><fgColor theme="2"/><bgColor indexed="64"/></patternFill></fill>`,
  ];
  const borders = [
    `<border><left/><right/><top/><bottom/><diagonal/></border>`,
    `<border><left/><right/><top/><bottom style="medium"><color theme="4"/></bottom><diagonal/></border>`,
    `<border><left/><right/><top/><bottom style="thin"><color rgb="${argb(c.border)}"/></bottom><diagonal/></border>`,
  ];
  const numFmts = [
    [164, "#,##0.00"],
    [165, loc.currency],
    [166, loc.date],
  ];
  // [name, builtinId, numFmtId, fontId, fillId, borderId, alignment]
  const defs = [
    ["Normal", 0, 0, 0, 0, 0],
    ["Title", 15, 0, 1, 0, 0],
    ["Heading 1", 16, 0, 2, 0, 1],
    ["Heading 2", 17, 0, 3, 0, 2],
    ["Body", null, 0, 0, 0, 0, '<alignment vertical="top" wrapText="1"/>'],
    ["Number", null, 164, 0, 0, 0],
    ["Currency", 4, 165, 0, 0, 0],
    ["Percent", 5, 10, 0, 0, 0],
    ["Date", null, 166, 0, 0, 0, '<alignment horizontal="left"/>'],
    ["Note", 10, 0, 4, 2, 0, '<alignment vertical="top" wrapText="1"/>'],
  ];
  const xf = ([, , numFmt, font, fill, border, align], xfId) => {
    const apply = `applyNumberFormat="${numFmt ? 1 : 0}" applyFont="1" applyFill="${fill ? 1 : 0}" applyBorder="${border ? 1 : 0}" applyAlignment="${align ? 1 : 0}"`;
    const attrs = `numFmtId="${numFmt}" fontId="${font}" fillId="${fill}" borderId="${border}"${xfId === undefined ? "" : ` xfId="${xfId}"`} ${apply}`;
    return align ? `<xf ${attrs}>${align}</xf>` : `<xf ${attrs}/>`;
  };
  const dxfs = [
    // wholeTable: thin horizontal rules only
    `<dxf><border><left/><right/><top/><bottom style="thin"><color rgb="${argb(c.border)}"/></bottom><vertical/><horizontal style="thin"><color rgb="${argb(c.border)}"/></horizontal></border></dxf>`,
    // headerRow: bold, header background, rule under it
    `<dxf><font><b/><color theme="1"/></font><fill><patternFill patternType="solid"><bgColor rgb="${argb(c.tableHeader)}"/></patternFill></fill><border><bottom style="thin"><color theme="1"/></bottom></border></dxf>`,
  ];
  const tableStyle = esc(t.name);
  return (
    XML +
    `<styleSheet xmlns="${NS.main}">` +
    `<numFmts count="${numFmts.length}">${numFmts.map(([id, code]) => `<numFmt numFmtId="${id}" formatCode="${esc(code)}"/>`).join("")}</numFmts>` +
    `<fonts count="${fonts.length}">${fonts.join("")}</fonts>` +
    `<fills count="${fills.length}">${fills.join("")}</fills>` +
    `<borders count="${borders.length}">${borders.join("")}</borders>` +
    `<cellStyleXfs count="${defs.length}">${defs.map((d) => xf(d)).join("")}</cellStyleXfs>` +
    `<cellXfs count="${defs.length}">${defs.map((d, i) => xf(d, i)).join("")}</cellXfs>` +
    `<cellStyles count="${defs.length}">${defs
      .map(([name, builtin], i) => `<cellStyle name="${esc(name)}" xfId="${i}"${builtin === null ? "" : ` builtinId="${builtin}"`}/>`)
      .join("")}</cellStyles>` +
    `<dxfs count="${dxfs.length}">${dxfs.join("")}</dxfs>` +
    `<tableStyles count="1" defaultTableStyle="${tableStyle}" defaultPivotStyle="PivotStyleLight16">` +
    `<tableStyle name="${tableStyle}" pivot="0" count="2"><tableStyleElement type="wholeTable" dxfId="0"/><tableStyleElement type="headerRow" dxfId="1"/></tableStyle>` +
    `</tableStyles></styleSheet>`
  );
}

/** Excel template: the theme, the named cell styles, a default table style and one empty sheet. */
export function buildXltx(theme, lang = "pt-BR") {
  const loc = LOCALE[lang] ?? LOCALE["pt-BR"];
  const rowHeight = Math.round(theme.type.body * 1.36 * 4) / 4;
  return zip({
    "[Content_Types].xml":
      XML +
      `<Types xmlns="${NS.ct}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>` +
      `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.template.main+xml"/>` +
      `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` +
      `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
      `<Override PartName="/xl/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/></Types>`,
    "_rels/.rels": rels([["rId1", REL.officeDocument, "xl/workbook.xml"]]),
    "xl/workbook.xml":
      XML +
      `<workbook xmlns="${NS.main}" xmlns:r="${NS.r}"><bookViews><workbookView/></bookViews>` +
      `<sheets><sheet name="${loc.sheet}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": rels([
      ["rId1", REL.worksheet, "worksheets/sheet1.xml"],
      ["rId2", REL.styles, "styles.xml"],
      ["rId3", REL.theme, "theme/theme1.xml"],
    ]),
    "xl/worksheets/sheet1.xml":
      XML +
      `<worksheet xmlns="${NS.main}"><sheetViews><sheetView workbookViewId="0"/></sheetViews>` +
      `<sheetFormatPr defaultRowHeight="${rowHeight}" customHeight="1"/><sheetData/></worksheet>`,
    "xl/styles.xml": stylesXml(theme, lang),
    "xl/theme/theme1.xml": themeXml(theme),
  });
}
