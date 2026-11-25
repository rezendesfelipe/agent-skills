# Changelog

All notable changes to this project are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the versions follow [Semantic Versioning](https://semver.org/) (while the major version is 0, a minor version may add features and change behavior).

Two things are versioned separately:

- the npm package `@frcloudsolutions/agent-skills` (the `agent-skills` command and the files it bundles), in `package.json`;
- each plugin of the marketplace, in `plugins/<plugin>/.claude-plugin/plugin.json`. Claude Code decides whether an installed plugin has an update from this number, so a change to a plugin ships with a bump of that plugin.

Versions before 0.6.0 were not recorded in this file; see the git tags and `openspec/changes/archive/`.

## [Unreleased]

Changes `vendor-stacks-engine-yaml` (OpenSpec; pull request #28) and `fix-engine-windows-paths` (pull request #33). No version, tag or date: the release is a separate decision (gate 2).

### Changed

- **The `azure-terraform-stacks` engine needs no installation.** Its one dependency, `yaml` 2.9.1, is vendored as a byte-for-byte copy of the published package (`dist/**/*.js`, `package.json`, the ISC `LICENSE`; 76 files) in `plugins/azure-terraform-stacks/skills/azure-terraform-stacks/scripts/vendor/yaml/`, and the engine reaches it through `scripts/lib/yaml.mjs`. No `npm ci`, no `node_modules/`, no network on first run. The engine's output and golden files are unchanged.
- **The `stacks-auditor` agent installs nothing and the command guard no longer allows `npm`.** The one write of the auditor, `npm ci --prefix <skill folder> --omit=dev --ignore-scripts`, is gone from the agent's instructions and from the guard's allowlist (now five command shapes; `npm` and `npx` fall to the default denial). A copy of the skill from before this change fails with `Cannot find package 'yaml'`; the auditor then tells the user to update the skill.
- `SKILL.md` step 1 now reads "No install step" (43 bytes shorter); the explanation is in `references/traps.md`.
- CI: the `azure-terraform-stacks` jobs (`(20)`, `(24)` and `-deep`, names unchanged) no longer run `npm ci`. A new job `azure-terraform-stacks-windows` (Node 24) first ran **only three test files** (`vendor`, `yaml-corpus`, `no-install`) plus `vendor-yaml.mjs verify`, because the engine's suite failed on Windows for a reason that predates this change; change `fix-engine-windows-paths` fixed it and the job now runs the full suite (see Fixed). A new `azure-terraform-stacks-parity (20)` / `(24)` job compares the vendored copy with the npm package. No new job is a required check, and no required check was renamed.

### Security

- **The vendored `yaml` is outside `npm audit` and Dependabot, so it is checked another way.** `scripts/vendor/yaml/PROVENANCE.json` records the tarball URL and SHA-256, the `sha512` integrity (equal to the lockfile's) and the SHA-256 of every file; `node scripts/vendor-yaml.mjs verify` fails on one changed byte, a missing or extra file, a CRLF rewrite, a symbolic link, or a version that differs from the lockfile, and `verify --registry` compares the files with a fresh download of the published package without running it. `yaml` stays a `devDependency` so the dependency graph and `npm audit` still see 2.9.1, and `.github/dependabot.yml` watches it. The workflow `vendor-watch` runs weekly and on demand and checks the registry copy and the OSV advisory feed. Limits: the first hash is taken from the registry (trust on first use); `yaml` 2.9.1 publishes no npm provenance attestation, only the registry signature; a compromised upstream release would be vendored by `update`. The new workflow is not a required check and `CODEOWNERS` is not enforcement while the ruleset requires no code owner review (repository settings are the maintainer's).

### Fixed

- **The engine's commands that generate files (`scaffold`, `add-stack` and what builds on them) work on Windows** (change `fix-engine-windows-paths`). `scripts/lib/gen-terraform.mjs` built the templates folder from `new URL("../../templates/", import.meta.url).pathname`, which is `/D:/a/...` on Windows and became `D:\D:\a\...` (`ENOENT`); it now uses `fileURLToPath` (also fixes a folder name with a space on any platform, which `.pathname` left as `%20`). No change in what is generated: the golden trees are unchanged. Proved in CI on Windows with Node 24 only: the engine's full suite runs there (203 tests: 188 pass, 0 fail, 15 skipped for stated reasons; before, 68 of 188 failed). Windows with Node 20 or 22 and macOS were not run for the engine. The fix reaches users only in a release that bumps the plugin version (not decided here).
- `.gitattributes` now anchors `eol=lf` for the skill's own `templates/`, `test/fixtures/` and `test/golden/` (the earlier rules were anchored at the repository root and did not reach them, so a Windows checkout had CRLF golden files).

### Added

- `scripts/vendor-yaml.mjs` (`verify`, `verify --registry`, `update <version>`), tests for the integrity check with mutations, a golden corpus of hostile and awkward YAML (alias bomb, tags, merge key, duplicate keys, several documents, CRLF, BOM, tabs, deep nesting, a 1 MiB scalar, a round trip with comments) run in child processes where memory is at risk, and a differential test against the npm package.

## [0.6.0] - 2026-11-24

_Date planned; adjust it if the merge happens on another day (the tag lands on the merge commit)._

Prepared on 2026-11-24 from `main` at 7521019 (pull requests #14 to #25). The date is the planned one; the tag and the npm publish wait for the maintainer's explicit OK, and the date is adjusted if the merge happens on another day. Plugin versions in this release: `azure-terraform-stacks` 0.3.0 (was 0.2.0), `assessment-report` 0.1.0 (new), `docs-generator` 0.1.0 (unchanged).

### Security

- **The command guard of the `stacks-auditor` agent was introduced in 0.3.0; before that, the development head of `main` had a guard that never applied.** What was and was not protected, as checked against the repository on 2026-11-24:
  - Plugin `azure-terraform-stacks` 0.2.0 as published (tag `v0.5.0`) had **no command guard**: there is no `hooks/` folder in that tag. Its restriction was the `disallowedTools` list in the agent's frontmatter (14 entries) and the prompt rules; per the review recorded in #17, a `Bash(...)` entry in that list removes the whole `Bash` tool in Claude Code, so the auditor could not run the engine its prompt asked for (not re-tested live here).
  - The guard (`hooks/hooks.json` and `hooks/stacks-auditor-guard.mjs`) was added by #21, merged on 2026-11-24 at 03:06 -03:00. Claude Code sends the `agent_type` `azure-terraform-stacks:stacks-auditor` (namespaced by the plugin) to a `PreToolUse` hook, and that guard compared it only with `stacks-auditor`, so it allowed every command and printed no reason (it failed open without any sign). The tests of that moment passed because they fed the short value. The maintainer found this in a live Claude Code session on 2026-11-24 (sanitized evidence in `openspec/changes/fix-stacks-auditor-guard-agent-type/evidence/live-2026-11-24.md`); #24 corrected it, merged at 11:33 -03:00 the same day. So the inert guard existed only on the head of `main` between those two merges (a window of hours), and only for someone who installed the plugin from the head of `main` in that window, which is the case of the live session.
  - Who should update: anyone running plugin 0.2.0 (it has no guard) and anyone who installed from the head of `main` in that window. Update to 0.3.0 to get the corrected guard. If you cannot update, `plugins/azure-terraform-stacks/skills/azure-terraform-stacks/references/traps.md` has interim guidance (`permissions.deny` rules, a read-only checkout, or not using the auditor).
  - The npm package never included `hooks/`, so a guard exists only in the plugin, and only on Claude Code. The published npm 0.5.0 tarball (90 files) contains no `hooks/`, no `agents/` and no `.claude-plugin/`; 0.6.0 is the first npm version that bundles agents (`plugins/azure-terraform-stacks/agents/stacks-auditor.md`), still without `hooks/`. Agents installed with `agent-skills add stacks-auditor` therefore have no guard.
  - The corrected guard has **not** been shown working in a live session yet (see Known limitations). Until it is, do not run the auditor on a repository you do not trust.
- The guard also now (#24): denies every command when `HOME` is defined and is empty, relative or different from `os.homedir()` (the auditor only); fails closed for the auditor if its own check throws, instead of failing open with a stack trace; and was checked against the real `bash` with 25 Unicode space and format characters, with no divergence found.
- Earlier in this release (#21) the guard was added with an allowlist of command shapes, rejection of shell metacharacters, and a ban on running an engine found inside the audited repository. `git status` was dropped from the allowlist because a clean filter in the audited repository's `.git/config` made it run a program.
- The assessment secret scanner was hardened (#23): linear-time patterns (no repeated name prefix, bounded URL scheme and look-ahead) with an overlapping-window guard, and a rule for YAML tags, anchors and aliases (a literal after `!!str`, `&a`, `*a` or a custom tag is now flagged; a lone tag or alias, or one before a reference, is still ignored).

### Added

- **Skill and plugin `assessment-report` 0.1.0** (#15 proposal, #19): a technical assessment report in which every finding cites evidence that a script verified (`file:line` plus quote, or an absence search with a scope); failed citations go through two repairs and are then demoted by code; confidence, severity (impact x likelihood), effort and a 30/60/90 roadmap are computed by fixed rules; optional framework mapping always names the ID, version and date; output in English, pt-BR and Spanish for `docs-generator`. A fixed workflow is enforced by code (`assess.mjs`), with no runtime dependency. Includes public evals with planted flaws and a code scorer. `SKILL.md` is about 2,041 estimated tokens.
- **Custom agents in the CLI** (#16 review, #18): `agent-skills list`, `add` and `remove` now handle agents (subagents) next to skills. An agent is written once in Claude Code's subagent format and converted for Claude Code, Codex (TOML), Gemini CLI, Cursor and Copilot. `list --json` entries carry a `kind` (`skill` or `agent`). Safe paths, no writing through symbolic links, one serializer that escapes every YAML and TOML value, and an install marker with a SHA-256 so `remove` keeps files you edited. `tools` is required; `hooks`, `mcpServers`, `permissionMode` and `initialPrompt` are rejected. A tool that cannot express the agent's tool restriction refuses to install it unless you pass `--allow-broader-access` (Codex always needs it; `--yes` never implies it). `--force` backs up a file the CLI did not write. `templates/agent/agent-name.md` is the starting point for a new agent.
- **Delivery graph documentation and tooling** (#14 proposal, #20): `docs/aep/` (delivery graph, roles, repository protection checklist, engagement workspaces, context budget, draw.io source and PNG), `scripts/delivery-check.mjs` (`scope`, `tasks`, `evidence`), `scripts/context-budget.mjs` with budgets in `docs/aep/context-budgets.json` (estimates, bytes / 4 on LF-normalized text, labelled as approximations), `.github/pull_request_template.md`, and a `delivery-check` job in `validate.yml`. "AEP" is this project's working definition, with two cited sources. No graph runtime is used.
- **`stacks-auditor` agent in `azure-terraform-stacks` 0.3.0** (#17 proposal, #21): one engine lookup (`ls -d`) over the plugin path and the skills folder of every supported tool, kept equal to `src/lib/tools.mjs` by a test; `skills: [azure-terraform-stacks]` so installing the agent installs the skill; the `audit` command checks each finding's `file:line` in code and moves failures to "Not verified" (text and `--json`); the plugin `PreToolUse` command guard (`hooks/hooks.json`, `hooks/stacks-auditor-guard.mjs`), Claude Code only; a budget test for the preloaded `SKILL.md`.
- CI: the `assessment-report` job in `validate.yml` (Ubuntu and Windows, Node 20 and 24; a skipped contract test fails the job) (#23).
- Tests for the secret scanner: a frozen table of 320 cases, scaling and 1 MiB tests timed in a worker with a deadline, a seeded property test and a corpus test (#23). The time ceiling of the pathological-input property test is now proportional to the cost of the runner's own Worker start-up (#25).

### Changed

- **`stacks-auditor` frontmatter** (#21): `tools: Read, Grep, Glob, Bash` with no `disallowedTools`. In 0.2.0 the fourteen entries such as `Bash(terraform *)` removed the whole `Bash` tool in Claude Code, so the auditor could not run the engine its prompt required. Behavior change for CLI users: Cursor now refuses the agent without `--allow-broader-access` because `Bash` is not read-only (Codex always did).
- The sentences in `SKILL.md` and in the agent file that said the hook enforced the command list were false for 0.2.0 and are corrected (#24). Read-only is described as layered, not guaranteed.
- `package.json` `scripts.test` lists the new test files; `files` now includes `plugins/*/agents/**` and excludes the `evals` folder of each skill.
- `CONTRIBUTING.md` (#20): describes the delivery graph and the two human gates, says a feature or fix change never edits a version, and that the integrator archives after an approved review and green CI; a section on adding an agent.
- The OpenSpec change `add-custom-agents` is archived, and its specs (`agent-catalog`, `agent-conversion`, and updates to `cli-installer`, `marketplace-distribution` and `skill-catalog`) moved into `openspec/specs/`. Three scenario titles in its delta were restored to the names in the base specs so the archive does not drop scenarios.

### Fixed

- Windows (CRLF) failures in CI of the context-budget and agent tests (#20, #21); Node 20 on Windows does not expand a glob in `npm test`, so the file list is explicit (#23).
- An intermittent failure of `property: pathological inputs` on `windows-latest` (5182 ms and 5035 ms against a 5000 ms limit) caused by Worker start-up cost (#25).

### Known limitations

These are stated as not verified on purpose.

- **The `stacks-auditor` guard is not proven live after the correction.** The tests use a fixture built from the value the maintainer reported, not a captured file. Task 5.1 of `fix-stacks-auditor-guard-agent-type` (and tasks 6.1 and 6.2 of `fix-stacks-auditor-agent`) stay open until a live Claude Code session shows `terraform --version` denied with the guard's reason, an allowed `audit`, the main conversation untouched and the `agent_type` still namespaced. The value for CLI-installed agents and for `--plugin-dir`, and for other Claude Code versions, is not known.
- The guard is one layer. It fails open if Node cannot start it, and does not run if an administrator disables plugin hooks.
- Windows: a POSIX-form `HOME` with Git Bash may make the guard deny everything (fails closed; no known workaround; behavior unchanged). The differential tests against `bash` are skipped on Windows.
- `SKILL.md` of `azure-terraform-stacks` is about 3,487 of 3,500 estimated tokens (bytes / 4, an approximation): almost no room is left. No official token count was made (it needs an API key).
- Not run: the manual smoke test of the agents CLI in real tools (Claude Code accepting the trailing marker comment, Copilot `tools`, Cursor reading `.claude/agents`, Gemini unknown keys); a model run of the `assessment-report` evals; the manual end-to-end run of `assessment-report` (PDF was not built); the consultant validation of `assessment-report`.
- The real smoke test of the agents CLI in Claude Code, Copilot CLI, Cursor and Gemini CLI (task 9.2 of the archived `add-custom-agents`) was **not done**, and the maintainer's recorded answers to its open questions (task 0.1) were not found; both stay tracked as open tasks in `openspec/changes/archive/2026-11-24-add-custom-agents/tasks.md`.
- The publish workflow runs only `node scripts/validate-skills.mjs` and the root `npm test`; the tests of the plugin engines (`azure-terraform-stacks`, `assessment-report`, `docs-generator`) run in the CI of the pull request, not in `publish.yml`.
- The timing bounds of the secret scanner and its tests (500 ms, ratio 3, 10 s deadline, factor 8) are initial values from CI diagnostics of one afternoon, not a calibration.
- The `assessment-report` CI checks are not required by the `main-protection` ruleset (a maintainer setting).

[0.6.0]: https://github.com/rezendesfelipe/agent-skills/compare/v0.5.0...v0.6.0
