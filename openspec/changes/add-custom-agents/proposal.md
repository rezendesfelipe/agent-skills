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
- **Permissions are never silently widened.** If an agent restricts its tools and a tool cannot express that restriction (Codex cannot restrict tools per agent; Cursor only has a read-only switch), the CLI refuses to install it for that tool and says why, unless the user passes `--allow-broader-access`. Because the repository already requires every agent to list `tools`, every agent is restricted, so Codex always needs that flag unless the agent lists the whole tool vocabulary. The flag is never implied by `--yes` and is recorded in the file's marker.
- **The source format stays the one the repository already validates.** `tools` remains required, and agent files may not use `hooks`, `mcpServers`, `permissionMode` or `initialPrompt`: Claude Code ignores them for plugin agents but honors them for user and project agents, so copying the file with the CLI would otherwise give an agent more power than the marketplace gives it.
- **Writes are safe.** The CLI re-validates names before building paths, refuses symbolic links and Windows reserved names, never overwrites a file it cannot prove it wrote (without `--force`, and then with a backup), and serializes every value into YAML or TOML through one escaping function.
- **An agent can depend on skills** (`skills:` in its frontmatter). Installing the agent also installs those skills for the same tool and scope.
- **`remove` only deletes agent files the CLI wrote and that were not edited since**, using a marker at the end of the file. The marker detects edits; it is not an authenticity check.
- Validation (which already checks `plugins/<plugin>/agents/*.md` since 0.5.0) is extended to the rules above; the README documents agents; the CLI package gets a new minor version, 0.6.0 (0.5.0 is the current release and its tag exists).
- **Agent authoring convention.** The template is read-only by default (`tools: Read, Grep, Glob`), and the design records the per-agent graph convention (nodes, edges, state, cycles, human interruptions, deterministic evidence check) that the AEP programme asks of every agent.

## Capabilities

### New Capabilities
- `agent-catalog`: where agents live in the repository, the source format they must follow, and the rules validation enforces.
- `agent-conversion`: how an agent is converted for each supported tool, which fields are carried, dropped or refused, and how skills dependencies are installed.

### Modified Capabilities
- `cli-installer`: the package bundles agents; `list`, `add`, `remove`, the tool path table, the interactive selection and the scriptable output cover agents as well as skills.
- `skill-catalog`: names must be unique across skills and agents, not only across skills; the existing "Plugin subagents" requirement no longer says that the CLI installs skills only, and gains the fields agents may not use.
- `marketplace-distribution`: the README documents agents, both through the CLI and by hand, and says which tools can enforce an agent's tool restrictions.

## Non-goals

- Publishing any particular agent. This change adds the mechanism; the first agents are separate changes.
- A neutral agent format with per-tool overrides. Authors write the Claude Code format; tool-specific tuning (a Gemini model id, a Codex reasoning effort) is not supported in this change.
- Translating Claude-only features (hooks, MCP servers, permission modes, memory, isolation, background mode) to other tools. They are dropped for other tools and reported.
- Organization-level or enterprise-level agents (for example a Copilot organization `.github-private` repository), remote or A2A agents, and agent teams.
- Antigravity CLI, which Gemini's documentation says replaced Gemini CLI for unpaid-tier and Google One users on 2026-06-18. It has its own documented subagent format (`.agents/agents/<name>.md`, `~/.gemini/config/agents/<name>.md`; see design). Gemini CLI stays supported as documented today; a new tool id is a separate change.
- Running or testing agents. The CLI installs files; it does not execute them.
- Detecting malicious or manipulative agent text. Validation rejects control and bidirectional characters, but whether an agent's prompt or description is trustworthy is a review and provenance question (npm provenance, pull request review), not something the CLI can decide.
- Following relocated configuration folders (`COPILOT_HOME`, and any equivalent for other tools). Paths stay `~`-relative as for skills; the README says so.
- Building the deterministic evidence verifier or the graph tooling of the AEP programme, and fixing the `stacks-auditor` agent. The design records both as follow-up changes; this change only records the convention and does not change `plugins/`.

## Impact

- New: `plugins/<plugin>/agents/` convention, `templates/agent/`, agent source loading and conversion modules under `src/lib/`, agent fixtures and tests under `test/`.
- Changed: `src/lib/tools.mjs` (agents folders and file formats per tool), `src/lib/catalog.mjs`, `src/lib/install.mjs`, `src/cli/main.mjs`, `src/lib/validate.mjs` (which already has `validateAgent`), `README.md`, `CONTRIBUTING.md`, the `files` whitelist and the explicit test file list in `package.json` (`npm test` names its files, so new test files must be added there or neither CI nor the publish workflow runs them), and a `.gitattributes` for fixtures and golden files (Windows runners check out CRLF).
- No new runtime dependencies (the Markdown and TOML outputs are written with small functions; YAML frontmatter uses the existing parser, extended for lists).
- Package version 0.6.0. The release workflow is not changed (see design, "Release pipeline").
