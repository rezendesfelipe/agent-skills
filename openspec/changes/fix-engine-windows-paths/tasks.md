Paths are relative to the repository root. `S` is `plugins/azure-terraform-stacks/skills/azure-terraform-stacks`. No task bumps a version, creates a tag, edits `publish.yml`, changes a ruleset or merges. No task writes a credential-shaped literal.

## 1. Gate 1 and baseline

- [x] 1.1 The maintainer approves fixing the bug as its own change. **Done:** recorded on 2026-11-25 in the conversation ("Ok", "siga com a correção do bug"); see `proposal.md`, Status. `delivery-check scope fix-engine-windows-paths --approved` is the form used; no GitHub comment.
- [x] 1.2 Baseline in CI, Windows Node 24, `main` at 40757db plus the full suite: 68 of 188 tests failed (log of job 138923715567: `ENOENT` for the templates folder in every test that generates files, and the guard tests that paste backslash paths).

## 2. Root cause and sweep

- [x] 2.1 Search `plugins/**`, `hooks`, `scripts/`, `src/`, `test/` (vendored yaml excluded) for `.pathname`, `new URL(`, `import.meta.url`, `import.meta.dirname`, `__dirname`, `__filename`, `fileURLToPath`, `pathToFileURL` and `file://`. **Done:** 150 tracked `.mjs`, `.js`, `.cjs` and `.sh` files read. Result:

  | Where | Pattern | Class |
  | --- | --- | --- |
  | `S/scripts/lib/gen-terraform.mjs:7` | `new URL("../../templates/", import.meta.url).pathname` | **Bug on Windows** (fixed) |
  | `S/scripts/lib/diagram.mjs:10` | `readFileSync(new URL("../../diagram/icons.json", import.meta.url))` | Safe: `fs` accepts a `URL` object on Windows |
  | `src/cli/main.mjs:57` | `readFileSync(new URL("../../package.json", import.meta.url))` | Safe (same) |
  | `src/cli/main.mjs:12`, `scripts/validate-skills.mjs:8`, `docs-generator` `scripts/docs.mjs:17`, `lib/source.mjs:13`, `lib/theme.mjs:7`, `assessment-report` `scripts/lib/locales.mjs:6`, `lib/schema.mjs:8` | `fileURLToPath(new URL(...))` | Safe |
  | `hooks/stacks-auditor-guard.mjs:41,210`, `scripts/context-budget.mjs:167`, `scripts/delivery-check.mjs:204`, `assessment-report` `evals/deterministic.mjs:91` | `fileURLToPath(import.meta.url)` for the "run as main" test and the plugin folder | Safe |
  | `assessment-report` `lib/regex-limited.mjs:8`, `test/scan-inputs.mjs:71` | `new URL("./x.mjs", import.meta.url)` handed to `new Worker` | Safe: `Worker` accepts a `URL` |
  | `assessment-report` `lib/classify.mjs:35` | `new URL(e.url).origin` | Not a path (a web URL) |
  | `docs-generator` `lib/html.mjs:6`, `lib/pdf.mjs:47` | `pathToFileURL(p).href` | Safe (the right direction) |
  | `S/test/*.mjs`, `test/*.mjs`, `assessment-report` and `docs-generator` tests | `fileURLToPath(...)`, `pathToFileURL(...)`, `new URL("./no-network.mjs", import.meta.url).href` | Safe; `verify.test.mjs:389` already pins `pathToFileURL(..., { windows: true })` |
  | `docs-generator/assets/paged.polyfill.min.js` | `typeof exports`, `define.amd` | Not a path (a bundled library) |

  `import.meta.dirname`, `__dirname`, `__filename` and a hand-built `file://` do not occur outside the vendored copy. Paths joined with a literal `/` and passed to `fs` (`join(TEMPLATES, "terraform/modules")`) are normalized by `path.join` and are safe; keys of the generated map use `/` on purpose (written through `join` when writing). One latent POSIX-only case in the tests: `S/test/generate.test.mjs` `walk` compared `relative()` (backslashes on Windows) with `/` keys (fixed).

## 3. Red first

- [x] 3.1 `S/test/paths.test.mjs`: `templatesDir("file:///D:/a/agent-skills/agent-skills/plugins/.../scripts/lib/gen-terraform.mjs", { windows: true })` is a drive path (`D:\a\...\templates\`), not starting with `/` or `\`, drive not doubled; a path with `%20` decodes to a space; the real call resolves an existing folder on this platform. **Done:** with `export const templatesDir = (base) => new URL("../../templates/", base).pathname` (the old code) the first two tests fail (`# pass 1`, `# fail 2`); with `fileURLToPath` all 3 pass (Linux, Node 22).
- [x] 3.2 Make the rest of the suite portable. **Done:** `guard.test.mjs` writes every path pasted into a command with forward slashes (the guard denies a backslash by design) and uses the long form of temp folders (`realpathSync.native`; a runner's temp is `C:\Users\RUNNER~1\...` and the guard denies a tilde inside a word); `bridge.test.mjs` uses `path.delimiter`; `generate.test.mjs` normalizes `relative()` to `/`; `.gitattributes` anchors `eol=lf` for the skill's own `test/fixtures`, `test/golden` and `templates` (the earlier rules were anchored at the repository root and did not reach them, so a Windows checkout had CRLF golden files).
- [x] 3.3 Skips on Windows, each with its reason in the message. **Done:** 4 `--open-pr` tests in `bridge.test.mjs` ("stubs the gh/az CLI with a bash script on PATH, which Windows cannot start without a shell"); the 3 differential tests against a real `bash` in `guard.test.mjs` (already skipped before, "needs bash"). The 8 parity tests skip wherever `node_modules` is absent ("the oracle package is not installed"), which is the design of the no-install legs; the parity job runs them on Linux with `REQUIRE_YAML_ORACLE=1`. Nothing else is skipped.

## 4. CI

- [x] 4.1 `azure-terraform-stacks-windows` runs `npm test` (the full suite, Node 24) after `vendor-yaml.mjs verify`. **Done:** see the pull request for the counts of the final head. No other job changed; no required context renamed (the ruleset's 15 contexts are listed in the pull request).

## 5. Docs

- [x] 5.1 CHANGELOG `[Unreleased]`: the limitation moves from "Known limitations" to "Fixed", worded to what CI proved (Windows, Node 24); the CI bullet of `vendor-stacks-engine-yaml` is corrected. `S/references/traps.md` and the workflow comments are updated to the same state. `SKILL.md` is untouched (13,904 bytes, ceiling 13,947). **Verify:** `node scripts/context-budget.mjs`, the no-install test.

## 6. Checks and delivery

- [x] 6.1 Before the push: engine tests without `node_modules` and `vendor-yaml.mjs verify`, `npm test`, `node scripts/validate-skills.mjs`, `openspec validate --all --strict`, `delivery-check`, `context-budget`. **Done:** results in the pull request.
- [ ] 6.2 Independent review, then the maintainer merges. Not done by the implementer.

## 7. Not in this change

- A version bump and release: the fix reaches users only with a new plugin version (0.3.x or 0.4.0) and, for the CLI bundle, a new npm version. Gate 2 is the maintainer's.
