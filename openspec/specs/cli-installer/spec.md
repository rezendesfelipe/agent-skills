# cli-installer Specification

## Purpose
Lets anyone install the repository's skills and agents (subagents) into Claude Code, OpenAI Codex, Gemini CLI, Cursor or GitHub Copilot with one `npx` command, without knowing each tool's skills and agents folders.
## Requirements
### Requirement: Package and command
The repository SHALL be published to npm as `@frcloudsolutions/agent-skills`, exposing a command named `agent-skills` that runs with `npx @frcloudsolutions/agent-skills <command>` on Node.js 20 or later. The package SHALL bundle every skill folder found under `plugins/<plugin>/skills/` and every agent file found under `plugins/<plugin>/agents/` at publish time.

#### Scenario: Running through npx
- **WHEN** a user with Node.js 20 runs `npx @frcloudsolutions/agent-skills --help`
- **THEN** the command prints its usage, listing the `list`, `add` and `remove` commands and the supported tools, and exits with code 0

#### Scenario: Unsupported Node version
- **WHEN** the command runs on Node.js older than 20
- **THEN** it prints that Node.js 20 or later is required and exits with a non-zero code

#### Scenario: Agents are in the package
- **WHEN** the package contents are listed with `npm pack --dry-run`
- **THEN** every `plugins/<plugin>/agents/<agent>.md` appears, and the packaging test fails if one is missing

### Requirement: Supported tools and paths
The CLI SHALL support the tools below. It SHALL install a skill into `<skills-dir>/<skill>/` and an agent as a file in `<agents-dir>` (see the `agent-conversion` capability), where the folders depend on the tool and scope. User scope paths are relative to the user's home directory; project scope paths are relative to the current working directory.

| Tool id | Skills, user scope | Skills, project scope | Agents, user scope | Agents, project scope |
|---------|--------------------|-----------------------|--------------------|-----------------------|
| `claude` | `~/.claude/skills` | `.claude/skills` | `~/.claude/agents` | `.claude/agents` |
| `codex` | `~/.agents/skills` | `.agents/skills` | `~/.codex/agents` | `.codex/agents` |
| `gemini` | `~/.gemini/skills` | `.gemini/skills` | `~/.gemini/agents` | `.gemini/agents` |
| `cursor` | `~/.cursor/skills` | `.cursor/skills` | `~/.cursor/agents` | `.cursor/agents` |
| `copilot` | `~/.copilot/skills` | `.github/skills` | `~/.copilot/agents` | `.github/agents` |

#### Scenario: Install for Codex at user scope
- **WHEN** a user runs `agent-skills add docs-generator --tool codex --scope user`
- **THEN** the skill folder is copied to `~/.agents/skills/docs-generator/`

#### Scenario: Install for Copilot at project scope
- **WHEN** a user runs `agent-skills add docs-generator --tool copilot --scope project` inside a project
- **THEN** the skill folder is copied to `./.github/skills/docs-generator/`

#### Scenario: Install an agent for Codex at user scope
- **WHEN** a user runs `agent-skills add doc-writer --tool codex --scope user` and `doc-writer` is an agent
- **THEN** `~/.codex/agents/doc-writer.toml` is written

#### Scenario: Unknown tool
- **WHEN** a user passes `--tool windsurf`
- **THEN** the command fails with a non-zero exit code, names the unknown tool and lists the supported ids, and writes nothing

### Requirement: Interactive selection
When attached to an interactive terminal, `add` and `remove` SHALL ask for every value not given on the command line, in this order: for `add`, items, tools, scope; for `remove`, tools, scope, items. Each question SHALL be a list the user navigates with the arrow keys, toggles with space (multiple choice for items and tools, single choice for scope) and confirms with enter.
- For `add`, the items list SHALL contain every skill and every agent available in the repository, each showing its kind, name and description, with none preselected.
- For `remove`, the items list SHALL contain the repository's skills and agents that the CLI installed for at least one tool at the chosen scope.
- The tools list SHALL preselect tools whose user configuration folder exists (`~/.claude`, `~/.codex` or `~/.agents`, `~/.gemini`, `~/.cursor`, `~/.copilot`).
- The scope question SHALL default to `user`.
- Before writing or deleting, the CLI SHALL show a summary of the planned operations and ask for confirmation, unless `--yes` is given.
- Confirming a multiple-choice list with nothing selected, or pressing Ctrl+C, SHALL cancel without changes.

When not attached to an interactive terminal, the CLI SHALL NOT prompt: a missing name or tool is a usage error, and scope defaults to `user`.

#### Scenario: Add with no arguments
- **WHEN** a user runs `agent-skills add` in a terminal
- **THEN** the CLI shows every skill and agent in the repository to select, then the tools, then the scope, then a summary to confirm, and installs only after confirmation

#### Scenario: Flags skip questions
- **WHEN** a user runs `agent-skills add docs-generator --tool claude --scope project` in a terminal
- **THEN** the CLI asks no selection questions and shows only the confirmation summary

#### Scenario: Tools preselected
- **WHEN** a user reaches the tools question and has `~/.claude` and `~/.cursor`
- **THEN** `claude` and `cursor` are already selected

#### Scenario: Remove with no arguments
- **WHEN** a user runs `agent-skills remove` in a terminal and installed only `docs-generator` with the CLI
- **THEN** the items list contains only `docs-generator`

#### Scenario: Cancel
- **WHEN** the user presses Ctrl+C or confirms an empty selection
- **THEN** nothing is written or deleted and the CLI exits with code 1

