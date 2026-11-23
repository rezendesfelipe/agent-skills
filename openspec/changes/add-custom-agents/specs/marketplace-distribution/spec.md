## MODIFIED Requirements

### Requirement: Manual installation
The README SHALL document how to install a skill or an agent for every tool supported by the `agent-skills` CLI: first with the CLI (`npx @frcloudsolutions/agent-skills add <name> --tool <tool>`), then without it. A skill is installed by copying its folder into that tool's user or project skills folder. An agent is installed by copying its file into that tool's agents folder, which works as is for Claude Code and needs the CLI for the other tools because their formats differ. The README paths SHALL match the CLI's path maps, the README SHALL explain that the CLI refuses to widen an agent's permissions, say which tools can enforce an agent's tool restrictions and which cannot (Codex cannot), and say that the CLI does not follow relocated configuration folders such as `COPILOT_HOME`.

#### Scenario: Manual copy instructions
- **WHEN** a user reads the README
- **THEN** they find the commands to copy a single skill folder into a skills directory for each of Claude Code, OpenAI Codex, Gemini CLI, Cursor and GitHub Copilot, and the command to copy an agent file into Claude Code's agents folder

#### Scenario: CLI instructions
- **WHEN** a user reads the README install section
- **THEN** they find the `npx @frcloudsolutions/agent-skills` commands to list, add and remove skills and agents, the list of supported tool ids, and the agents folder of each tool

#### Scenario: Agent catalog
- **WHEN** a plugin ships agents
- **THEN** the README catalog lists them with their descriptions next to the plugin's skills

#### Scenario: Permissions table
- **WHEN** a user reads the README agents section
- **THEN** they find, per tool, whether the tool can enforce an agent's tool restrictions, and the `--allow-broader-access` flag that installs an agent where it cannot
