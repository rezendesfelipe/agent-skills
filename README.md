# agent-skills

[![validate](https://github.com/rezendesfelipe/agent-skills/actions/workflows/validate.yml/badge.svg)](https://github.com/rezendesfelipe/agent-skills/actions/workflows/validate.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

A public collection of [Agent Skills](https://docs.claude.com/en/docs/claude-code/skills) for Claude Code and other agents that read `SKILL.md` files. Every skill here is designed spec-first with [OpenSpec](https://github.com/Fission-AI/OpenSpec).

## Install

Works with **Claude Code**, **OpenAI Codex**, **Gemini CLI**, **Cursor** and **GitHub Copilot**. Requires Node.js 20 or later.

### With the CLI (any tool)

```bash
npx @frcloudsolutions/agent-skills add
```

In a terminal, `add` shows every skill in this repository in a checkbox list (arrow keys to move, space to select, `a` for all, enter to confirm). It then asks which tools to install into, with the tools found on your machine already selected, and whether to install for your user or only for the current project. It shows a summary to confirm before writing anything.

Pass flags to skip the questions, for example in scripts or when another agent runs the command:

```bash
npx @frcloudsolutions/agent-skills list                                   # every available skill
npx @frcloudsolutions/agent-skills add <skill> [<skill>...] --tool claude,codex [--scope user|project]
npx @frcloudsolutions/agent-skills remove <skill> --tool claude          # only removes what the CLI installed
```

Other options: `--force` (replace a skill folder that already exists), `--yes` (skip the confirmation), `--dry-run` (show what would change), `--json` (machine-readable output). Run with `--help` for details.

| Tool | `--tool` | User scope (default) | Project scope |
|-------|-----------|----------------------|---------------|
| Claude Code | `claude` | `~/.claude/skills/` | `.claude/skills/` |
| OpenAI Codex | `codex` | `~/.agents/skills/` | `.agents/skills/` |
| Gemini CLI | `gemini` | `~/.gemini/skills/` | `.gemini/skills/` |
| Cursor | `cursor` | `~/.cursor/skills/` | `.cursor/skills/` |
| GitHub Copilot | `copilot` | `~/.copilot/skills/` | `.github/skills/` |

Notes:
- Gemini CLI may need Agent Skills enabled in its settings ([docs](https://geminicli.com/docs/cli/skills/)).
- Cursor also reads `.claude/skills/`, and Copilot also reads `.claude/skills/` and `.agents/skills/`. If you install the same skill for Claude Code and one of these, that agent may list it twice. Installing for just one of them is enough.

### As a Claude Code plugin marketplace

```text
/plugin marketplace add rezendesfelipe/agent-skills
/plugin install <plugin-name>@rezendesfelipe-agent-skills
```

Run `/plugin` to browse the plugins this marketplace offers.

### Copy a skill by hand

```bash
git clone https://github.com/rezendesfelipe/agent-skills.git
skill=agent-skills/plugins/<plugin>/skills/<skill>

# For your user (all projects): pick the line for your tool
cp -r "$skill" ~/.claude/skills/     # Claude Code
cp -r "$skill" ~/.agents/skills/     # OpenAI Codex
cp -r "$skill" ~/.gemini/skills/     # Gemini CLI
cp -r "$skill" ~/.cursor/skills/     # Cursor
cp -r "$skill" ~/.copilot/skills/    # GitHub Copilot

# Or only for one project, from the project folder
cp -r "$skill" .claude/skills/       # Claude Code
cp -r "$skill" .agents/skills/       # OpenAI Codex
cp -r "$skill" .gemini/skills/       # Gemini CLI
cp -r "$skill" .cursor/skills/       # Cursor
cp -r "$skill" .github/skills/       # GitHub Copilot
```

Create the target folder first (`mkdir -p <folder>`) if it does not exist.

## Catalog

| Plugin | Skills | Description |
|--------|--------|-------------|
| [`docs-generator`](plugins/docs-generator/skills/docs-generator/SKILL.md) | `docs-generator` | Writes design documents and reports as structured Markdown and renders them to designed PDF and DOCX (cover, contents, executive summary, sources, annexes, change log), plus a matching Excel template and Office theme. Uses your Claude Design System or brand, or a research-based default theme. Needs Node.js 20+; PDF output also needs Chrome, Edge or Chromium. |

## Layout

```text
.claude-plugin/marketplace.json   # marketplace manifest: lists every plugin
plugins/<plugin>/skills/<skill>/SKILL.md
templates/skill/SKILL.md          # starting point for new skills
openspec/specs/                   # current specs of this repository
openspec/changes/                 # proposed changes being worked on
scripts/validate-skills.mjs       # format and manifest checks (also run in CI)
bin/, src/                        # the agent-skills CLI published to npm
test/                             # CLI tests (npm test)
```

## Contributing

Every skill starts as an OpenSpec change. See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE)
