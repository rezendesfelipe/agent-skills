## MODIFIED Requirements

### Requirement: Unique skill names
Every skill name SHALL be unique across all plugins in the repository, and SHALL not equal the name of any agent, so a skill or an agent can be addressed by its name alone.

#### Scenario: Same skill name in two plugins
- **WHEN** `plugins/a/skills/pdf-tools/` and `plugins/b/skills/pdf-tools/` both exist
- **THEN** validation fails and names both folders

#### Scenario: Skill and agent with the same name
- **WHEN** `plugins/a/skills/reviewer/` and `plugins/b/agents/reviewer.md` both exist
- **THEN** validation fails and names both paths

### Requirement: Plugin subagents
A plugin MAY ship Claude Code subagents as Markdown files in `plugins/<plugin>/agents/<name>.md`; Claude Code scans that folder without a manifest entry. Every such file SHALL start with YAML frontmatter containing `name` (kebab-case, at most 64 characters, equal to the file name without extension), a non-empty `description` of at most 1024 characters, and a `tools` list. The repository is stricter than Claude Code here: Claude Code allows up to 256 characters in `name` and treats `tools` as optional, with an omitted list inheriting every tool. The `name` SHALL be unique across all agents in all plugins. Validation SHALL fail, naming the file, when any of these is missing or wrong. The frontmatter SHALL NOT contain `hooks`, `mcpServers`, `permissionMode` or `initialPrompt`, which Claude Code ignores for plugin subagents but honors for user and project subagents. The remaining rules for agent files (file location, size, characters, template and conversion) are defined by the `agent-catalog` and `agent-conversion` capabilities. Subagents are installed by the Claude Code plugin marketplace, by copying the file and, for every supported tool, by the `agent-skills` CLI.

#### Scenario: Valid subagent
- **WHEN** `plugins/azure-terraform-stacks/agents/stacks-auditor.md` has `name: stacks-auditor`, a description and a `tools` list
- **THEN** validation passes for that file

#### Scenario: Name does not match the file
- **WHEN** `agents/stacks-auditor.md` declares `name: auditor`
- **THEN** validation fails and reports the file and the mismatch

#### Scenario: Missing tools
- **WHEN** a subagent file has no `tools` list
- **THEN** validation fails, because an unrestricted subagent would inherit every tool of the session

#### Scenario: Duplicate name
- **WHEN** two plugins each ship an agent named `stacks-auditor`
- **THEN** validation fails and names both files

#### Scenario: Field ignored for plugin subagents
- **WHEN** a subagent file declares `hooks`, `mcpServers`, `permissionMode` or `initialPrompt`
- **THEN** validation fails and names the field
