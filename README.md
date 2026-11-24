# agent-skills

[![validate](https://github.com/rezendesfelipe/agent-skills/actions/workflows/validate.yml/badge.svg)](https://github.com/rezendesfelipe/agent-skills/actions/workflows/validate.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

A public collection of [Agent Skills](https://docs.claude.com/en/docs/claude-code/skills) and custom agents (subagents) for Claude Code and other tools that read `SKILL.md` files or subagent files. Every skill and agent here is designed spec-first with [OpenSpec](https://github.com/Fission-AI/OpenSpec).

## Install

Works with **Claude Code**, **OpenAI Codex**, **Gemini CLI**, **Cursor** and **GitHub Copilot**. Requires Node.js 20 or later.

### With the CLI (any tool)

```bash
npx @frcloudsolutions/agent-skills add
```

In a terminal, `add` shows every skill and agent in this repository in a checkbox list (arrow keys to move, space to select, `a` for all, enter to confirm). It then asks which tools to install into, with the tools found on your machine already selected, and whether to install for your user or only for the current project. It shows a summary to confirm before writing anything.

Pass flags to skip the questions, for example in scripts or when another agent runs the command:

```bash
npx @frcloudsolutions/agent-skills list                                   # every available skill and agent
npx @frcloudsolutions/agent-skills add <name> [<name>...] --tool claude,codex [--scope user|project]
npx @frcloudsolutions/agent-skills remove <name> --tool claude           # only removes what the CLI installed
```

A name is either a skill or an agent: names are unique across both, so `add <name>` needs no extra flag.

Other options: `--force` (replace a skill folder or agent file that already exists), `--allow-broader-access` (see [Agents](#agents)), `--yes` (skip the confirmation), `--dry-run` (show what would change), `--json` (machine-readable output). Run with `--help` for details.

| Tool | `--tool` | Skills, user scope | Skills, project scope | Agents, user scope | Agents, project scope | Agent file |
|-------|-----------|--------------------|-----------------------|--------------------|-----------------------|------------|
| Claude Code | `claude` | `~/.claude/skills/` | `.claude/skills/` | `~/.claude/agents/` | `.claude/agents/` | `.md` |
| OpenAI Codex | `codex` | `~/.agents/skills/` | `.agents/skills/` | `~/.codex/agents/` | `.codex/agents/` | `.toml` |
| Gemini CLI | `gemini` | `~/.gemini/skills/` | `.gemini/skills/` | `~/.gemini/agents/` | `.gemini/agents/` | `.md` |
| Cursor | `cursor` | `~/.cursor/skills/` | `.cursor/skills/` | `~/.cursor/agents/` | `.cursor/agents/` | `.md` |
| GitHub Copilot | `copilot` | `~/.copilot/skills/` | `.github/skills/` | `~/.copilot/agents/` | `.github/agents/` | `.agent.md` |

The CLI uses these folders only. It does not follow relocated configuration folders such as `COPILOT_HOME`; if you moved a tool's folder, copy the files by hand.

Notes:
- Gemini CLI may need Agent Skills enabled in its settings ([docs](https://geminicli.com/docs/cli/skills/)).
- Cursor also reads `.claude/skills/`, and Copilot also reads `.claude/skills/` and `.agents/skills/`. If you install the same skill for Claude Code and one of these, that agent may list it twice. Installing for just one of them is enough.

### Agents

An agent is one Markdown file written once in Claude Code's subagent format (`plugins/<plugin>/agents/<name>.md`). Claude Code's plugin marketplace loads it as is; for the other tools the CLI converts it to that tool's format (Codex uses TOML, the others Markdown with different fields), carries the name, description and prompt unchanged, and reports every field it dropped (`model` and Claude-only fields such as `color` or `maxTurns` are written only for Claude Code).

If an agent lists `skills`, installing it also installs those skills for the same tool and scope. A skill folder that already exists is left as it is. `remove` never removes the skills.

**Permissions are never silently widened.** Every agent declares the `tools` it may use. The CLI carries that restriction only where the tool can express it, and otherwise refuses to install the agent for that tool, writes nothing, and exits with a non-zero code.

| Tool | Can express the restriction | Written as |
|-------|------------------|------------|
| Claude Code | yes, documented by the vendor | the source `tools` and `disallowedTools`, unchanged |
| Gemini CLI | documented by the vendor for the eight tools below; not yet verified in a real tool | `tools`, translated to Gemini names (`read_file`, `grep_search`, `glob`, `replace`, `write_file`, `run_shell_command`, `web_fetch`, `google_web_search`) |
| GitHub Copilot | documented by the vendor for the eight tools below; not yet verified in a real tool (Copilot CLI may need `strict-tools-list`) | `tools`, with Claude Code's names (Copilot accepts them as aliases) |
| Cursor | only a read-only agent, documented by the vendor; not yet verified in a real tool | `readonly: true`; Cursor's read-only mode also allows commands that do not change state |
| OpenAI Codex | **no**, by the vendor's documentation | nothing is expressible, so every agent that restricts its tools is refused |

The CLI writes the restriction; whether each tool enforces it is that tool's behavior, and "not yet verified" means the maintainer has not tried it in the real tool yet. The eight tools are `Read`, `Grep`, `Glob`, `Edit`, `Write`, `Bash`, `WebFetch` and `WebSearch`. Any other entry (an MCP tool, `NotebookEdit`, a tool name with a specifier) cannot leave Claude Code. A `disallowedTools` entry with a specifier such as `Bash(git push *)` removes the whole `Bash` tool, as Claude Code does; the CLI reports each such entry.

To install a refused agent anyway, pass `--allow-broader-access`. The agent is then written **without** the restriction the tool cannot express, so it can use more than its source asks; the output says so and the install marker records `broadened=tools`. `--yes` never implies this flag, and the interactive summary lists every agent that will be installed with broader access. For Codex you need the flag for nearly every agent.

Cursor also reads `.claude/agents` and `.codex/agents`. If you install a restricted agent for Claude Code and Cursor, Cursor may load the Claude Code copy without its tool restriction, and the CLI warns you; install it for one of them only.

**Existing files.** `add` leaves an existing agent file alone and exits non-zero. With `--force`, a file this CLI wrote and nobody edited is replaced; any other file is first copied to `<file>.bak` (then `.bak.1`, ...) and the path is printed. A symbolic link at the target is never written through.

**Install marker.** Every file the CLI writes ends with a comment such as `<!-- agent-skills: sha256=... version=... -->` (`# agent-skills: ...` in TOML) that records the version and the SHA-256 of the file before it. `remove` deletes an agent only when the marker is valid and the file still matches it, so your edits are kept (`--force` deletes an edited file anyway). The marker detects edits; it does not prove who wrote the file, because anyone who can write the file can write a marker.

### As a Claude Code plugin marketplace

```text
/plugin marketplace add rezendesfelipe/agent-skills
/plugin install <plugin-name>@rezendesfelipe-agent-skills
```

Run `/plugin` to browse the plugins this marketplace offers.

### Copy a skill or an agent by hand

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

An agent file works as is only in Claude Code, so copying it by hand is for Claude Code only:

```bash
cp agent-skills/plugins/<plugin>/agents/<agent>.md ~/.claude/agents/   # or .claude/agents/ for one project
```

For the other tools use the CLI, which converts the file.

## Catalog

| Plugin | Skills | Agents | Description |
|--------|--------|--------|-------------|
| [`azure-terraform-stacks`](plugins/azure-terraform-stacks/skills/azure-terraform-stacks/SKILL.md) | `azure-terraform-stacks` | `stacks-auditor`: reads an existing infrastructure repository and returns one audit report; read-only by design and by guard, not by guarantee (it keeps `Bash` to run the engine). Installed by the marketplace, or by `agent-skills add stacks-auditor` at user scope, which installs the skill with it (the auditor never runs an engine found inside the audited repository); Cursor and Codex need `--allow-broader-access`; the command guard exists on Claude Code only | Sets up and checks Terraform on Azure as independent stacks (one tfstate per stack and instance) with one parameterized Azure DevOps or GitHub Actions pipeline, an optional private AKS + PostgreSQL architecture (standalone or Azure Landing Zone), Argo CD delivery, a Terraform-to-Kustomize bridge that can open the pull request, an editable draw.io diagram, and a read-only auditor agent that audits an existing repository without a manifest. Needs Node.js 20+; Terraform, actionlint, kubectl and the draw.io desktop app are optional. |
| [`docs-generator`](plugins/docs-generator/skills/docs-generator/SKILL.md) | `docs-generator` | none yet | Writes design documents and reports as structured Markdown and renders them to designed PDF and DOCX (cover, contents, executive summary, sources, annexes, change log), plus a matching Excel template and Office theme. Uses your Claude Design System or brand, or a research-based default theme. Needs Node.js 20+; PDF output also needs Chrome, Edge or Chromium. |
| [`assessment-report`](plugins/assessment-report/skills/assessment-report/SKILL.md) | `assessment-report` | none yet | Produces a technical assessment report for a client in which every finding cites evidence that a script has verified (path, line range and quoted text, or a checked absence search), unverified claims are labelled and demoted by code, severity, effort and the 30/60/90-day roadmap follow fixed rules, and the result is an executive document with a technical annex in English, Portuguese or Spanish, rendered to PDF and DOCX by `docs-generator`. Read-only; no runtime dependencies. The workflow gates guard against shortcuts and accidents, not against an agent that edits the state files; `output` and snapshot evidence prove only consistency with a file the agent saved. Needs Node.js 20+; PDF and DOCX need the `docs-generator` plugin. |

## Layout

```text
.claude-plugin/marketplace.json   # marketplace manifest: lists every plugin
plugins/<plugin>/skills/<skill>/SKILL.md
plugins/<plugin>/agents/<agent>.md  # custom agents (subagents)
templates/skill/SKILL.md          # starting point for new skills
templates/agent/agent-name.md     # starting point for new agents (read-only)
openspec/specs/                   # current specs of this repository
openspec/changes/                 # proposed changes being worked on
scripts/validate-skills.mjs       # format and manifest checks (also run in CI)
bin/, src/                        # the agent-skills CLI published to npm
test/                             # CLI tests (npm test)
```

## Contributing

Every skill and agent starts as an OpenSpec change. See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE)
