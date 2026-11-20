## Purpose

Lets anyone install the repository's skills into Claude Code, OpenAI Codex, Gemini CLI, Cursor or GitHub Copilot with one `npx` command, without knowing each agent's skills folder.

## ADDED Requirements

### Requirement: Package and command
The repository SHALL be published to npm as `@frcloudsolutions/agent-skills`, exposing a command named `agent-skills` that runs with `npx @frcloudsolutions/agent-skills <command>` on Node.js 20 or later. The package SHALL bundle every skill folder found under `plugins/<plugin>/skills/` at publish time.

#### Scenario: Running through npx
- **WHEN** a user with Node.js 20 runs `npx @frcloudsolutions/agent-skills --help`
- **THEN** the command prints its usage, listing the `list`, `add` and `remove` commands and the supported agents, and exits with code 0

#### Scenario: Unsupported Node version
- **WHEN** the command runs on Node.js older than 20
- **THEN** it prints that Node.js 20 or later is required and exits with a non-zero code

### Requirement: Supported agents and paths
The CLI SHALL support the agents below and SHALL install a skill into `<skills-dir>/<skill>/`, where `<skills-dir>` depends on the agent and scope. User scope paths are relative to the user's home directory; project scope paths are relative to the current working directory.

| Agent id | User scope | Project scope |
|----------|------------|---------------|
| `claude` | `~/.claude/skills` | `.claude/skills` |
| `codex` | `~/.agents/skills` | `.agents/skills` |
| `gemini` | `~/.gemini/skills` | `.gemini/skills` |
| `cursor` | `~/.cursor/skills` | `.cursor/skills` |
| `copilot` | `~/.copilot/skills` | `.github/skills` |

#### Scenario: Install for Codex at user scope
- **WHEN** a user runs `agent-skills add docs-generator --agent codex --scope user`
- **THEN** the skill folder is copied to `~/.agents/skills/docs-generator/`

#### Scenario: Install for Copilot at project scope
- **WHEN** a user runs `agent-skills add docs-generator --agent copilot --scope project` inside a project
- **THEN** the skill folder is copied to `./.github/skills/docs-generator/`

#### Scenario: Unknown agent
- **WHEN** a user passes `--agent windsurf`
- **THEN** the command fails with a non-zero exit code, names the unknown agent and lists the supported ids, and writes nothing

### Requirement: List skills
The `list` command SHALL print every skill available in the repository (every bundled skill) with its name, plugin and description. With `--json` it SHALL print a JSON array of objects with `name`, `plugin` and `description`.

#### Scenario: Listing all skills
- **WHEN** a user runs `agent-skills list`
- **THEN** every skill under `plugins/<plugin>/skills/` in the published version appears once, with its plugin and description

#### Scenario: Listing as JSON
- **WHEN** a user runs `agent-skills list --json`
- **THEN** stdout contains only a JSON array with one entry per bundled skill

### Requirement: Add skills
The `add [<skill>...]` command SHALL copy each chosen skill's complete folder (its `SKILL.md` and every other file in it) into the skills folder of each chosen agent. Skills are given as positional arguments or chosen interactively; agents are given with `--agent` (a comma-separated list) or chosen interactively. `--scope` SHALL default to `user` when not chosen interactively. When several chosen agents resolve to the same folder, each skill SHALL be copied there once. After installing, the command SHALL print each path it wrote.

#### Scenario: Install several skills for several agents
- **WHEN** a user runs `agent-skills add docs-generator other-skill --agent claude,gemini`
- **THEN** both skills exist in `~/.claude/skills/` and `~/.gemini/skills/`, and all four paths are printed

#### Scenario: Unknown skill
- **WHEN** a user runs `agent-skills add no-such-skill --agent claude`
- **THEN** the command fails with a non-zero exit code, says the skill does not exist, suggests `agent-skills list`, and writes nothing

#### Scenario: Skill already present
- **WHEN** the target folder already exists and `--force` is not given
- **THEN** the command does not change that folder, reports it as skipped, and exits with a non-zero code

#### Scenario: Overwrite with force
- **WHEN** the target folder exists and the user passes `--force`
- **THEN** the folder is replaced by the bundled version of the skill

