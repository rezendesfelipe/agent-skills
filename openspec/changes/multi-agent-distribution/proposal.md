## Why

Today the repository installs only into Claude Code (plugin marketplace or a manual copy into `~/.claude/skills/`). The same `SKILL.md` format is now read by OpenAI Codex, Gemini CLI, Cursor and GitHub Copilot, but each looks in a different folder, so users of those agents have to work out the paths themselves. The next planned skill (`docs-generator`) is meant to be installable by anyone, so distribution has to work across agents first.

## What Changes

- Publish an npm package `@frcloudsolutions/agent-skills` with a CLI (`agent-skills`) that bundles every skill in `plugins/` and installs it into the right folder for each supported agent:
  - `npx @frcloudsolutions/agent-skills list` — show every skill available in the repository.
  - `npx @frcloudsolutions/agent-skills add [<skill>...] [--agent <agent>[,<agent>]] [--scope user|project]` — copy one or more skills into each agent's skills folder.
  - `npx @frcloudsolutions/agent-skills remove [<skill>...] [--agent ...]` — delete skills the CLI installed.
- In a terminal, `add` and `remove` run without arguments: they show every skill available in the repository in a checkbox list (arrow keys, space, enter), then ask for the agents and the scope. Flags skip the matching question.
- Supported agents (first release): `claude`, `codex`, `gemini`, `cursor`, `copilot`, using a per-agent path map the repository maintains.
- The CLI is scriptable: no prompts when not attached to a terminal, `--json` output, `--dry-run`, and clear exit codes.
- Skill names become unique across all plugins, so `add <skill>` is never ambiguous. Validation enforces this.
- README documents installation for every supported agent: the CLI, plus the manual-copy path for each agent.
- A GitHub Actions workflow publishes the package to npm when a version tag is pushed.

## Capabilities

### New Capabilities
- `cli-installer`: the npm CLI that lists, installs and removes skills for each supported agent and scope.

### Modified Capabilities
- `marketplace-distribution`: the "Manual installation" requirement expands from Claude Code only to every supported agent, and the README must document the CLI.
- `skill-catalog`: adds a requirement that skill names are unique across plugins.

## Non-goals

- Native plugin or extension manifests for other agents (Gemini CLI extensions, `gh skill`, Cursor or Codex marketplaces). The Claude Code marketplace stays as it is.
- Installing a skill's runtime dependencies (for example `npm install` for a skill that ships scripts). A skill that needs dependencies documents its own setup step in its `SKILL.md`.
- Automatic updates or version tracking of installed skills beyond reinstalling with `--force`.
- Agents not in the list above. Adding one later is a change to the path map only.
- Windows-specific path handling beyond what Node's `os.homedir()` and `path` already provide.

## Impact

- New: `package.json` at the repo root, `bin/agent-skills.mjs`, CLI source under `src/cli/`, tests under `test/`.
- Changed: `scripts/validate-skills.mjs` (unique-name check), `README.md` (multi-agent install section), `.github/workflows/` (new publish workflow; validate workflow also runs CLI tests).
- New external dependency: the npm registry. Publishing needs an `NPM_TOKEN` secret (or npm trusted publishing) configured by the maintainer.
- Runtime requirement for users: Node.js 20 or later. The CLI has no npm dependencies.
