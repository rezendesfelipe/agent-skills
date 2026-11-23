## Status

Approved at gate 1 by the maintainer on 2026-11-23, with the decisions recorded in `design.md` ("Decisions", "Maintainer decisions, 2026-11-23"). Nothing is implemented yet. Two items remain conditional on live tests (tasks 6.1 and 6.2), with a stated plan B.

## Why

A review of pull request #16 found three defects in the `stacks-auditor` agent (`plugins/azure-terraform-stacks/agents/stacks-auditor.md`). All three were checked against the file and the current Claude Code subagent documentation (https://code.claude.com/docs/en/sub-agents, read 2026-11-23):

1. **The agent has no `Bash`, and its instructions need it. Confirmed.** The file lists `tools: Read, Grep, Glob, Bash` and fourteen `disallowedTools` entries such as `Bash(git push *)`. The documentation says that "an entry with a specifier, such as `Bash(git push *)`, still removes the whole tool", that `disallowedTools` is applied first, and that "a tool listed in both is removed". The effective tool set is therefore `Read, Grep, Glob`. Steps 2 to 4 of the prompt (`test -f`, `npm ci`, `node stacks.mjs audit`) cannot run. The `stacks-auditor` spec ("Auditor subagent") and `SKILL.md` assume the entries filter commands; they do not. The documented way to keep `Bash` and block commands is a `permissions.deny` rule in the user's settings.
2. **The engine is searched only under `.claude/...`. Confirmed.** The prompt tries `${CLAUDE_PLUGIN_ROOT}/...`, `<repo>/.claude/skills/...` and `~/.claude/skills/...`. The CLI of the merged `add-custom-agents` change installs skills for Codex, Gemini CLI, Cursor and Copilot into other folders (`.agents/skills`, `.gemini/skills`, `.cursor/skills`, `.github/skills`, `.copilot/skills`; see `src/lib/tools.mjs`), so after such an install no path in the prompt exists and the agent stops with "install the skill" although it is installed.
3. **`skills: [azure-terraform-stacks]` is missing. Confirmed** (the frontmatter has no `skills` key). The CLI uses that field to install the skill together with the agent; without it, installing the agent through the CLI leaves the engine absent. The documentation also says the full content of each listed skill is injected into the subagent's context at startup.

Two side findings: the existing `agent.test.mjs` pins the defect (it asserts that the fourteen entries are present), and `stacks-auditor`'s step 5 re-reads cited lines with a model, which is not the deterministic evidence check that `define-aep-delivery-graph` (pull request #14, in review) and `add-custom-agents` ask for.

This change is a **release prerequisite, not a merge prerequisite**, of the agents CLI: `add-custom-agents` can be merged and applied first, but the batch that publishes the CLI with agents (the next version after 0.5.0, set by the maintainer at release) SHALL NOT be released before this change is applied, because the first real conversion of the agent would carry the defect to five tools.

## What Changes

