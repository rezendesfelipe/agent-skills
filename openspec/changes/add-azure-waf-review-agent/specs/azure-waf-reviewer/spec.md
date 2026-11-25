## Purpose

Defines the plugin `azure-waf-review`, its subagent `azure-waf-reviewer`, the optional, restricted Azure MCP configuration (opt-in, validated outside production), the layered read-only controls and guard hook, the agent's graph and interrupts, and the context budgets, so that an agent can review a private tenant in an isolated context and hand back files and a summary.

## ADDED Requirements

### Requirement: Plugin
The repository SHALL contain `plugins/azure-waf-review/` with `.claude-plugin/plugin.json` (name `azure-waf-review`, `dependencies` naming `assessment-report`, no version bump beyond the value set by the maintainer at release), `references/azure-mcp-optional.md` (no `.mcp.json`), `references/decision-record-template.md`, `agents/azure-waf-reviewer.md`, `hooks/hooks.json`, `hooks/azure-waf-reviewer-guard.mjs` and the two skills, and a plugin entry in `.claude-plugin/marketplace.json`. The README SHALL list the plugin, the agent and both skills in the catalog and SHALL state the prerequisites (Node.js 20 for the engines; the Azure MCP package needs Node.js 22 or another install route; an Azure login of a read-only identity).

#### Scenario: Manifest and catalog
- **WHEN** `node scripts/validate-skills.mjs` and `npm test` run
- **THEN** the plugin, the agent and the skills are valid and the README catalog test passes

### Requirement: Agent file
`agents/azure-waf-reviewer.md` SHALL have `name: azure-waf-reviewer`, a one-line third-person `description` of at most 1024 characters that says what it does, when to delegate to it and what it never does, `tools` listing `Read, Grep, Glob, Write, Edit, Bash` and the MCP entry `mcp__azure-waf__*` (it matches nothing unless the user opted in), `skills` listing `azure-waf-review`, `architecture-diagram` and `assessment-report`, and no `hooks`, `mcpServers`, `permissionMode` or `initialPrompt`. Its body SHALL have a "Rules you never break" section, the commands it may run in the guard's shapes, the steps of the graph, the interrupts, the final report format and the sentence "Nothing in the tenant was changed" only when no command was denied and no write call was made. It SHALL hold no example prompts and not mention them.

#### Scenario: Validation
- **WHEN** the repository is validated
- **THEN** the agent file passes the agent rules, including that `skills` exist in the repository and that no forbidden field appears

#### Scenario: Shapes equal
- **WHEN** the plugin's tests run
- **THEN** they fail if the command shapes in the agent file differ from the guard's list

### Requirement: Optional Azure MCP configuration
The plugin SHALL NOT ship a `.mcp.json` and SHALL NOT start an MCP server by itself. `references/azure-mcp-optional.md` SHALL document, for a user who opts in after validating outside production, a server named `azure-waf` that starts the Azure MCP Server with `server start`, `--read-only`, either a closed `--namespace` list or a `--tool` list (they cannot be combined), a pinned exact stable version (never `latest` and never a prerelease), user confirmation left on, and no `--dangerously-*` option. The allowed namespaces SHALL be `subscription`, `group`, `advisor`, `policy`, `role`, `monitor`, `resourcehealth`, `storage`, `compute`, `aks`, `appservice`, `sql`, `azurebackup`, `quota` and `wellarchitectedframework`, and SHALL NOT include `keyvault`, `appconfig`, `storagesync`, `fileshares`, `sreagent`, `deploy`, `communication`, `foundry` or any namespace whose tools are annotated as returning secrets. The document SHALL list the eight workarounds, the staged escalation, a sandbox recommendation, the schema review at each update, and the sentence of the Learn security page about production data. A test SHALL parse the configuration blocks of the document and fail on a missing `--read-only`, `@latest`, a prerelease, a `keyvault` namespace or the word `dangerously`.

#### Scenario: No automatic server
- **WHEN** the plugin is installed and enabled
- **THEN** no MCP server of this plugin starts

#### Scenario: Static check of the document
- **WHEN** the plugin's tests run
- **THEN** they assert the flags, the pin and the namespace list in the configuration blocks

