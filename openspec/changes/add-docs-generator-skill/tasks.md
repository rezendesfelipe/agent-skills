## 1. Setup

- [x] 1.1 Create `plugins/docs-generator/skills/docs-generator/` from `templates/skill/` with `name: docs-generator` and a description of what it does and when to use it
- [x] 1.2 Add the skill's `package.json` (Node 20+, `type: module`, runtime and dev dependencies from design Decisions 10–11) and commit `package-lock.json`
- [x] 1.3 Add Public Sans font files and `OFL.txt` to `assets/fonts/`, and a pinned Paged.js file to `assets/`
- [x] 1.4 Add `plugins/docs-generator` to `.claude-plugin/marketplace.json`

## 2. Theme

- [x] 2.1 Write `themes/docs-theme.schema.json`
- [x] 2.2 Write `themes/clean-modern.json` with the values from the spec
- [x] 2.3 Implement theme loading, defaults from `clean-modern` and WCAG contrast checks
- [x] 2.4 Implement `theme check` and `theme init`, with tests (invalid field, contrast failure, missing font warning, `clean-modern` passes)

## 3. Source loading and check

- [x] 3.1 Write `locales/pt-BR.json`, `en.json`, `es.json`
- [x] 3.2 Implement frontmatter and Markdown parsing, annex and image resolution, and the document model
- [x] 3.3 Implement `check` with collected errors (missing field, bad date, unknown `lang`, missing file, `####` heading, unsupported element), with one test per scenario

## 4. PDF renderer

- [x] 4.1 Generate HTML and CSS from the model and theme (covers, TOC with `target-counter`, footers, tables, code, images)
- [x] 4.2 Browser discovery (`DOCS_GENERATOR_CHROMIUM`, Chrome, Edge, Playwright Chromium) and the no-browser error
- [x] 4.3 Paginate with Paged.js and print the PDF; tests for section order, footers, cover without footer, TOC page numbers and links

## 5. DOCX renderer

- [x] 5.1 Map theme to Word styles and build cover, main and back-cover sections
- [x] 5.2 Render every model block (headings, lists, tables, quotes, code, images, links) and the TOC field with pre-filled entries
- [x] 5.3 Embed Public Sans; tests that inspect styles, sections, TOC field and fonts in the XML
- [x] 5.4 Parity test: same headings, tables and text in the PDF and DOCX built from the sample

## 6. Office theme and Excel template

- [x] 6.1 Color slot mapping and accent2–6 derivation with contrast checks
- [x] 6.2 Write `.thmx` (theme XML, content types, relationships)
- [x] 6.3 Write `.xltx` (template content type, theme, named cell styles, default table style, one empty sheet)
- [x] 6.4 Tests on the XML, plus a LibreOffice headless smoke test when available; open both files once in Microsoft Excel by hand and record the result in the PR

## 7. Command line

- [x] 7.1 `scripts/docs.mjs` with `check`, `build`, `theme check`, `theme init`, `office-theme`, `--json` and exit codes 0/1/2
- [x] 7.2 `build` options `--format`, `--theme`, `--out`, theme lookup next to the source, and printed output paths

## 8. Skill instructions

- [x] 8.1 Write `SKILL.md`: first-use install, theme choice order, workflow (write → check → build → report paths), DOCX TOC update note, writing rules
- [x] 8.2 Write `references/source-format.md` with a full example document
- [x] 8.3 Write `references/theme-format.md`
- [x] 8.4 Write `references/from-design-system.md` (reading `project/tokens.json`, token mapping, contrast fixes, other specification formats)
- [x] 8.5 Write `references/writing-guide.md` with the research sources and links

## 9. Verification and release

- [x] 9.1 Run `node scripts/validate-skills.mjs` to validate frontmatter and the marketplace manifest
- [x] 9.2 Run the skill's test suite and add it to `validate.yml`
- [x] 9.3 Build the sample document in pt-BR, en and es and review the PDFs, DOCX and the Excel template by eye
- [x] 9.4 Add the plugin to the README catalog
- [ ] 9.5 Test an install with `npx @frcloudsolutions/agent-skills add docs-generator` for at least Claude Code and one other agent, after `multi-agent-distribution` ships
- [x] 9.6 Run `openspec validate add-docs-generator-skill --strict` and fix any findings