#### Scenario: Non-interactive run without arguments
- **WHEN** `agent-skills add` runs in CI or from another agent with no name or no `--tool`
- **THEN** it fails with exit code 2, says which argument is missing, lists the available items or detected tools, and writes nothing

### Requirement: Scriptable behavior
Every command SHALL accept `--json` (machine-readable result on stdout, messages on stderr) and `add` and `remove` SHALL accept `--yes` (skip the confirmation) and `--dry-run` (report what would be written or deleted, change nothing). The CLI SHALL exit with code 0 only when every requested operation succeeded. Each entry of the `--json` results SHALL carry `kind`, `name` and, for compatibility, `skill` (the item's name), and for agents `dropped`, `notes` and `broader` when they apply. `--dry-run` SHALL include refusals in its plan.

#### Scenario: Dry run
- **WHEN** a user runs `agent-skills add docs-generator --tool claude --dry-run`
- **THEN** the planned target path is printed and no file is created

#### Scenario: Partial failure
- **WHEN** an `add` for two tools succeeds for one and is skipped for the other because the folder exists
- **THEN** the successful install is kept, both outcomes are reported, and the exit code is non-zero

#### Scenario: Dry run of a refused agent
- **WHEN** a user runs `agent-skills add <restricted-agent> --tool codex --dry-run`
- **THEN** the plan reports the refusal and its reason, no file is created, and the exit code is non-zero

#### Scenario: JSON results keep the old field
- **WHEN** a user runs `agent-skills add docs-generator --tool claude --json`
- **THEN** each result has `skill` as before, and also `name` and `kind`

### Requirement: List skills and agents
The `list` command SHALL print every skill and every agent available in the repository (every bundled item) with its kind (`skill` or `agent`), name, plugin and description. With `--json` it SHALL print a JSON array of objects with `kind`, `name`, `plugin` and `description`.

#### Scenario: Listing all skills
- **WHEN** a user runs `agent-skills list`
- **THEN** every skill under `plugins/<plugin>/skills/` and every agent under `plugins/<plugin>/agents/` in the published version appears once, with its kind, plugin and description

#### Scenario: Listing as JSON
- **WHEN** a user runs `agent-skills list --json`
- **THEN** stdout contains only a JSON array with one entry per bundled skill or agent, each with a `kind`

### Requirement: Add skills and agents
The `add [<name>...]` command SHALL install each chosen item for each chosen tool: a skill by copying its complete folder (its `SKILL.md` and every other file in it) into the tool's skills folder, an agent by writing its converted file into the tool's agents folder. Names are given as positional arguments or chosen interactively; tools are given with `--tool` (a comma-separated list) or chosen interactively. `--scope` SHALL default to `user` when not chosen interactively. When several chosen tools resolve to the same folder, each skill SHALL be copied there once. After installing, the command SHALL print each path it wrote. For agents, `--allow-broader-access` applies as described in the `agent-conversion` capability. The result of each operation SHALL carry its `kind`.

#### Scenario: Install several skills for several tools
- **WHEN** a user runs `agent-skills add docs-generator other-skill --tool claude,gemini`
- **THEN** both skills exist in `~/.claude/skills/` and `~/.gemini/skills/`, and all four paths are printed

#### Scenario: Install a skill and an agent together
- **WHEN** a user runs `agent-skills add docs-generator doc-writer --tool claude`
- **THEN** the skill folder is installed in `~/.claude/skills/` and the agent file in `~/.claude/agents/`

#### Scenario: Unknown skill
- **WHEN** a user runs `agent-skills add no-such-name --tool claude`
- **THEN** the command fails with a non-zero exit code, says no skill or agent has that name, suggests `agent-skills list`, and writes nothing

#### Scenario: Skill already present
- **WHEN** the target folder already exists and `--force` is not given
- **THEN** the command does not change that folder, reports it as skipped, and exits with a non-zero code

#### Scenario: Overwrite with force
- **WHEN** the target folder exists and the user passes `--force`
- **THEN** the folder is replaced by the bundled version of the skill

#### Scenario: Refused agent
- **WHEN** an agent cannot be installed for a tool without widening its permissions
- **THEN** the other chosen items and tools are still installed, the refusal is reported with its reason, and the exit code is non-zero

### Requirement: Remove skills and agents
The `remove [<name>...]` command SHALL delete each chosen skill's folder from each selected tool's skills folder only if that folder was installed by this CLI, recorded with a marker file inside the installed skill folder. It SHALL delete each chosen agent's file from each selected tool's agents folder only if the file carries the install marker and has not been modified since (see the `agent-conversion` capability). The skills an agent depends on SHALL be left installed.

#### Scenario: Removing a CLI-installed skill
- **WHEN** a user runs `agent-skills remove docs-generator --tool claude` after installing it with the CLI
- **THEN** `~/.claude/skills/docs-generator/` is deleted

#### Scenario: Removing a CLI-installed agent
- **WHEN** a user runs `agent-skills remove doc-writer --tool claude` after installing it with the CLI
- **THEN** `~/.claude/agents/doc-writer.md` is deleted and the skills it depends on stay installed

#### Scenario: Skill not installed for a tool
- **WHEN** a user runs `agent-skills remove docs-generator --tool claude,codex` and the skill is installed only for `claude`
- **THEN** it is removed from `claude`, `codex` is reported as not found, and the exit code is 0, because removal is idempotent

#### Scenario: Folder not installed by the CLI
- **WHEN** the target folder exists but has no install marker
- **THEN** the command leaves it in place, says it was not installed by `agent-skills`, and exits with a non-zero code

