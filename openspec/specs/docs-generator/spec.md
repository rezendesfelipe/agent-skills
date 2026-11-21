# docs-generator Specification

## Purpose
Lets an agent turn one structured Markdown source into consistently designed PDF and DOCX documents, plus a matching Excel template and Office theme, using the user's own design tokens or a research-based default theme.
## Requirements
### Requirement: Source document format
A source document SHALL be a UTF-8 Markdown file starting with YAML frontmatter. The engine's `check` command SHALL validate it and report every problem with the field name or line number.

| Field | Required | Content |
|-------|----------|---------|
| `title` | yes | Document title |
| `subtitle` | no | One line under the title |
| `author` | yes | Name or list of names |
| `date` | yes | ISO date `YYYY-MM-DD` of this version |
| `version` | yes | Version label, for example `1.0` |
| `lang` | no | `pt-BR` (default), `en` or `es` |
| `summary` | yes | Executive summary in Markdown |
| `sources` | no | List of `{ title, url?, author?, date?, accessed? }` |
| `annexes` | no | List of `{ title, file }`, where `file` is a Markdown file relative to the source |
| `changes` | yes | Change log: list of `{ version, date, author?, description }`, at least one entry |

The Markdown body SHALL support headings, paragraphs, bold, italic, links, ordered and unordered lists, tables (GitHub syntax), block quotes, code blocks and local images.

#### Scenario: Valid source
- **WHEN** the agent runs `check` on a file with all required fields and a body
- **THEN** the command reports no errors and exits with code 0

#### Scenario: Missing required field
- **WHEN** the frontmatter has no `summary`
- **THEN** `check` fails, names the missing field, and no output file is written by `build`

#### Scenario: Missing annex or image file
- **WHEN** an annex `file` or an image path does not exist
- **THEN** `check` fails and reports the path relative to the source

#### Scenario: Too many heading levels
- **WHEN** the body uses a `####` (or deeper) heading, or an annex uses a `###` (or deeper) heading
- **THEN** `check` fails and reports the file and line, because documents are limited to 3 heading levels and an annex's title is its first level

#### Scenario: Unsupported Markdown
- **WHEN** the body contains raw HTML, footnotes, reference-style links or images, horizontal rules or strikethrough
- **THEN** `check` fails and reports the line with the supported alternative, instead of dropping the content

#### Scenario: Internal link
- **WHEN** the body links to a heading with `[text](#s-<heading-id>)`
- **THEN** the link jumps to that heading in both the PDF and the DOCX

### Requirement: Document structure
Every generated PDF and DOCX SHALL contain, in this order: cover, table of contents, executive summary, body, sources, annexes, change log, back cover. The sources and annexes sections SHALL be omitted when their lists are empty; all others are always present.
- The cover SHALL show title, subtitle (if any), author, date and version.
- The table of contents SHALL list the executive summary, every body heading of the first two levels, sources, each annex and the change log, with page numbers.
- The change log SHALL be a table with version, date, author and description, newest entry first.
- The back cover SHALL show the document title, the version and, when the theme defines them, the contact and license text.
- Every page except the cover and back cover SHALL show the page number and the document title in the footer.

#### Scenario: Full document
- **WHEN** a valid source with sources, two annexes and three changes is built
- **THEN** both outputs contain the eight parts in order, annexes are titled "Anexo A", "Anexo B" (in pt-BR), and the change log lists the newest version first

#### Scenario: No sources
- **WHEN** `sources` is absent
- **THEN** the outputs have no sources section and the table of contents does not list one

#### Scenario: PDF table of contents links
- **WHEN** a reader clicks an entry in the PDF table of contents
- **THEN** the viewer jumps to that section, and the page number shown in the entry is the page where the section starts

#### Scenario: DOCX table of contents
- **WHEN** a user opens the DOCX
- **THEN** the table of contents is a Word table of contents over Heading 1–2 whose entries already show their page numbers, and Word can update it after edits

#### Scenario: Table across pages
- **WHEN** a table continues on the next page of the PDF
- **THEN** its header row is repeated at the top of the continuation