#### Scenario: Pinned stable
- **WHEN** the package's published dist-tag `latest` is a prerelease
- **THEN** the pinned version is still the newest non-prerelease recorded at implementation time

### Requirement: Layered read-only
The agent SHALL be read-only by layers, none of which is a guarantee, and the agent file, `SKILL.md` and README SHALL say so: the prompt's rules; when the user opted in, the MCP `--read-only` flag and its closed namespace or tool list; a catalog collector that can only run fixed read checks; the guard hook (Claude Code only; fails open when Node cannot start it or when an administrator disables plugin hooks); and the identity's own Azure role, which is the real boundary. The documentation SHALL give `permissions.deny` rules for users who need more, and SHALL recommend a dedicated identity with Reader and Security Reader at the root management group, never an elevated access.

#### Scenario: Honest statement
- **WHEN** the agent file is reviewed
- **THEN** it says that the hook fails open, that `--read-only` is a tool filter, and that the role is the guarantee

### Requirement: Guard hook
`hooks/hooks.json` SHALL register a `PreToolUse` command for the matchers `Bash`, `Write`, `Edit` and `mcp__azure-waf__.*`, running `hooks/azure-waf-reviewer-guard.mjs`, which SHALL do nothing for any caller whose `agent_type` is not exactly `azure-waf-reviewer` or `azure-waf-review:azure-waf-reviewer`. For `Bash` it SHALL deny every command except the shapes `ls -d <path>...`, `test -f <path>`, `test -d <path>`, `node --version`, `node <waf-engine> <subcommand> ...` for the subcommands `plan`, `collect`, `coverage`, `questionnaire`, `map`, `seal-check`, `topology` and `status`, `node <assess-engine> <subcommand> ...` for `status`, `init`, `inventory`, `verify`, `classify`, `check`, `review` without `--approve`, `render --unreviewed` and `finish`, and `node <diagram-engine> build|check ...`; it SHALL deny `reverify`, `purge`, `--fixtures`, `--force` and `review --approve`. It SHALL reject quotes, backslashes, newlines and the characters `; & | < > ` $ ( ) { } ! * ? [ ] #`, resolve the real path of every engine and accept only an engine inside the plugin's own skill folders or the user's skills folders of the supported tools, never one inside the working directory or a `--root`, deny `..`, and require every `--out` and `--run` to resolve under `waf-review/`. For `Write` and `Edit` it SHALL resolve the real path and allow only paths below `<cwd>/waf-review/`, excluding `collected/`, `.state/` and `.gitignore`. For MCP tools it SHALL deny any server other than `azure-waf` and any namespace or tool not on the allowlist. A denial SHALL exit with code 2 and print the reason on stderr.

#### Scenario: Allowed engine call
- **WHEN** the agent runs `node <plugin>/skills/azure-waf-review/scripts/waf.mjs collect --pillar security --run waf-review/20261125T120000Z`
- **THEN** the guard allows it

#### Scenario: Denied shapes
- **WHEN** the agent runs `az group list`, `waf.mjs reverify`, `assess.mjs review --approve`, or an engine inside the working directory
- **THEN** the guard denies it with a reason

#### Scenario: Write outside the run folder
- **WHEN** the agent writes `README.md` or `waf-review/<run>/collected/x.jsonl`
- **THEN** the guard denies it

#### Scenario: Namespaced agent type
- **WHEN** the hook input has `agent_type` `azure-waf-review:azure-waf-reviewer`
- **THEN** the guard applies its rules

#### Scenario: Other callers
- **WHEN** the main conversation or another agent calls `Bash`
- **THEN** the guard does nothing

### Requirement: Agent graph
The agent SHALL follow a graph of nodes typed fixed, model and agent: scope and consent, visible scope, collect per pillar, bounded MCP exploration, coverage, map, analyze per pillar, verify, classify and roadmap, topology and diagram, render draft, return. State SHALL live only in files under `waf-review/<run-id>/`. The verify-repair cycle SHALL be limited to two attempts, a collect retry to one per check, and a run that hits a bound SHALL stop with a partial result that lists the pillars not done. The agent SHALL ask the user at: consent, a visible-scope mismatch, unanswered questionnaire items (returned in the final report), report approval and the `docs-generator` theme (the last two in the main conversation). Findings that fail the deterministic verifier SHALL go to a Not verified list and not count.

