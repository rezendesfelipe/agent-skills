## MODIFIED Requirements

### Requirement: Output formats
The `build` command SHALL take the source path, `--format` (any of `pdf`, `docx`, default both), an explicit theme (`--theme`, or a `docs-theme.json` next to the source) and an optional `--out` folder (default: the source's folder). Output files SHALL be named after the source file (`<name>.pdf`, `<name>.docx`). PDF and DOCX built from the same source and theme SHALL contain the same text, sections, tables and images. The command SHALL print the theme it used and where it came from.

#### Scenario: Build both formats
- **WHEN** the agent runs `build report.md --theme clean-modern`
- **THEN** `report.pdf` and `report.docx` are written next to `report.md` and their paths are printed, together with the theme used

#### Scenario: DOCX uses real styles
- **WHEN** a user opens the DOCX in Microsoft Word
- **THEN** headings use the Heading 1–3 styles, body text uses the Normal style, and the styles carry the theme's fonts, sizes and colors, so the user can keep editing in the same look

#### Scenario: PDF without a browser
- **WHEN** `build --format pdf` runs and no Chrome, Edge or Chromium can be found
- **THEN** the command fails with a message explaining how to install Chromium (`npx playwright install chromium`) and still allows `--format docx`

### Requirement: Default theme
The skill SHALL bundle a theme named `clean-modern`, which is used only when chosen explicitly (`--theme clean-modern`), with these values: Public Sans for headings and body (bundled font files, tabular numerals in tables); body 11 pt with line height 1.4 and 6 pt between paragraphs; headings 20 / 14 / 12 pt bold with space above at least 1.5 times the space below; text `#1F2328`, secondary text `#57606A`, accent `#0B6E79`, table header background `#F6F8FA`; A4 pages with the body limited to about 66 characters per line; tables with thin horizontal rules only; cover with a left-aligned title and an accent color band, no photos. The engine SHALL never fall back to it on its own: `build` and `office-theme` refuse to run without an explicit theme.

#### Scenario: Building without a theme
- **WHEN** `build` runs without `--theme` and no `docs-theme.json` exists next to the source
- **THEN** the command writes nothing, exits with code 2, and says that the user must be asked which theme to use and that `--theme clean-modern` selects the default; with `--json` the result has `ok: false` and the same message

#### Scenario: Choosing the default on purpose
- **WHEN** `build` runs with `--theme clean-modern`
- **THEN** the outputs use the `clean-modern` theme and the result reports that it was chosen with `--theme`

#### Scenario: Theme file next to the source
- **WHEN** `build` runs without `--theme` and a `docs-theme.json` exists next to the source
- **THEN** the outputs use that theme and the result reports that it came from the file next to the source

#### Scenario: Default theme passes its own checks
- **WHEN** `theme check` runs on the bundled `clean-modern` theme
- **THEN** it passes, including the contrast checks

### Requirement: Choosing the theme
The skill's instructions SHALL make the agent settle the theme with the user before writing or building anything, and never fall back to `clean-modern` on its own. The agent SHALL skip the question only when the user named a theme in the request or a `docs-theme.json` sits next to the source, and then say which it uses. Otherwise it SHALL list the user's Design System artifacts (when it can read them), ask one question and wait for the answer, offering: the user's design system (by name), another design specification (file or URL), the default `clean-modern`, or building a theme together through a short interview. It SHALL act on the answer:
- *Design system:* read its `project/tokens.json`, map it to a `docs-theme.json`, tell the user which tokens it used and which values it filled from `clean-modern`, get a yes, and run `theme check` before building.
- *Another specification:* map it the same way.
- *Default:* build with `--theme clean-modern`.
- *Interview:* ask for brand colors, fonts, logo and page size, and produce a `docs-theme.json` checked with `theme check`.

If the agent cannot ask at all (no user to answer), it SHALL use `clean-modern` explicitly and start its final message by saying it used the default because it could not ask.

#### Scenario: Design System available
- **WHEN** the user has a Claude Design System artifact and no theme file
- **THEN** the agent offers it by name, and after the user picks it derives a `docs-theme.json` from its `project/tokens.json`, lists the mapping, and builds only after the theme passes `theme check`

#### Scenario: User names no theme
- **WHEN** the user asks for a document and names no theme, and no `docs-theme.json` is next to the source
- **THEN** the agent asks which theme to use and writes and builds nothing until the user answers

#### Scenario: Derived colors fail contrast
- **WHEN** the mapped design-system colors fail the contrast check
- **THEN** the agent reports the failing pair and proposes the nearest passing color for the user to accept

#### Scenario: Nothing available
- **WHEN** there is no theme file, no design system and no specification
- **THEN** the agent offers `clean-modern` or the interview, and saves the result as `docs-theme.json` next to the source

### Requirement: Excel template and Office theme
The `office-theme` command SHALL generate, from an explicit theme (`--theme`, or a `docs-theme.json` in the current folder), an Excel template (`<theme-name>.xltx`) and an Office theme (`<theme-name>.thmx`). Both SHALL open without repair prompts in Microsoft Excel and LibreOffice Calc. Without an explicit theme it SHALL write nothing and exit with code 2, with the same message as `build`.
- The Office theme SHALL map the theme's colors to the Office color slots (dark 1, light 1, dark 2, light 2, accent 1–6, hyperlink) and its fonts to the heading and body theme fonts.
- The Excel template SHALL use that Office theme, contain one empty sheet, and define named cell styles `Title`, `Heading 1`, `Heading 2`, `Body`, `Number`, `Currency`, `Percent`, `Date` and `Note`, plus a table style named after the theme that is the default for new tables. It SHALL contain no data.

#### Scenario: Generate from the default theme
- **WHEN** the agent runs `office-theme --theme clean-modern`
- **THEN** `clean-modern.xltx` and `clean-modern.thmx` are written and their paths printed

#### Scenario: Office theme without a theme
- **WHEN** `office-theme` runs without `--theme` and with no `docs-theme.json` in the current folder
- **THEN** nothing is written and the command exits with code 2

#### Scenario: Using the template
- **WHEN** a user creates a workbook from the `.xltx` and inserts a table
- **THEN** the table uses the theme's table style and the named cell styles appear in the Cell Styles gallery

### Requirement: Agent workflow and writing guidance
`SKILL.md` SHALL instruct the agent to: install the engine's dependencies on first use; settle the theme with the user (requirement "Choosing the theme"); say up front, when the user asks for Excel, that the Excel output is an empty template and not a workbook with the document's content; write the source following the input format, asking the user for the `author` and `version` the text does not provide and never inferring them from the account's e-mail address or inventing them; run `check` and fix every error before `build`; always build with `--theme` and with `--preview`; look at the cover, a page with a table and the last page when it can view images; and report the output paths, the theme used and what it checked (or that it could not look at the pages). It SHALL also give writing rules taken from the research: put the conclusion in the first sentence of the executive summary and of each section; use descriptive headings; keep to at most 3 heading levels; and write each change log entry as a full sentence that says what changed and where, never only "updated".

#### Scenario: Agent builds a document
- **WHEN** a user asks the agent for a design document using this skill
- **THEN** the agent settles the theme, writes the Markdown source, runs `check`, builds the requested formats with `--theme`, looks at the preview pages, and gives the user the output paths and the theme used

#### Scenario: Missing author or version
- **WHEN** the user's text has no author or version
- **THEN** the agent asks the user for them instead of guessing from an e-mail address or inventing values

#### Scenario: Excel requested with a document
- **WHEN** the user asks for Excel together with a document
- **THEN** the agent says before building that the Excel output is a template, and offers another tool for a workbook with the tables

#### Scenario: Vague change log entry
- **WHEN** the agent is about to write a change log entry like "Document updated"
- **THEN** the instructions direct it to rewrite it as what changed and where, for example "Added section 3.2 on data retention"
