# agent-conversion Specification

## Purpose
Defines how an agent written once in Claude Code's subagent format is converted for each supported tool, so people can install it with `agent-skills` without knowing each tool's file format, and without an agent getting more permissions than its author gave it.
## Requirements
### Requirement: Converted files
For each tool the CLI SHALL write one file per agent into the tool's agents folder, named after the agent's `name`:

| Tool id | User scope folder | Project scope folder | File | Format |
|---------|-------------------|----------------------|------|--------|
| `claude` | `~/.claude/agents` | `.claude/agents` | `<name>.md` | the source file |
| `codex` | `~/.codex/agents` | `.codex/agents` | `<name>.toml` | TOML |
| `gemini` | `~/.gemini/agents` | `.gemini/agents` | `<name>.md` | Markdown + YAML |
| `cursor` | `~/.cursor/agents` | `.cursor/agents` | `<name>.md` | Markdown + YAML |
| `copilot` | `~/.copilot/agents` | `.github/agents` | `<name>.agent.md` | Markdown + YAML |

The agent's `name`, `description` and prompt SHALL be carried to every tool, and the prompt text SHALL not be altered (line endings are normalized to LF).
- **Codex:** `name`, `description` and `developer_instructions` (the prompt).
- **Gemini CLI:** `name`, `description`, `kind: local`, and `tools` when the source is restricted.
- **Cursor:** `name`, `description`, and `readonly: true` when the source is read-only.
- **GitHub Copilot:** `name`, `description`, and `tools` when the source is restricted.

#### Scenario: Install for Codex
- **WHEN** an agent `doc-writer` with a description and a prompt is installed for `codex` at user scope (with `--allow-broader-access` if it is restricted)
- **THEN** `~/.codex/agents/doc-writer.toml` exists, its `name` and `description` match the source, and its `developer_instructions` decode to exactly the source prompt, including quotes, backslashes and triple quotes

#### Scenario: Install for Copilot
- **WHEN** the same agent is installed for `copilot` at project scope
- **THEN** `./.github/agents/doc-writer.agent.md` exists with `name`, `description` and the unchanged prompt

#### Scenario: Install for Claude Code
- **WHEN** the agent is installed for `claude`
- **THEN** `~/.claude/agents/doc-writer.md` has the source's frontmatter fields and prompt

### Requirement: Fields that do not travel
Fields of the source that only Claude Code understands (`maxTurns`, `memory`, `background`, `effort`, `isolation`, `color`, and any others) SHALL be written only for `claude`. The fields `hooks`, `mcpServers`, `permissionMode` and `initialPrompt` are not allowed in repository agents (see `agent-catalog`); if one is present anyway, the agent SHALL be refused for every tool, `claude` included. `model` SHALL be carried for `claude` and omitted for the other tools unless it is `inherit` or absent, because model names differ per tool; the tool's default model is then used. For every other tool the CLI SHALL report which fields were dropped.

#### Scenario: Model is dropped with a warning
- **WHEN** an agent with `model: haiku` is installed for `gemini`
- **THEN** the written file has no `model`, and the result lists `model` as dropped for `gemini`

#### Scenario: Claude-only field
- **WHEN** an agent with `color: blue` is installed for `cursor`
- **THEN** the file has no `color`, and the result lists it as dropped

#### Scenario: Field that widens an installed agent
- **WHEN** an agent file with `mcpServers` or `permissionMode: bypassPermissions` reaches the converter
- **THEN** it is refused for every tool with the field named, and nothing is written

### Requirement: Permissions are never silently widened
An agent's **effective tools** are its `tools` minus the tool of every `disallowedTools` entry. An entry with a specifier such as `Bash(git push *)` removes the whole tool, as Claude Code does, and the result SHALL report each such entry. An agent is **restricted** when its effective tools do not contain every one of `Read`, `Grep`, `Glob`, `Edit`, `Write`, `Bash`, `WebFetch` and `WebSearch`. For each tool the CLI SHALL carry a restriction only when the tool can express it, and otherwise SHALL refuse to install that agent for that tool:
- `claude`: always expressible; the fields are kept.
- `copilot`: expressible when every effective tool is one of Claude Code's tool names above; they are written as `tools` (Copilot accepts these names as case-insensitive aliases). A `tools` list SHALL never be written empty.
- `gemini`: expressible when every effective tool has a Gemini equivalent in the CLI's translation table: `Read` to `read_file`, `Grep` to `grep_search`, `Glob` to `glob`, `Edit` to `replace`, `Write` to `write_file`, `Bash` to `run_shell_command`, `WebFetch` to `web_fetch`, `WebSearch` to `google_web_search`. They are written translated.
- `cursor`: expressible when every effective tool is read-only (`Read`, `Grep`, `Glob`, `WebFetch`, `WebSearch`); it is written as `readonly: true`, and the result notes that Cursor's read-only mode also allows commands that do not change state.
- `codex`: expressible only when the agent is not restricted, because a Codex agent cannot restrict its tools.

