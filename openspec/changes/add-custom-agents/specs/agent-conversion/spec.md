## Purpose

Defines how an agent written once in Claude Code's subagent format is converted for each supported tool, so people can install it with `agent-skills` without knowing each tool's file format, and without an agent getting more permissions than its author gave it.

## ADDED Requirements

### Requirement: Converted files
For each tool the CLI SHALL write one file per agent into the tool's agents folder, named after the agent's `name`:

| Tool id | User scope folder | Project scope folder | File | Format |
|---------|-------------------|----------------------|------|--------|
| `claude` | `~/.claude/agents` | `.claude/agents` | `<name>.md` | the source file |
| `codex` | `~/.codex/agents` | `.codex/agents` | `<name>.toml` | TOML |
| `gemini` | `~/.gemini/agents` | `.gemini/agents` | `<name>.md` | Markdown + YAML |
| `cursor` | `~/.cursor/agents` | `.cursor/agents` | `<name>.md` | Markdown + YAML |
| `copilot` | `~/.copilot/agents` | `.github/agents` | `<name>.agent.md` | Markdown + YAML |

The agent's `name`, `description` and prompt SHALL be carried to every tool, and the prompt text SHALL not be altered.
- **Codex:** `name`, `description` and `developer_instructions` (the prompt).
- **Gemini CLI:** `name`, `description`, `kind: local`, and `tools` when the source restricts tools.
- **Cursor:** `name`, `description`, and `readonly: true` when the source is read-only.
- **GitHub Copilot:** `name`, `description`, and `tools` when the source restricts tools.

#### Scenario: Install for Codex
- **WHEN** an agent `doc-writer` with a description and a prompt is installed for `codex` at user scope
- **THEN** `~/.codex/agents/doc-writer.toml` exists, its `name` and `description` match the source, and its `developer_instructions` decode to exactly the source prompt, including quotes, backslashes and triple quotes

#### Scenario: Install for Copilot
- **WHEN** the same agent is installed for `copilot` at project scope
- **THEN** `./.github/agents/doc-writer.agent.md` exists with `name`, `description` and the unchanged prompt

#### Scenario: Install for Claude Code
- **WHEN** the agent is installed for `claude`
- **THEN** `~/.claude/agents/doc-writer.md` has the source's frontmatter fields and prompt

### Requirement: Fields that do not travel
Fields of the source that only Claude Code understands (`permissionMode`, `maxTurns`, `mcpServers`, `hooks`, `memory`, `background`, `effort`, `isolation`, `color`, and any others) SHALL be written only for `claude`. `model` SHALL be carried for `claude` and omitted for the other tools unless it is `inherit` or absent, because model names differ per tool; the tool's default model is then used. For every other tool the CLI SHALL report which fields were dropped.

#### Scenario: Model is dropped with a warning
- **WHEN** an agent with `model: haiku` is installed for `gemini`
- **THEN** the written file has no `model`, and the result lists `model` as dropped for `gemini`

#### Scenario: Claude-only field
- **WHEN** an agent with `color: blue` is installed for `cursor`
- **THEN** the file has no `color`, and the result lists it as dropped

### Requirement: Permissions are never silently widened
The fields `tools`, `disallowedTools` and a `permissionMode` other than `default` are restrictions. For each tool the CLI SHALL carry a restriction only when the tool can express it, and otherwise SHALL refuse to install that agent for that tool:
- `claude`: always expressible; the fields are kept.
- `copilot`: expressible when `tools` is the only restriction and every name is one of Claude Code's tool names `Read`, `Grep`, `Glob`, `Edit`, `Write`, `Bash`, `WebFetch`, `WebSearch`; they are written as `tools` (Copilot accepts these names as aliases).
- `gemini`: expressible when `tools` is the only restriction and every name has a Gemini equivalent in the CLI's translation table (for example `Read` → `read_file`, `Grep` → `grep_search`); they are written translated.
- `cursor`: expressible when `tools` is the only restriction and every name is read-only (`Read`, `Grep`, `Glob`, `WebFetch`, `WebSearch`); it is written as `readonly: true`, and the result notes that Cursor's read-only mode also allows commands that do not change state.
- `codex`: expressible only when the source has no restriction, because a Codex agent cannot restrict its tools.

