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
- `name` (required): kebab-case, at most 64 characters.
- `description` (required): non-empty, at most 1024 characters. It tells the tool when to delegate to the agent.
- `tools` (optional): a list or a comma-separated string of tool names.
- `model` (optional): `inherit`, a Claude alias (`sonnet`, `opus`, `haiku`, `fable`) or a model id.
- `skills` (optional): a list of skill names, each of which MUST exist in the repository's catalog.
- Any other field Claude Code's subagent format defines is allowed and is carried only for Claude Code.

The body SHALL be at most 30,000 characters, the smallest limit among the supported tools.

#### Scenario: Valid agent
- **WHEN** an agent has `name`, a `description`, and a non-empty body
- **THEN** validation passes

#### Scenario: Missing description
- **WHEN** the frontmatter has no `description`
- **THEN** validation fails and reports the missing field

#### Scenario: Empty prompt
- **WHEN** the body after the frontmatter is empty
- **THEN** validation fails and says the agent has no prompt

#### Scenario: Prompt too long
- **WHEN** the body is longer than 30,000 characters
- **THEN** validation fails and reports the length and the limit

#### Scenario: Unknown skill
- **WHEN** `skills` lists a name that is not a skill in the catalog
- **THEN** validation fails and names the missing skill

### Requirement: Names are unique across skills and agents
No agent name SHALL equal another agent's name or any skill's name anywhere in the repository, so an item can be addressed by its name alone.

#### Scenario: Agent and skill with the same name
- **WHEN** `plugins/a/skills/reviewer/` and `plugins/b/agents/reviewer.md` both exist
- **THEN** validation fails and names both paths

### Requirement: Agent template
The repository SHALL provide an agent template that passes validation once its placeholder name is replaced, so contributors can start from a known-good agent.

#### Scenario: Starting from the template
- **WHEN** a contributor copies the template to `plugins/<plugin>/agents/<agent>.md` and sets `name` to `<agent>`
- **THEN** the agent passes validation without further changes