A tool name outside the eight above (an MCP tool, `NotebookEdit`, an entry with a specifier in `tools`) cannot be expressed outside `claude`. A refused agent SHALL be reported with the tool, the field and the reason, SHALL write nothing for that tool (and SHALL install none of the skills it depends on for that tool), and SHALL make the exit code non-zero. With `--allow-broader-access` the CLI SHALL install it anyway without the restriction the tool cannot express, the result and the printed output SHALL say that access is broader than the source asks, and the marker SHALL record it. `--yes` SHALL NOT imply `--allow-broader-access`, and the interactive confirmation summary SHALL list every agent that will be installed with broader access.

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
- **THEN** `~/.codex/agents/<name>.toml` is written without any restriction, the output says the agent has broader access than its source asks, and the marker line contains `broadened=tools`

#### Scenario: Yes does not allow broader access
- **WHEN** the same agent is installed for `codex` with `--yes` and without `--allow-broader-access`
- **THEN** it is refused as in the restricted-agent scenario

#### Scenario: Tool the CLI does not know
- **WHEN** an agent has `tools: Read, mcp__github__search` and is installed for `gemini`
- **THEN** it is refused for `gemini`, because `mcp__github__search` cannot be translated

#### Scenario: Specifier removes the whole tool
- **WHEN** an agent with `tools: Read, Grep, Bash` and `disallowedTools: Bash(rm *)` is installed for `gemini`
- **THEN** the file has `tools` with `read_file` and `grep_search` only, and the result says that `Bash(rm *)` removed the whole `Bash` tool

#### Scenario: Refused agent leaves nothing behind
- **WHEN** an agent with `skills: [docs-generator]` is refused for `codex`
- **THEN** `docs-generator` is not installed for `codex` because of that agent

### Requirement: Skills an agent depends on
When an agent lists `skills`, installing it for a tool SHALL also install those skills for the same tool and scope, as `add` does for skills. For `claude` the agent file keeps the `skills` field; for other tools the field is dropped, because those tools discover installed skills on their own. A listed skill whose folder already exists SHALL be left as it is and reported, without failing the agent's install. Skills SHALL be installed only for tools for which the agent is going to be written.

#### Scenario: Agent with a skill
- **WHEN** an agent with `skills: [docs-generator]` is installed for `claude` at user scope
- **THEN** `~/.claude/agents/<name>.md` keeps `skills`, and `~/.claude/skills/docs-generator/` is installed

#### Scenario: Skill already installed
- **WHEN** the skill folder already exists
- **THEN** the folder is left as it is, the result says so, and the agent is still installed

### Requirement: Install marker for agent files
Every file the CLI writes for an agent SHALL end with a marker line that records the package name, its version, the SHA-256 of the file's content before the marker and, when the agent was installed with `--allow-broader-access`, `broadened=tools`: an HTML comment in Markdown files (`<!-- agent-skills: … -->`) and a comment in TOML files (`# agent-skills: …`). The hash SHALL be computed over the UTF-8 content with CRLF normalized to LF, and files SHALL be written as UTF-8 without a byte order mark, with LF line endings and a final newline. The marker is read only from the last non-empty line and only when it has the exact form above; any other line is "no marker". `remove` SHALL delete an agent file only if it ends with a valid marker and its content still matches the recorded hash. The marker detects edits; it is not an authenticity check, and documentation SHALL NOT present it as one.

#### Scenario: Removing an unedited agent
- **WHEN** a user removes an agent the CLI installed and nobody edited the file
- **THEN** the file is deleted

