# Report format and delegation to docs-generator

Read this at the render and delegate nodes. `assess.mjs render` writes the files; the layout, PDF and DOCX belong to the `docs-generator` skill.

**This skill contains no layout, PDF or DOCX code.** A test fails if any script here imports a PDF or DOCX library or ships an HTML layout template. The engine writes Markdown in the `docs-generator` source format and stops there.

## Files written to `<out>/report/`

| File | Content |
|------|---------|
| `report.md` | Frontmatter plus the executive body |
| `annex-findings.md` | Annex A: the finding register, with quoted evidence and `path:start-end` |
| `annex-evidence.md` | Annex B: the evidence index and the verification log, failures included |
| `annex-frameworks.md` | Annex C: registered frameworks and control mapping. Written only when a framework is used |
| `annex-method.md` | Annex D: run metadata, what the verifier proves and does not, conventions |
| `report.json` | A copy of `assessment.json` at render time |

## Frontmatter

| Field | Comes from |
|-------|-----------|
| `title`, `author`, `date`, `version`, `lang` | `meta`, as given at `init`. Never inferred |
| `subtitle` | `meta.subtitle`, else `meta.client` |
| `summary` | `summary`, with `{{count.*}}` tokens replaced by computed numbers |
| `sources` | `frameworks[]`: name and version, `url`, `date`, `retrievedAt` as `accessed`. Left out when there is no framework |
| `annexes` | The annex files above |
| `changes` | `meta.changes`, else one entry for the first issue |

## Executive body

Conclusion first. Descriptive headings, at most two levels:

1. Headline assessment: counts computed by code.
2. Main findings: the highest-ranked findings by severity, with confidence labels. Critical and High findings get a short paragraph and the recommendation. A "Verify first" table lists findings with `potentialSeverity`.
3. Severity and effort matrix, and the derived quick wins.
4. Roadmap in waves 1 to 3 (days 0-30, 31-60, 61-90), wave 4 only when used, with the effort total of each wave and any capacity warning.
5. Decisions needed from the client (`decisions[]`).
6. What could not be verified: the Not verified findings with their failure codes and the action that collects the evidence.
7. Scope and limits.

A finding that is not verified appears only in section 6 and in the verification log, never among the findings.

## What the engine restricts itself to

`docs-generator` supports Markdown headings to level 3 (annexes `#` and `##` only), paragraphs, bold, italic, inline code, links, lists, GitHub tables, block quotes and code blocks with three backticks. It rejects raw HTML, footnotes, reference-style links, horizontal rules and strikethrough. So the engine:

- escapes `\ ` * _ [ ] < > | ~ &` in every model-written string, so text can never become markup, and a pipe cannot break a table;
- writes quotes in fenced blocks and replaces any run of three backticks inside a quote with a visible substitute (`‵‵‵`), followed by the label "(escaped)";
- never writes a heading level the annexes cannot hold;
- rejects, at `check`, a summary that holds a heading or raw HTML.

A contract test renders the fixtures in all three languages and runs the repository's `docs-generator check` on them, and builds a DOCX.

## Language

Fixed labels come from `locales/en.json`, `pt-BR.json` and `es.json`, chosen by `meta.lang`, which is also the document `lang`. The prose of findings follows the user's language. The `pt-BR` and `es` labels were written by the implementer and need review by a native speaker.

## Delegation

After `render`:

1. If a `docs-generator` skill is available, load it and follow its workflow on `<out>/report/report.md`. It asks the user which theme to use. Do not choose a theme, and do not invent an author or version: they were set at scope.
2. If it is not available, deliver `report.md` and `report.json` and tell the user that PDF and DOCX need the `docs-generator` plugin (`/plugin install docs-generator@rezendesfelipe-agent-skills`, or `npx @frcloudsolutions/agent-skills add docs-generator`).
3. Run `finish`.
