---
name: docs-generator
description: Writes design documents, reports and proposals as structured Markdown and renders them to consistently designed PDF and DOCX files (cover, table of contents, executive summary, sources, annexes, change log, back cover), plus a matching Excel template and Office theme. Use when the user asks for a document, report, design doc, proposal or white paper as PDF or Word, wants documents to follow their brand or Claude Design System, or wants an Excel or Office theme in the same look.
---

# Docs generator

Turns one Markdown source into a PDF and a DOCX that share the same structure and look, and can produce an Excel template (`.xltx`) and Office theme (`.thmx`) from the same theme. You write Markdown and JSON; the engine in `scripts/` owns every layout decision.

Paths below are relative to this skill's folder (the folder that holds this file).

## When to use

- The user wants a design document, report, proposal or white paper as a PDF or Word file.
- The user wants documents in their brand, from their Claude Design System or another design specification.
- The user wants an Excel template or an Office theme that matches their documents.

## Workflow

1. **Install the engine on first use.** If `node_modules/` does not exist in this skill's folder, run `npm ci --omit=dev` there. Node.js 20 or later is required. PDF output needs Chrome, Edge or Chromium; if none is installed, DOCX and Excel outputs still work (see Troubleshooting).
2. **Choose the theme** (next section) and show the user what will be used before the first build.
3. **Write the source** following `references/source-format.md`: YAML frontmatter with `title`, `author`, `date`, `version`, `summary`, `changes` (and optionally `subtitle`, `lang`, `sources`, `annexes`), then the body. Apply the writing rules below.
4. **Check it:** `node scripts/docs.mjs check <source.md>`. Fix every error and rerun until it passes. Address warnings too (a vague change log entry is a warning).
5. **Build:** `node scripts/docs.mjs build <source.md>` writes `<name>.pdf` and `<name>.docx` next to the source. Use `--format pdf` or `--format docx` for one format, `--out <folder>` for another folder, `--theme <file>` for a theme file elsewhere.
6. **Report** the output paths to the user. Mention that Word may ask to update fields when the DOCX opens; answering yes refreshes the table of contents after edits.

For an **Excel template or Office theme**: `node scripts/docs.mjs office-theme [--theme <file>] [--lang pt-BR|en|es] [--out <folder>]` writes `<theme>.xltx` and `<theme>.thmx`. Tell the user how to use them: open the `.xltx` to start a workbook (new tables use the theme's table style; the named styles are in the Cell Styles gallery); apply the `.thmx` in Excel, Word or PowerPoint under Page Layout or Design → Themes → Browse for Themes. Office does not embed fonts: if the theme font is not installed on the user's machine, point them to the font files (for the default theme, `assets/fonts/`).

Every command accepts `--json` for a machine-readable result. Exit codes: 0 success, 1 validation or rendering failure, 2 usage error.

## Choosing the theme

Pick the first that applies, and tell the user which one you used:

1. **A theme the user named**, or a `docs-theme.json` next to the source (the engine picks it up automatically).
2. **The user's Claude Design System.** If the user has one (or mentions their design system or brand), read its `project/tokens.json` and map it to a `docs-theme.json` as described in `references/from-design-system.md`. Show the user a short table of which tokens you used and which values came from `clean-modern`, and run `node scripts/docs.mjs theme check docs-theme.json` before building.
3. **Another design specification** the user points to (a file, a URL, a Style Dictionary or Figma variables export): map it the same way.
4. **The bundled `clean-modern` theme**, if the user accepts it: Public Sans, 11 pt body, teal accent, neutral palette, tables with horizontal rules only.
5. **Otherwise, a short interview:** ask for the brand's main color, text color if not near-black, fonts (and their files, if they are not common), logo, and page size (A4 or Letter). Create the file with `node scripts/docs.mjs theme init --out docs-theme.json`, edit it with the answers, and run `theme check`.

When `theme check` reports a contrast failure, it prints the nearest color that passes. Propose that color to the user rather than changing the brand silently. Theme fields are described in `references/theme-format.md`.

## Writing rules

These come from the research behind the default design (sources in `references/writing-guide.md`):

- **Lead with the conclusion.** The first sentence of the executive summary is the recommendation or main finding; the first sentence of each section says what the section concludes. Readers scan headings and first sentences.
- **Descriptive headings.** A reader should know what a section says from its heading alone ("Launch in three phases", not "Approach").
- **At most three heading levels** (`#`, `##`, `###`); two is better. In annexes, use `#` and `##` only, because the annex title is the first level. `check` rejects deeper headings.
- **Short paragraphs, lists for parallel items, tables for comparisons.** Bold only a few key phrases; never bold whole paragraphs.
- **Change log entries say what changed and where**, as full sentences: "Added section 3.2 on data retention", never "Document updated". The newest entry is shown first automatically.
- **Sources** go in the `sources` list, not as footnotes (footnotes are not supported).
- Images are local PNG or JPEG files; the alt text becomes the caption.

## Troubleshooting

- **`check` reports an unsupported element** (raw HTML, footnotes, reference-style links, horizontal rules, strikethrough): rewrite it with the supported Markdown listed in `references/source-format.md`.
- **No browser for the PDF:** install Chrome, or run `npx playwright install chromium` in this skill's folder, or set `DOCS_GENERATOR_CHROMIUM` to a Chrome or Chromium executable. `--format docx` works without one.
- **The dependencies are missing:** the engine prints the `npm ci` command to run.
- **Review the layout by eye:** `build --preview <folder>` also writes one PNG per PDF page.

## Examples

**Input:** "Write a design document for our new scheduling feature as PDF and Word."
**Output:** a `scheduling-design.md` source in the project, `scheduling-design.pdf` and `scheduling-design.docx` next to it, built with the user's theme or `clean-modern`, and the paths in the reply.

**Input:** "Make an Excel template in the same style as our documents."
**Output:** `<theme>.xltx` and `<theme>.thmx` from the same `docs-theme.json`, with instructions to open or apply them.