### Requirement: Interactive selection
When attached to an interactive terminal, `add` and `remove` SHALL ask for every value not given on the command line, in this order: for `add`, skills, agents, scope; for `remove`, agents, scope, skills. Each question SHALL be a list the user navigates with the arrow keys, toggles with space (multiple choice for skills and agents, single choice for scope) and confirms with enter.
- For `add`, the skills list SHALL contain every skill available in the repository, showing name and description, with none preselected.
- For `remove`, the skills list SHALL contain the repository's skills that the CLI installed for at least one agent at the chosen scope.
- The agents list SHALL preselect agents whose user configuration folder exists (`~/.claude`, `~/.codex` or `~/.agents`, `~/.gemini`, `~/.cursor`, `~/.copilot`).
- The scope question SHALL default to `user`.
- Before writing or deleting, the CLI SHALL show a summary of the planned operations and ask for confirmation, unless `--yes` is given.
- Confirming a multiple-choice list with nothing selected, or pressing Ctrl+C, SHALL cancel without changes.

When not attached to an interactive terminal, the CLI SHALL NOT prompt: a missing skill or agent is a usage error, and scope defaults to `user`.

#### Scenario: Add with no arguments
- **WHEN** a user runs `agent-skills add` in a terminal
- **THEN** the CLI shows every skill in the repository to select, then the agents, then the scope, then a summary to confirm, and installs only after confirmation

#### Scenario: Flags skip questions
- **WHEN** a user runs `agent-skills add docs-generator --agent claude --scope project` in a terminal
- **THEN** the CLI asks no selection questions and shows only the confirmation summary

#### Scenario: Agents preselected
- **WHEN** a user reaches the agents question and has `~/.claude` and `~/.cursor`
- **THEN** `claude` and `cursor` are already selected

#### Scenario: Remove with no arguments
- **WHEN** a user runs `agent-skills remove` in a terminal and installed only `docs-generator` with the CLI
- **THEN** the skills list contains only `docs-generator`

#### Scenario: Cancel
- **WHEN** the user presses Ctrl+C or confirms an empty selection
- **THEN** nothing is written or deleted and the CLI exits with code 1

#### Scenario: Non-interactive run without arguments
- **WHEN** `agent-skills add` runs in CI or from another agent with no skill or no `--agent`
- **THEN** it fails with exit code 2, says which argument is missing, lists the available skills or detected agents, and writes nothing

### Requirement: Remove skills
The `remove [<skill>...]` command SHALL delete each chosen skill's folder from each selected agent's skills folder only if that folder was installed by this CLI. The CLI SHALL record its installs with a marker file inside the installed skill folder.

#### Scenario: Removing a CLI-installed skill
- **WHEN** a user runs `agent-skills remove docs-generator --agent claude` after installing it with the CLI
- **THEN** `~/.claude/skills/docs-generator/` is deleted

#### Scenario: Skill not installed for an agent
- **WHEN** a user runs `agent-skills remove docs-generator --agent claude,codex` and the skill is installed only for `claude`
- **THEN** it is removed from `claude`, `codex` is reported as not found, and the exit code is 0, because removal is idempotent

#### Scenario: Folder not installed by the CLI
- **WHEN** the target folder exists but has no install marker
- **THEN** the command leaves it in place, says it was not installed by `agent-skills`, and exits with a non-zero code

### Requirement: Scriptable behavior
Every command SHALL accept `--json` (machine-readable result on stdout, messages on stderr) and `add` and `remove` SHALL accept `--yes` (skip the confirmation) and `--dry-run` (report what would be written or deleted, change nothing). The CLI SHALL exit with code 0 only when every requested operation succeeded.

#### Scenario: Dry run
- **WHEN** a user runs `agent-skills add docs-generator --agent claude --dry-run`
- **THEN** the planned target path is printed and no file is created

#### Scenario: Partial failure
- **WHEN** an `add` for two agents succeeds for one and is skipped for the other because the folder exists
- **THEN** the successful install is kept, both outcomes are reported, and the exit code is non-zero
