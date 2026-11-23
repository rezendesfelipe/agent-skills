## ADDED Requirements

### Requirement: Plugin subagents
A plugin MAY ship Claude Code subagents as Markdown files in `plugins/<plugin>/agents/<name>.md`; Claude Code scans that folder without a manifest entry. Every such file SHALL start with YAML frontmatter containing `name` (kebab-case, at most 64 characters, equal to the file name without extension), a non-empty `description` of at most 1024 characters, and a `tools` list. The repository is stricter than Claude Code here: Claude Code allows up to 256 characters in `name` and treats `tools` as optional, with an omitted list inheriting every tool. The `name` SHALL be unique across all agents in all plugins. Validation SHALL fail, naming the file, when any of these is missing or wrong. Subagents are installed by the Claude Code plugin marketplace and by copying the file; the `agent-skills` CLI installs skills only.

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
