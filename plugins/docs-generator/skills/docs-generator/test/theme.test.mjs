import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";
import { contrastRatio, loadTheme, nearestPassingColor, officeAccents } from "../scripts/lib/theme.mjs";
import { tmp } from "./helpers.mjs";

const themeFile = (obj) => {
  const p = join(tmp(), "docs-theme.json");
  writeFileSync(p, JSON.stringify(obj));
  return p;
};

describe("contrast", () => {
  test("matches WCAG reference values", () => {
    assert.equal(contrastRatio("#000000", "#FFFFFF").toFixed(2), "21.00");
    assert.equal(contrastRatio("#777777", "#FFFFFF").toFixed(2), "4.48");
    assert.equal(contrastRatio("#FFFFFF", "#FFFFFF"), 1);
  });

  test("nearest passing color reaches the target", () => {
    const c = nearestPassingColor("#9AA0A6", "#FFFFFF", 4.5);
    assert.ok(contrastRatio(c, "#FFFFFF") >= 4.5);
  });
});

describe("Theme file", () => {
  test("clean-modern passes its own checks, including contrast", () => {
    const r = loadTheme("clean-modern");
    assert.deepEqual(r.errors, []);
    assert.deepEqual(r.warnings, []);
    assert.equal(r.theme.fonts.body, "Public Sans");
  });

  test("missing fields are filled from clean-modern", () => {
    const r = loadTheme(themeFile({ name: "brand", colors: { accent: "#1A5FB4" } }));
    assert.deepEqual(r.errors, []);
    assert.equal(r.theme.colors.accent, "#1A5FB4");
    assert.equal(r.theme.colors.text, "#1F2328");
    assert.equal(r.theme.type.body, 11);
  });

  test("a value that is not a color is rejected with its field", () => {
    const r = loadTheme(themeFile({ colors: { accent: "teal" } }));
    assert.equal(r.theme, null);
    assert.match(r.errors.join("\n"), /colors\.accent: must be a color/);
  });

  test("unknown fields are rejected", () => {
    const r = loadTheme(themeFile({ colours: {} }));
    assert.match(r.errors.join("\n"), /unknown field "colours"/);
  });

  test("contrast below WCAG AA reports the pair, ratio and a fix", () => {
    const r = loadTheme(themeFile({ colors: { text: "#9AA0A6" } }));
    assert.equal(r.theme, null);
    const msg = r.errors.find((e) => e.startsWith("colors.text #9AA0A6 on colors.background"));
    assert.ok(msg, r.errors.join("\n"));
    assert.match(msg, /contrast 2\.\d\d:1, below 4\.5:1/);
    assert.match(msg, /nearest passing: #[0-9A-F]{6}/);
  });

  test("large text (accent) needs 3:1", () => {
    const r = loadTheme(themeFile({ colors: { accent: "#B0E0E6" } }));
    assert.match(r.errors.join("\n"), /colors\.accent .* below 3:1/);
  });

  test("a font that is neither bundled nor given as a file is a warning, not an error", () => {
    const r = loadTheme(themeFile({ fonts: { body: "Garamond" } }));
    assert.deepEqual(r.errors, []);
    assert.match(r.warnings.join("\n"), /fonts\.body: "Garamond" is not bundled/);
  });

  test("a missing font file is an error", () => {
    const r = loadTheme(themeFile({ fonts: { body: "Brand", files: [{ family: "Brand", path: "nope.ttf" }] } }));
    assert.match(r.errors.join("\n"), /fonts\.files: file not found/);
  });

  test("WOFF2-only fonts work for the PDF but warn that Word cannot embed them", () => {
    const dir = tmp();
    writeFileSync(join(dir, "brand.woff2"), "");
    writeFileSync(join(dir, "docs-theme.json"), JSON.stringify({ fonts: { body: "Brand", files: [{ family: "Brand", path: "brand.woff2" }] } }));
    const r = loadTheme(join(dir, "docs-theme.json"));
    assert.deepEqual(r.errors, []);
    assert.match(r.warnings.join("\n"), /"Brand" has only WOFF\/WOFF2 files/);
  });

  test("unknown bundled theme or path", () => {
    assert.match(loadTheme("no-such-theme").errors[0], /not found/);
  });

  test("derived Office accents reach 3:1 on the background", () => {
    const { theme } = loadTheme();
    const accents = officeAccents(theme);
    assert.equal(accents.length, 5);
    for (const a of accents) assert.ok(contrastRatio(a, theme.colors.background) >= 3, a);
  });
});