### Requirement: Output formats
The `build` command SHALL take the source path, `--format` (any of `pdf`, `docx`, default both) and an optional `--theme` and `--out` folder (default: the source's folder). Output files SHALL be named after the source file (`<name>.pdf`, `<name>.docx`). PDF and DOCX built from the same source and theme SHALL contain the same text, sections, tables and images.

#### Scenario: Build both formats
- **WHEN** the agent runs `build report.md`
- **THEN** `report.pdf` and `report.docx` are written next to `report.md` and their paths are printed

#### Scenario: DOCX uses real styles
- **WHEN** a user opens the DOCX in Microsoft Word
- **THEN** headings use the Heading 1–3 styles, body text uses the Normal style, and the styles carry the theme's fonts, sizes and colors, so the user can keep editing in the same look

#### Scenario: PDF without a browser
- **WHEN** `build --format pdf` runs and no Chrome, Edge or Chromium can be found
- **THEN** the command fails with a message explaining how to install Chromium (`npx playwright install chromium`) and still allows `--format docx`

### Requirement: Theme file
The look of every output SHALL come from a theme file in JSON (`docs-theme.json`) that follows a schema bundled with the skill. The theme SHALL define fonts (headings, body, monospace), colors (text, secondary text, accent, text on accent, background, table header background, borders), type sizes (body and heading levels 1–3), line height, page size (`A4` or `Letter`) and margins, and MAY define a logo, contact text and license text for the covers. The `theme check` command SHALL validate a theme file.

#### Scenario: Invalid theme
- **WHEN** a theme file has a value that is not a color, a value out of range, or an unknown field
- **THEN** `theme check` and `build` fail and name the field

#### Scenario: Contrast below WCAG AA
- **WHEN** a theme's body text color on the background has a contrast ratio below 4.5:1, or a heading or large-text color is below 3:1
- **THEN** `theme check` and `build` fail and report the color pair, its ratio and the nearest color that passes

#### Scenario: Partial theme
- **WHEN** a theme file sets only some fields, for example `colors.accent`
- **THEN** the other fields are taken from the `clean-modern` theme, and `theme check` prints the complete resulting theme

#### Scenario: Font not available
- **WHEN** the theme names a font that is neither bundled nor given as a font file in the theme
- **THEN** the engine warns that the font will fall back to the viewer's default and continues

#### Scenario: Web font files only
- **WHEN** a theme gives only `.woff` or `.woff2` files for a font
- **THEN** the PDF uses them, and the engine warns that the DOCX cannot embed them and shows the font only where it is installed

### Requirement: Default theme
The skill SHALL bundle a theme named `clean-modern`, used when no other theme is chosen, with these values: Public Sans for headings and body (bundled font files, tabular numerals in tables); body 11 pt with line height 1.4 and 6 pt between paragraphs; headings 20 / 14 / 12 pt bold with space above at least 1.5 times the space below; text `#1F2328`, secondary text `#57606A`, accent `#0B6E79`, table header background `#F6F8FA`; A4 pages with the body limited to about 66 characters per line; tables with thin horizontal rules only; cover with a left-aligned title and an accent color band, no photos.

#### Scenario: Building without a theme
- **WHEN** `build` runs without `--theme` and no `docs-theme.json` exists next to the source
- **THEN** the outputs use the `clean-modern` theme

#### Scenario: Default theme passes its own checks
- **WHEN** `theme check` runs on the bundled `clean-modern` theme
- **THEN** it passes, including the contrast checks

### Requirement: Choosing the theme
The skill's instructions SHALL make the agent pick the theme in this order, and SHALL make it show the chosen or derived theme to the user before the first build:
1. A theme passed explicitly by the user, or a `docs-theme.json` next to the source.
2. The user's Claude Design System: the agent reads its `project/tokens.json`, maps the tokens to a `docs-theme.json`, and tells the user which tokens it used and which values it filled from `clean-modern`.
3. Another design specification the user points to (file or URL), mapped the same way.
4. A bundled predefined theme (`clean-modern`), if the user accepts it.
5. Otherwise a short interview (brand colors, fonts, logo, page size) that produces a `docs-theme.json`, checked with `theme check`.

#### Scenario: Design System available
- **WHEN** the user has a Claude Design System artifact and no theme file
- **THEN** the agent derives a `docs-theme.json` from its `project/tokens.json`, lists the mapping, and builds only after the theme passes `theme check`

#### Scenario: Derived colors fail contrast
- **WHEN** the mapped design-system colors fail the contrast check
- **THEN** the agent reports the failing pair and proposes the nearest passing color for the user to accept

#### Scenario: Nothing available
- **WHEN** there is no theme file, no design system and no specification
- **THEN** the agent offers `clean-modern` or the interview, and saves the result as `docs-theme.json` next to the source

### Requirement: Excel template and Office theme
The `office-theme` command SHALL generate, from a theme file, an Excel template (`<theme-name>.xltx`) and an Office theme (`<theme-name>.thmx`). Both SHALL open without repair prompts in Microsoft Excel and LibreOffice Calc.
- The Office theme SHALL map the theme's colors to the Office color slots (dark 1, light 1, dark 2, light 2, accent 1–6, hyperlink) and its fonts to the heading and body theme fonts.
- The Excel template SHALL use that Office theme, contain one empty sheet, and define named cell styles `Title`, `Heading 1`, `Heading 2`, `Body`, `Number`, `Currency`, `Percent`, `Date` and `Note`, plus a table style named after the theme that is the default for new tables. It SHALL contain no data.

#### Scenario: Generate from the default theme
- **WHEN** the agent runs `office-theme` with `clean-modern`
- **THEN** `clean-modern.xltx` and `clean-modern.thmx` are written and their paths printed

#### Scenario: Using the template
- **WHEN** a user creates a workbook from the `.xltx` and inserts a table
- **THEN** the table uses the theme's table style and the named cell styles appear in the Cell Styles gallery

### Requirement: Localized labels
Fixed labels (table of contents, executive summary, sources, annexes and annex letters, change log and its columns, version, page) and the cover date SHALL follow `lang`: Brazilian Portuguese (default), English or Spanish, with dates written in that language's long format.

#### Scenario: English document
- **WHEN** `lang: en` and `date: 2026-11-20`
- **THEN** the labels read "Table of contents", "Executive summary", "Sources", "Annex A", "Change log", and the cover date reads "November 20, 2026"

#### Scenario: Unsupported language
- **WHEN** `lang: fr`
- **THEN** `check` fails and lists the supported values

### Requirement: Agent workflow and writing guidance
`SKILL.md` SHALL instruct the agent to: install the engine's dependencies on first use; choose the theme (requirement "Choosing the theme"); write the source following the input format; run `check` and fix every error before `build`; and report the output paths. It SHALL also give writing rules taken from the research: put the conclusion in the first sentence of the executive summary and of each section; use descriptive headings; keep to at most 3 heading levels; and write each change log entry as a full sentence that says what changed and where, never only "updated".

#### Scenario: Agent builds a document
- **WHEN** a user asks the agent for a design document using this skill
- **THEN** the agent writes the Markdown source, runs `check`, builds the requested formats, and gives the user the output paths

#### Scenario: Vague change log entry
- **WHEN** the agent is about to write a change log entry like "Document updated"
- **THEN** the instructions direct it to rewrite it as what changed and where, for example "Added section 3.2 on data retention"

### Requirement: Engine command line
The engine SHALL be run with `node <skill-folder>/scripts/docs.mjs <command>`, with the commands `check`, `build`, `theme check`, `theme init` (writes a copy of a bundled theme to edit) and `office-theme`. Every command SHALL accept `--json` (result object on stdout, messages on stderr) and SHALL exit with 0 on success, 1 on a validation or rendering failure, and 2 on a usage error.

#### Scenario: Machine-readable check
- **WHEN** the agent runs `check report.md --json` on a file with two errors
- **THEN** stdout is a JSON object with `ok: false` and both errors with field or line, and the exit code is 1