- **Frontmatter.** `tools: Read, Grep, Glob, Bash`, no `disallowedTools`, `skills: [azure-terraform-stacks]`. No specifier is used in any field that Claude Code treats as a whole-tool switch.
- **Read-only, honestly layered.** The agent keeps `Bash` (it must run the engine) and is held read-only by four layers, none of which is a hard guarantee (design, Decisions 1 and 2): the prompt's rules; the engine's `audit` command, which writes nothing by construction and by test; a plugin-level `PreToolUse` guard (`hooks/hooks.json` plus a small Node script) that, only for calls made by this subagent, allows a short list of command shapes and denies everything else (Claude Code only); and the user's own `permissions.deny` rules, documented with a copy-paste snippet, for those who need more.
- **Engine discovery without a harness assumption.** The prompt finds the engine by the skill's name: the plugin path when substituted, then the skills folders of all five supported tools (project and user), in one `ls -d` call. A test keeps that list equal to `src/lib/tools.mjs`.
- **Deterministic evidence check.** `audit` verifies each finding's `file:line` in code (path inside the root, line exists) and reports failures as "not verified" instead of counting them, which is the verifier node of the agent graph convention.
- **Preloading with a budget.** `skills: [azure-terraform-stacks]` is approved. Its cost (about 3,000 tokens for `SKILL.md` plus about 1,600 for the agent file) is a byte-based estimate, not a measurement; this change adds a task to measure it with the official token counting endpoint and a test that fails when the preloaded `SKILL.md` outgrows a declared budget, using an offline estimate labeled as an approximation. No runtime dependency is added.
- **Cursor now needs `--allow-broader-access`** for this agent, as Codex does (accepted).
- **Agent graph** for `stacks-auditor` in `design.md`, following the convention of `add-custom-agents` (already in `main`) and `define-aep-delivery-graph` (level 2), by reference.
- Spec: `MODIFIED` "Auditor subagent" and "Engine location"; `ADDED` "Command guard", "Evidence verified by code" and "Preloaded skill budget".
- **Plan B for the guard.** If the live tests of tasks 6.1 and 6.2 show that `agent_type` is not in the `PreToolUse` input or that `${CLAUDE_PLUGIN_ROOT}` does not work in `hooks/hooks.json`, the hook is not shipped and the plugin documents `permissions.deny` instead (design, Decision 2).

## Capabilities

### New Capabilities
None.

### Modified Capabilities
- `stacks-auditor`: the subagent's frontmatter and honesty about read-only; how the engine is located; a command guard; code-verified evidence.

## Non-goals

- Implementing anything in this pull request: it only proposes. Implementation starts after the maintainer approves.
- A version bump, a tag or publishing. `plugin.json` (0.2.0) and `package.json` stay as they are; the release is a separate batch behind the maintainer's gate.
- A guarantee that the auditor cannot change files. With `Bash` that is not achievable inside a plugin subagent; this change states the limits instead (design, Risks).
- Making the engine dependency-free (it needs the `yaml` package, hence the `npm ci` exception). Approved as a separate, later change, suggested name `vendor-stacks-engine-yaml` (design, Decision 6). `npm ci --omit=dev --ignore-scripts` stays as the declared exception here.
- Adding a tokenizer or any other runtime dependency. Token counts are measured with the official endpoint, outside the package, and guarded in tests by an offline approximation.
- Changing `add-custom-agents` (conversion rules, the refusal of Bash agents for Cursor and Codex) or `define-aep-delivery-graph`.
- A guard for other harnesses. Codex, Gemini CLI, Cursor and Copilot get the prompt's rules only; the README says so.
- Adding a new rule to `audit` or changing the findings it produces.

## Impact

- `plugins/azure-terraform-stacks/agents/stacks-auditor.md` (frontmatter, steps 2 and 3, report), new `plugins/azure-terraform-stacks/hooks/hooks.json` and `hooks/stacks-auditor-guard.mjs`.
- `plugins/azure-terraform-stacks/skills/azure-terraform-stacks/scripts/lib/audit.mjs` and `stacks.mjs` (evidence check, `--json` gains `unverified`), `test/agent.test.mjs`, `test/audit.test.mjs`, new guard tests, `SKILL.md` ("Auditing an existing repository"), `README.md` (catalog row; the CLI now installs agents).
- Behavior change for CLI users: with `Bash` in the effective tools, the agent is now refused for Cursor without `--allow-broader-access` (it used to convert to `readonly: true` because the specifiers removed `Bash`); accepted by the maintainer. Codex already needs the flag for any restricted agent. Gemini CLI and Copilot keep working, now with a shell tool (`run_shell_command` and `Bash`).
- `test/cli-agents.test.mjs` (root, in `main` since `add-custom-agents`), block "The published stacks-auditor agent through the CLI": its three tests record the current defect (a note that `Bash` was removed, read-only conversions with `Read, Grep, Glob`, no skill installed with the agent) and must be rewritten by the implementation (tasks 1.3 and 1.4).
- A new budget test for the preloaded `SKILL.md` (`Preloaded skill budget`).
- No new runtime dependency. No change to `.claude-plugin/marketplace.json` or versions.
