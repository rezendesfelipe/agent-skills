## Context

Motivation and scope: see `proposal.md`. Required behavior: see `specs/docs-generator/spec.md`. Decisions agreed earlier with the user: no pandoc; Markdown + frontmatter written by the agent is the only input; DOCX through the `docx` library; PDF through HTML/CSS printed by Chromium; the default theme comes from the 2026-11-19 research, approved with a sans-only font choice (Public Sans). On 2026-11-20 the user replaced the `exceljs` plan with a real Office theme (`.thmx`) plus an Excel template (`.xltx`), and chose pt-BR, en and es labels.

The skill must work when installed by the Claude Code marketplace or by the `agent-skills` CLI into any agent's skills folder, so everything it needs lives inside the skill folder.

## Goals / Non-Goals

**Goals:**
- One document model, two renderers, so PDF and DOCX cannot drift apart.
- The agent only ever writes Markdown and JSON; the engine owns every layout decision.
- Output fidelity checked by automated tests, not only by eye.

**Non-Goals:**
- A general-purpose Markdown-to-anything converter. Only the elements listed in the spec are supported; anything else is a `check` error, not a silent drop.

## Decisions

**1. Skill folder layout.**
```text
plugins/docs-generator/skills/docs-generator/
  SKILL.md                     # workflow, theme choice, writing rules
  references/
    source-format.md           # frontmatter fields, supported Markdown, full example
    theme-format.md            # docs-theme.json fields, contrast rules
    from-design-system.md      # mapping Claude Design System tokens.json → docs-theme.json
    writing-guide.md           # research-based rules with source links
  themes/clean-modern.json
  themes/docs-theme.schema.json
  assets/fonts/PublicSans-*.ttf + OFL.txt
  locales/pt-BR.json, en.json, es.json
  scripts/docs.mjs             # CLI entry
  scripts/lib/…                # engine modules
  package.json, package-lock.json
  test/…
```
`SKILL.md` stays short and points to the references, so the agent loads detail only when needed.

**2. Pipeline: source → document model → renderers.** `check` and `build` share one loader: parse frontmatter (`yaml`), parse Markdown to an mdast tree (`remark-parse` + `remark-gfm`), resolve annexes and images, then build a *document model* (cover, toc entries, summary, body blocks, sources, annexes, changes, back cover, labels). Validation errors are collected with positions, not thrown one at a time. The HTML renderer and the DOCX renderer each walk the same model.
*Alternative:* render Markdown to HTML and convert HTML to DOCX. Rejected: HTML-to-DOCX converters lose styles, which is the pandoc problem again.

**3. PDF through Paged.js in Chromium.** The HTML renderer writes one HTML file with inline CSS generated from the theme and `@font-face` rules pointing at the bundled fonts. Paged.js (bundled as a file, run inside the page) paginates it, which gives CSS Paged Media features Chromium lacks: `target-counter()` for table-of-contents page numbers, running footers with the title, named pages for cover and back cover without footers, and `break-after: avoid` for headings. Then `page.pdf({ preferCSSPageSize: true })`. Internal links stay clickable.
*Alternative:* plain `page.pdf()` with `headerTemplate`/`footerTemplate`. Rejected: no way to put page numbers in the table of contents or to hide footers on the covers.

**4. Browser discovery with `playwright-core`.** `playwright-core` has no browser download. The engine tries, in order: `DOCS_GENERATOR_CHROMIUM` (path), installed Chrome (`channel: "chrome"`), Edge (`channel: "msedge"`), then a Playwright-managed Chromium. If none starts, it fails with the install hint from the spec. This avoids a 150 MB download for users who already have Chrome.

**5. DOCX through `docx`.** Theme → `styles` (Normal, Heading 1–3, Title, Subtitle, Caption, Quote, Code, table style) so the document is editable in the same look. Cover and back cover are their own sections with no footer; the main section has a footer with the title and a `PAGE` field. The table of contents is a Word TOC field over Heading 1–2 with `updateFields: true`, so Word fills page numbers when the file opens. Public Sans is embedded in the DOCX (allowed by the OFL) so the look survives on machines without the font.
*Trade-off:* page numbers in the DOCX table of contents appear only after Word updates fields (Word asks on open; LibreOffice needs Tools → Update). The entries themselves are pre-filled with the heading text so the table of contents is never empty. Documented in `SKILL.md` so the agent tells the user.

