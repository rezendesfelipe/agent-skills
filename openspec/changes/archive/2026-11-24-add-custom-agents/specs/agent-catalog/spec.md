## Purpose

Defines where custom agents live in the repository and the source format every agent must follow, so they can be validated, shared through the Claude Code marketplace and converted for other tools.

## ADDED Requirements

### Requirement: Agent location
Every agent SHALL be one Markdown file at `plugins/<plugin>/agents/<agent>.md`. The file name without `.md` SHALL equal the agent's `name`.

#### Scenario: Agent file in the right place
- **WHEN** `plugins/docs/agents/doc-writer.md` has `name: doc-writer`
- **THEN** validation passes for that agent

#### Scenario: Name does not match the file
- **WHEN** `plugins/docs/agents/doc-writer.md` declares `name: writer`
- **THEN** validation fails and reports the file and the mismatch

#### Scenario: Nested folders
- **WHEN** an agent file is inside a subfolder of `plugins/<plugin>/agents/`
- **THEN** validation fails, because tools treat nested Markdown files as separate agents

### Requirement: Agent source format
Every agent file SHALL start with YAML frontmatter followed by a non-empty Markdown body that is the agent's prompt. The format is Claude Code's subagent format:
- `name` (required): kebab-case, at most 64 characters, and not a Windows reserved device name (`con`, `prn`, `aux`, `nul`, `com1` to `com9`, `lpt1` to `lpt9`).
- `description` (required): non-empty, at most 1024 characters, on one line and without control characters or Unicode line separators. It tells the tool when to delegate to the agent.
- `tools` (required, as the `skill-catalog` capability already demands): a non-empty list or comma-separated string of tool names. The agent's effective tools are `tools` minus the tool of every `disallowedTools` entry, because Claude Code removes the whole tool even when an entry has a specifier such as `Bash(git push *)`; validation SHALL fail when no tool is left.
- `disallowedTools` (optional): same format as `tools`.
- `model` (optional): `inherit`, a Claude alias (`sonnet`, `opus`, `haiku`, `fable`) or a model id.
- `skills` (optional): a list of skill names, each of which MUST exist in the repository's catalog.
- Other fields Claude Code's subagent format defines are allowed and are carried only for Claude Code, **except** `hooks`, `mcpServers`, `permissionMode` and `initialPrompt`, which MUST NOT appear: Claude Code ignores them for plugin agents but honors them for user and project agents, so the file the CLI installs would be more powerful than the file the marketplace loads.

The body SHALL be at most 30,000 characters, the smallest limit among the supported tools. The file MUST NOT contain Unicode bidirectional control characters (U+202A to U+202E, U+2066 to U+2069).

#### Scenario: Valid agent
- **WHEN** an agent has `name`, a `description`, a `tools` list and a non-empty body
- **THEN** validation passes

#### Scenario: Missing description
- **WHEN** the frontmatter has no `description`
- **THEN** validation fails and reports the missing field

#### Scenario: Missing tools
- **WHEN** the frontmatter has no `tools`
- **THEN** validation fails, because an agent without `tools` would inherit every tool of the session

#### Scenario: Specifier removes the whole tool
- **WHEN** an agent has `tools: Bash` and `disallowedTools: Bash(rm *)`
- **THEN** validation fails because no tool is left, and the message says that a specifier removes the whole tool

#### Scenario: Empty prompt
- **WHEN** the body after the frontmatter is empty
- **THEN** validation fails and says the agent has no prompt

#### Scenario: Prompt too long
- **WHEN** the body is longer than 30,000 characters
- **THEN** validation fails and reports the length and the limit

#### Scenario: Unknown skill
- **WHEN** `skills` lists a name that is not a skill in the catalog
- **THEN** validation fails and names the missing skill

#### Scenario: Field Claude Code ignores for plugin agents
- **WHEN** an agent declares `hooks`, `mcpServers`, `permissionMode` or `initialPrompt`
- **THEN** validation fails and names the field and the reason

#### Scenario: Reserved or hostile name
- **WHEN** an agent is named `aux` or `con`
- **THEN** validation fails because the name is a Windows reserved device name

#### Scenario: Unsafe characters
- **WHEN** a `description` contains a newline or a bidirectional control character
- **THEN** validation fails and reports the file and the character

### Requirement: Names are unique across skills and agents
No agent name SHALL equal another agent's name or any skill's name anywhere in the repository, so an item can be addressed by its name alone.

#### Scenario: Agent and skill with the same name
- **WHEN** `plugins/a/skills/reviewer/` and `plugins/b/agents/reviewer.md` both exist
- **THEN** validation fails and names both paths

### Requirement: Agent template
The repository SHALL provide an agent template that passes validation once its placeholder name is replaced, so contributors can start from a known-good agent. The template SHALL be read-only by default (`tools: Read, Grep, Glob`, no `Edit`, `Write` or `Bash`) and its body SHALL tell the author to report every finding with `file:line` evidence and to list unverified claims separately.

#### Scenario: Starting from the template
- **WHEN** a contributor copies the template to `plugins/<plugin>/agents/<agent>.md` and sets `name` to `<agent>`
- **THEN** the agent passes validation without further changes

#### Scenario: Template is read-only
- **WHEN** the template is validated
- **THEN** its effective tools contain none of `Edit`, `Write`, `Bash` or `NotebookEdit`, and a test fails if they do
