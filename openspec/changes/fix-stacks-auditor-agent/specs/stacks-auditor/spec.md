## MODIFIED Requirements

### Requirement: Auditor subagent
The `azure-terraform-stacks` plugin SHALL ship a Claude Code subagent at `plugins/azure-terraform-stacks/agents/stacks-auditor.md` with a `name`, a third-person `description` that says when to use it, an allowlist `tools: Read, Grep, Glob, Bash` (no `Write`, `Edit` or `NotebookEdit`) and `skills: [azure-terraform-stacks]`. The file SHALL NOT declare `disallowedTools` with a specifier such as `Bash(git push *)`, because Claude Code removes the whole tool for such an entry and the agent would lose the `Bash` that it needs to run the engine. Its instructions SHALL limit the shell to running the engine's `audit` command and a short list of read-only commands, and SHALL forbid changing the audited repository and running Terraform or `kubectl`. The single permitted write is `npm ci --prefix <skill folder> --omit=dev --ignore-scripts` for the trusted copy of the skill (the folder that contains `scripts/`) when its `node_modules` is missing (the engine needs the `yaml` package and plugin installs do not ship `node_modules`); it SHALL NOT run it for a folder inside the audited repository, SHALL report that it did, and SHALL stop with an instruction to the user when it fails. The file SHALL NOT rely on `hooks`, `mcpServers` or `permissionMode`, which Claude Code ignores for plugin subagents. The agent's text and the skill's documentation SHALL describe the read-only property as a property of its design and its guards, not as a guarantee.

#### Scenario: Frontmatter present
- **WHEN** the repository is validated
- **THEN** the agent file has `name` equal to the file name without extension, a non-empty `description`, a `tools` list that includes `Bash`, and `skills` containing `azure-terraform-stacks`

#### Scenario: No write tools and no whole-tool surprises
- **WHEN** the plugin's tests run
- **THEN** they fail if `tools` of `stacks-auditor.md` contains `Write`, `Edit` or `NotebookEdit`, if `disallowedTools` has any entry with a specifier, or if the effective tools (`tools` minus the tool of every `disallowedTools` entry) do not include `Bash`

#### Scenario: Skill installed with the agent
- **WHEN** the agent is installed with the `agent-skills` CLI for a tool
- **THEN** the `skills` field makes the CLI install `azure-terraform-stacks` for the same tool and scope

#### Scenario: Cursor and Codex need the broader-access flag
- **WHEN** the agent is installed with `agent-skills add stacks-auditor --tool cursor` or `--tool codex`
- **THEN** the CLI refuses it unless `--allow-broader-access` is given, because the effective tools include `Bash`; with the flag it installs the agent without a tool restriction and says so; Gemini CLI and Copilot install it with their shell tool and no flag

#### Scenario: Bash is the residual risk
- **WHEN** the agent file and the skill's documentation are reviewed
- **THEN** they say that `Bash` can change files in ways no instruction prevents; that the engine's `audit` command is read-only by construction and tested; that the plugin's command guard enforces an allowlist only on Claude Code and fails open when Node cannot start the script or when an administrator disables plugin hooks; that the preloaded `SKILL.md` describes commands that write (`scaffold`, `add-stack`), so only the instructions and the guard stop the auditor from using them; that other tools rely on the instructions; and that users who need a hard guarantee can add `permissions.deny` rules in their own Claude Code settings, with a snippet, or run the agent on a read-only checkout

#### Scenario: Audit requested
- **WHEN** a user asks the main agent to audit an existing infrastructure repository against the stacks pattern
- **THEN** the main agent can delegate to `stacks-auditor`, and only the auditor's final report returns to the main conversation

### Requirement: Engine location
The subagent SHALL locate the engine (`scripts/stacks.mjs` of the `azure-terraform-stacks` skill) by the skill's name and without assuming one tool, and SHALL run only a trusted copy: with one `ls -d` call it SHALL check, in this order, `${CLAUDE_PLUGIN_ROOT}/skills/azure-terraform-stacks/scripts/stacks.mjs` (written in the agent's Markdown body, where Claude Code substitutes the plugin folder when it loads the content; the variable is not set in the environment of shell commands, so the path must appear in the body, not in a shell variable); then `<skills folder>/azure-terraform-stacks/scripts/stacks.mjs` for the user-scope skills folder of every supported tool in the home directory. The folders SHALL be exactly those that `src/lib/tools.mjs` defines as `user` for the supported tools. The project-scope skills folders SHALL NOT be searched, and the subagent SHALL NEVER run an engine that is inside the audited repository or the working directory: the repository is untrusted. It SHALL use the first path that exists, and SHALL name its shell tool generically in the instructions instead of `Bash`. When the plugin variable was not substituted, that path does not exist and is skipped. When no trusted copy is found, it SHALL stop and tell the user how to install the skill at user scope, instead of auditing by reading files by hand.

