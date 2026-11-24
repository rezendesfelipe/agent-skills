# Changelog

All notable changes to this project are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the versions follow [Semantic Versioning](https://semver.org/) (while the major version is 0, a minor version may add features and change behavior).

Two things are versioned separately:

- the npm package `@frcloudsolutions/agent-skills` (the `agent-skills` command and the files it bundles), in `package.json`;
- each plugin of the marketplace, in `plugins/<plugin>/.claude-plugin/plugin.json`. Claude Code decides whether an installed plugin has an update from this number, so a change to a plugin ships with a bump of that plugin.

Versions before 0.6.0 were not recorded in this file; see the git tags and `openspec/changes/archive/`.

## [0.6.0] - unreleased

Prepared on 2026-11-24 from `main` at 7521019 (pull requests #14 to #25). The date, the tag and the npm publish wait for the maintainer's explicit OK. Plugin versions in this release: `azure-terraform-stacks` 0.3.0 (was 0.2.0), `assessment-report` 0.1.0 (new), `docs-generator` 0.1.0 (unchanged).

### Security

- **The command guard of the `stacks-auditor` agent in `azure-terraform-stacks` 0.2.0 did not restrict the agent.** Claude Code sends the `agent_type` `azure-terraform-stacks:stacks-auditor` (namespaced by the plugin) to a `PreToolUse` hook, and the guard compared it only with `stacks-auditor`. The comparison was never true for the real agent, so the guard allowed every command and never printed a reason. The 27 guard tests of that moment passed because they fed the short value. This was found in a live Claude Code session of the maintainer on 2026-11-24 (evidence, sanitized, in `openspec/changes/fix-stacks-auditor-guard-agent-type/evidence/live-2026-11-24.md`). Fixed in 0.3.0 (#24): the guard now matches the exact namespaced value and the short one, and every other agent is left alone.
  - Who was exposed: anyone who installed the plugin through the Claude Code marketplace and ran the auditor with 0.2.0. The auditor's other layers (the prompt rules and `tools: Read, Grep, Glob, Bash`) were unchanged, so the exposure is that `Bash` was not filtered. If you cannot update, `plugins/azure-terraform-stacks/skills/azure-terraform-stacks/references/traps.md` has interim guidance (`permissions.deny` rules, a read-only checkout, or not using the auditor).
  - The npm package never shipped the guard: it bundles skills and agents only, not `hooks/`. Agents installed with `agent-skills add stacks-auditor` have never had a guard, and the README says it exists on Claude Code only.
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
- The timing bounds of the secret scanner and its tests (500 ms, ratio 3, 10 s deadline, factor 8) are initial values from CI diagnostics of one afternoon, not a calibration.
- The `assessment-report` CI checks are not required by the `main-protection` ruleset (a maintainer setting).

[0.6.0]: https://github.com/rezendesfelipe/agent-skills/compare/v0.5.0...v0.6.0
