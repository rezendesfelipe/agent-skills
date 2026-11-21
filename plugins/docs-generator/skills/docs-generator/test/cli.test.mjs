import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";
import { MINIMAL, runCli, tmp, writeSource } from "./helpers.mjs";

// The engine has no default theme; tests choose the bundled one on purpose.
const THEME = ["--theme", "clean-modern"];

describe("Engine command line", () => {
  test("--help lists the commands and exits 0", () => {
    const r = runCli(["--help"]);
    assert.equal(r.code, 0);
    for (const c of ["check", "build", "theme check", "theme init", "office-theme"]) assert.ok(r.stdout.includes(c), c);
  });

  test("unknown command is a usage error", () => {
    assert.equal(runCli(["publish"]).code, 2);
  });

  test("check --json reports every error with its field and exits 1", () => {
    const fm = MINIMAL.replace(/^summary:.*$/m, "").replace("date: 2026-11-20\nversion", "date: 2026-13-45\nversion");
    const r = runCli(["check", writeSource(tmp(), "doc.md", fm), "--json"]);
    assert.equal(r.code, 1);
    const out = JSON.parse(r.stdout);
    assert.equal(out.ok, false);
    const where = out.errors.map((e) => e.where);
    assert.ok(where.includes("summary"), where);
    assert.ok(where.includes("date"), where);
  });

  test("build with errors writes nothing", () => {
    const dir = tmp();
    const src = writeSource(dir, "doc.md", MINIMAL.replace(/^summary:.*$/m, ""));
    const r = runCli(["build", src, "--format", "docx", ...THEME]);
    assert.equal(r.code, 1);
    assert.match(r.stdout, /summary: is required/);
    assert.deepEqual(readdirSync(dir), ["doc.md"]);
  });

  test("build docx writes next to the source and prints the path", () => {
    const dir = tmp();
    const src = writeSource(dir, "report.md", MINIMAL);
    const r = runCli(["build", src, "--format", "docx", ...THEME, "--json"]);
    assert.equal(r.code, 0, r.stderr);
    const out = JSON.parse(r.stdout);
    assert.deepEqual(out.outputs.map((o) => o.path), [join(dir, "report.docx")]);
    assert.ok(existsSync(join(dir, "report.docx")));
  });

  test("build without a theme refuses, writes nothing, and tells the agent to ask the user", () => {
    const dir = tmp();
    const src = writeSource(dir, "doc.md", MINIMAL);
    const r = runCli(["build", src, "--format", "docx"]);
    assert.equal(r.code, 2);
    assert.match(r.stderr, /No theme was chosen, so nothing was written\. Ask the user which theme to use/);
    assert.match(r.stderr, /--theme clean-modern for the bundled default/);
    assert.deepEqual(readdirSync(dir), ["doc.md"]);

    const json = runCli(["build", src, "--format", "docx", "--json"]);
    assert.equal(json.code, 2);
    const out = JSON.parse(json.stdout);
    assert.equal(out.ok, false);
    assert.match(out.error, /Ask the user which theme to use/);
    assert.deepEqual(readdirSync(dir), ["doc.md"]);
  });

  test("build reports the theme and how it was chosen: --theme", () => {
    const src = writeSource(tmp(), "doc.md", MINIMAL);
    const text = runCli(["build", src, "--format", "docx", ...THEME]);
    assert.match(text.stdout, /^theme: clean-modern \(.*; from --theme\)$/m);
    const json = JSON.parse(runCli(["build", src, "--format", "docx", ...THEME, "--json"]).stdout);
    assert.equal(json.themeName, "clean-modern");
    assert.equal(json.themeSource, "flag");
  });

  test("an unknown theme name is a validation error, not a fallback", () => {
    const dir = tmp();
    const r = runCli(["build", writeSource(dir, "doc.md", MINIMAL), "--format", "docx", "--theme", "no-such-theme"]);
    assert.equal(r.code, 1);
    assert.match(r.stdout, /theme "no-such-theme" not found/);
    assert.deepEqual(readdirSync(dir), ["doc.md"]);
  });

  test("bad --format is a usage error", () => {
    const src = writeSource(tmp(), "doc.md", MINIMAL);
    assert.equal(runCli(["build", src, "--format", "odt"]).code, 2);
  });

  test("without a browser, PDF fails with the install hint and DOCX still builds", () => {
    const dir = tmp();
    const src = writeSource(dir, "doc.md", MINIMAL);
    const env = { DOCS_GENERATOR_CHROMIUM: join(dir, "no-such-browser") };
    const r = runCli(["build", src, ...THEME], { env });
    assert.equal(r.code, 1);
    assert.match(r.stdout, /npx playwright install chromium/);
    assert.ok(existsSync(join(dir, "doc.docx")), "DOCX is still written");
    assert.equal(runCli(["build", src, "--format", "docx", ...THEME], { env }).code, 0);
  });

  test("a docs-theme.json next to the source is used and reported", () => {
    const dir = tmp();
    const src = writeSource(dir, "doc.md", MINIMAL);
    writeFileSync(join(dir, "docs-theme.json"), JSON.stringify({ name: "brand", colors: { accent: "#7A1FA2" } }));
    assert.equal(JSON.parse(runCli(["check", src, "--json"]).stdout).theme, join(dir, "docs-theme.json"));
    const r = runCli(["build", src, "--format", "docx", "--json"]);
    assert.equal(r.code, 0, r.stderr);
    const out = JSON.parse(r.stdout);
    assert.equal(out.themeName, "brand");
    assert.equal(out.themeSource, "file-next-to-source");
    assert.match(runCli(["build", src, "--format", "docx"]).stdout, /from docs-theme\.json next to the source\)$/m);
  });

  test("--theme wins over a docs-theme.json next to the source", () => {
    const dir = tmp();
    const src = writeSource(dir, "doc.md", MINIMAL);
    writeFileSync(join(dir, "docs-theme.json"), JSON.stringify({ name: "brand" }));
    const out = JSON.parse(runCli(["build", src, "--format", "docx", ...THEME, "--json"]).stdout);
    assert.equal(out.themeName, "clean-modern");
    assert.equal(out.themeSource, "flag");
  });

  test("a theme that fails contrast stops the build", () => {
    const dir = tmp();
    const src = writeSource(dir, "doc.md", MINIMAL);
    writeFileSync(join(dir, "docs-theme.json"), JSON.stringify({ colors: { text: "#CCCCCC" } }));
    const r = runCli(["build", src, "--format", "docx"]);
    assert.equal(r.code, 1);
    assert.match(r.stdout, /colors\.text #CCCCCC on colors\.background #FFFFFF has contrast/);
    assert.ok(!existsSync(join(dir, "doc.docx")));
  });

  test("theme init writes an editable copy and refuses to overwrite", () => {
    const out = join(tmp(), "docs-theme.json");
    assert.equal(runCli(["theme", "init", "--out", out]).code, 0);
    const copy = JSON.parse(readFileSync(out, "utf8"));
    assert.equal(copy.name, "my-theme");
    assert.equal(runCli(["theme", "check", out]).code, 0);
    assert.equal(runCli(["theme", "init", "--out", out]).code, 1);
  });

  test("office-theme writes <name>.xltx and <name>.thmx", () => {
    const dir = tmp();
    const r = runCli(["office-theme", ...THEME, "--out", dir, "--lang", "en", "--json"]);
    assert.equal(r.code, 0, r.stderr);
    assert.deepEqual(readdirSync(dir).sort(), ["clean-modern.thmx", "clean-modern.xltx"]);
    assert.equal(runCli(["office-theme", ...THEME, "--out", dir, "--lang", "fr"]).code, 2);
  });

  test("office-theme without a theme refuses and writes nothing", () => {
    const out = tmp();
    const cwd = tmp(); // no docs-theme.json here
    const r = runCli(["office-theme", "--out", out], { cwd });
    assert.equal(r.code, 2);
    assert.match(r.stderr, /Ask the user which theme to use/);
    assert.deepEqual(readdirSync(out), []);
  });

  test("office-theme uses a docs-theme.json in the current folder", () => {
    const cwd = tmp();
    const out = tmp();
    writeFileSync(join(cwd, "docs-theme.json"), JSON.stringify({ name: "brand", colors: { accent: "#7A1FA2" } }));
    const r = runCli(["office-theme", "--out", out], { cwd });
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /from docs-theme\.json in the current folder/);
    assert.deepEqual(readdirSync(out).sort(), ["brand.thmx", "brand.xltx"]);
  });
});