#### Scenario: Installed as a plugin
- **WHEN** the plugin is installed through the Claude Code marketplace
- **THEN** the auditor runs the engine at the substituted plugin path

#### Scenario: Installed by the CLI for another tool
- **WHEN** the agent and the skill were installed with `agent-skills add stacks-auditor --tool gemini` (or `codex`, `cursor`, `copilot`) at user scope
- **THEN** the unsubstituted variable path does not exist, and the auditor runs the copy in that tool's skills folder (for example `~/.gemini/skills/azure-terraform-stacks`)

#### Scenario: Skill folder in a Claude Code user folder
- **WHEN** the agent file was copied by hand and the skill is installed in `~/.claude/skills/azure-terraform-stacks`
- **THEN** the auditor runs the copy in the skill folder

#### Scenario: Engine inside the audited repository
- **WHEN** the audited repository contains `.claude/skills/azure-terraform-stacks/scripts/stacks.mjs` (or any other copy of the engine)
- **THEN** the auditor does not run it, says so in the report, and the guard denies it

#### Scenario: List stays in sync with the CLI
- **WHEN** the plugin's tests run
- **THEN** they fail if the skills folders listed in the agent, or the guard's list of trusted user folders, differ from the `user` folders of the tools in `src/lib/tools.mjs`, or if the agent lists a project-scope folder

#### Scenario: Engine missing
- **WHEN** no copy of the engine is found
- **THEN** the auditor reports that it needs the skill and prints the install commands, and runs nothing else

## ADDED Requirements

### Requirement: Command guard
The plugin SHALL ship `hooks/hooks.json` with a `PreToolUse` hook for `Bash` that runs `hooks/stacks-auditor-guard.mjs` (Node.js 20, no dependency). The script SHALL exit 0 without inspecting the command when the hook input's `agent_type` is not `stacks-auditor`. For `stacks-auditor` it SHALL approve a command only when it is certain what the shell hands to the program, so it SHALL deny (exit code 2, with the reason on stderr) every command that contains a newline, any quote (single or double), a backslash or any of `; & | < > ` $ ( ) { }` (the guard does not model the shell's quoting), and every command in which a `~` is anywhere but the first character of an unquoted word followed by `/` (`~`, `~+`, `~-`, `~user`, `--root=~/x`, `a:~/b`), for the arguments of every allowed command, and every command that is not one of: `ls -d` with paths; `test -f` or `test -d` with a path; `node --version`; `node <engine> audit` with optional `--root <path>` and `--json`, where `<engine>` is a path ending in `azure-terraform-stacks/scripts/stacks.mjs` that has no `..` segment (the `--root` and the `--prefix` folder too), resolves (real path, following symbolic links) and, once resolved, is the `scripts/stacks.mjs` of the plugin's own skill folder (derived from the script's location) or of the skill folder installed in a user skills folder (`~/.claude/skills`, `~/.agents/skills`, `~/.gemini/skills`, `~/.cursor/skills`, `~/.copilot/skills`), and is not inside the input's `cwd` nor inside the audited `--root`, as written or once resolved; `npm ci --prefix <skill folder> --omit=dev --ignore-scripts` (exactly this order and no other argument) where `<skill folder>` follows the same rules, is not inside `cwd`, and contains `scripts/stacks.mjs` and a `package.json` named `azure-terraform-stacks-engine`. The guard SHALL deny a `node` or `npm` call when the input has no `cwd` or when `cwd` is not an absolute path of an existing folder. Only the engine file itself (or the skill folder itself, for `--prefix`) is trusted, not another file under a trusted folder. No `git` command is allowed: git runs programs that the audited repository's own configuration names (task 2.4 found that `git -c core.fsmonitor=false status --porcelain` still ran a clean filter set in the repository). The allowed shapes SHALL be the same as those the agent's instructions list. The guard applies on Claude Code only, does not run when plugin hooks are disabled by an administrator, and fails open when it cannot start; the agent's text and the skill's documentation SHALL say so.

