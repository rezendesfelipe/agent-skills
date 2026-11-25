## MODIFIED Requirements

### Requirement: Auditor subagent
The `azure-terraform-stacks` plugin SHALL ship a Claude Code subagent at `plugins/azure-terraform-stacks/agents/stacks-auditor.md` with a `name`, a third-person `description` that says when to use it, an allowlist `tools: Read, Grep, Glob, Bash` (no `Write`, `Edit` or `NotebookEdit`) and `skills: [azure-terraform-stacks]`. The file SHALL NOT declare `disallowedTools` with a specifier such as `Bash(git push *)`, because Claude Code removes the whole tool for such an entry and the agent would lose the `Bash` that it needs to run the engine. Its instructions SHALL limit the shell to running the engine's `audit` command and a short list of read-only commands, and SHALL forbid changing the audited repository and running Terraform or `kubectl`. It SHALL NOT write anything and SHALL NOT run `npm` or any installer, because the engine carries its one dependency (requirement "Vendored YAML parser" of `azure-terraform-stacks`) and needs no network. When the engine fails with `Cannot find package 'yaml'` (a copy of the skill that predates the vendored parser), the auditor SHALL stop and tell the user to update or reinstall the skill, and SHALL NOT try to install the package itself. The file SHALL NOT rely on `hooks`, `mcpServers` or `permissionMode`, which Claude Code ignores for plugin subagents. The agent's text and the skill's documentation SHALL describe the read-only property as a property of its design and its guards, not as a guarantee.

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

#### Scenario: No installer
- **WHEN** the agent file and the guard's allowlist are reviewed
- **THEN** neither lists an `npm` shape, no step of the agent's instructions installs anything, and a test fails if either mentions `npm ci`

#### Scenario: Audit requested
- **WHEN** a user asks the main agent to audit an existing infrastructure repository against the stacks pattern
- **THEN** the main agent can delegate to `stacks-auditor`, and only the auditor's final report returns to the main conversation

### Requirement: Command guard
The plugin SHALL ship `hooks/hooks.json` with a `PreToolUse` hook for `Bash` that runs `hooks/stacks-auditor-guard.mjs` (Node.js 20, no dependency). The script SHALL exit 0 without inspecting the command when the hook input's `agent_type` is not `stacks-auditor`. For `stacks-auditor` it SHALL approve a command only when it is certain what the shell hands to the program, so it SHALL deny (exit code 2, with the reason on stderr) every command that contains a newline, any quote (single or double), a backslash or any of `; & | < > ` $ ( ) { }` (the guard does not model the shell's quoting), and every command in which a `~` is anywhere but the first character of an unquoted word followed by `/` (`~`, `~+`, `~-`, `~user`, `--root=~/x`, `a:~/b`), for the arguments of every allowed command, and every command that is not one of: `ls -d` with paths; `test -f` or `test -d` with a path; `node --version`; `node <engine> audit` with optional `--root <path>` and `--json`, where `<engine>` is a path ending in `azure-terraform-stacks/scripts/stacks.mjs` that has no `..` segment (the `--root` too), resolves (real path, following symbolic links) and, once resolved, is the `scripts/stacks.mjs` of the plugin's own skill folder (derived from the script's location) or of the skill folder installed in a user skills folder (`~/.claude/skills`, `~/.agents/skills`, `~/.gemini/skills`, `~/.cursor/skills`, `~/.copilot/skills`), and is not inside the input's `cwd` nor inside the audited `--root`, as written or once resolved. The guard SHALL deny a `node` call when the input has no `cwd` or when `cwd` is not an absolute path of an existing folder. Only the engine file itself is trusted, not another file under a trusted folder. No `git` command is allowed: git runs programs that the audited repository's own configuration names (task 2.4 found that `git -c core.fsmonitor=false status --porcelain` still ran a clean filter set in the repository). The allowed shapes SHALL be the same as those the agent's instructions list. The guard applies on Claude Code only, does not run when plugin hooks are disabled by an administrator, and fails open when it cannot start; the agent's text and the skill's documentation SHALL say so.

#### Scenario: Other agents are untouched
- **WHEN** the hook receives a `Bash` call whose `agent_type` is absent or is not `stacks-auditor`
- **THEN** it exits 0 and prints nothing

#### Scenario: Allowed engine call
- **WHEN** `stacks-auditor` runs `node <the plugin's engine, or one in a user skills folder> audit --root /repo --json` with `cwd` and `/repo` outside the engine's folder
- **THEN** the guard exits 0

#### Scenario: Tilde inside quotes
- **WHEN** `stacks-auditor` runs `node "~/.claude/skills/azure-terraform-stacks/scripts/stacks.mjs" audit` (double or single quotes), or the same for `--root`, in a repository that has a folder literally named `~` with an engine inside it
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

#### Scenario: No package manager
- **WHEN** `stacks-auditor` runs `npm ci --prefix <a trusted skill folder> --omit=dev --ignore-scripts`, `npm ci`, `npm install`, `npx yaml` or any other `npm` or `npx` command
- **THEN** the guard exits 2 with the reason that the command is not on the allowlist

#### Scenario: Terraform denied
- **WHEN** `stacks-auditor` runs `terraform plan`, `kubectl get pods`, `az login`, `gh pr create`, `git push` or `git status`
- **THEN** the guard exits 2
