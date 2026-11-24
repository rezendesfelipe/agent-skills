## Status

Proposal only, written on 2026-11-24. Nothing is implemented. Gate 1 (the maintainer's approval) is pending; the questions that need an answer are listed in `design.md` ("Decisions for the maintainer").

## Why

A live session of the maintainer on 2026-11-24 proved two things about the `PreToolUse` guard of `stacks-auditor` (`plugins/azure-terraform-stacks/hooks/stacks-auditor-guard.mjs`, merged by pull request #21):

1. The hook runs, and `${CLAUDE_PLUGIN_ROOT}` is substituted in `hooks/hooks.json`.
2. The `agent_type` it receives for the subagent is **`azure-terraform-stacks:stacks-auditor`** (namespaced by the plugin), not `stacks-auditor`.

The guard decides whether a call is "its" agent with a strict comparison, `input.agent_type !== AGENT` (`stacks-auditor-guard.mjs:185`, where `AGENT = "stacks-auditor"` is on line 17), and returns `allow()` otherwise. So for the real agent the guard exits 0 on every call: it is **inert, and it fails open without any sign**. Layer 3 of the read-only design ("the plugin's `PreToolUse` hook ... allows that short list of commands for this agent and denies the rest", `SKILL.md` "Auditing an existing repository") does not exist in practice on Claude Code. Today the only effective protection is layer 1, the agent's prompt, plus the fact that `audit` writes nothing. The agent has `Bash` (`tools: Read, Grep, Glob, Bash`).

This was anticipated: maintainer decision I3 of 2026-11-24 in `fix-stacks-auditor-agent` kept the comparison strict "until task 6.1 confirms the real format, and if it differs, the comparison changes then". That moment has come. All 27 guard tests (`test/guard.test.mjs`) pass because they feed `agent_type: "stacks-auditor"`, the value nobody receives; no test uses a value captured from Claude Code.

The review of pull request #21 also left three NITs that the maintainer chose to fix together with this change.

## What Changes

- **Agent identity (the fix).** The guard applies to a call when `agent_type` is exactly `stacks-auditor` (the CLI-installed or hand-copied agent, no plugin) or exactly `azure-terraform-stacks:stacks-auditor` (the plugin). Two literals compared with `===`, no suffix, no regular expression, no wildcard prefix. The plugin name is one constant, and a test ties it to `plugin.json` and to the agent file (design, Decision 1).
- **Everything else stays untouched**: an `agent_type` that is absent, empty, another agent, or a look-alike (other prefix, other case, extra text) makes the guard exit 0 and print nothing, as today. The guard only restricts one agent, so denying "unknown" would block the main conversation and every other agent (design, Decision 2).
- **Tests, red first.** A fixture with the captured real hook input shape; a regression test that fails on `main` (it expects exit 2 for `terraform --version` with the real value, and the current code exits 0) and passes after the fix; the short value keeps its tests; a test that the accepted list equals `${plugin name}:${agent name}` taken from the files.
- **Three NITs of the review of pull request #21:**
  - (a) the differential test against the real `bash` gets a corpus of NBSP and other Unicode space characters, to prove the guard's tokenizer and the shell agree;
  - (b) one line of documentation on Windows and paths (backslashes and quotes are denied, forward slashes work, the differential test is skipped on Windows);
  - (c) the guard denies when `process.env.HOME` is set and differs from `os.homedir()`, because then the home directory the guard judges is not the one `~` expands to in the shell.
- **Evidence record for tasks 6.1 and 6.2 of `fix-stacks-auditor-agent`.** That change is still active (not archived), so this proposal does not edit it. The implementation records the live evidence in this change and then ticks the two tasks with a pointer, in the way "Evidence" in `design.md` describes. Honest scope: the capture proves the hook runs and the variable is substituted (6.2, first half) and gives the real `agent_type` (6.1, condition I3); it does not prove that the guard blocks the real agent, because the guard was inert. That half needs a short live re-test after the fix (task 5.1 of this change).
- **Interim guidance for users of plugin 0.2.0** (design, "Impact on 0.2.0 users"), documentation only.

## Capabilities

### New Capabilities
None.

### Modified Capabilities
- `stacks-auditor`: ADDED requirements for the guard's agent identity, its refusal of a divergent home directory, and its test obligations. The requirement "Command guard" itself is not modified here because it is not in `openspec/specs/` yet (it lives in the active change `fix-stacks-auditor-agent`); design, Decision 6 explains how the two changes combine and why a MODIFIED delta was not possible.

## Non-goals

- Implementing anything in this pull request: it only proposes. Implementation starts after the maintainer approves.
- A version bump, a tag, `npm publish` or a marketplace release. `plugin.json` (0.2.0) and `package.json` stay as they are. A release needs the maintainer's explicit OK (gate 2).
- Any other change to the guard's allowlist, the engine, the agent's prompt or `audit`.
- Making the guard a guarantee. It still fails open when Node cannot start it or when an administrator disables plugin hooks; this change only makes it work for the agent it was written for.
- Guards for other tools (Codex, Gemini CLI, Cursor, Copilot) or other plugins' agents.
- Editing `openspec/changes/fix-stacks-auditor-agent/`, or archiving it.
- A diagram. No diagram is added, so the design system of `CLAUDE.md` does not apply.

## Impact

- `plugins/azure-terraform-stacks/hooks/stacks-auditor-guard.mjs` (agent identity, home check), `plugins/azure-terraform-stacks/skills/azure-terraform-stacks/test/guard.test.mjs` plus one fixture with the real hook input, and one line in `references/traps.md`.
- `docs/aep/context-budgets.json`: **no change expected.** None of the files measured by `node scripts/context-budget.mjs` is edited (`SKILL.md`, `agents/stacks-auditor.md`, the other skills); the guard, the tests and `references/traps.md` are not counted. `SKILL.md` is deliberately not touched: its estimate with margin is about 4,514 tokens against a budget of 5,000 (measured on `main` on 2026-11-24, an approximation by bytes divided by 4). If the implementation has to touch a measured file, the command decides and the rule of the file's `note` applies.
- Users who installed plugin 0.2.0: exposed until a release; see design.
- No new runtime dependency.
