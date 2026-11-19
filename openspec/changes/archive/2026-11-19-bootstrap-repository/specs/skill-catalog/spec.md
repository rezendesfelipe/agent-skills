## Purpose

Defines where skills live in the repository and the minimum format every published skill must follow, so agents can load them and users can trust them.

## ADDED Requirements

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
