## MODIFIED Requirements

### Requirement: Auditor subagent
The `azure-terraform-stacks` plugin SHALL ship a Claude Code subagent at `plugins/azure-terraform-stacks/agents/stacks-auditor.md` with a `name`, a third-person `description` that says when to use it, an allowlist `tools: Read, Grep, Glob, Bash` (no `Write`, `Edit` or `NotebookEdit`) and `skills: [azure-terraform-stacks]`. The file SHALL NOT declare `disallowedTools` with a specifier such as `Bash(git push *)`, because Claude Code removes the whole tool for such an entry and the agent would lose the `Bash` that it needs to run the engine. Its instructions SHALL limit the shell to running the engine's `audit` command and a short list of read-only commands, and SHALL forbid changing the audited repository and running Terraform or `kubectl`. The single permitted write is `npm ci --omit=dev` in the skill's folder (the folder that contains `scripts/`) when its `node_modules` is missing (the engine needs the `yaml` package and plugin installs do not ship `node_modules`); it SHALL NOT run it in the audited repository, SHALL report that it did, and SHALL stop with an instruction to the user when it fails. The file SHALL NOT rely on `hooks`, `mcpServers` or `permissionMode`, which Claude Code ignores for plugin subagents. The agent's text and the skill's documentation SHALL describe the read-only property as a property of its design and its guards, not as a guarantee.

#### Scenario: Frontmatter present
- **WHEN** the repository is validated
- **THEN** the agent file has `name` equal to the file name without extension, a non-empty `description`, a `tools` list that includes `Bash`, and `skills` containing `azure-terraform-stacks`

#### Scenario: No write tools and no whole-tool surprises
- **WHEN** the plugin's tests run
- **THEN** they fail if `tools` of `stacks-auditor.md` contains `Write`, `Edit` or `NotebookEdit`, if `disallowedTools` has any entry with a specifier, or if the effective tools (`tools` minus the tool of every `disallowedTools` entry) do not include `Bash`

#### Scenario: Skill installed with the agent
- **WHEN** the agent is installed with the `agent-skills` CLI for a tool
- **THEN** the `skills` field makes the CLI install `azure-terraform-stacks` for the same tool and scope

#### Scenario: Bash is the residual risk
- **WHEN** the agent file and the skill's documentation are reviewed
- **THEN** they say that `Bash` can change files in ways no instruction prevents; that the engine's `audit` command is read-only by construction and tested; that the plugin's command guard enforces an allowlist only on Claude Code and fails open when it cannot run; that other tools rely on the instructions; and that users who need a hard guarantee can add `permissions.deny` rules in their own Claude Code settings, with a snippet, or run the agent on a read-only checkout

#### Scenario: Audit requested
- **WHEN** a user asks the main agent to audit an existing infrastructure repository against the stacks pattern
- **THEN** the main agent can delegate to `stacks-auditor`, and only the auditor's final report returns to the main conversation

### Requirement: Engine location
The subagent SHALL locate the engine (`scripts/stacks.mjs` of the `azure-terraform-stacks` skill) by the skill's name and without assuming one tool: with one `ls -d` call it SHALL check, in this order, `${CLAUDE_PLUGIN_ROOT}/skills/azure-terraform-stacks/scripts/stacks.mjs` (written in the agent's Markdown body, where Claude Code substitutes the plugin folder when it loads the content; the variable is not set in the environment of shell commands, so the path must appear in the body, not in a shell variable); then `<skills folder>/azure-terraform-stacks/scripts/stacks.mjs` for the project-scope skills folder of every supported tool in the audited repository, then for the user-scope skills folder of every supported tool in the home directory. The folders SHALL be exactly those that `src/lib/tools.mjs` defines for the supported tools. It SHALL use the first path that exists, and SHALL name its shell tool generically in the instructions instead of `Bash`. When the plugin variable was not substituted, that path does not exist and is skipped. When no copy is found, it SHALL stop and tell the user how to install the skill, instead of auditing by reading files by hand.

#### Scenario: Installed as a plugin
- **WHEN** the plugin is installed through the Claude Code marketplace
- **THEN** the auditor runs the engine at the substituted plugin path

#### Scenario: Installed by the CLI for another tool
- **WHEN** the agent and the skill were installed with `agent-skills add stacks-auditor --tool gemini` (or `codex`, `cursor`, `copilot`)
- **THEN** the unsubstituted variable path does not exist, and the auditor runs the copy in that tool's skills folder (for example `~/.gemini/skills/azure-terraform-stacks`)

