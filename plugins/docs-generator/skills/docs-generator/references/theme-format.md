# Theme format

The look of every output comes from a theme file, `docs-theme.json`, validated against `themes/docs-theme.schema.json` (point `$schema` at it for editor autocomplete). Any field you leave out is taken from `clean-modern`, so a theme can be as short as one accent color.

Create an editable copy of the default with `node scripts/docs.mjs theme init --out docs-theme.json`, then check it with `node scripts/docs.mjs theme check docs-theme.json` (it prints the theme with defaults filled in).

## Fields

| Field | Type | Default (`clean-modern`) | Used for |
|-------|------|--------------------------|----------|
| `name` | kebab-case text | `clean-modern` | File names of the `.xltx` and `.thmx` outputs |
| `fonts.heading` | font family | `Public Sans` | Headings, cover title |
| `fonts.body` | font family | `Public Sans` | Body text, tables, footers |
| `fonts.mono` | font family | `monospace` | Code |
| `fonts.files` | list of `{ family, path, weight?, style? }` | none | Font files for fonts that are not bundled; `weight` is `normal` or `bold`, `style` is `normal` or `italic`; paths are relative to the theme file |
| `colors.text` | `#RRGGBB` | `#1F2328` | Body text |
| `colors.textMuted` | `#RRGGBB` | `#57606A` | Footers, captions, cover labels |
| `colors.accent` | `#RRGGBB` | `#0B6E79` | Level 1 headings, links, cover band |
| `colors.onAccent` | `#RRGGBB` | `#FFFFFF` | Title on the cover band |
| `colors.background` | `#RRGGBB` | `#FFFFFF` | Page |
| `colors.tableHeader` | `#RRGGBB` | `#F6F8FA` | Table header rows, code blocks |
| `colors.border` | `#RRGGBB` | `#D0D7DE` | Table rules |
| `type.body` | points | 11 | Body text |
| `type.h1`, `h2`, `h3` | points | 20, 14, 12 | Headings |
| `type.small` | points | 9 | Footers, captions, code |
| `type.title` | points | 34 | Cover title |
| `type.lineHeight` | multiple | 1.4 | Body line height |
| `type.paragraphSpacing` | points | 6 | Space after paragraphs |
| `page.size` | `A4` or `Letter` | `A4` | Page size |
| `page.margins` | `{ top, right, bottom, left }` in mm | 28, 36, 28, 36 | Margins; 36 mm sides keep lines near 66 characters |
| `cover.style` | `accent-band` or `plain` | `accent-band` | Colored band behind the cover title, or a plain cover with the title in the accent color |
| `cover.logo` | PNG or JPEG path | none | Logo above the cover title |
| `backCover.contact` | text | none | Contact line on the back cover |
| `backCover.license` | text | none | License or copyright line on the back cover |
| `office.accents` | five `#RRGGBB` | derived | Office accent colors 2–6 for the `.thmx`/`.xltx`; derived from the accent when left out |

## Fonts

- **Bundled:** Public Sans (regular, bold, italic, bold italic), under the SIL Open Font License.
- **Generic families** `sans-serif`, `serif`, `monospace` always work; in Office files they become Arial, Georgia and Consolas.
- **Other fonts** need files in `fonts.files`, or the engine warns that viewers will use their default font. The PDF accepts `.ttf`, `.otf`, `.woff` and `.woff2`. Word embeds only `.ttf` and `.otf`: with WOFF files only, the DOCX shows the font just where it is installed. Excel and PowerPoint never embed fonts.

## Contrast checks

`theme check` and `build` refuse a theme whose colors fail WCAG 2.x AA:

| Pair | Minimum |
|------|---------|
| `text` on `background` | 4.5:1 |
| `textMuted` on `background` | 4.5:1 |
| `accent` on `background` (headings and links are large or bold) | 3:1 |
| `onAccent` on `accent` (cover title) | 4.5:1 |
| `text` on `tableHeader` | 4.5:1 |

Each failure names the pair, its ratio and the nearest passing color (same hue, adjusted lightness). Offer that color to the user; do not silently replace a brand color.

## Example: brand theme

```json
{
  "$schema": "./docs-theme.schema.json",
  "name": "acme",
  "fonts": {
    "heading": "Inter",
    "body": "Inter",
    "files": [
      { "family": "Inter", "path": "fonts/Inter-Regular.ttf" },
      { "family": "Inter", "path": "fonts/Inter-Bold.ttf", "weight": "bold" },
      { "family": "Inter", "path": "fonts/Inter-Italic.ttf", "style": "italic" }
    ]
  },
  "colors": { "accent": "#C2410C" },
  "page": { "size": "Letter" },
  "cover": { "logo": "acme-logo.png" },
  "backCover": { "contact": "docs@acme.example", "license": "© 2026 Acme. Internal use." }
}
```