**6. Office theme and Excel template written as OOXML.** Neither `exceljs` nor other common libraries write theme XML, named cell styles and custom table styles, so the engine writes the parts directly from small XML templates and zips them with `fflate`:
- `.thmx`: `theme/theme/theme1.xml` (`a:clrScheme` with dk1/lt1/dk2/lt2/accent1–6/hlink/folHlink, `a:fontScheme` major/minor), plus content types and relationships.
- `.xltx`: a workbook part with the `spreadsheetml.template.main+xml` content type, the same `theme1.xml`, `styles.xml` with the named `cellStyles`/`cellXfs` from the spec and one `tableStyle` set as `defaultTableStyle`, and one empty sheet.
Color slot mapping: dk1 = text, lt1 = background, dk2 = secondary text, lt2 = table header background, accent1 = accent; accent2–6 are derived from the accent by rotating hue in steps and adjusting lightness until each passes 3:1 against the background, unless the theme lists them.
*Alternative:* ship a template made by hand in Excel and patch colors. Rejected: binary-ish fixture that is hard to review, and fonts and styles would still need patching.

**7. Theme file and validation.** `docs-theme.json` is validated by a JSON Schema (`ajv`), which also gives editors autocomplete via `$schema`. Contrast is computed with the WCAG 2.x relative-luminance formula for these pairs: text/background and secondary text/background (≥ 4.5:1), accent/background for headings and links (≥ 3:1), text on accent/accent for the cover band (≥ 4.5:1), and text/table header background (≥ 4.5:1). Missing optional fields are filled from `clean-modern`, and the resolved theme is what `theme check --json` prints, so the agent can show the user exactly what will be used.

**8. Design System mapping is done by the agent, guided by a reference.** The engine never reads claude.ai. `references/from-design-system.md` tells the agent how to fetch `project/tokens.json` from the user's Design System artifact (the Artifact tool's read with a `path`), which token names usually hold the text, background, accent and font values, and to write `docs-theme.json` plus a short mapping table for the user. Keeping this in the agent avoids coupling the engine to one token format, and the same reference covers other specifications (Style Dictionary, Figma variables exports).

**9. Localization.** `locales/<lang>.json` holds the labels; dates use `Intl.DateTimeFormat(lang, { dateStyle: "long" })`. Annex letters are A, B, C… in all three languages.

**10. Dependencies installed on first use.** Runtime dependencies: `yaml`, `unified`, `remark-parse`, `remark-gfm`, `docx`, `fflate`, `ajv`, `playwright-core`, and a pinned copy of Paged.js in `assets/`. `package-lock.json` is committed. `SKILL.md` tells the agent: if `node_modules` is missing in the skill folder, run `npm ci --omit=dev` there. Installed size without a browser is a few MB.

**11. Tests (`node --test`, dev dependency `pdfjs-dist`).**
- Model: fixtures for every `check` scenario.
- PDF: build a fixture and assert, with `pdfjs-dist`, the page order, footer text, absence of footer on covers, and that table-of-contents numbers match the pages where headings are found. Skipped with a notice when no browser is found.
- DOCX: unzip and assert styles, sections, TOC field and embedded fonts in the XML.
- Office theme: unzip and check the XML against the expected slots; when LibreOffice is installed, convert the `.xltx` headless as a smoke test that it opens.
- Theme: contrast calculator against known WCAG examples; `clean-modern` passes.
- A sample document (`test/fixtures/sample.md`) also renders page PNGs to `test/output/` for human review, not asserted.

## Risks / Trade-offs

- [Paged.js has bugs with very long tables or images taller than a page] → Tables repeat their header row and may break between rows; images are scaled to fit the page; known cases covered by fixtures.
- [DOCX table of contents needs a field update] → Pre-filled entries, `updateFields`, and a note in `SKILL.md` (Decision 5).
- [Hand-written OOXML can trigger Excel's repair prompt] → Generate the minimum valid parts, compare against a file saved by Excel during development, and keep the LibreOffice smoke test in CI.
- [Excel cannot embed fonts] → The `.xltx` and `.thmx` name the fonts; if Public Sans is not installed, Office substitutes. `SKILL.md` tells the user where the font files are.
- [Design System token names differ between users] → The agent shows the mapping and asks before building; anything it cannot map comes from `clean-modern`.
- [Chromium not available in some sandboxes] → DOCX and Office outputs still work; the error message explains how to add a browser.

## Migration Plan

Additive: a new plugin plus manifest and README entries. Rollback is removing the plugin folder and its manifest entry.

## Open Questions

- Exact Paged.js version to pin; decided at implementation by picking the latest release that passes the PDF tests.
