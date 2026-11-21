## MODIFIED Requirements

### Requirement: Unique skill names
Every skill name SHALL be unique across all plugins in the repository, and SHALL not equal the name of any agent, so a skill or an agent can be addressed by its name alone.

#### Scenario: Same skill name in two plugins
- **WHEN** `plugins/a/skills/pdf-tools/` and `plugins/b/skills/pdf-tools/` both exist
- **THEN** validation fails and names both folders

#### Scenario: Skill and agent with the same name
- **WHEN** `plugins/a/skills/reviewer/` and `plugins/b/agents/reviewer.md` both exist
- **THEN** validation fails and names both paths
