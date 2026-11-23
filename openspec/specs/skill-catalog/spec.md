# skill-catalog Specification

## Purpose
Defines where skills live in the repository and the minimum format every published skill must follow, so agents can load them and users can trust them.
## Requirements
### Requirement: Skill location
Every skill SHALL live in its own folder at `plugins/<plugin>/skills/<skill>/` and SHALL contain a `SKILL.md` file at the root of that folder.

#### Scenario: Skill folder with SKILL.md
- **WHEN** a folder exists under `plugins/<plugin>/skills/`
- **THEN** it MUST contain a `SKILL.md` file, otherwise validation fails

### Requirement: Skill frontmatter
Every `SKILL.md` SHALL start with YAML frontmatter containing a `name` and a `description`. The `name` MUST be kebab-case, at most 64 characters, and equal to the skill folder name. The `description` MUST be non-empty and at most 1024 characters.

#### Scenario: Valid frontmatter
- **WHEN** a `SKILL.md` has `name: pdf-tools` inside folder `pdf-tools/` and a non-empty description
- **THEN** validation passes for that skill

#### Scenario: Name does not match folder
- **WHEN** a `SKILL.md` in folder `pdf-tools/` declares `name: pdf`
- **THEN** validation fails and reports the file and the mismatch

#### Scenario: Missing description
- **WHEN** a `SKILL.md` frontmatter has no `description`
- **THEN** validation fails and reports the missing field

### Requirement: Skill template
The repository SHALL provide a skill template that passes validation once its placeholder name is replaced, so contributors can start from a known-good skill.

#### Scenario: Starting from the template
- **WHEN** a contributor copies the template into `plugins/<plugin>/skills/<skill>/` and sets `name` to `<skill>`
- **THEN** the skill passes validation without further changes

### Requirement: Unique skill names
Every skill name SHALL be unique across all plugins in the repository, so a skill can be addressed by its name alone.

#### Scenario: Same skill name in two plugins
- **WHEN** `plugins/a/skills/pdf-tools/` and `plugins/b/skills/pdf-tools/` both exist
- **THEN** validation fails and names both folders

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

