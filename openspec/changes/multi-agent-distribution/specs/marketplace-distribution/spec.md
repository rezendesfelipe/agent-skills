## MODIFIED Requirements

### Requirement: Manual installation
The README SHALL document how to install a skill for every agent supported by the `agent-skills` CLI: first with the CLI (`npx @frcloudsolutions/agent-skills add <skill> --agent <agent>`), then without it, by copying the skill folder into that agent's user or project skills folder. The README paths SHALL match the CLI's path map.

#### Scenario: Manual copy instructions
- **WHEN** a user reads the README
- **THEN** they find the commands to copy a single skill folder into a skills directory for each of Claude Code, OpenAI Codex, Gemini CLI, Cursor and GitHub Copilot

#### Scenario: CLI instructions
- **WHEN** a user reads the README install section
- **THEN** they find the `npx @frcloudsolutions/agent-skills` commands to list, add and remove skills, and the list of supported agent ids
