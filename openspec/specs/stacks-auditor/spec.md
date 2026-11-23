# stacks-auditor Specification

## Purpose
Lets an agent audit an existing Azure infrastructure repository against the stacks pattern of the `azure-terraform-stacks` skill, read-only and in an isolated context, and report findings without changing anything.
## Requirements
### Requirement: Auditor subagent
The `azure-terraform-stacks` plugin SHALL ship a Claude Code subagent at `plugins/azure-terraform-stacks/agents/stacks-auditor.md` with a `name`, a third-person `description` that says when to use it, an allowlist `tools: Read, Grep, Glob, Bash` (no `Write`, `Edit` or `NotebookEdit`) and a `disallowedTools` list that removes `Bash` commands that change state: `terraform *`, `kubectl *`, `az *`, `gh *`, `git commit *`, `git push *`, `git checkout *`, `git reset *`, `git clean *`, `rm *`, `mv *`, `cp *`, `tee *` and `sed -i *`. Its instructions SHALL limit `Bash` to running the engine's `audit` command and read-only inspection commands, and SHALL forbid changing the audited repository and running Terraform or `kubectl`. The single permitted write is `npm ci --omit=dev` in the skill's folder (the folder that contains `scripts/`) when its `node_modules` is missing (the engine needs the `yaml` package and plugin installs do not ship `node_modules`); it SHALL NOT run it in the audited repository, SHALL report that it did, and SHALL stop with an instruction to the user when it fails. The file SHALL NOT rely on `hooks`, `mcpServers` or `permissionMode`, which Claude Code ignores for plugin subagents.

#### Scenario: Frontmatter present
- **WHEN** the repository is validated
- **THEN** the agent file has `name` equal to the file name without extension, a non-empty `description` and a `tools` list

#### Scenario: No write tools
- **WHEN** the plugin's tests run
- **THEN** they fail if `tools` of `stacks-auditor.md` contains `Write`, `Edit` or `NotebookEdit`, or if `disallowedTools` lacks any of the patterns listed above

#### Scenario: Bash is the residual risk
- **WHEN** the agent file is reviewed
- **THEN** its text and the skill's documentation say that `Bash` can still change files in ways the `disallowedTools` patterns do not cover, that the engine's `audit` command is read-only by construction and tested, and that users who need a hard guarantee can add `permissions.deny` rules in their own Claude Code settings

#### Scenario: Audit requested
- **WHEN** a user asks the main agent to audit an existing infrastructure repository against the stacks pattern
- **THEN** the main agent can delegate to `stacks-auditor`, and only the auditor's final report returns to the main conversation

### Requirement: Audit command
The engine SHALL provide `node scripts/stacks.mjs audit [--root <repo>] [--json]` that works **without** `infra/stacks.yaml`, reads the repository, writes nothing, and exits with code 0 when no error finding exists, 1 when at least one exists and 2 on a usage error. It SHALL NOT run Terraform, `kubectl`, `kustomize` or any other external tool in v1.

#### Scenario: Repository without a manifest
- **WHEN** `audit` runs on a repository that has Terraform roots and pipelines but no `infra/stacks.yaml`
- **THEN** it prints an inventory and the findings, creates no file, and does not fail because the manifest is missing

#### Scenario: Nothing found
- **WHEN** `audit` runs on a directory without Terraform files, pipelines or Argo CD manifests
- **THEN** it reports that nothing was discovered and exits with code 0

#### Scenario: Read-only
- **WHEN** `audit` runs on a repository with uncommitted changes
- **THEN** `git status` shows the same state before and after

### Requirement: Discovery
`audit` SHALL discover, from file contents and not from folder names alone: Terraform roots (a directory with `.tf` files that declares a `backend` block, or declares a `provider` or `terraform {}` block and is not used as a module by a relative `source` in another folder), the backend type and the `key` of each root when it is literal, the Azure DevOps and GitHub Actions pipelines that run Terraform, and Argo CD `Application` manifests. The inventory SHALL list, per root, the number of `resource` blocks and the Azure resource types it creates, and SHALL mark every deduced value as inferred.

#### Scenario: Modules are not roots
- **WHEN** a folder with `.tf` files is used as a module by a relative `source` and declares no `backend` block
- **THEN** it is listed under modules and not as a root

#### Scenario: Roots and backends
- **WHEN** the repository has three directories with a `backend "azurerm"` block
- **THEN** the inventory lists three roots with their backend type and, when literal, their state keys

#### Scenario: Backend with partial configuration
- **WHEN** a root declares `backend "azurerm" {}` and the key is passed by a script or pipeline
- **THEN** the inventory marks the key as inferred and reads it from literal `*.tfstate` names in scripts and pipelines that contain the root's folder name (ignoring `-` and `_`): one match is "inferred", several (one per environment or instance) are "per-instance", none is "unknown"

#### Scenario: Pipelines
- **WHEN** a workflow or pipeline file runs `terraform` or `tf.sh`
- **THEN** the inventory lists the file, its trigger, and its inputs or parameters with their defaults

