# Writing and design guide

The structure, default theme and writing rules of this skill come from typography, usability and accessibility guidance gathered on 2026-11-19. This page lists each rule and where it comes from, so it can be revisited.

## Structure and writing

| Rule | Why | Source |
|------|-----|--------|
| Put the conclusion first: executive summary at the start, and the main point in the first sentence of each section and paragraph | Readers scan; whoever stops after one paragraph still gets the point | [NN/g: Inverted Pyramid](https://www.nngroup.com/articles/inverted-pyramid/) |
| Descriptive headings and subheadings | Scanning heading by heading ("layer-cake") is the most effective way readers skim | [NN/g: Text scanning patterns](https://www.nngroup.com/articles/text-scanning-patterns-eyetracking/) |
| Bold a few key phrases, use lists for parallel items | The "spotted" scanning pattern fixes on styled words and lists | [NN/g: Text scanning patterns](https://www.nngroup.com/articles/text-scanning-patterns-eyetracking/) |
| At most three heading levels; two is better | More levels make readers lose their place | [Butterick: Headings](https://practicaltypography.com/headings.html) |
| Summaries: short, active, no "this document is about…" | Readers decide from the summary whether to read on | [GOV.UK: Write clear summaries](https://guidance.publishing.service.gov.uk/writing-to-gov-uk-standards/writing-guidelines/summaries/) |
| Change notes: full sentences, what changed and where, most important first; never only "updated" | A change note is only useful if readers can tell what is different | [GOV.UK: Write change notes](https://guidance.publishing.service.gov.uk/writing-to-gov-uk-standards/writing-guidelines/change-notes/) |
| Clickable table of contents and visible page numbers | Readers skip to the sections they need | [Venngage: White paper design tips](https://venngage.com/blog/white-paper-examples/) |
| A clear cover with the title, and key takeaways up front | The cover decides whether the document gets opened | [Venngage: White paper design tips](https://venngage.com/blog/white-paper-examples/) |

## Typography and layout (`clean-modern`)

| Rule | Value used | Source |
|------|-----------|--------|
| Body size 10–12 pt in print | 11 pt | [Butterick: Summary of key rules](https://practicaltypography.com/summary-of-key-rules.html) |
| Line spacing 120–145% (at least 1.5 for long text on screen) | 1.4 | Butterick; [USWDS: Typography](https://designsystem.digital.gov/components/typography/) |
| Line length 45–90 characters, about 66 for long text | 36 mm side margins on A4 | Butterick; USWDS |
| Space between paragraphs or first-line indent, not both | 6 pt after paragraphs | Butterick |
| Headings: bold, small size steps, no all caps, no underline, not centered | 20 / 14 / 12 pt bold, left-aligned | [Butterick: Headings](https://practicaltypography.com/headings.html) |
| Space above a heading at least 1.5 times the space below | 1.2–1.4 em above, 0.3–0.5 em below | USWDS |
| Avoid long runs of bold or italic | Rules for the writer, not styled by default | Butterick; USWDS |
| Tables: no cell borders by default, add rules only where they help | Horizontal hairlines only, tabular numerals | [Butterick: Tables](https://practicaltypography.com/tables.html) |
| Professional typeface, not system defaults like Arial or Times | Public Sans (open source, designed for legibility, tabular numerals) | Butterick; USWDS |
| Neutral palette with one accent for a modern, technical look | Grays plus one teal accent | Venngage |

## Accessibility

| Rule | Value used | Source |
|------|-----------|--------|
| Text contrast at least 4.5:1, large text at least 3:1 (WCAG 2.2 AA, 1.4.3) | Enforced by `theme check` for every text color pair | [W3C: Understanding SC 1.4.3](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html) |
| Tagged PDF with document outline | Chromium's tagged PDF and outline output | WCAG |
| Images have text alternatives | The alt text is the figure caption and the DOCX alt text | WCAG |
