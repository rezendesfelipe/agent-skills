## Why

In two real runs an agent built documents with the bundled `clean-modern` theme without ever asking the user about a design system or brand. The skill's instructions told it to ask (since 0.2.1), but the engine still falls back to `clean-modern` silently, so an agent that skips the question gets no signal and the user gets documents in a look they never chose. The theme choice has to be impossible to skip, not just recommended.

## What Changes

- **BREAKING (engine CLI):** `build` and `office-theme` no longer fall back to `clean-modern`. They need an explicit theme: `--theme <name|file>`, or a `docs-theme.json` next to the source (for `build`) or in the current folder (for `office-theme`). Without one they exit with code 2 and a message that says to ask the user which theme to use and to pass `--theme clean-modern` if they pick the default. Nothing is written.
- `--theme clean-modern` stays the way to choose the default on purpose. The build output and JSON result keep reporting the theme used and whether it came from `--theme`, a file next to the source, or the default.
- `check` is unchanged: it validates the source, and a theme only if one is given or found.
- The skill's instructions are brought in line with the 0.2.1 behavior: ask which theme to use (offering the user's design systems by name) and wait; for the `author` and `version` fields the text does not provide, ask the user and never infer them from the account's e-mail address or invent them; always build with `--theme`; look at the pages and say what was checked; say up front that the Excel output is a template.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `docs-generator`: the "Output formats", "Default theme", "Choosing the theme", "Excel template and Office theme" and "Agent workflow and writing guidance" requirements change as described above.

## Non-goals

- A prompt inside the engine (the engine stays non-interactive; the agent asks the user).
- Building a workbook with the document's tables (the Excel output stays an empty template; a data workbook would be a separate capability).
- Changing `check`, the theme file format, the themes, or any rendering.
- Detecting design systems from the engine; discovering them stays with the agent (Artifact tool).

## Impact

- `scripts/docs.mjs` (theme resolution for `build` and `office-theme`), `SKILL.md`, tests, the sample commands in `references/`.
- Anyone calling the engine directly must now pass `--theme`. Package version 0.3.0 (breaking change in a 0.x CLI).
