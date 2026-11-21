## Why

The maintainer wants to publish custom agents (subagents) for other people to install, from this repository. Claude Code, OpenAI Codex, Gemini CLI, Cursor and GitHub Copilot all support them now, but each reads a different folder and a different file format (four use Markdown with YAML frontmatter, Codex uses TOML, and the fields and tool names differ). The repository already solves the folder problem for skills with the `agent-skills` CLI; agents need the same, plus a conversion step.

## What Changes

- **Agents live in the repository** at `plugins/<plugin>/agents/<agent>.md`, next to a plugin's skills. An agent is written once, in Claude Code's subagent format (YAML frontmatter with `name`, `description`, optional `tools`, `model`, `skills`, then the prompt as the Markdown body). That is the file Claude Code's plugin marketplace loads as it is, so one file serves the marketplace and the CLI.
- **The CLI converts and installs agents** for each supported tool:

  | Tool | File written | Format |
  |------|--------------|--------|
  | Claude Code | `<agents-dir>/<name>.md` | the source file, unchanged |
  | OpenAI Codex | `<agents-dir>/<name>.toml` | TOML with `name`, `description`, `developer_instructions` |
  | Gemini CLI | `<agents-dir>/<name>.md` | Markdown with the tool names Gemini uses |
  | Cursor | `<agents-dir>/<name>.md` | Markdown with `readonly` instead of a tool list |
  | GitHub Copilot | `<agents-dir>/<name>.agent.md` | Markdown with Copilot's `tools` |

- **`list`, `add` and `remove` handle skills and agents together.** The list shows a kind (skill or agent) for each entry and the interactive selection mixes both. Names are unique across skills and agents, so `agent-skills add <name>` stays unambiguous.
- **Permissions are never silently widened.** If an agent restricts its tools and a tool cannot express that restriction (Codex cannot restrict tools per agent; Cursor only has a read-only switch), the CLI refuses to install it for that tool and says why, unless the user passes `--allow-broader-access`.
- **An agent can depend on skills** (`skills:` in its frontmatter). Installing the agent also installs those skills for the same tool and scope.
- **`remove` only deletes agent files the CLI wrote and that were not edited since**, using a marker at the end of the file.
- Validation checks every agent file; the README documents agents; the CLI package gets a new minor version.

## Capabilities

### New Capabilities
- `agent-catalog`: where agents live in the repository, the source format they must follow, and the rules validation enforces.
- `agent-conversion`: how an agent is converted for each supported tool, which fields are carried, dropped or refused, and how skills dependencies are installed.

### Modified Capabilities
- `cli-installer`: `list`, `add`, `remove`, the tool path table and the interactive selection cover agents as well as skills.
- `skill-catalog`: names must be unique across skills and agents, not only across skills.
- `marketplace-distribution`: the README documents agents, both through the CLI and by hand.

## Non-goals

- Publishing any particular agent. This change adds the mechanism; the first agents are separate changes.
- A neutral agent format with per-tool overrides. Authors write the Claude Code format; tool-specific tuning (a Gemini model id, a Codex reasoning effort) is not supported in this change.
- Translating Claude-only features (hooks, MCP servers, permission modes, memory, isolation, background mode) to other tools. They are dropped for other tools and reported.
- Organization-level or enterprise-level agents (for example a Copilot organization `.github-private` repository), remote or A2A agents, and agent teams.
- Antigravity CLI, which Gemini's documentation says replaces Gemini CLI. Gemini CLI stays supported as documented today; a new tool id is a separate change.
- Running or testing agents. The CLI installs files; it does not execute them.

## Impact

- New: `plugins/<plugin>/agents/` convention, `templates/agent/`, agent source loading and conversion modules under `src/lib/`, agent fixtures and tests under `test/`.
- Changed: `src/lib/tools.mjs` (agents folders and file formats per tool), `src/lib/catalog.mjs`, `src/lib/install.mjs`, `src/cli/main.mjs`, `src/lib/validate.mjs`, `README.md`, `CONTRIBUTING.md`.
- No new runtime dependencies (the Markdown and TOML outputs are written with small functions; YAML frontmatter uses the existing parser, extended for lists).
- Package version 0.4.0.
