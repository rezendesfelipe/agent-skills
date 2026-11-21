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
The README SHALL document how to install a skill for every tool supported by the `agent-skills` CLI: first with the CLI (`npx @frcloudsolutions/agent-skills add <skill> --tool <tool>`), then without it, by copying the skill folder into that tool's user or project skills folder. The README paths SHALL match the CLI's path map.

#### Scenario: Manual copy instructions
- **WHEN** a user reads the README
- **THEN** they find the commands to copy a single skill folder into a skills directory for each of Claude Code, OpenAI Codex, Gemini CLI, Cursor and GitHub Copilot

#### Scenario: CLI instructions
- **WHEN** a user reads the README install section
- **THEN** they find the `npx @frcloudsolutions/agent-skills` commands to list, add and remove skills, and the list of supported tool ids

