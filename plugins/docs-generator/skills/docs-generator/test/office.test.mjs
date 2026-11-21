import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";
import { XMLValidator } from "fast-xml-parser";
import { buildThmx, buildXltx, CELL_STYLES } from "../scripts/lib/office.mjs";
import { loadTheme } from "../scripts/lib/theme.mjs";
import { tmp, unzipText } from "./helpers.mjs";

const { theme } = loadTheme();
const write = (name, bytes) => {
  const p = join(tmp(), name);
  writeFileSync(p, bytes);
  return p;
};
const thmx = unzipText(write("t.thmx", buildThmx(theme)));
const xltx = unzipText(write("t.xltx", buildXltx(theme, "pt-BR")));

describe("Office theme (.thmx)", () => {
  test("every part is well-formed XML", () => {
    for (const [name, xml] of Object.entries(thmx)) assert.equal(XMLValidator.validate(xml), true, name);
  });

  test("package points to the theme manager and the theme", () => {
    assert.match(thmx["_rels/.rels"], /Target="theme\/theme\/themeManager\.xml"/);
    assert.match(thmx["theme/theme/_rels/themeManager.xml.rels"], /Target="theme1\.xml"/);
    assert.match(thmx["[Content_Types].xml"], /themeManager\+xml/);
  });

  test("colors fill the Office slots and fonts the heading/body slots", () => {
    const t = thmx["theme/theme/theme1.xml"];
    const slot = (name) => t.match(new RegExp(`<a:${name}><a:srgbClr val="([0-9A-F]{6})"/>`))?.[1];
    assert.equal(slot("dk1"), "1F2328");
    assert.equal(slot("lt1"), "FFFFFF");
    assert.equal(slot("dk2"), "57606A");
    assert.equal(slot("lt2"), "F6F8FA");
    assert.equal(slot("accent1"), "0B6E79");
    for (const n of ["accent2", "accent3", "accent4", "accent5", "accent6", "hlink", "folHlink"]) assert.ok(slot(n), n);
    assert.match(t, /<a:majorFont><a:latin typeface="Public Sans"\/>/);
    assert.match(t, /<a:minorFont><a:latin typeface="Public Sans"\/>/);
  });
});

describe("Excel template (.xltx)", () => {
  test("every part is well-formed XML", () => {
    for (const [name, xml] of Object.entries(xltx)) assert.equal(XMLValidator.validate(xml), true, name);
  });

  test("is a template with one empty sheet and the theme", () => {
    assert.match(xltx["[Content_Types].xml"], /spreadsheetml\.template\.main\+xml/);
    assert.match(xltx["xl/workbook.xml"], /<sheet name="Planilha1" sheetId="1"/);
    assert.match(xltx["xl/worksheets/sheet1.xml"], /<sheetData\/>/);
    assert.equal(xltx["xl/theme/theme1.xml"], thmx["theme/theme/theme1.xml"]);
  });

  test("named cell styles, mapped to Excel's built-in ones where they exist", () => {
    const styles = xltx["xl/styles.xml"];
    const names = [...styles.matchAll(/<cellStyle name="([^"]+)"/g)].map((m) => m[1]);
    assert.deepEqual(names, CELL_STYLES);
    for (const [name, id] of [["Normal", 0], ["Title", 15], ["Heading 1", 16], ["Heading 2", 17], ["Currency", 4], ["Percent", 5], ["Note", 10]])
      assert.match(styles, new RegExp(`<cellStyle name="${name}" xfId="\\d+" builtinId="${id}"/>`));
    for (const name of ["Body", "Number", "Date"]) assert.match(styles, new RegExp(`<cellStyle name="${name}" xfId="\\d+"/>`));
  });

  test("a table style named after the theme is the default for new tables", () => {
    const styles = xltx["xl/styles.xml"];
    assert.match(styles, /<tableStyles count="1" defaultTableStyle="clean-modern"/);
    assert.match(styles, /<tableStyle name="clean-modern" pivot="0" count="2">/);
  });

  test("number formats follow the language", () => {
    const pt = unzipText(write("pt.xltx", buildXltx(theme, "pt-BR")))["xl/styles.xml"];
    const en = unzipText(write("en.xltx", buildXltx(theme, "en")));
    const es = unzipText(write("es.xltx", buildXltx(theme, "es")));
    assert.match(pt, /formatCode="&quot;R\$&quot; #,##0\.00"/);
    assert.match(pt, /formatCode="dd\/mm\/yyyy"/);
    assert.match(en["xl/styles.xml"], /formatCode="mm\/dd\/yyyy"/);
    assert.match(en["xl/workbook.xml"], /<sheet name="Sheet1"/);
    assert.match(es["xl/workbook.xml"], /<sheet name="Hoja1"/);
  });
});

// Opens the template in LibreOffice when it is installed: conversion fails on a file it cannot read.
const soffice = ["soffice", "libreoffice"].find((b) => spawnSync(b, ["--version"], { encoding: "utf8" }).status === 0);
test("LibreOffice opens the template", { skip: soffice ? false : "LibreOffice not installed" }, () => {
  const dir = tmp();
  const src = join(dir, "clean-modern.xltx");
  writeFileSync(src, buildXltx(theme));
  const r = spawnSync(soffice, ["--headless", "--convert-to", "xlsx", "--outdir", dir, src], { encoding: "utf8", timeout: 120_000 });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(existsSync(join(dir, "clean-modern.xlsx")));
});
