## 1. Setup

- [ ] 1.1 Confirm the npm scope `@frcloudsolutions` is available to the maintainer (`npm whoami`, `npm view @frcloudsolutions/agent-skills`)
- [ ] 1.2 Add root `package.json` (name, version `0.1.0`, `type: module`, `bin.agent-skills`, `engines.node >=20`, `files` whitelist, `test` and `validate` scripts, MIT license)
- [ ] 1.3 Add `.playwright-mcp/` to `.gitignore`

## 2. Shared library

- [ ] 2.1 Move the frontmatter parser from `scripts/validate-skills.mjs` to `src/lib/frontmatter.mjs` and import it from the validator
- [ ] 2.2 Add `src/lib/catalog.mjs`: find bundled skills under `plugins/*/skills/*` and return name, plugin, description and path
- [ ] 2.3 Add `src/lib/agents.mjs`: agent id → user/project skills folder map with a source link per entry, plus detection of user config folders

## 3. Validation

- [ ] 3.1 Add the unique-skill-name check to `scripts/validate-skills.mjs`, with a failing fixture test
- [ ] 3.2 Run `node scripts/validate-skills.mjs` and confirm it passes on the current repo

## 4. CLI

- [ ] 4.1 `bin/agent-skills.mjs`: Node version check, `parseArgs`, `--help`, routing to commands, exit codes 0/1/2
- [ ] 4.2 `list` command with human and `--json` output
- [ ] 4.3 `add` command (one or more skills): agent and scope resolution, dedupe of target folders, copy, `--force`, `--dry-run`, install marker, overlap note, Gemini note
- [ ] 4.4 `src/cli/prompt.mjs`: checkbox and single-select lists (arrows, space, `a` for all, enter, Ctrl+C, scrolling) and a yes/no confirm, with no dependencies
- [ ] 4.5 Interactive flow for `add` (skills → agents → scope → summary) and `remove` (agents → scope → installed skills → summary), skipping questions given by flags, `--yes` to skip the summary; non-TTY usage error (exit 2) when skills or `--agent` are missing
- [ ] 4.6 `remove` command (one or more skills): marker check, `--dry-run`, per-agent results
- [ ] 4.7 `--json` output contract for every command (stdout JSON only, messages on stderr)

## 5. Tests

- [ ] 5.1 Test harness that runs the CLI with a temp `HOME` and temp working directory, plus a fixture skill
- [ ] 5.2 One test per scenario in `specs/cli-installer/spec.md`
- [ ] 5.3 Prompt tests: drive `prompt.mjs` with scripted keypresses on a fake TTY stream (select, toggle all, empty confirm, Ctrl+C)
- [ ] 5.4 `npm pack --dry-run` check that the tarball has `bin/`, `src/` and the skills and nothing else

## 6. Docs and CI

- [ ] 6.1 README: CLI install section, supported agents table, manual copy commands per agent (paths must match `agents.mjs`), duplicate-listing and Gemini notes
- [ ] 6.2 Update CONTRIBUTING.md: skill names must be unique; how to add an agent to the path map
- [ ] 6.3 Make `validate.yml` also run `npm test`
- [ ] 6.4 Add `publish.yml`: on tag `v*`, validate, test, check tag equals `package.json` version, `npm publish --provenance --access public`
- [ ] 6.5 Run `openspec validate multi-agent-distribution --strict` and fix any findings