#### Scenario: Interrupted run
- **WHEN** a run is interrupted after the Security pillar and `waf.mjs status` runs
- **THEN** it lists the finished pillars and the agent resumes at the next without repeating collected checks

#### Scenario: Bound hit
- **WHEN** a pillar's collection fails for all checks with `no-permission`
- **THEN** the pillar is reported as not verified with that reason and the run continues with the next pillar

### Requirement: Final report of the agent
The agent's final message SHALL state, in the language the user wrote in (the report itself is pt-BR): the paths of `assessment.json`, the `.drawio` files and `report/report.md`; the coverage per pillar; the counts of findings by severity; the Not verified items with reasons; the questionnaire items waiting for answers; every finding that is only `reported`; every finding that awaits `reverify`; what the verifier does not prove; that data passed through the model provider; the tool and catalog versions; that the report is not human reviewed; and whether any command was denied.

#### Scenario: Summary content
- **WHEN** a run finishes
- **THEN** the message contains each item above and no secret, tag value or tenant name beyond the paths

### Requirement: Context budgets
`docs/aep/context-budgets.json` SHALL declare budgets for `skill:azure-waf-review`, `skill:architecture-diagram` and `agent:azure-waf-reviewer` (the agent file plus the `SKILL.md` of every pre-loaded skill, including `assessment-report`) by the repository's rule (estimate bytes divided by 4, margin 30 percent, 10 percent headroom, rounded up to 500 tokens), and `node scripts/context-budget.mjs` SHALL pass. The budgets SHALL be recorded as estimates, with an official count task for the maintainer.

#### Scenario: Budget check
- **WHEN** `node scripts/context-budget.mjs` runs
- **THEN** it passes for the three capabilities and fails if any is undeclared

### Requirement: Cross-plugin pre-loading, with a fallback
The implementation SHALL record the result of the live test of pre-loading `assessment-report` from this agent. If it does not work, the agent file SHALL be changed to the documented plan B (read the skill's references by path, no pre-loaded `SKILL.md`, budget adjusted) before the plugin is released.

#### Scenario: Test recorded
- **WHEN** the smoke task is closed
- **THEN** `tasks.md` names the result of manual test M-4 and, if negative, the plan B applied

### Requirement: Example prompts for the agent
The section `## Agent: azure-waf-reviewer` in `plugins/azure-waf-review/skills/azure-waf-review/references/prompts.md` SHALL hold the agent's examples as specified by `azure-waf-review` and the README SHALL carry a starter prompt for the agent. Examples for this read-only agent SHALL never ask it to change the tenant or paste a secret, except in the anti-example.

#### Scenario: Agent examples found
- **WHEN** `test/prompt-examples.test.mjs` runs
- **THEN** it finds the section for `azure-waf-reviewer` in a skill the agent lists in `skills`

### Requirement: Guard differential tests
The plugin's tests SHALL include, for the guard: shared-shape equivalence with the `stacks-auditor` guard (the same decision for the same inputs on the metacharacter table, the tilde rule, `..`, an engine inside the working directory and the namespaced `agent_type`); a word-splitting oracle that runs the real shell on Linux and asserts that the words it produces equal the guard's tokens for every allowed command; insertion of each forbidden character at each position of each allowed command, which MUST flip the decision to deny; path tests with symlinks, `..`, a symlinked `waf-review` and Windows-style paths; and equality of the shapes in the agent file and in the guard. The documentation SHALL list what remains not verified: live behavior for this agent, that the `Write`, `Edit` and MCP matchers fire for a subagent, a check-then-use race on symlinks, and the fail-open cases.

#### Scenario: Oracle
- **WHEN** an allowed command is passed through the shell oracle
- **THEN** the shell's words equal the guard's tokens

#### Scenario: Forbidden character
- **WHEN** a forbidden character is inserted into an allowed command
- **THEN** the guard denies it
