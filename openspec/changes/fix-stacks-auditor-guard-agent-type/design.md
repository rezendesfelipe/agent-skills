## Context

Pull request #21 (merged, `fix-stacks-auditor-agent`) added a `PreToolUse` hook that restricts one subagent. The hook is registered by the plugin for every `Bash` call of every agent and exits 0 at once unless `agent_type` is the auditor's. The live session of 2026-11-24 showed that for a plugin subagent Claude Code sends `agent_type: "azure-terraform-stacks:stacks-auditor"`. The guard compares with `=== "stacks-auditor"` (`plugins/azure-terraform-stacks/hooks/stacks-auditor-guard.mjs:185`), so it never restricts the real agent. This is the failure mode the guard's own header calls "fail open", reached through a wrong assumption instead of a missing Node.

Facts used below, with their source:

| Fact | Source |
|------|--------|
| The real value for the plugin's agent is `azure-terraform-stacks:stacks-auditor` | the maintainer's live capture, 2026-11-24 (to be recorded in `evidence/live-2026-11-24.md`, task 4.1) |
| The plugin name is `azure-terraform-stacks` and the agent's file name and `name` are `stacks-auditor` | `plugins/azure-terraform-stacks/.claude-plugin/plugin.json`, `agents/stacks-auditor.md` |
| The agent installed by `agent-skills add stacks-auditor` or copied by hand is not part of a plugin | `add-custom-agents`; the converted file has the agent's own `name` |
| The shape `agent_type` has for an agent that is not namespaced (short value) was never captured | not verified; it is accepted because the file's `name` is that value and the design must not depend on a capture that does not exist |
| `os.homedir()` on POSIX reads `HOME` when it is set and non-empty, otherwise the password database | Node.js documentation of `os.homedir()` (from memory; task 3.3 includes a test that fixes the behavior on the machine that runs it) |

## Decisions for the maintainer

These need an answer at gate 1. Each has a recommendation and a fallback.

| # | Question | Recommendation |
|---|----------|----------------|
| Q1 | Accept exactly the two literals (Decision 1)? | **Yes.** Fallback: also accept any `<x>:stacks-auditor` (Decision 1, option B), if you prefer that a hostile or renamed namespace is restricted rather than ignored |
| Q2 | Keep "unknown, absent or empty `agent_type` means allow" (Decision 2)? | **Yes.** Fallback if you want a signal: a stderr notice for near misses, which changes the "prints nothing" scenario (Decision 2, option C) |
| Q3 | Deny every command of the auditor when `HOME` differs from `os.homedir()` (Decision 3)? | **Yes, deny all.** Fallback: deny only commands whose paths involve the home directory |
| Q4 | Record the evidence in this change and tick 6.1 and 6.2 of `fix-stacks-auditor-agent` after the re-test, not before (Decision 5)? | **Yes** |
| Q5 | Which parts of 6.1 and 6.2 did the live session also observe (the agent's effective tools include `Bash`; the preloaded skill is in the subagent's context; any denial on screen)? | Needed to word the evidence file; the capture described to us covers only the hook running, the variable and the `agent_type` |
| Q6 | Which Claude Code version and how was the plugin installed (marketplace or `--plugin-dir`)? Does the namespaced value also appear with `--plugin-dir`? | Needed for the evidence file; if `--plugin-dir` gives another value, Decision 1 is revisited |

## Answers at gate 1 (2026-11-24)

Q1 to Q4: as recommended. Q5: not informed (the effective tools, the preloaded skill and any denial on screen were not reported). Q6: the plugin was installed through the marketplace; the Claude Code version and whether `--plugin-dir` gives the same value were not informed. Recorded in `evidence/live-2026-11-24.md`.

## Decisions

### Decision 1. The match rule for `agent_type`

The guard is a restriction. Matching too little leaves the agent unrestricted (the defect being fixed); matching too much restricts an agent that was not meant to be restricted. Options:

