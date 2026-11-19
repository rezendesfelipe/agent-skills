# marketplace-distribution Specification

## Purpose
Lets end users discover and install the repository's skills directly from Claude Code through a plugin marketplace, or by copying a skill folder by hand.
## Requirements
### Requirement: Marketplace manifest
The repository SHALL provide a plugin marketplace manifest at `.claude-plugin/marketplace.json` that lists every plugin in `plugins/` with its `name` and relative `source` path.

#### Scenario: Adding the marketplace
- **WHEN** a user runs `/plugin marketplace add rezendesfelipe/agent-skills` in Claude Code
- **THEN** the marketplace is registered and its plugins are listed for installation

#### Scenario: Plugin missing from manifest
- **WHEN** a folder exists under `plugins/` but is not listed in the manifest
- **THEN** validation fails and names the unlisted plugin

#### Scenario: Manifest entry without folder
- **WHEN** the manifest lists a plugin whose `source` folder does not exist
- **THEN** validation fails and names the broken entry

### Requirement: Manual installation
The README SHALL document how to use a skill without the marketplace, by copying its folder into `~/.claude/skills/` or a project's `.claude/skills/`.

#### Scenario: Manual copy instructions
- **WHEN** a user reads the README
- **THEN** they find the commands to copy a single skill folder into a skills directory

