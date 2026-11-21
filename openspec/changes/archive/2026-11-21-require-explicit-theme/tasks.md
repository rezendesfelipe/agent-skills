## 1. Engine

- [x] 1.1 `scripts/docs.mjs`: theme resolution for `build` — `--theme`, else `docs-theme.json` next to the source, else exit 2 with the "ask the user / pass `--theme clean-modern`" message (JSON: `ok: false`); nothing written
- [x] 1.2 Same for `office-theme` (`--theme`, else `docs-theme.json` in the current folder, else exit 2)
- [x] 1.3 Report the theme source in the build output and JSON (`themeSource`: `flag`, `file-next-to-source`), replacing `usedDefaultTheme`
- [x] 1.4 Update `HELP` text and keep `check` unchanged

## 2. Skill instructions

- [x] 2.1 `SKILL.md`: always pass `--theme`; ask for `author` and `version` when the text has none, never infer from an e-mail address; keep the other 0.2.1 rules
- [x] 2.2 Update commands in `SKILL.md` and `references/*.md` that run `build` or `office-theme` without `--theme`

## 3. Tests

- [x] 3.1 CLI tests: `build` without a theme fails with exit 2 and writes nothing (text and `--json`); `--theme clean-modern` works; `docs-theme.json` next to the source works and is reported
- [x] 3.2 CLI tests: `office-theme` without a theme fails with exit 2; with `--theme` works
- [x] 3.3 Update existing tests (`render.test.mjs`, `cli.test.mjs`) to pass `--theme clean-modern`

## 4. Verification and release

- [x] 4.1 Run the skill test suite and `node scripts/validate-skills.mjs`
- [x] 4.2 Run `openspec validate require-explicit-theme --strict`
- [x] 4.3 Bump the package to 0.3.0