#### Scenario: Removing an edited agent
- **WHEN** the file was edited after installation
- **THEN** it is left in place, the result says it was modified since installation, and the exit code is non-zero; `--force` deletes it

#### Scenario: Line endings changed only
- **WHEN** an editor converted an installed file from LF to CRLF and changed nothing else
- **THEN** `remove` still deletes it

#### Scenario: File without a marker
- **WHEN** the target file has no marker
- **THEN** `remove` leaves it in place and says it was not installed by `agent-skills`

#### Scenario: Malformed marker
- **WHEN** the last line looks like a marker but its hash is not 64 hexadecimal digits
- **THEN** it is treated as no marker

### Requirement: Existing agent files
When the agent file already exists, `add` SHALL leave it unchanged, report it as skipped and exit non-zero, unless `--force` is given. With `--force`, a file with a valid marker and a matching hash SHALL be replaced; any other existing file (no marker, or edited since installation) SHALL first be copied to a uniquely named backup next to it (`<file>.bak`, then `<file>.bak.1` and so on) and the result SHALL report the backup path. A symbolic link at the target path SHALL never be written through, with or without `--force`.

#### Scenario: Agent already present
- **WHEN** `~/.claude/agents/doc-writer.md` exists and `add doc-writer --tool claude` runs without `--force`
- **THEN** the file is unchanged and reported as skipped

#### Scenario: Force over a file the user wrote
- **WHEN** `~/.claude/agents/doc-writer.md` has no marker and `add doc-writer --tool claude --force` runs
- **THEN** the file is replaced, `doc-writer.md.bak` holds the previous content, and the result reports the backup

#### Scenario: Force over an unedited installed file
- **WHEN** the file carries a valid marker with a matching hash and `--force` runs
- **THEN** it is replaced and no backup is made

#### Scenario: Target is a symbolic link
- **WHEN** the target path is a symbolic link, including a dangling one, and `--force` is given
- **THEN** nothing is written, the link is untouched, and the result says the target is a symbolic link

### Requirement: Safe paths
The CLI SHALL build an agent's path only from a name that matches the kebab-case rule, is at most 64 characters and is not a Windows reserved device name, and SHALL check this again at install time even though validation checked it in the repository. The resolved target SHALL be a direct child of the tool's resolved agents folder. A new file SHALL be created with an exclusive flag so that a file appearing between the check and the write is not overwritten, and a replacement SHALL be written to a temporary sibling file and renamed into place.

#### Scenario: Hostile name
- **WHEN** a catalog entry reaches the installer with the name `../../.bashrc` or `aux`
- **THEN** the installer refuses it before touching the disk and names the reason

#### Scenario: File appears during install
- **WHEN** the target file is created by another process after the existence check and before the write
- **THEN** the installer reports it as skipped and does not overwrite it

### Requirement: Values are escaped, not concatenated
Every value from the source (`name`, `description`, tool names) SHALL reach a YAML or TOML output only through one serializer that writes a quoted, escaped string, and the keys of the output SHALL be fixed by the converter. The prompt SHALL be carried unchanged for Markdown outputs and escaped for TOML. A source value MUST NOT be able to add, remove or change a key or end a string early.

#### Scenario: Description that tries to add a key
- **WHEN** a description is `x` followed by a newline and `tools: ["*"]`, and the agent is installed for `copilot`
- **THEN** the written file has exactly one `description` value containing that text, and no extra `tools` key

#### Scenario: Hostile characters round-trip
- **WHEN** descriptions and prompts contain a colon and a space, `#`, `---`, quotes, backslashes, a triple quote, the words `true` and `null`, and U+2028
- **THEN** the test-side decoder reads back exactly the source values from every tool's file

### Requirement: Overlap warnings for agents
When two selected tools are such that one also reads the other's agents folder (Cursor reads `.claude/agents` and `.codex/agents`), `add` SHALL print a note. When the agent is restricted, the note SHALL say that the reading tool may load the other tool's copy without its restriction, because the reading tool is not documented to apply that copy's `tools` field.

#### Scenario: Cursor and Claude Code together
- **WHEN** a read-only agent is installed for `claude` and `cursor` at user scope
- **THEN** the output notes that Cursor also reads `~/.claude/agents` and may load that copy without its tool restriction

