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
2. **Ask which theme to use, and wait for the answer** (next section). Do this before writing or building anything. Never build with a theme the user has not chosen or confirmed.
3. **Tell the user what the formats include** if they asked for Excel: this skill does not put the document's content in a workbook (see below). Say so now, not after building.
4. **Write the source** following `references/source-format.md`: YAML frontmatter with `title`, `author`, `date`, `version`, `summary`, `changes` (and optionally `subtitle`, `lang`, `sources`, `annexes`), then the body. Apply the writing rules below. **Ask the user for the `author` and `version` when their text does not contain them.** Never infer an author from the account's e-mail address or the machine's user name, and never invent a name or a version. The same goes for the `date` if it matters: use today's date only if the user has no other date in mind, and say so.
5. **Check it:** `node scripts/docs.mjs check <source.md>`. Fix every error and rerun until it passes. Address warnings too (a vague change log entry is a warning).
6. **Build:** `node scripts/docs.mjs build <source.md> --theme <the chosen theme> --preview <folder>` writes `<name>.pdf` and `<name>.docx` next to the source, plus one PNG per PDF page in the preview folder. `--theme` is required (a bundled name such as `clean-modern`, or a file; a `docs-theme.json` next to the source also counts). The engine has no default and refuses to build without one, with a message telling you to ask the user. Use `--format pdf` or `--format docx` for one format, `--out <folder>` for another folder.
7. **Look at the result.** If you can view images, open the cover, one page with a table, and the last page of the preview, and fix what looks wrong (rebuild after editing the source). In the final message say what you checked; if you could not look at the pages, say that too.
8. **Report** the output paths and the theme used. Mention that Word may ask to update fields when the DOCX opens; answering yes refreshes the table of contents after edits.

**Excel is a template, not a workbook.** For an **Excel template or Office theme**, `node scripts/docs.mjs office-theme --theme <the chosen theme> [--lang pt-BR|en|es] [--out <folder>]` writes `<theme>.xltx` and `<theme>.thmx`. Tell the user how to use them: open the `.xltx` to start a workbook (new tables use the theme's table style; the named styles are in the Cell Styles gallery); apply the `.thmx` in Excel, Word or PowerPoint under Page Layout or Design → Themes → Browse for Themes. Office does not embed fonts: if the theme font is not installed on the user's machine, point them to the font files (for the default theme, `assets/fonts/`). If the user asked for "Excel" together with a document, make clear before building that the Excel output is an empty template with the document's look, not a workbook with its tables; offer to put the tables in a workbook with another tool or skill if they want that.

Every command accepts `--json` for a machine-readable result. Exit codes: 0 success, 1 validation or rendering failure, 2 usage error.

## Choosing the theme

**Always settle the theme with the user before the first build. Never fall back to `clean-modern` on your own.** The user may have a design system or brand they never mention, so you have to ask.

Skip the question only when the user already named a theme in the request, or a `docs-theme.json` sits next to the source. Then say which one you are using.

Otherwise:

1. **Look for design systems.** If you can read claude.ai artifacts (the Artifact tool), list the user's artifacts of type "Design System" and note their names. Do not read any yet.
2. **Ask one question and wait for the answer.** Use your question tool (for example `AskUserQuestion`); if you have none, ask in your reply and stop. Offer these options:
   - **Use my design system**, naming the ones you found (leave this out only if you found none and cannot check).
   - **Use another design specification**: a file, a URL, a Style Dictionary or Figma variables export.
   - **Use the default `clean-modern`**: Public Sans, 11 pt body, teal accent, neutral palette, tables with horizontal rules only.
   - **Build a theme together**: a short interview.
3. **Act on the answer:**
   - *Design system:* read its `project/tokens.json` and map it to a `docs-theme.json` as described in `references/from-design-system.md`. Show the user a short table of which tokens you used and which values came from `clean-modern`, get a yes, and run `node scripts/docs.mjs theme check docs-theme.json` before building.
   - *Another specification:* map it the same way.
   - *Default:* build with `--theme clean-modern`, which is how the default is chosen on purpose.
   - *Interview:* ask for the brand's main color, text color if not near-black, fonts (and their files, if they are not common), logo, and page size (A4 or Letter). Create the file with `node scripts/docs.mjs theme init --out docs-theme.json`, edit it with the answers, and run `theme check`.

If you cannot ask at all (a run with no user to answer, such as a headless job), use `clean-modern`, and begin your final message by saying you used the default theme because you could not ask, and how to change it.

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