### Requirement: Rules without a manifest
`audit` SHALL evaluate every rule of the `check` command that does not need the manifest, reusing the same rule ids and references, and SHALL list every other rule as "not evaluated" with the reason. The rules evaluated are: `backend-partial`, `versions`, `rg-owned`, `oidc` (stored credentials in pipelines, scripts and Terraform), `no-prod-destroy` (when the pipeline mentions `prod`), `manual-trigger` (entry pipelines only: not Azure DevOps templates or reusable GitHub workflows), `plan-default` (the plan/apply input's default; boolean inputs are inferred to be stack selectors only when the pipeline also has such an input, and are then only a warning), `gha-inputs`, `argocd-finalizer`, `argocd-prod-sync` (not applied to an app of apps, which syncs by itself on purpose; it is the Applications it creates that must wait in production), `argocd-pinned` (any script that installs Argo CD from an `install.yaml` URL), `argocd-apply-only` (entry pipelines only) and `wi-subject` (best effort, from literals, as a warning). The rules `state-key`, `pipeline-params`, `pipeline-deps`, `lz-dns-zone-group`, `lz-no-local-privatelink-zone` and `drift` SHALL be listed as "not evaluated: needs infra/stacks.yaml".

#### Scenario: Shared rule, same id
- **WHEN** a pipeline offers `destroy` as an `action` value and can target an environment named `prod`
- **THEN** `audit` reports `no-prod-destroy` with the file and line, as `check` would

#### Scenario: Rule needing the manifest
- **WHEN** `audit` runs without a manifest
- **THEN** the output lists `state-key` under "not evaluated" with the reason "needs infra/stacks.yaml", and does not report it as passed

#### Scenario: Stored credential
- **WHEN** a workflow sets `ARM_CLIENT_SECRET` or a Terraform backend sets `access_key`
- **THEN** `audit` reports `oidc` with the file and line

### Requirement: Audit-only rules
`audit` SHALL also report: `state-shared`, as an error when two roots have the same literal key in the same literal storage account and container, and as a warning when the account or container is not stated or a key was inferred; `state-local`, as a warning, when a root has no `backend` block, so it uses local state; and `state-unknown`, as a warning, when a root has a backend whose key cannot be determined. It SHALL NOT report a verdict on how to split a root: it only shows the counts and resource-type groups per root in the inventory.

#### Scenario: Shared state
- **WHEN** two roots use the same literal storage account, container and key
- **THEN** `audit` reports `state-shared` as an error and names both roots

#### Scenario: Possibly shared state
- **WHEN** two roots resolve to the same key but the storage account or container is not stated, or a key was inferred
- **THEN** `audit` reports `state-shared` as a warning marked inferred

#### Scenario: Local state
- **WHEN** a root has no `backend` block
- **THEN** `audit` reports `state-local` as a warning with the root's path

### Requirement: Report
The subagent SHALL return one report in the language the user wrote in, with: a summary line (roots, pipelines, Argo CD apps, number of findings per severity); findings ordered by severity, each with rule id, file, line and the reference to read; the rules not evaluated and why; the deduced values marked as inferred; and what the audit does not cover. Any suggestion to split a root or to adopt the stacks pattern SHALL be labeled as the auditor's reading, with the inventory numbers that support it.

#### Scenario: Findings with evidence
- **WHEN** the audit finds a `versions` violation
- **THEN** the report shows the rule id, the file and line, the version found, the minimum required and the reference to read

#### Scenario: Limits stated
- **WHEN** the report is returned
- **THEN** it says that `terraform validate`, `actionlint`, `kustomize build` and `shellcheck` were not run, and how to run them on a copy of the repository

#### Scenario: No changes made
- **WHEN** the audit ends
- **THEN** the report states that no file in the repository was changed, and the auditor has not proposed or opened a pull request

### Requirement: Engine location
The subagent SHALL locate the engine (`scripts/stacks.mjs` of the `azure-terraform-stacks` skill) in this order: the path `${CLAUDE_PLUGIN_ROOT}/skills/azure-terraform-stacks/scripts/stacks.mjs`, written in the agent's Markdown body, where Claude Code substitutes the plugin folder when it loads the content (the variable is not set in the environment of `Bash` commands, so the path must appear in the body, not in a shell variable); then `.claude/skills/azure-terraform-stacks/` in the audited repository; then `~/.claude/skills/azure-terraform-stacks/`. It SHALL confirm that the file exists before running it. When no copy is found, it SHALL stop and tell the user how to install the skill, instead of auditing by reading files by hand.

#### Scenario: Installed as a plugin
- **WHEN** the plugin is installed through the Claude Code marketplace
- **THEN** the auditor runs the engine at the substituted plugin path

#### Scenario: Skill folder
- **WHEN** the agent file was copied by hand and the skill is installed in `~/.claude/skills/azure-terraform-stacks`
- **THEN** the unsubstituted variable path does not exist, and the auditor runs the copy in the skill folder

#### Scenario: Engine missing
- **WHEN** no copy of the engine is found
- **THEN** the auditor reports that it needs the skill and prints the install commands, and runs nothing else

