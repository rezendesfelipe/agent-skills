# Contributing

Thanks for helping. This repository is built **spec-first** with [OpenSpec](https://github.com/Fission-AI/OpenSpec): every new skill or structural change begins as a change proposal, and code follows the spec.

## Prerequisites

- Node.js LTS
- OpenSpec CLI: `npm install -g @fission-ai/openspec`

After cloning, generate the OpenSpec commands for your agent (they are not committed):

```bash
openspec init --tools claude   # or cursor, codex, github-copilot, ... (see openspec init --help)
```

This keeps the existing `openspec/` folder and only adds the `/opsx:*` commands.

## Adding a skill

1. **Propose.** Create a change:
   - Claude Code: `/opsx:propose "add <skill> skill"`
   - CLI: `openspec new change add-<skill>-skill`, then write `proposal.md`, `specs/`, `design.md` (if needed) and `tasks.md`.

   Name the capability after the skill (for example `pdf-tools`) and describe its behavior with requirements and `#### Scenario:` blocks.
2. **Validate the proposal.** `openspec validate add-<skill>-skill --strict`
3. **Implement** (`/opsx:apply`):
   - Copy `templates/skill/` to `plugins/<plugin>/skills/<skill>/`.
   - Set `name` to the folder name and write a `description` that says what the skill does **and when to use it**.
   - If the plugin is new, add `plugins/<plugin>/.claude-plugin/plugin.json` and an entry in `.claude-plugin/marketplace.json`.
   - Add the skill to the catalog table in `README.md`.
4. **Check locally.**
   ```bash
   node scripts/validate-skills.mjs
   npm test
   openspec validate --all --strict
   ```
5. **Open a pull request.** CI runs the same checks.
6. **Archive.** After merge, the maintainer runs `/opsx:archive` (or `openspec archive <change>`) so the specs move into `openspec/specs/`.

## Adding an agent

An agent (a Claude Code subagent) is one Markdown file, `plugins/<plugin>/agents/<agent>.md`. Claude Code's marketplace loads it as is, and the `agent-skills` CLI converts it for Codex, Gemini CLI, Cursor and Copilot. It starts as an OpenSpec change like a skill does.

1. Copy `templates/agent/agent-name.md` to `plugins/<plugin>/agents/<agent>.md` and set `name` to the file name without `.md`. The template is **read-only**: `tools: Read, Grep, Glob`. Add `Edit`, `Write` or `Bash` only when a step of the agent needs it, and say which step and why in the change's `design.md`.
2. Write a `description` (one line, at most 1024 characters, no control characters) that says what the agent does, when to delegate to it and what it never does.
3. Write the prompt as the body. It must not be empty or longer than 30,000 characters.
4. Add the plugin's entry to `.claude-plugin/marketplace.json` if the plugin is new, and the agent to the catalog table in `README.md`.
5. Run `node scripts/validate-skills.mjs`, `npm test` and `openspec validate --all --strict`.

Rules `validate-skills` enforces:
- `name` is kebab-case, at most 64 characters, equal to the file name, not a Windows reserved device name (`con`, `prn`, `aux`, `nul`, `com1` to `com9`, `lpt1` to `lpt9`), and not used by any other agent or skill.
- `tools` is required: an agent without it inherits every tool of the session. A `disallowedTools` entry with a specifier such as `Bash(git push *)` removes the **whole** tool (that is how Claude Code works), so at least one tool must be left; to block only some commands keep `Bash` and use `permissions.deny` in settings instead.
- `hooks`, `mcpServers`, `permissionMode` and `initialPrompt` are **not allowed**. Claude Code ignores them for plugin agents but honors them in `~/.claude/agents` and `.claude/agents`, where the CLI installs the file, so the installed agent would be more powerful than the marketplace one.
- `skills` may only list skills in this repository (the CLI installs them with the agent).
- No bidirectional control characters (U+202A to U+202E, U+2066 to U+2069) anywhere in the file.
- Nested folders under `agents/` are not allowed, because tools treat nested Markdown files as separate agents.

What converts and what does not: `name`, `description`, `tools`/`disallowedTools` (where the tool can express them) and the prompt travel to every tool. `model` and every other Claude Code field (`color`, `maxTurns`, `memory`, ...) are written for Claude Code only, and the CLI reports them as dropped for the rest. An agent whose restriction a tool cannot express is refused for that tool unless the user passes `--allow-broader-access`; Codex cannot restrict tools at all.

Do not hard-code Claude Code paths such as `.claude/skills` or `${CLAUDE_PLUGIN_ROOT}` in the prompt. The agent may be installed for another tool, where the skill is in another folder: locate skills by name or through the tool's own skill mechanism.

### Agent checklist

- [ ] Read-only by default (`Read, Grep, Glob`); every added `Edit`, `Write` or `Bash` is justified in `design.md`
- [ ] The change's `design.md` has an "Agent graph" section (below)
- [ ] The prompt makes the agent report each finding with `file:line` evidence and list what it could not verify separately
- [ ] The prompt has a "Rules you never break" section
- [ ] No Claude-specific paths in the prompt; the skills it needs are listed in `skills`
- [ ] No secrets, personal data or machine-specific paths; content in English

### Agent graph

Design an agent as a graph, not as a prompt. The `design.md` of the change that introduces an agent (or a skill with agent behavior) carries an "Agent graph" section with:
- **Nodes**, each typed `fixed` (deterministic code or a command), `model` (one model call) or `agent` (a loop with tools), with what it reads, writes and which tools it holds.
- **Edges**, deterministic or conditional, with the condition written down.
- **State**: where it lives between nodes (a report file, the pull request, a returned JSON), never in hidden memory.
- **Cycles** and their bound (for example a retry limit), and what happens when the bound is hit.
- **Human interruptions**: every point where the agent stops and asks (for example before any write), and what it needs to resume.
- **A deterministic verifier node** after any node that produces findings. Findings carry evidence as `file:line` plus an optional excerpt; the verifier is code that checks the path resolves inside the audited root, the line exists and the excerpt occurs on that line. Findings that fail go to a "not verified" list and do not count.

The CLI installs files; it does not know whether an agent's graph is good, so the graph is reviewed with the change. The verifier is not implemented yet (a follow-up change).

## Skill checklist

- [ ] `name` is kebab-case, matches the folder, is at most 64 characters, and is not used by any other skill in any plugin (the CLI installs skills by name)
- [ ] `description` is at most 1024 characters, written in third person, and says when to use the skill
- [ ] Instructions are concrete steps, with examples
- [ ] Supporting files (scripts, references) live inside the skill folder and are referenced by relative path
- [ ] No secrets, personal data or machine-specific paths
- [ ] Content is in English

## Adding or fixing a tool in the CLI

The folders the `agent-skills` CLI installs into are defined in one place: `src/lib/tools.mjs`. To add a tool (Claude Code, Codex, ...) or fix a path:

1. Edit its entry (`user` and `project` folders, the `detect` folders that show the tool is installed, `alsoReads` for other tools' folders it also loads, and a `source` link to the vendor's docs).
   Each tool also has an `agents` entry: its agents `user` and `project` folders, the file extension `ext`, the `alsoReads` list of other tools' agents folders it loads (they feed the overlap warning), and a `source` link. A tool that needs a new agent format also needs a case in `src/lib/agents/convert.mjs` and in `src/lib/agents/permissions.mjs` (what it can restrict).
2. Update the tools table in `README.md` (`test/readme.test.mjs` compares it with `src/lib/tools.mjs`) and the path tests in `test/cli.test.mjs` and `test/convert.test.mjs`.
3. Because the supported paths are part of the `cli-installer` spec, open an OpenSpec change for it.

## Releasing the CLI

1. Bump `version` in `package.json` and commit.
2. Push a tag `v<version>`. The `publish` workflow validates, tests and publishes to npm with provenance.

## Commits

Use [Conventional Commits](https://www.conventionalcommits.org/): `feat(skill): add pdf-tools`, `docs: ...`, `ci: ...`.