#### Scenario: Skill folder in a Claude Code user folder
- **WHEN** the agent file was copied by hand and the skill is installed in `~/.claude/skills/azure-terraform-stacks`
- **THEN** the auditor runs the copy in the skill folder

#### Scenario: List stays in sync with the CLI
- **WHEN** the plugin's tests run
- **THEN** they fail if the skills folders listed in the agent differ from the `user` and `project` folders of the tools in `src/lib/tools.mjs`

#### Scenario: Engine missing
- **WHEN** no copy of the engine is found
- **THEN** the auditor reports that it needs the skill and prints the install commands, and runs nothing else

## ADDED Requirements

### Requirement: Command guard
The plugin SHALL ship `hooks/hooks.json` with a `PreToolUse` hook for `Bash` that runs `hooks/stacks-auditor-guard.mjs` (Node.js 20, no dependency). The script SHALL exit 0 without inspecting the command when the hook input's `agent_type` is not `stacks-auditor`. For `stacks-auditor` it SHALL deny (exit code 2, with the reason on stderr) every command that contains a newline or any of `; & | < > ` $ ( ) { }`, and every command that is not one of: `ls -d` with paths; `test -f` or `test -d` with a path; `node --version`; `node <path ending in azure-terraform-stacks/scripts/stacks.mjs> audit` with optional `--root <path>` and `--json`; `npm ci --omit=dev` when the input's `cwd` is a folder that contains `scripts/stacks.mjs`; `git -c core.fsmonitor=false status --porcelain`. The allowed shapes SHALL be the same as those the agent's instructions list. The guard applies on Claude Code only, does not run when plugin hooks are disabled by an administrator, and fails open when it cannot start; the agent's text and the skill's documentation SHALL say so.

#### Scenario: Other agents are untouched
- **WHEN** the hook receives a `Bash` call whose `agent_type` is absent or is not `stacks-auditor`
- **THEN** it exits 0 and prints nothing

#### Scenario: Allowed engine call
- **WHEN** `stacks-auditor` runs `node /x/azure-terraform-stacks/scripts/stacks.mjs audit --root /repo --json`
- **THEN** the guard exits 0

#### Scenario: Chaining and redirects denied
- **WHEN** `stacks-auditor` runs `node .../stacks.mjs audit && rm -rf x`, `ls -d a | tee b`, `echo hi > f`, `node -e "..."` or any command with `$(...)` or a backtick
- **THEN** the guard exits 2 with a reason

#### Scenario: Other engine subcommands denied
- **WHEN** `stacks-auditor` runs `node .../stacks.mjs scaffold` or `add-stack`, `bridge` or `diagram`
- **THEN** the guard exits 2

#### Scenario: Dependency install only in the skill folder
- **WHEN** `stacks-auditor` runs `npm ci --omit=dev` and the input's `cwd` is the audited repository (no `scripts/stacks.mjs` in it)
- **THEN** the guard exits 2; with the skill's folder as `cwd` it exits 0

#### Scenario: Terraform denied
- **WHEN** `stacks-auditor` runs `terraform plan`, `kubectl get pods`, `az login`, `gh pr create` or `git push`
- **THEN** the guard exits 2

### Requirement: Evidence verified by code
`audit` SHALL, after producing its findings, check each of them in code: the real path of its `file` is inside the audited root (a `..` segment or a symbolic link that leaves the root fails the check) and its `line`, when present, is an integer between 1 and the number of lines of that file. A finding that fails SHALL be removed from the findings and listed under `unverified` with the reason; it SHALL NOT count in the summary or in the exit code. The text output and the `--json` output SHALL list the `unverified` findings. The subagent's report SHALL show them under "Not verified", and SHALL label its own re-reading of the cited lines as a model check that follows the code check, not as the code check.

#### Scenario: Line beyond the end of the file
- **WHEN** a finding cites line 500 of a file with 40 lines
- **THEN** the finding is listed under `unverified` with that reason, the summary does not count it and the exit code does not depend on it

#### Scenario: Path outside the root
- **WHEN** a finding cites a file whose real path is outside the audited root (through `..` or a symbolic link)
- **THEN** it is listed under `unverified` and the file is not read

#### Scenario: Normal finding
- **WHEN** a finding cites an existing file inside the root and a line within it
- **THEN** it is reported as before and counted

#### Scenario: Report separates the checks
- **WHEN** the auditor returns its report
- **THEN** it has a "Not verified" section for the engine's `unverified` findings, and any finding it could not confirm by reading the cited line is labeled "could not confirm" and stays in the findings