| Option | Rule | For | Against |
|--------|------|-----|---------|
| A (recommended) | `agent_type` equals `stacks-auditor` or equals `azure-terraform-stacks:stacks-auditor` (two literals, `===`) | Deterministic, no parsing, one line to read. Covers the plugin install (the captured value) and the CLI or hand install (the file's own name). The plugin name is the only prefix this plugin can ever have, and a test ties it to `plugin.json`. A homonymous agent of another plugin is not touched | An unexpected form (another plugin name after a rename, a marketplace-qualified form, a value that has a different shape under `--plugin-dir`) is not matched, so the guard fails open for it. The test of the constants catches a rename inside this repository, not a change made by Claude Code |
| B | `agent_type === "stacks-auditor"` or ends with `:stacks-auditor` (any prefix) | Also restricts forms nobody has seen yet | A homonymous agent from **another plugin** (or a user's own namespaced agent) that happens to be called `stacks-auditor` is restricted too: its `Bash` calls (any command outside six shapes) are denied while this plugin is installed. That breaks code that is not ours, and the denial text tells the model to "stop", which it would obey. It can never grant anything, so it is not a privilege bypass; it is collateral damage, in the user's session, caused by a plugin they installed for something else |
| C | A pattern such as `^[a-z0-9-]+:stacks-auditor$` | Same as B, one more constraint | Same collateral damage; still a parser to maintain; no real gain over B |
| D | Match only the file's `name` and resolve the owning plugin from a hook field | Exact | No such field is documented or captured; not relied on |

**Recommendation: A.** The guard should restrict what it was written to restrict, by a rule that a reader can verify by looking. B's only advantage is for values that nobody has observed, and it buys that with a way to break a third party's agent; A's weakness (a future unknown form) is made visible instead: the live re-test (task 5.1 (d)) re-checks the value on each Claude Code version the maintainer uses, and the constants test fails when the repository renames the plugin or the agent. Residual risk, stated: a Claude Code change in the format makes the guard inert again, silently. That is the same class of failure as before, and the only remedy that is not a guess is the re-test, plus option C of Decision 2 if the maintainer wants a signal.

Exact equality also means that a padded value (` azure-terraform-stacks:stacks-auditor`) or a different case is not matched. Claude Code sends the name as written in the agent's file and the plugin's manifest, so a padded value is not expected; the tests list these as untouched cases so the behavior is a decision, not an accident.

### Decision 2. `agent_type` absent, empty or another value

Options:

| Option | Behavior | For | Against |
|--------|----------|-----|---------|
| A (recommended) | Allow (exit 0, print nothing), as today | The guard exists to restrict one subagent, and the hook runs on **every** `Bash` call of the main conversation and of every other agent. The main conversation has no `agent_type`; denying "no value" would block the user's own shell | An agent that Claude Code starts without sending its type is unrestricted: the same fail-open as the defect, and it cannot be told apart from the main conversation |
| B | Deny when absent, empty or not matched | Fail-closed | The main conversation and every other agent lose `Bash` while the plugin is installed. Unacceptable for a plugin that is installed by people who use other things; not offered as a choice |
| C | A with a non-blocking notice: when the value contains `stacks-auditor` (any case) but is not matched, exit 0 and write one line to stderr saying that the guard did not apply to this `agent_type` | Makes a future format change visible when Claude Code shows hook stderr (it may only do so in verbose mode; not verified) | It breaks the "prints nothing" scenario for look-alikes, such as `Stacks-Auditor` and `stacks-auditor-2` that tests use today; a notice nobody sees is not a signal |

**Recommendation: A.** Detecting drift is the job of the live re-test, not of a hook that cannot distinguish the main conversation from an unnamed subagent. C is recorded as the way to add a signal if the maintainer wants one; it is not in the specs.

### Decision 3. A home directory that differs between the guard and the shell

The guard trusts paths in the user's skills folders (`~/.claude/skills`, ...). It computes them from `os.homedir()`, and it judges words that begin with `~/` against the same directory. The shell expands `~` from `$HOME`. They agree on POSIX when `HOME` is set and not empty, because Node reads `HOME` first. They disagree when `HOME` is empty (the shell expands `~/x` to `/x`; Node falls back to the password database), and on Windows, where Node uses `USERPROFILE` and Git Bash sets `HOME` to its own form. When they disagree, the guard would approve a path that the shell resolves elsewhere: the class of bug of review cycle 2 (B1) again.

Rule: for a call of the auditor, when `process.env.HOME` is defined (even empty) and `resolve(HOME)` is not equal to `resolve(homedir())` (compared case-insensitively on Windows), deny. When `HOME` is undefined, do nothing: both sides then use the password database or `USERPROFILE`, which agree.

| Scope of the denial | For | Against |
|---------------------|-----|---------|
| All commands of the auditor (recommended) | One check at the entry; no reasoning about which commands "involve" home; easy to test | The auditor cannot run even `node --version` in such a session; it must say why. Rare: needs an unusual `HOME`, or Git Bash on Windows, where the guard is not verified anyway |
| Only commands with `~/` or a path under a user skills folder | Less collateral | A second parser to decide "involves home"; the trusted-folder check uses the home even for absolute paths, so most useful commands are in scope anyway |

Review cycle 1 notes: on POSIX Node reads `HOME` first, so the "differs from `os.homedir()`" branch is almost unreachable there (the check mainly catches an empty or relative `HOME`; the branch stays for Windows). The guard also computes `homedir()` only after recognizing the agent and inside the `try`, because it throws when `HOME` is undefined and the uid has no passwd entry: the auditor is then denied, anyone else is untouched.

The denial reason says: "HOME (`<value>`) differs from the user's home directory (`<value>`); the guard cannot tell where `~` points. Set HOME to the user's home directory and start the session again." The home value is a path, not a secret, but the reason prints at most the two paths' last segment to avoid putting a user name in a log that is pasted on a pull request. Decision on that detail left to the implementer; the test checks only that the reason names `HOME`.

### Decision 4. The three NITs

- **(a) NBSP and Unicode spaces.** The guard tokenizes on space and tab only (`/[ \t]+/`); a NBSP or an ideographic space stays inside a word and so inside a path. `bash` does not treat them as separators either (they are not in the default `IFS`; bash with a UTF-8 locale does not split on them). The two should agree, but "should" is what the differential test exists to prove. The new corpus puts these characters between arguments, inside paths and next to flags. Expected: the guard approves a command only if the real shell's argv equals what the guard resolved; a command such as `ls -d a<NBSP>b` is one word for both. The Unicode line and paragraph separators (U+2028, U+2029) and U+0085 are not control characters below U+0020, so the `FORBIDDEN` class does not deny them; the test documents what each does in `bash -c`. If the test finds a disagreement, the fix is to deny the character wholesale (add it to `FORBIDDEN`), not to model it. Not covered: other shells (zsh, dash, PowerShell), as in the review of #21; the Bash tool runs the user's bash.
- **(b) Windows and paths.** One sentence in `references/traps.md`, not in `SKILL.md` (budget, see "Context budget"). It says what is already true: backslashes and quotes are denied, so use forward slashes; the differential test needs `bash` and is skipped on Windows; the guard is not verified on Windows.
- **(c) Home divergence.** Decision 3.

### Decision 5. Evidence for tasks 6.1 and 6.2 of `fix-stacks-auditor-agent`

Those tasks are in `openspec/changes/fix-stacks-auditor-agent/tasks.md`, lines 36 and 37 (group 6, "Verification and release hand-off"). The change is **active, not archived** (it is under `openspec/changes/`, not `openspec/changes/archive/`), and `delivery-check scope` allows a proposal to touch only its own folder, so this proposal does not edit it. What the capture proves, task by task:

| Task and item | Proven by the capture | Not proven |
|---------------|-----------------------|------------|
| 6.2, hook command with `${CLAUDE_PLUGIN_ROOT}` | The hook ran, so the variable was substituted in `hooks/hooks.json` | That a deliberate `terraform --version` by the subagent is denied with the guard's reason: the guard was inert for the real agent |
| 6.1 (b), variable substituted in the agent body | Stated by the maintainer as proven live | (to be confirmed in the evidence file, question Q5) |
| 6.1 (c), `agent_type` received | The real value, and that it is **not** `stacks-auditor`: (c) as written fails, and condition I3 says the comparison must change then | That the guard blocks and allows correctly for the real value: needs the re-test after the fix |
| 6.1 (a), effective tools include `Bash`; (d), preloaded skill in context | Not stated | Question Q5 |

So 6.1 and 6.2 cannot be ticked as written from today's capture. The way to register it, in two steps:

1. The implementation commits `evidence/live-2026-11-24.md` in this change (task 4.1), with what was observed and what was not.
2. After the re-test (task 5.1) shows the denial and the allowed audit with the namespaced value, the implementation pull request ticks 6.1 and 6.2 in `fix-stacks-auditor-agent/tasks.md` with a one-line note each that links the evidence and says what it proves (task 4.2). If that change is archived by then, the archive is not edited and the pointer lives in the evidence file.

An alternative was to tick the two tasks now with a note. Rejected: it would say "proven" for a guard that was shown not to work, which is the mistake this change corrects.

### Decision 6. How the delta relates to `fix-stacks-auditor-agent`

The requirement "Command guard" is defined by the active change `fix-stacks-auditor-agent` and is not in `openspec/specs/stacks-auditor/spec.md` yet. A `MODIFIED` delta cannot target a requirement that the base specs do not have (the same situation as `harden-assessment-secret-scan`, Decision 1). This change therefore ADDS three requirements with new names, which add to "Command guard" without contradicting it. One sentence of that requirement and one scenario ("Other agents are untouched": `agent_type` "absent or is not `stacks-auditor`") become imprecise: "not `stacks-auditor`" now means "not one of the two accepted values". When `fix-stacks-auditor-agent` is archived, its text is synced first and this change then archives cleanly; the maintainer can instead ask that the sentence be edited in `fix-stacks-auditor-agent` before it is archived, which this proposal does not do.

## Agent graph

This change adds no agent and no model node. It changes one deterministic node of the existing graph of `stacks-auditor` (`fix-stacks-auditor-agent`, "Agent graph"): the hook that decides whether a call is the auditor's.

| Node | Type | Reads | Writes | Tools |
|------|------|-------|--------|-------|
| `guard` (hook) | fixed (code) | the hook input (`agent_type`, `tool_name`, `tool_input.command`, `cwd`), `HOME`, `os.homedir()` | exit code and stderr only | none (no network, no process) |

Edges, state, cycles and human interruptions are unchanged. The verifier of this node is its test suite: the regression test with the real value, the table of unmatched values, the differential tests against the real shell and the constants test.

## Risks and residual limits

- [The guard can still be inert] A future change in the `agent_type` format makes it inert again, silently (Decision 1). Mitigation: re-test on each Claude Code version before a release (task 5.1 (d)); the constants test for repository-side renames.
- [Collateral on other agents] None with option A. With option B, a homonymous agent of another plugin would be denied; this is why B is not recommended.
- [Home divergence denies everything] A session with an empty `HOME` (or Git Bash on Windows) cannot use the auditor on Claude Code; it says why. Documented in `references/traps.md`.
- [Test value is a copy, not a capture] The fixture is built from what the maintainer saw; Claude Code may add fields. The guard reads only `agent_type`, `tool_name`, `tool_input.command` and `cwd`.
- [Unverified] The behavior of `os.homedir()` with an empty `HOME` on macOS and Windows; the short (non-namespaced) value for a CLI-installed agent on Claude Code; Claude Code's own `permissions` rule to deny a subagent by name (see below). The tests fix the first on the machines that run them; the others are listed as "Not verified" in the pull request.

## Impact on users who installed plugin 0.2.0

- **Current exposure.** For users of 0.2.0 on Claude Code, the auditor has `Bash` and the guard does nothing. What still holds: the agent's prompt (advice, not enforcement), `audit` writing nothing (by construction and by test), and the user's own settings. What does not hold: the claims in `SKILL.md` ("on Claude Code only, the plugin's `PreToolUse` hook ... allows that short list ... and denies the rest") and in the agent file ("On Claude Code the guard hook enforces the list above") are false for 0.2.0. The audited repository is untrusted text that can try to instruct the model, and the guard was the layer meant to bound the damage.
- **Mitigation until a release (documentation, no code).** The maintainer can publish a notice (the pull request description, and a line in the README if wanted) telling 0.2.0 users: (1) add the `permissions.deny` snippet that `SKILL.md` already contains to their Claude Code settings; (2) run the auditor on a read-only checkout or a copy; (3) or do not use the auditor until the fixed version is out. Whether a `permissions` rule can deny the subagent by name is not verified here; the maintainer can check the current Claude Code documentation before recommending it.
- **After the fix.** Users get it only with a new plugin version: the marketplace delivers the plugin by version. Bumping `plugin.json`, the marketplace entry and tagging are **not** done by this change and need the maintainer's explicit OK for the version (gate 2). If the maintainer wants to ship faster, a patch release containing only this change is the smallest unit; that is the maintainer's decision.
- **CLI users** (`agent-skills add stacks-auditor`) have no hook and are not affected by this change.

## Context budget

`docs/aep/context-budgets.json` measures `skill:azure-terraform-stacks` (`SKILL.md`, about 3,472 estimated tokens, with margin about 4,514, budget 5,000) and `agent:stacks-auditor` (agent file plus the preloaded skill, about 6,078, with margin about 7,902, budget 9,000), measured on `main` on 2026-11-24 with `node scripts/context-budget.mjs` (an approximation, bytes divided by 4, not an official count). This change edits neither file: the guard, the tests, the fixture and `references/traps.md` are not counted (`references/traps.md` is not in `loadedWith`). The Windows sentence therefore goes into `references/traps.md`, because `SKILL.md` has about 486 estimated tokens of headroom under its budget and the rule of the file's `note` would force a revision for a sentence. If the implementation touches a measured file, it runs the command and revises the budget only by that rule, as initial values for the maintainer.

## Alternatives rejected

- Match by suffix or pattern (options B and C of Decision 1): collateral denial of other plugins' agents; no benefit for a name this plugin controls.
- Deny when `agent_type` is absent or unknown (Decision 2, B): breaks every other use of `Bash`.
- Tick 6.1 and 6.2 now (Decision 5): would claim a guard works that was shown not to.
- Remove the hook and rely on `permissions.deny` only (plan B of `fix-stacks-auditor-agent`): the live test shows the hook runs and the variable works, so plan B's trigger (the hook does not run) did not happen; the failure was the comparison, which a one-line change fixes.
- Read the agent's identity from somewhere else (the agent's tool list, a marker in the prompt): not available to a `PreToolUse` hook; not relied on.
- Put the Windows sentence in `SKILL.md`: raises the budget for no gain.
- Fix this in `fix-stacks-auditor-agent`: that change is merged and gate 1 for it is closed; a new change keeps the record and the scope check simple.

## Release

No release here. Plugin 0.2.0 and `package.json` stay; no tag, no publish, no `npm publish`, no workflow edit. Gate 2 (the maintainer's explicit OK for a version) is the only way to one.