#### Scenario: Other agents are untouched
- **WHEN** the hook receives a `Bash` call whose `agent_type` is absent or is not `stacks-auditor`
- **THEN** it exits 0 and prints nothing

#### Scenario: Allowed engine call
- **WHEN** `stacks-auditor` runs `node <the plugin's engine, or one in a user skills folder> audit --root /repo --json` with `cwd` and `/repo` outside the engine's folder
- **THEN** the guard exits 0

#### Scenario: Tilde inside quotes
- **WHEN** `stacks-auditor` runs `node "~/.claude/skills/azure-terraform-stacks/scripts/stacks.mjs" audit` (double or single quotes), or the same for `--root` or `--prefix`, in a repository that has a folder literally named `~` with an engine inside it
- **THEN** the guard exits 2, because quotes are not accepted and the shell would not expand the tilde; unquoted `~/` is expanded to the user's home folder, and the guard judges that path; a differential test compares the paths the guard resolves with the argv that a real shell delivers

#### Scenario: Engine inside the audited repository denied
- **WHEN** `stacks-auditor` runs `node <repo>/.claude/skills/azure-terraform-stacks/scripts/stacks.mjs audit` (absolute or relative, with `./`), `node ./azure-terraform-stacks/scripts/stacks.mjs audit`, `node /tmp/evil/azure-terraform-stacks/scripts/stacks.mjs audit`, `node ~/x/azure-terraform-stacks/scripts/stacks.mjs audit`, an engine path with `..`, a path that does not resolve, or an engine whose folder contains the `--root`
- **THEN** the guard exits 2 with the reason, and a symbolic link in the repository that points to a trusted engine is denied as written, while a link in a user skills folder is judged by its resolved path

#### Scenario: Chaining and redirects denied
- **WHEN** `stacks-auditor` runs `node .../stacks.mjs audit && rm -rf x`, `ls -d a | tee b`, `echo hi > f`, `node -e "..."` or any command with `$(...)` or a backtick
- **THEN** the guard exits 2 with a reason

#### Scenario: Other engine subcommands denied
- **WHEN** `stacks-auditor` runs `node .../stacks.mjs scaffold` or `add-stack`, `bridge` or `diagram`
- **THEN** the guard exits 2

#### Scenario: Dependency install only for a trusted skill folder
- **WHEN** `stacks-auditor` runs `npm ci --prefix <folder> --omit=dev --ignore-scripts`
- **THEN** the guard exits 0 when `<folder>` is the plugin's skill folder or a user-installed one, and exits 2 when it is inside the audited repository or `cwd`, outside those two origins, contains `..`, does not resolve, is not an engine folder, or when the call is `npm ci --omit=dev --ignore-scripts` without `--prefix`, or has any extra argument (`--ignore-scripts=false`, `--userconfig`, `--globalconfig`, `--registry`, `--foreground-scripts`)

#### Scenario: Terraform denied
- **WHEN** `stacks-auditor` runs `terraform plan`, `kubectl get pods`, `az login`, `gh pr create`, `git push` or `git status`
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

### Requirement: Preloaded skill budget
The size of the `SKILL.md` that `stacks-auditor` preloads through `skills: [azure-terraform-stacks]` SHALL be bounded by a declared budget. The plugin's tests SHALL fail when an offline estimate of that file's tokens exceeds the budget. The estimate SHALL be computed in the test with no dependency beyond Node.js (bytes of the UTF-8 file divided by 4, rounded up) and SHALL be labeled everywhere it appears (test name, failure message, documentation) as an approximation and not a tokenizer count. The test file SHALL record the budget, the method, the model and the date of the last count made with the official token counting endpoint, and the value that count returned. The change SHALL add no runtime dependency.

#### Scenario: Within budget
- **WHEN** `SKILL.md` is at or below the budget under the offline estimate
- **THEN** the test passes and prints the estimate labeled as an approximation

#### Scenario: Skill grows beyond the budget
- **WHEN** a change makes `SKILL.md` larger than the budget under the offline estimate
- **THEN** the test fails with a message that names the file, the estimate (labeled approximate), the budget, and says that raising the budget requires a new count with the official endpoint

#### Scenario: Official count recorded
- **WHEN** the maintainer, or an environment with an API key, counts the preloaded text with `POST /v1/messages/count_tokens`
- **THEN** the model, date, method and `input_tokens` are written next to the budget in the test file; continuous integration without a key never calls the endpoint
