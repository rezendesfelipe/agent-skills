## Context

Motivation and scope: see `proposal.md`. Required behavior: `specs/stacks-auditor/spec.md` and `specs/skill-catalog/spec.md`. Background: the skill's engine (`scripts/stacks.mjs`) derives every file from `infra/stacks.yaml`, and its `check` command compares a repository with that manifest. The subagent-versus-skill decision is in `add-azure-terraform-stacks-skill`, Decision 1.

Facts about Claude Code subagents that shape this design, from the official docs read on 2026-11-23 ([plugins reference](https://code.claude.com/docs/en/plugins-reference), [subagents](https://code.claude.com/docs/en/sub-agents)):

- A plugin puts subagents in `agents/` at the plugin root; the default folder is scanned, and a `plugin.json` entry is optional.
- `name` and `description` are the only required fields. `tools` is an allowlist of tool names; an omitted `tools` inherits every tool. `disallowedTools` removes tools and accepts patterns such as `Bash(git push *)`. The docs do not say that `tools` accepts command patterns.
- Plugin subagents ignore `hooks`, `mcpServers` and `permissionMode`.
- `${CLAUDE_PLUGIN_ROOT}` is substituted inline when the agent's Markdown body is loaded; it is **not** set in the environment of commands run through `Bash`.
- The docs warn that a subagent without `Edit` and `Write` can still change files through `Bash`.

## Goals / Non-Goals

**Goals:**
- A report a maintainer can act on, with evidence (file, line, rule, reference) and with its own limits stated.
- A read-only run that provably leaves the audited repository unchanged, as far as the engine goes.
- One set of rule ids and references shared with `check`, so a finding means the same thing in both.

**Non-Goals:**
- Deducing a manifest, migrating state or fixing anything. See `proposal.md`.

## Decisions

**1. `check` cannot be the auditor's engine as it is, so `audit` is a new command.** `check` loads `infra/stacks.yaml` first and compares generated files with it; a repository the skill did not generate has no manifest. Instead of making the auditor read files by hand (inconsistent across runs), the engine gets `audit`: discovery plus the subset of rules that needs no manifest. The shared rules are moved from `check.mjs` into small functions that take a list of discovered files, so `check` and `audit` call the same code and cannot drift apart.

| Rule | In `audit` | Why |
|---|---|---|
| `backend-partial` | yes | Looks at each root's `backend` block |
| `versions` | yes | Looks at each root's `required_version` and `azurerm` |
| `rg-owned` | yes | Compares resource groups read by data sources with those created in any root |
| `oidc` | yes | Looks for stored credentials and `id-token: write` |
| `no-prod-destroy` | yes | Applies when the pipeline can target `prod` (an environment value or a GitHub/Azure DevOps Environment named `prod`) |
| `manual-trigger` | yes | Triggers of the pipelines that run Terraform |
| `plan-default` | yes | The `action` default; boolean defaults only when the inputs are recognizable as stack selectors |
| `gha-inputs` | yes | Counts `workflow_dispatch` inputs |
| `argocd-finalizer`, `argocd-prod-sync`, `argocd-pinned`, `argocd-apply-only` | yes | Read Applications and the bootstrap script/stage |
| `wi-subject` | best effort | Compares literals in Terraform with the Application's namespace and service account |
| `state-key`, `pipeline-params`, `pipeline-deps`, `lz-*`, `drift` | **no** | Need the manifest (naming pattern, stack list, landing zone mode, generated files) |
| `state-shared`, `state-local`, `state-unknown` | new, audit only | A repository that was never split is exactly where these show up |

Rules that are not evaluated are printed with the reason. Silent skipping would let an audit look cleaner than it is.

**2. Discovery looks at contents, not names.** A Terraform root is a directory with `.tf` files that has a `terraform {}` or `backend` block, because an existing repository may call its folders `prod/network` or `live/eastus`. Modules (directories with `.tf` files and no `terraform {}`/`backend` block) are not roots. State keys are read only when literal: from the `backend` block, or from `-backend-config="key=..."` or `key=...` in scripts and pipelines. Anything built from variables is "unknown", and `state-unknown` says so. Values the engine deduces are tagged `inferred` in the JSON output.

**3. The inventory reports facts and counts, never a verdict on splitting.** Per root: the number of `resource` blocks and the Azure resource types, grouped into network, compute, data, identity and other. This supports statements like "root `prod` holds 214 resources, including a VNet, an AKS cluster and two PostgreSQL servers", which the auditor can relate to HashiCorp's guidance (group by volatility, separate stateful from stateless, split by privilege; [workspace best practices](https://developer.hashicorp.com/terraform/cloud-docs/workspaces/best-practices)). The suggestion itself is labeled as the auditor's reading, per the spec. No numeric threshold is built into the engine, because no source gives a number to apply here.

**4. Read-only is layered, and the residual risk is stated.** The tool allowlist is `Read, Grep, Glob, Bash`. `Bash` is needed to run the engine, and `tools` cannot limit it to one command. So: (a) `disallowedTools` removes the state-changing commands listed in the spec; (b) the agent's instructions limit `Bash` to the `audit` command and read-only inspection; (c) `audit` itself writes nothing, runs no external tool and is tested for an unchanged working tree. The documentation warns that `Bash` can still change files, so the agent file and `SKILL.md` say plainly that this is not a hard guarantee, and suggest `permissions.deny` rules in the user's own settings for those who need one. Plugin subagents cannot carry `hooks` or `permissionMode`, so enforcement through those is not available. *Alternative:* no `Bash`, reading files with `Read`/`Grep`/`Glob` only. Rejected: results would differ between runs and the shared rules could not be reused, which is the point of Decision 1. For the same reason the auditor does not fall back to manual reading when the engine is missing: it stops, so a report never presents hand-made results as engine-checked.

**5. No external tools in `audit` v1.** `terraform init -backend=false` creates `.terraform/` and a lock file inside the repository, and `terraform validate` needs it. That breaks "writes nothing". The report instead tells the user to copy the repository (`cp -R`) and run `terraform fmt -check`, `terraform init -backend=false && terraform validate`, `actionlint`, `kubectl kustomize` and `shellcheck` there. A later `--deep` mode that copies the repository into a temporary directory is possible and listed as an open question.

**6. Finding the engine.** The agent's Markdown body names the engine as `${CLAUDE_PLUGIN_ROOT}/skills/azure-terraform-stacks/scripts/stacks.mjs`. For a plugin install, Claude Code substitutes the folder when it loads the body, so the shell never sees the variable. When the agent file was copied alone, the path stays unresolved, does not exist, and the agent falls back to `.claude/skills/azure-terraform-stacks/` in the audited repository, then `~/.claude/skills/azure-terraform-stacks/`. It runs `test -f` before using a path. If nothing is found, it stops and prints the install commands. This depends on the substitution behaving as the docs state; task 5.2 confirms it by installing the plugin.

**7. Report.** The subagent returns: a summary line; findings by severity with rule id, file, line and reference; the rules not evaluated and why; what was inferred; what the audit does not cover (Terraform and linters not run, no manifest deduced); and, in a separate section marked as the auditor's reading, observations such as "two roots share a state" with their numbers and the next step the skill offers (write `infra/stacks.yaml`, then `plan`). The report is in the user's language. Findings use the same severities as `check`: error, warning, info.

**8. Validator and tests.** `src/lib/validate.mjs` gets `validateAgent`, called for every `plugins/*/agents/*.md`: frontmatter present; `name` kebab-case, at most 64 characters and equal to the file name; `description` present and at most 1024 characters; `tools` present; names unique across plugins. The repository is stricter than Claude Code on two points (64 characters, `tools` required), because an agent without `tools` inherits every tool of the session. That the auditor is read-only is not a general validator rule (other agents may need to write); it is a test in the plugin that parses `stacks-auditor.md` and fails if `tools` contains `Write`, `Edit` or `NotebookEdit`, or if `disallowedTools` lacks any pattern listed in the spec.

**9. Where it ships.** Same plugin, because the agent is useless without the engine and a separate plugin would need the skill as a dependency, which the marketplace manifest does not express. The `agent-skills` CLI installs skills only, so a user of Codex, Gemini CLI, Cursor or Copilot does not get the subagent; they can still run `node scripts/stacks.mjs audit` from the installed skill.

## Implementation notes (2026-11-23)

- **Shared rules.** The manifest-independent rules moved from `check.mjs` into `rules.mjs`; `check` and `audit` call the same functions. The refactor was pinned by a golden test (`test/golden-findings.json`: 28 scenarios, 130 findings, captured before the change and compared after), which also guards later edits to a shared rule. `ruleVersions` is split into a Terraform part and a provider part, because in an existing repository `required_version` and the `azurerm` constraint can live in different files.
- **Context knobs, not forks.** Where `check` and `audit` need to differ, the shared function takes a small context (`prodPossible`, `actionKey`, `requireAction`, `selectors`, `selectorSeverity`, `requireIdToken`, `allowWorkflowCall`, `entry`) instead of duplicating the rule.
- **False positives found by running `audit` on freshly scaffolded repositories**, which must audit clean: the callee of a reusable bootstrap workflow cannot see the caller's `action` input (so `argocd-apply-only` applies to entry workflows only); the app-of-apps root is automated on purpose; and state keys listed in a script's key table (`echo "x.tfstate"`) must count as script keys, not only `key=` arguments. Separators `-` and `_` are ignored when matching a key to a root's folder, because a naming pattern may use either.
- **`argocd-pinned` and `argocd-prod-sync` in `audit`.** `audit` calls `ruleBootstrapScript` with `required: false` (a script with no Argo CD install is not a finding) and skips `argocd-prod-sync` for an app of apps.
- **The engine's own dependency.** The engine needs the `yaml` package, and plugin installs do not ship `node_modules`. The auditor may run `npm ci --omit=dev` in the skill's folder (never in the audited repository). That is the one exception to "writes nothing", stated in the agent file, the spec and the report.
- **A dry run of the instructions.** A general-purpose agent was given the body of the agent file (plugin path substituted) and asked to audit a Git copy of two fixtures. It followed the rules, produced the report sections, verified findings with `Read`, left `git status` clean and listed what was ambiguous. That led to three fixes: the dependency folder is the skill's folder, not the folder next to `stacks.mjs`; `node --version` and `test -d` join the allowed inspection commands; and `manual-trigger` now cites the `trigger:` or `on:` key, not the first comment that contains the word. It does **not** replace task 5.2 (the agent was not registered through the plugin, and the variable was substituted by hand).
- **Plugin version.** The plugin goes from 0.1.0 to 0.2.0 (a new agent). The `agent-skills` npm package is untouched until the next release.

## Risks / Trade-offs

- [`Bash` can change files despite the deny patterns] → Layered mitigation in Decision 4; stated in the agent file, `SKILL.md` and the report's limits; optional user-side `permissions.deny`.
- [Discovery misreads an unusual repository (generated Terraform, Terragrunt, nested modules)] → Everything deduced is tagged `inferred`; unrecognized layouts are reported under "not covered"; Terragrunt is a non-goal and named in the report when `terragrunt.hcl` files exist.
- [A shared-rule refactor changes `check` behavior] → The existing 83 tests (including one failing fixture per rule) must pass unchanged before `audit` is added; `audit` then gets its own fixtures.
- [Plugin variable substitution in the agent body does not work as documented] → Task 5.2 verifies it on a real plugin install; the fallback search order still finds a skill-folder copy.
- [False sense of safety from an audit that passes] → The report always lists the rules not evaluated and the tools not run; "no findings" is never worded as "compliant".
- [Claude Code only] → Documented; the `audit` command works from any agent that can run Node.

## Open Questions

- Which `model` the agent should use. Scanning many files is cheap work, but the docs read for this change do not say what an omitted `model` means for a plugin subagent, so the agent file leaves it out until that is confirmed.
- Whether a later `audit --deep` should copy the repository to a temporary directory and run Terraform and the linters there (breaks no read-only promise, costs disk and time on large repositories).
- Whether a v2 should deduce a draft `infra/stacks.yaml`; decide after real audits show which fields the inventory can fill reliably.
- Whether `cli-installer` should learn to install agents (a separate change).
