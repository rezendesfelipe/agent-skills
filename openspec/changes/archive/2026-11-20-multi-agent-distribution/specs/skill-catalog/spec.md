## ADDED Requirements

### Requirement: Unique skill names
Every skill name SHALL be unique across all plugins in the repository, so a skill can be addressed by its name alone.

#### Scenario: Same skill name in two plugins
- **WHEN** `plugins/a/skills/pdf-tools/` and `plugins/b/skills/pdf-tools/` both exist
- **THEN** validation fails and names both folders
