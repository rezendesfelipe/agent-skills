## Status

Gate 1 recorded on 2026-11-25: the maintainer approved fixing this bug as its own change in the conversation ("Ok" and "siga com a correção do bug"). The implementation follows on the same branch and pull request. `node scripts/delivery-check.mjs scope fix-engine-windows-paths --approved` is the recorded form of that approval; no GitHub comment is needed for it.

## Why

The engine of the `azure-terraform-stacks` skill builds the path of its Terraform module templates with `new URL("../../templates/", import.meta.url).pathname` (`scripts/lib/gen-terraform.mjs:7`). On Windows that is `/D:/a/repo/.../templates/`, and `path.join` then yields `D:\D:\a\...`: `readdirSync` fails with `ENOENT`. So every command that generates files (`scaffold`, `add-stack`, and what depends on them, such as `plan`, `diagram` and `bridge` after a scaffold) fails for a Windows user; `audit` and `check-manifest` do not read the templates and work.

It went unseen because the engine's suite had never run on Windows. The first run (CI, Node 24, 2026-11-25) failed 68 of 188 tests: the path bug, and tests that assume POSIX paths. Until now the Windows job runs only the vendored-yaml tests ("plan B", change `vendor-stacks-engine-yaml`).

## What Changes

- **Fix.** `gen-terraform.mjs` resolves the templates folder with `fileURLToPath` through an exported `templatesDir(base, opts)`. No change on POSIX.
- **Sweep.** Every other `import.meta.url`, `new URL(...)`, `.pathname`, `__dirname` and hand-made `file://` in `plugins/`, `hooks`, `scripts/`, `src/` and `test/` was read and classified (table in `tasks.md`): this was the only one that breaks on Windows.
- **Tests.** A new `test/paths.test.mjs` proves the conversion on Linux with a `file:///D:/...` URL and `fileURLToPath(url, { windows: true })`; it fails when the code goes back to `.pathname`. The suite's POSIX assumptions are removed (forward-slash paths in guard commands, long temp folders, `/`-separated golden walk, `path.delimiter`). Only the tests that need a bash executable are skipped on Windows, each with its reason.
- **CI.** Job `azure-terraform-stacks-windows` (Node 24) runs the engine's full suite (`npm test`), not only the vendored-yaml tests. Its name is unchanged and it is not a required check; no required context is renamed.
- **Docs.** CHANGELOG `[Unreleased]` (Fixed, and the limitation leaves "Known limitations"), `references/traps.md` and the workflow comments say what CI proved (Windows, Node 24).

## Capabilities

### New Capabilities
None.

### Modified Capabilities
- `azure-terraform-stacks`: ADDED requirement "Cross-platform file generation" (existing requirements are not changed, so there is no MODIFIED delta).

## Non-goals

- A version bump, a tag or a publish. The fix reaches users only in a later release (plugin 0.3.x or 0.4.0, and the npm package), which is the maintainer's decision.
- Changing what the engine generates on any platform: the golden trees are unchanged.
- Supporting Windows Node older than 20.13 for the new unit test (it needs `fileURLToPath(url, { windows })`; the test says so when it cannot run), or making the `--open-pr` stub tests run on Windows.
- Changing required checks, rulesets, `publish.yml`, or the SKILL.md of the skill (its size ceiling is untouched).

## Impact

`S` is `plugins/azure-terraform-stacks/skills/azure-terraform-stacks`.

- Code: `S/scripts/lib/gen-terraform.mjs`.
- Tests: new `S/test/paths.test.mjs`; changed `S/test/guard.test.mjs`, `S/test/bridge.test.mjs`, `S/test/generate.test.mjs` (and any other `S/test/*.mjs` that CI on Windows shows to assume POSIX, listed in `tasks.md`).
- CI: `.github/workflows/validate.yml` (job `azure-terraform-stacks-windows` and its comments).
- Text: `CHANGELOG.md` (`[Unreleased]`), `S/references/traps.md`.
- OpenSpec: this change.

Releasing the fix needs a version bump of the plugin (and of the npm package if the CLI should carry it), which this change does not make.
