## ADDED Requirements

### Requirement: Guard agent identity
The command guard of `stacks-auditor` (`hooks/stacks-auditor-guard.mjs`) SHALL apply its allowlist to a call if and only if the hook input's `agent_type` is a string equal (`===`) to one of exactly two values: the agent's name, `stacks-auditor`, and the agent's name prefixed by the plugin's name and a colon, `azure-terraform-stacks:stacks-auditor` (the value that Claude Code sends for a plugin subagent, observed in a live session on 2026-11-24). The plugin name and the agent name SHALL each be a single constant of the guard, and the plugin's tests SHALL fail if the plugin constant differs from `name` in `.claude-plugin/plugin.json` or the agent constant differs from `name` in `agents/stacks-auditor.md`. The guard SHALL NOT match by suffix, prefix, pattern, case-insensitively or after trimming. For every other input (an `agent_type` that is absent, `null`, empty, not a string, another agent, another plugin's `stacks-auditor`, or a value that differs in case, spacing or extra text) the guard SHALL exit 0 and print nothing, because it restricts one agent and the hook runs on every `Bash` call of the main conversation and of every other agent. The documentation of the guard SHALL state that a change in the format of `agent_type` made by Claude Code makes the guard inert without a signal, and that a live check on the Claude Code version in use is the remedy.

#### Scenario: Plugin subagent with the namespaced value
- **WHEN** the hook receives a `Bash` call with `agent_type` `azure-terraform-stacks:stacks-auditor` and the command `terraform --version`
- **THEN** the guard exits 2 with a reason on stderr

#### Scenario: Plugin subagent runs the audit
- **WHEN** the hook receives a `Bash` call with `agent_type` `azure-terraform-stacks:stacks-auditor` and the command `node <the plugin's engine> audit --root <repo> --json`, with a `cwd` and a `--root` outside the engine's folder
- **THEN** the guard exits 0

#### Scenario: Agent installed without the plugin
- **WHEN** the hook receives a `Bash` call with `agent_type` `stacks-auditor` and the command `terraform --version`
- **THEN** the guard exits 2, as it did before this change

#### Scenario: Values that are not the auditor
- **WHEN** the hook receives the command `terraform apply` with `agent_type` absent, `null`, an empty string, a number, `general-purpose`, `Stacks-Auditor`, `azure-terraform-stacks:Stacks-Auditor`, `other-plugin:stacks-auditor`, `azure-terraform-stacks:stacks-auditor:x`, `x:azure-terraform-stacks:stacks-auditor`, `stacks-auditor-2`, or a value with a leading or trailing space, tab or no-break space
- **THEN** the guard exits 0 and prints nothing for each

#### Scenario: Regression with a captured value
- **WHEN** the plugin's tests run against a guard that compares `agent_type` only with `stacks-auditor`
- **THEN** the test that feeds the fixture of a real hook input (with the namespaced value) fails, because the guard exits 0 where 2 is expected

#### Scenario: Constants follow the repository
- **WHEN** the plugin's name or the agent's name is changed in its file and not in the guard
- **THEN** the plugin's tests fail

### Requirement: Guard refuses a divergent home directory
For a call of the auditor, when `process.env.HOME` is defined (an empty string counts as defined) and its resolved path is not equal to the resolved path of `os.homedir()` (compared case-insensitively on Windows), the guard SHALL deny the command with exit code 2 and a reason that names `HOME`, because the guard resolves `~` and the user's skills folders from the home directory that Node reports and the shell expands `~` from `HOME`. When `HOME` is not defined, the guard SHALL NOT add this denial. The check SHALL apply only after the agent has been identified (Requirement "Guard agent identity"), so it never affects the main conversation or another agent.

#### Scenario: Empty HOME
- **WHEN** the auditor's call reaches a guard started with `HOME` set to an empty string, on a platform where `os.homedir()` then falls back to the password database
- **THEN** the guard exits 2 and the reason names `HOME`

#### Scenario: HOME equals the home directory
- **WHEN** `HOME` and `USERPROFILE` are both set to the same folder and the command is an allowed one
- **THEN** the guard decides as it does without this requirement

#### Scenario: HOME not defined
- **WHEN** `HOME` is not defined in the guard's environment
- **THEN** the guard does not deny for this reason

#### Scenario: Another agent with a divergent HOME
- **WHEN** the hook receives a call whose `agent_type` is not one of the two accepted values and `HOME` is empty
- **THEN** the guard exits 0 and prints nothing

### Requirement: Guard test obligations
The guard's tests SHALL include: a fixture with the shape of a real hook input for a plugin subagent, whose `agent_type` is the namespaced value, and which contains no path, session identifier or user name taken from a real machine; a table of non-matching `agent_type` values that each exit 0 with no output; a corpus in the differential tests against the real `bash` that includes no-break space (U+00A0), en and em space, figure space, narrow no-break space, ideographic space, zero-width space, byte-order mark, next line (U+0085) and the line and paragraph separators (U+2028, U+2029), placed between arguments, inside paths and next to `--root`, `--json`, `~/` and `audit`; and tests of the home check that spawn the hook with `HOME` empty, equal to the home directory, and undefined. For every command in the corpus that the guard approves, the paths it resolves SHALL equal the argv that `bash` delivers; a character for which the two disagree SHALL be denied by the guard, not modeled. The differential tests SHALL be skipped, with the reason, where `bash` is not available (Windows), and the guard's documentation SHALL say that it is not verified on Windows and that paths there must use forward slashes, because the guard denies backslashes and quotes.

#### Scenario: Unicode space inside a path
- **WHEN** the corpus has `ls -d` with a word that contains a no-break space between two letters
- **THEN** the guard and `bash` both see one word, or the guard denies the command; the test fails if the guard approves and the argv differs

#### Scenario: Tokenizer mutation
- **WHEN** the guard's tokenizer is changed to split on any Unicode white space
- **THEN** at least one corpus test fails

#### Scenario: Windows documentation
- **WHEN** the skill's `references/traps.md` is read
- **THEN** it says that on Windows the guard denies backslashes and quotes, paths use forward slashes, the differential test against `bash` is skipped, and the guard is not verified on Windows

#### Scenario: Evidence of live checks
- **WHEN** the change is applied
- **THEN** the pull request records the live check of the guard with the namespaced value (a denied `terraform --version` and an allowed `audit`), and the evidence file of the 2026-11-24 capture states what it proves and what it does not