An agent without restrictions is expressible everywhere. A refused agent SHALL be reported with the tool, the field and the reason, SHALL write nothing for that tool, and SHALL make the exit code non-zero. With `--allow-broader-access` the CLI SHALL install it anyway without the restriction the tool cannot express, and the result and the printed output SHALL say that access is broader than the source asks.

#### Scenario: Read-only agent for Gemini
- **WHEN** an agent with `tools: Read, Grep` is installed for `gemini`
- **THEN** the file has `tools` with `read_file` and `grep_search`

#### Scenario: Read-only agent for Cursor
- **WHEN** an agent with `tools: Read, Grep, Glob` is installed for `cursor`
- **THEN** the file has `readonly: true` and the result notes that read-only mode also allows commands that do not change state

#### Scenario: Restricted agent for Codex
- **WHEN** an agent with `tools: Read, Grep` is installed for `codex`
- **THEN** nothing is written for `codex`, the result says a Codex agent cannot restrict its tools, and the exit code is non-zero

#### Scenario: Allowing broader access
- **WHEN** the same agent is installed for `codex` with `--allow-broader-access`
- **THEN** `~/.codex/agents/<name>.toml` is written without any restriction, and the output says the agent has broader access than its source asks

#### Scenario: Tool the CLI does not know
- **WHEN** an agent has `tools: Read, mcp__github__search` and is installed for `gemini`
- **THEN** it is refused for `gemini`, because `mcp__github__search` cannot be translated

#### Scenario: A restrictive permission mode
- **WHEN** an agent has `permissionMode: plan` and is installed for `copilot`
- **THEN** it is refused for `copilot`, because the permission mode cannot be expressed

### Requirement: Skills an agent depends on
When an agent lists `skills`, installing it for a tool SHALL also install those skills for the same tool and scope, as `add` does for skills. For `claude` the agent file keeps the `skills` field; for other tools the field is dropped, because those tools discover installed skills on their own. A listed skill whose folder already exists SHALL be left as it is and reported, without failing the agent's install.

#### Scenario: Agent with a skill
- **WHEN** an agent with `skills: [docs-generator]` is installed for `claude` at user scope
- **THEN** `~/.claude/agents/<name>.md` keeps `skills`, and `~/.claude/skills/docs-generator/` is installed

#### Scenario: Skill already installed
- **WHEN** the skill folder already exists
- **THEN** the folder is left as it is, the result says so, and the agent is still installed

### Requirement: Install marker for agent files
Every file the CLI writes for an agent SHALL end with a marker line that records the package name, its version and the SHA-256 of the file's content before the marker: an HTML comment in Markdown files (`<!-- agent-skills: … -->`) and a comment in TOML files (`# agent-skills: …`). `remove` SHALL delete an agent file only if it ends with a valid marker and its content still matches the recorded hash.

#### Scenario: Removing an unedited agent
- **WHEN** a user removes an agent the CLI installed and nobody edited the file
- **THEN** the file is deleted

#### Scenario: Removing an edited agent
- **WHEN** the file was edited after installation
- **THEN** it is left in place, the result says it was modified since installation, and the exit code is non-zero; `--force` deletes it

#### Scenario: File without a marker
- **WHEN** the target file has no marker
- **THEN** `remove` leaves it in place and says it was not installed by `agent-skills`

### Requirement: Existing agent files
When the agent file already exists, `add` SHALL leave it unchanged, report it as skipped and exit non-zero, unless `--force` is given, in which case it SHALL be replaced.

#### Scenario: Agent already present
- **WHEN** `~/.claude/agents/doc-writer.md` exists and `add doc-writer --tool claude` runs without `--force`
- **THEN** the file is unchanged and reported as skipped
