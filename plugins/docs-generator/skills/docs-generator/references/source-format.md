# Source format

A source document is one UTF-8 Markdown file that starts with YAML frontmatter. Run `node scripts/docs.mjs check <file>` to validate it; every problem is reported with its field name or line number.

## Frontmatter

| Field | Required | Content |
|-------|----------|---------|
| `title` | yes | Document title, shown on the cover, in the footer and on the back cover |
| `subtitle` | no | One line under the title on the cover |
| `author` | yes | A name, or a list of names |
| `date` | yes | Date of this version, ISO format `YYYY-MM-DD` |
| `version` | yes | Version label. Quote it if it looks like a number (`version: "1.0"`) |
| `lang` | no | `pt-BR` (default), `en` or `es`. Sets the fixed labels and date format |
| `summary` | yes | Executive summary, in Markdown. No headings. Use `\|` for several paragraphs |
| `sources` | no | List of `{ title, author?, url?, date?, accessed? }`. Dates are ISO |
| `annexes` | no | List of `{ title, file }`. `file` is a Markdown file relative to the source |
| `changes` | yes | Change log: list of `{ version, date, author?, description }`, at least one |

Unknown fields are ignored with a warning.

## Body

The body is the document's main text. Supported Markdown:

- Headings `#`, `##`, `###` (no deeper). `#` starts a top-level section; levels 1 and 2 appear in the table of contents.
- Paragraphs, **bold**, *italic*, `inline code`, line breaks.
- Links `[text](https://…)`. Internal links to a heading use `#` plus its id, which is `s-` followed by the heading in lowercase with dashes (`[see risks](#s-risks)`).
- Ordered and unordered lists, nested up to three levels.
- Tables in GitHub syntax, with column alignment (`|---:|` for right-aligned numbers).
- Block quotes `>`.
- Code blocks with three backticks.
- Images `![caption](path/to/image.png)`: local PNG or JPEG files, relative to the source. An image alone in a paragraph becomes a figure with its alt text as caption.

Not supported, and reported by `check`: raw HTML, footnotes, reference-style links and images, horizontal rules, strikethrough, remote images.

## Annexes

Each annex file is plain Markdown (frontmatter is optional and ignored). The engine titles it "Anexo A — <title>" (or "Annex A", "Anexo A" in Spanish), so inside the annex use only `#` and `##`.

## What the engine adds

You do not write these; they are generated in this order: cover, table of contents, executive summary (from `summary`), body, sources, annexes, change log (newest first), back cover. Sections without content (no sources, no annexes) are left out.

## Full example

```markdown
---
title: Online scheduling platform
subtitle: Design document for the first release
author:
  - Ana Souza
  - Bruno Lima
date: 2026-11-20
version: "1.2"
lang: en
summary: |
  **We recommend launching online scheduling in three phases**, starting with clinics that already use the records system, because they hold 70% of the unmet demand and need no new integration.

  The estimated investment is $80k over six months, with payback in 14 months.
sources:
  - title: "Inverted Pyramid: Writing for Comprehension"
    author: Nielsen Norman Group
    url: https://www.nngroup.com/articles/inverted-pyramid/
    accessed: 2026-11-19
annexes:
  - title: Interview script
    file: annex-interviews.md
changes:
  - version: "1.0"
    date: 2026-10-02
    author: Ana Souza
    description: First version approved by the product committee.
  - version: "1.2"
    date: 2026-11-20
    author: Bruno Lima
    description: Updated section 3 with the revised cost estimate and added Annex A.
---

# Clinics lose two hours a day to scheduling calls

Patients book by phone or message today. Each receptionist spends **2 hours a day** confirming and rescheduling, and 18% of appointments end in no-shows.

## What already exists

The records system stores each professional's calendar but does not expose it.

# Launch in three phases

| Phase | Audience | Length | Adoption target |
|-------|----------|-------:|----------------:|
| 1 | Clinics with active records | 2 months | 40% |
| 2 | Clinics without records | 2 months | 25% |

![Demand by region, thousands of appointments per month](chart.png)
```
