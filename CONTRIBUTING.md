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

## How a change travels: the delivery graph

Every change follows the **delivery graph** in [`docs/aep/delivery-graph.md`](docs/aep/delivery-graph.md): `propose`, `validate`, **human gate 1**, `apply`, tests, independent review, pull request and CI, merge, archive, release queue, **human gate 2**. The page also has the roles and what each may write, the state of a change (`tasks.md` and pull request labels), the cycle limit (3, then the maintainer) and the parallel-change rules. Two gates matter to contributors:

1. **Gate 1, before implementation.** The maintainer approves the proposal on its pull request. Until then, a proposal changes only `openspec/changes/<name>/` (`node scripts/delivery-check.mjs scope <name>` checks it).
2. **Gate 2, before a release.** Merging to `main` publishes a skill or agent in the marketplace. The version bump, the `v*` tag and the npm publish happen only after the maintainer's explicit OK that names the version.

Rules for every change: work on a branch `claude/<change-name>`, open the pull request as a **draft**, never push to `main`, and use Conventional Commits. A feature or fix change never edits the `version` in `package.json`.

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
   - Write the example prompts (see [Example prompts](#example-prompts)): copy `templates/prompts/prompts.md` to `references/prompts.md`, link it once from `SKILL.md`, and add the starter prompt to the README section "Example prompts".
4. **Check locally.**
   ```bash
   node scripts/validate-skills.mjs
   npm test
   openspec validate --all --strict
   ```
   The `azure-terraform-stacks` engine needs no install: `cd plugins/azure-terraform-stacks/skills/azure-terraform-stacks && node --test test/*.test.mjs` runs without `node_modules/`. Its parity tests compare the vendored `yaml` with the npm package and are skipped (with a message) until you run `npm ci` there; `REQUIRE_YAML_ORACLE=1` turns that skip into a failure, as CI does.
   `node scripts/delivery-check.mjs tasks <change>` names the first task of `tasks.md` still unticked, and `node scripts/context-budget.mjs` checks the context budget (an estimate, labeled as one; see `docs/aep/context-budget.md`).
5. **Open a draft pull request.** CI runs the same checks. It leaves draft after the checks pass; an independent, read-only review follows.
6. **Archive.** The integrator (see the roles in `docs/aep/roles.md`) merges only on an approved review verdict and green CI, then runs `openspec archive <change>` so the specs move into `openspec/specs/`. The maintainer can still archive by hand.

## Updating the vendored yaml

The engine of `azure-terraform-stacks` carries `yaml` in `plugins/azure-terraform-stacks/skills/azure-terraform-stacks/scripts/vendor/yaml/` (see `references/traps.md` there). Never edit those files by hand; CI fails on one changed byte.

1. In the skill folder run `node scripts/vendor-yaml.mjs update <x.y.z>`. It downloads the tarball with `npm pack`, checks its integrity against the registry, keeps only `dist/**/*.js`, `package.json` and `LICENSE`, writes `PROVENANCE.json`, moves the `devDependencies` pin and the lockfile, and prints what was added, changed and removed.
2. Read the diff of `scripts/vendor/yaml/` and the release notes of `yaml`. Run `npm ci` and then `REQUIRE_YAML_ORACLE=1 node --test test/*.test.mjs`. A change of behavior shows up as a diff of `test/yaml-corpus/golden.json` (regenerate it with `node test/yaml-corpus/update.mjs` and read the diff; do not accept a change you cannot explain).
3. Run `node scripts/vendor-yaml.mjs verify --registry`.
4. Commit the vendor folder, `package.json`, `package-lock.json` and the golden file together, and add a CHANGELOG entry. A version bump of the plugin is a separate decision (gate 2).

## Adding an agent

An agent (a Claude Code subagent) is one Markdown file, `plugins/<plugin>/agents/<agent>.md`. Claude Code's marketplace loads it as is, and the `agent-skills` CLI converts it for Codex, Gemini CLI, Cursor and Copilot. It starts as an OpenSpec change like a skill does.

1. Copy `templates/agent/agent-name.md` to `plugins/<plugin>/agents/<agent>.md` and set `name` to the file name without `.md`. The template is **read-only**: `tools: Read, Grep, Glob`. Add `Edit`, `Write` or `Bash` only when a step of the agent needs it, and say which step and why in the change's `design.md`.
2. Write a `description` (one line, at most 1024 characters, no control characters) that says what the agent does, when to delegate to it and what it never does.
3. Write the prompt as the body. It must not be empty or longer than 30,000 characters.
4. Add the plugin's entry to `.claude-plugin/marketplace.json` if the plugin is new, and the agent to the catalog table in `README.md`.
5. Write the example prompts (see [Example prompts](#example-prompts)). The agent file is its system prompt, so it holds no examples and does not mention them: they go in the skill the agent lists in `skills`, or, if it lists none, in the README.
6. Run `node scripts/validate-skills.mjs`, `npm test` and `openspec validate --all --strict`.

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
- [ ] The change's `design.md` has an "Agent graph" section (below; the convention is the level 2 graph of the delivery graph page)
- [ ] The prompt makes the agent report each finding with `file:line` evidence and list what it could not verify separately
- [ ] The prompt has a "Rules you never break" section
- [ ] No Claude-specific paths in the prompt; the skills it needs are listed in `skills`
- [ ] No secrets, personal data or machine-specific paths; content in English
- [ ] Example prompts exist (prompt, what it produces, how to get good results) in the skill the agent lists in `skills`, or in the README if it lists none; the agent file itself holds none

### Agent graph

Design an agent as a graph, not as a prompt. The `design.md` of the change that introduces an agent (or a skill with agent behavior) carries an "Agent graph" section with:
- **Nodes**, each typed `fixed` (deterministic code or a command), `model` (one model call) or `agent` (a loop with tools), with what it reads, writes and which tools it holds.
- **Edges**, deterministic or conditional, with the condition written down.
- **State**: where it lives between nodes (a report file, the pull request, a returned JSON), never in hidden memory.
- **Cycles** and their bound (for example a retry limit), and what happens when the bound is hit.
- **Human interruptions**: every point where the agent stops and asks (for example before any write), and what it needs to resume.
- **A deterministic verifier node** after any node that produces findings. Findings carry evidence as `file:line` plus an optional excerpt; the verifier is code that checks the path resolves inside the audited root, the line exists and the excerpt occurs on that line. Findings that fail go to a "not verified" list and do not count.

The convention is the "level 2" graph in [`docs/aep/delivery-graph.md`](docs/aep/delivery-graph.md#level-2-the-graph-of-each-agent-or-skill). `node scripts/delivery-check.mjs evidence <file>` checks the `file:line` references of a report. The CLI installs files; it does not know whether an agent's graph is good, so the graph is reviewed with the change. A verifier inside each agent is not implemented yet (a follow-up change).

## Skill checklist

- [ ] `name` is kebab-case, matches the folder, is at most 64 characters, and is not used by any other skill in any plugin (the CLI installs skills by name)
- [ ] `description` is at most 1024 characters, written in third person, and says when to use the skill
- [ ] Instructions are concrete steps, with examples
- [ ] Supporting files (scripts, references) live inside the skill folder and are referenced by relative path
- [ ] No secrets, personal data or machine-specific paths
- [ ] Content is in English, except the pt-BR twin of each example prompt (see [Example prompts](#example-prompts))
- [ ] `references/prompts.md` exists with example prompts (prompt, what it produces, how to get good results), linked once from `SKILL.md`, with a README starter prompt; `npm test` passes `test/prompt-examples.test.mjs`
- [ ] If the skill has agent behavior, the change's `design.md` has the graph section (node types, edges, state, cycles, human interruptions, and a verifier node when it produces findings; see [Agent graph](#agent-graph))
- [ ] The loaded-context cost is within its declared budget (`node scripts/context-budget.mjs`; add the skill to `docs/aep/context-budgets.json`)

## Example prompts

Every skill and every agent ships example prompts: the prompt, what it produces, and how to get a good result. A new skill or agent without them fails `npm test` (`test/prompt-examples.test.mjs` finds the catalog by looking at `plugins/*/skills/*` and `plugins/*/agents/*`; there is no list to update).

- **Where.** A skill: `references/prompts.md` in its folder, linked once from `SKILL.md` (progressive disclosure: the file costs no context until it is read; do not list it under `loadedWith` in `docs/aep/context-budgets.json`). An agent that lists `skills`: a section `## Agent: <name>` in the `prompts.md` of one of those skills (the CLI installs the skill with the agent). An agent that lists none: `### <name>` in the README section "Example prompts", with the full examples. The agent file itself is the system prompt: it holds no examples and does not point to them. Every skill and agent also has a starter prompt in the README, equal to the first example of its file.
- **Start from** `templates/prompts/prompts.md`. Each example has an id, an English prompt and a pt-BR twin with the same id, "What you get", an output excerpt with its label, and 2 to 4 tips in both languages. A "What not to ask" section holds at least one prompt the tool declines, with the reason and the alternative.
- **Language.** English is canonical; the pt-BR twin is written in the same pull request. Names of skills, agents, files, commands and flags stay in English in both. This is the only exception to "content in English".
- **Honesty about outputs.** Where the output is deterministic (an engine command), run the real command on fictitious data and paste an excerpt of at most 30 lines with the label `Real output (command: ...)`. Where it depends on a model, use the label `Illustrative excerpt, not a captured run:`. Never invent a metric, and never promise a result: the file says "starting examples" and what was and was not run.
- **Safe by construction.** No credential or literal in the shape of one (the test uses the scanner of `assessment-report`), no GUID except all zeros, no personal or temporary path, a "Where not to paste" paragraph in both languages, fictitious names such as "Cliente Exemplo S.A.". Examples for a read-only agent never ask it to change anything.
- **Budget.** Examples do not go in `SKILL.md`, an agent file or a `description`; one pointer line in `SKILL.md` is enough. Do not raise a context budget to fit examples. If a skill has tests on `references/` (for example `assessment-report`'s), the file must pass them.
- **Keep them current.** A change to a skill's behavior updates its `prompts.md` in the same pull request.

## Adding or fixing a tool in the CLI

The folders the `agent-skills` CLI installs into are defined in one place: `src/lib/tools.mjs`. To add a tool (Claude Code, Codex, ...) or fix a path:

1. Edit its entry (`user` and `project` folders, the `detect` folders that show the tool is installed, `alsoReads` for other tools' folders it also loads, and a `source` link to the vendor's docs).
   Each tool also has an `agents` entry: its agents `user` and `project` folders, the file extension `ext`, the `alsoReads` list of other tools' agents folders it loads (they feed the overlap warning), and a `source` link. A tool that needs a new agent format also needs a case in `src/lib/agents/convert.mjs` and in `src/lib/agents/permissions.mjs` (what it can restrict).
2. Update the tools table in `README.md` (`test/readme.test.mjs` compares it with `src/lib/tools.mjs`) and the path tests in `test/cli.test.mjs` and `test/convert.test.mjs`.
3. Because the supported paths are part of the `cli-installer` spec, open an OpenSpec change for it.

## Releasing the CLI

A release is a batch behind human gate 2. It needs the maintainer's **explicit OK that names the version**; no agent bumps the version, creates a tag or publishes without it.

1. Bump `version` in `package.json` and commit (in a release change, never in a feature or fix change).
2. Push a tag `v<version>`. The `publish` workflow validates, tests and publishes to npm with provenance.

The recommended protection of `main` and of the tags is a checklist for the maintainer in `docs/aep/repository-protection.md`.

## Commits

Use [Conventional Commits](https://www.conventionalcommits.org/): `feat(skill): add pdf-tools`, `docs: ...`, `ci: ...`.
