# Contributing

Thanks for helping. This repository is built **spec-first** with [OpenSpec](https://github.com/Fission-AI/OpenSpec): every new skill or structural change begins as a change proposal, and code follows the spec.

## Prerequisites

- Node.js LTS
- OpenSpec CLI: `npm install -g @fission-ai/openspec`

After cloning, generate the OpenSpec commands for your agent (they are not committed):

```bash
openspec init --tools claude   # or cursor, codex, github-copilot, ... (see openspec init --help)
```

This keeps the existing `openspec/` folder and only adds the `/opsx:*` commands.

## Adding a skill

1. **Propose.** Create a change:
   - Claude Code: `/opsx:propose "add <skill> skill"`
   - CLI: `openspec new change add-<skill>-skill`, then write `proposal.md`, `specs/`, `design.md` (if needed) and `tasks.md`.

   Name the capability after the skill (for example `pdf-tools`) and describe its behavior with requirements and `#### Scenario:` blocks.
2. **Validate the proposal.** `openspec validate add-<skill>-skill --strict`
3. **Implement** (`/opsx:apply`):
   - Copy `templates/skill/` to `plugins/<plugin>/skills/<skill>/`.
   - Set `name` to the folder name and write a `description` that says what the skill does **and when to use it**.
   - If the plugin is new, add `plugins/<plugin>/.claude-plugin/plugin.json` and an entry in `.claude-plugin/marketplace.json`.
   - Add the skill to the catalog table in `README.md`.
4. **Check locally.**
   ```bash
   node scripts/validate-skills.mjs
   npm test
   openspec validate --all --strict
   ```
5. **Open a pull request.** CI runs the same checks.
6. **Archive.** After merge, the maintainer runs `/opsx:archive` (or `openspec archive <change>`) so the specs move into `openspec/specs/`.

## Skill checklist

- [ ] `name` is kebab-case, matches the folder, is at most 64 characters, and is not used by any other skill in any plugin (the CLI installs skills by name)
- [ ] `description` is at most 1024 characters, written in third person, and says when to use the skill
- [ ] Instructions are concrete steps, with examples
- [ ] Supporting files (scripts, references) live inside the skill folder and are referenced by relative path
- [ ] No secrets, personal data or machine-specific paths
- [ ] Content is in English

## Adding or fixing an agent in the CLI

The folders the `agent-skills` CLI installs into are defined in one place: `src/lib/agents.mjs`. To add an agent or fix a path:

1. Edit its entry (`user` and `project` folders, the `detect` folders that show the agent is installed, `alsoReads` for other agents' folders it also loads, and a `source` link to the vendor's docs).
2. Update the agents table in `README.md` and the path test in `test/cli.test.mjs`.
3. Because the supported paths are part of the `cli-installer` spec, open an OpenSpec change for it.

## Releasing the CLI

1. Bump `version` in `package.json` and commit.
2. Push a tag `v<version>`. The `publish` workflow validates, tests and publishes to npm with provenance.

## Commits

Use [Conventional Commits](https://www.conventionalcommits.org/): `feat(skill): add pdf-tools`, `docs: ...`, `ci: ...`.
