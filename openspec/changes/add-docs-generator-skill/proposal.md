## Why

Design documents written with agents come out in a different shape every time: sections missing, no change log, inconsistent styling, and exports that depend on pandoc, which loses layout fidelity. A skill that makes the agent write one structured Markdown source and then renders it to a consistently designed PDF and DOCX (plus an Excel theme in the same look) gives anyone a repeatable, good-looking document without manual formatting.

## What Changes

- New plugin `docs-generator` with skill `docs-generator` (`plugins/docs-generator/skills/docs-generator/`).
- The agent writes a Markdown file with YAML frontmatter (title, subtitle, author, date, version, language, executive summary, sources, annexes, change log). A bundled Node engine checks it and renders:
  - **PDF**: HTML and CSS printed by a Chromium browser.
  - **DOCX**: a native Word document with real styles, generated directly (no pandoc).
- Every document has the same fixed structure: cover, table of contents, executive summary, body, sources, annexes, change log, back cover.
- **Theme**: the look comes from a theme file (`docs-theme.json`). The skill finds or creates it in this order: the user's Claude Design System (`project/tokens.json`), a theme file the user points to, a bundled predefined theme, or a short interview to build one. The engine rejects themes whose text colors fail WCAG AA contrast.
- **Default theme `clean-modern`**, based on the typography and readability research done on 2026-11-19 (Butterick, NN/g, WCAG, GOV.UK, USWDS): Public Sans, 11 pt body, line height 1.4, at most 3 heading levels, neutral palette with one accent, tables without vertical borders.
- **Excel / Office theme**: from the same theme file the engine produces an Excel template (`.xltx`) with theme colors and fonts, named cell styles and a table style, and an Office theme file (`.thmx`) that applies the colors and fonts in Excel, Word and PowerPoint.
- Fixed labels (for example "Sumário" / "Table of contents" / "Índice") and date formats in Brazilian Portuguese (default), English and Spanish.
- Marketplace manifest and README catalog list the new plugin. The skill is installable through the `agent-skills` CLI from `multi-agent-distribution`.

## Capabilities

### New Capabilities
- `docs-generator`: the skill's input format, document structure, theme file and its sources, the default theme, the PDF, DOCX, `.xltx` and `.thmx` outputs, localization, and the agent workflow described in `SKILL.md`.

### Modified Capabilities
<!-- none: the skill follows the existing skill-catalog and marketplace-distribution requirements -->

## Non-goals

- Pandoc or any converter that goes through an intermediate format other than the bundled renderers.
- Editing or restyling existing `.docx` / `.pdf` files that the skill did not generate.
- Slides, spreadsheets with content (the Excel output is a blank, themed template only), Google Docs output.
- Diagrams-as-code (Mermaid, PlantUML) rendering, automatic citation numbering, footnotes, tracked changes.
- Right-to-left languages and languages other than pt-BR, en and es in this release.
- Bundling the maintainer's own design system as a theme.

## Impact

- New: `plugins/docs-generator/` (skill, references, bundled theme, Public Sans font files under the SIL Open Font License, Node engine, tests).
- Changed: `.claude-plugin/marketplace.json`, README catalog.
- New runtime dependencies inside the skill folder only (installed by the skill on first use, not at repository level): a Markdown parser, a DOCX writer, a zip writer, a JSON schema validator, and `playwright-core` to drive an installed Chrome, Edge or Chromium.
- Users need Node.js 20+ and a Chromium-based browser for PDF output. DOCX and Excel outputs do not need a browser.
- Depends on `multi-agent-distribution` for installation outside Claude Code; can be implemented after it.
