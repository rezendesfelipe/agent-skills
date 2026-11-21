import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";
import { loadSource } from "../scripts/lib/source.mjs";
import { MINIMAL, SAMPLE, tmp, writeSource } from "./helpers.mjs";

const messages = (r) => r.errors.map((e) => `${e.where}: ${e.message}`).join("\n");

describe("Source document format", () => {
  test("the sample is valid and builds the model", () => {
    const r = loadSource(SAMPLE);
    assert.deepEqual(r.errors, []);
    assert.deepEqual(r.warnings, []);
    assert.equal(r.model.meta.version, "1.2", "version stays text");
    assert.deepEqual(r.model.meta.authors, ["Ana Souza", "Bruno Lima"]);
  });

  test("minimal valid source", () => {
    const r = loadSource(writeSource(tmp(), "doc.md", MINIMAL));
    assert.deepEqual(r.errors, []);
    assert.equal(r.model.meta.lang, "pt-BR");
  });

  for (const field of ["title", "author", "date", "version", "summary", "changes"]) {
    test(`missing ${field} is reported by name`, () => {
      const fm = MINIMAL.split("\n").filter((l) => !l.startsWith(`${field}:`) && !(field === "changes" && /^\s/.test(l))).join("\n");
      const r = loadSource(writeSource(tmp(), "doc.md", fm));
      assert.equal(r.model, null);
      assert.match(messages(r), new RegExp(`^${field}: is required`, "m"));
    });
  }

  test("dates must be ISO", () => {
    const r = loadSource(writeSource(tmp(), "doc.md", MINIMAL.replace("date: 2026-11-20", "date: 20/11/2026")));
    assert.match(messages(r), /^date: "20\/11\/2026" must be an ISO date/m);
  });

  test("a file without frontmatter is rejected", () => {
    const path = join(tmp(), "doc.md");
    writeFileSync(path, "# Just a heading\n\nText.\n");
    const r = loadSource(path);
    assert.equal(r.model, null);
    assert.match(messages(r), /^frontmatter: the file must start with YAML frontmatter/m);
  });

  test("missing annex file is reported relative to the source", () => {
    const fm = MINIMAL + "annexes:\n  - title: Extra\n    file: annexes/extra.md\n";
    const r = loadSource(writeSource(tmp(), "doc.md", fm));
    assert.match(messages(r), /annexes\[0\]\.file: annex file not found: annexes\/extra\.md/);
  });

  test("missing image is reported with its line", () => {
    const r = loadSource(writeSource(tmp(), "doc.md", MINIMAL, "# A\n\n![Chart](img/chart.png)\n"));
    assert.match(messages(r), /doc\.md:\d+: image not found: img\/chart\.png/);
  });

  test("#### heading fails with its line number", () => {
    const path = writeSource(tmp(), "doc.md", MINIMAL, "# A\n\n## B\n\n### C\n\n#### D\n");
    const r = loadSource(path);
    const line = 1 + MINIMAL.trim().split("\n").length + 1 + 7; // ---, frontmatter, ---, body line 7
    assert.match(messages(r), new RegExp(`doc\\.md:${line}: heading level #### is too deep`));
  });

  test("an annex allows # and ##, not ###", () => {
    const dir = tmp();
    writeSource(dir, "annex.md", "x: 1", "# One\n\n## Two\n\n### Three\n");
    const r = loadSource(writeSource(dir, "doc.md", MINIMAL + "annexes:\n  - title: A\n    file: annex.md\n"));
    assert.match(messages(r), /annex\.md:\d+: heading level ### is too deep.*annex allows # and ##/);
  });

  test("raw HTML and footnotes are reported, not dropped", () => {
    const r = loadSource(writeSource(tmp(), "doc.md", MINIMAL, "# A\n\n<div>x</div>\n\nText[^1].\n\n[^1]: Note.\n"));
    assert.match(messages(r), /raw HTML is not supported/);
    assert.match(messages(r), /footnotes are not supported/);
  });

  test("headings are not allowed in the summary", () => {
    const r = loadSource(writeSource(tmp(), "doc.md", MINIMAL.replace("summary: The conclusion comes first.", "summary: |\n  # Title\n  Text.")));
    assert.match(messages(r), /headings are not allowed in the summary/);
  });

  test("a vague change log entry is a warning", () => {
    const r = loadSource(writeSource(tmp(), "doc.md", MINIMAL.replace("Created the document with sections 1 and 2.", "Document updated")));
    assert.deepEqual(r.errors, []);
    assert.match(r.warnings.map((w) => w.message).join("\n"), /is vague: say what changed and where/);
  });
});

describe("Document structure", () => {
  test("table of contents: summary, body levels 1–2, sources, annexes, change log", () => {
    const { model } = loadSource(SAMPLE);
    assert.deepEqual(model.toc.map((e) => e.id), [
      "summary", "s-contexto", "s-o-que-ja-existe", "s-proposta", "s-fases-do-lancamento", "s-arquitetura",
      "s-custos-e-retorno", "s-riscos", "sources", "annex-a", "annex-b", "changes",
    ]);
    assert.equal(model.toc.find((e) => e.id === "annex-a").text, "Anexo A — Roteiro das entrevistas");
  });

  test("change log is newest first", () => {
    const { model } = loadSource(SAMPLE);
    assert.deepEqual(model.changes.map((c) => c.version), ["1.2", "1.1", "1.0"]);
  });

  test("no sources: no sources entry", () => {
    const { model } = loadSource(writeSource(tmp(), "doc.md", MINIMAL));
    assert.ok(!model.toc.some((e) => e.id === "sources"));
    assert.deepEqual(model.toc.map((e) => e.id), ["summary", "s-section", "changes"]);
  });
});

describe("Localized labels", () => {
  test("English labels and long date", () => {
    const { model } = loadSource(writeSource(tmp(), "doc.md", MINIMAL + "lang: en\n"));
    assert.equal(model.labels.toc, "Table of contents");
    assert.equal(model.labels.summary, "Executive summary");
    assert.equal(model.labels.sources, "Sources");
    assert.equal(model.labels.changes, "Change log");
    assert.equal(model.meta.dateText, "November 20, 2026");
  });

  test("Spanish labels and long date", () => {
    const { model } = loadSource(writeSource(tmp(), "doc.md", MINIMAL + "lang: es\n"));
    assert.equal(model.labels.toc, "Índice");
    assert.equal(model.meta.dateText, "20 de noviembre de 2026");
  });

  test("unsupported language lists the supported ones", () => {
    const r = loadSource(writeSource(tmp(), "doc.md", MINIMAL + "lang: fr\n"));
    assert.match(messages(r), /^lang: "fr" is not supported; use one of: pt-BR, en, es/m);
  });
});
