## Context

Motivation and scope: see `proposal.md`. Required behavior: see `specs/azure-terraform-stacks/spec.md`. The content comes from two articles of the maintainer's blog (Parte 1, 2026-11-21: stacks, naming, state and pipeline parameters; Parte 2, 2026-11-22: private reference architecture and Argo CD). The articles mark their code as simplified and some formats as "not executed"; this skill must turn them into files that pass `terraform validate`, `actionlint` and a real sandbox deploy.

The skill must work when installed by the Claude Code marketplace or by the `agent-skills` CLI into any agent's skills folder, so everything it needs lives inside the skill folder.

## Goals / Non-Goals

**Goals:**
- One manifest (`infra/stacks.yaml`) from which every generated file is derived, so pipelines, state keys and names cannot drift from the stacks.
- The agent writes the manifest and answers questions; the engine writes the files. Deterministic output, reviewable diffs.
- Encode the articles' traps as `check` rules, not only as prose.

**Non-Goals:**
- Touching any cloud or CI system. See `proposal.md` Non-goals.

## Decisions

**1. Skill, not subagent.**

| Criterion | Skill (`SKILL.md` + scripts) | Claude Code subagent (`agents/*.md`) |
|---|---|---|
| Distribution in this repo | Covered by `skill-catalog` and `cli-installer`: installs into Claude Code, Codex, Gemini CLI, Cursor, Copilot | Claude Code plugin only; the CLI does not install it; other tools use other formats |
| Context | Loaded on demand (description first, body when triggered, references when needed); scripts run without loading their code | Separate context window; only its final message returns |
| User interaction | Runs in the main conversation: can ask, show a plan, confirm before writing | Built to run a task and report; poor place for an interview and overwrite confirmations |
| Bundled files | Templates, scripts and references next to `SKILL.md` | Prompt plus tool list; files would still need a skill or a repo |
| Best fit | Repeatable procedure with deterministic artifacts | Large isolated exploration, parallel work, restricted tools or a different model |

The work here is a procedure (interview → manifest → generate → check) with deterministic artifacts and decisions that belong to the user, so a skill. A subagent is the right shape for a later, separate job: auditing a big existing repository against the pattern without filling the main context. It can reuse this skill's `check` engine. Sources: [Agent Skills overview](https://docs.claude.com/en/docs/agents-and-tools/agent-skills/overview), [Claude Code skills](https://docs.claude.com/en/docs/claude-code/skills), [Claude Code subagents](https://docs.claude.com/en/docs/claude-code/sub-agents), [Anthropic engineering: Equipping agents for the real world with Agent Skills](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills), [agentskills.io](https://agentskills.io).

**2. Skill folder layout.**
```text
plugins/azure-terraform-stacks/skills/azure-terraform-stacks/
  SKILL.md                       # workflow, interview, guardrails
  references/
    manifest-format.md           # stacks.yaml fields and a full example
    naming.md                    # pattern, CAF abbreviations, global-name rules, sources
    stacks-and-state.md          # stack vs module vs instance, backend, cross-stack reads
    pipelines-azure-devops.md    # runtime params, template expressions, approvals, OIDC
    pipelines-github-actions.md  # workflow_dispatch, reusable workflows, OIDC subjects
    private-aks-postgres.md      # reference architecture and the docs behind each decision
    gitops-argocd.md             # layout, sync policy, finalizers, bootstrap, bridge
    traps.md                     # the articles' traps, each mapped to a check rule
  templates/                     # files with {{placeholders}}, one folder per area
    terraform/{stack,modules/*}/
    azure-devops/  github-actions/  argocd/  scripts/
  schema/stacks.schema.json
  scripts/stacks.mjs             # CLI entry
  scripts/lib/…                  # manifest, naming, render, check, bridge
  package.json, package-lock.json
  test/fixtures/…  test/*.test.mjs
```
`SKILL.md` stays short and points to references, so the agent loads detail only when needed (same choice as `docs-generator`).

**3. Manifest shape.** Example for the articles' setup:
```yaml
# infra/stacks.yaml
version: 1
region: { name: brazilsouth, code: brs }
environments: [dev, hml, prod]
instances: [brs-01]
ci: [azure-devops, github-actions]   # one or both
profile: private-aks-postgres        # or "none" for empty stacks
state: { resourceGroup: rg-tfstate, storageAccount: sttfstatecorp001, container: tfstate }
stacks:
  - { name: vnet-core,  type: vnet, owner: core,   modules: [network] }
  - { name: aks-core,   type: aks,  owner: core,   modules: [aks, acr, private-endpoint], dependsOn: [vnet-core] }
  - { name: app-orders, type: app,  owner: orders, modules: [postgresql, key-vault, private-endpoint, workload-identity], dependsOn: [vnet-core, aks-core] }
gitops:
  tool: argocd
  argocdVersion: v3.2.0
  repoURL: https://github.com/<org>/<repo>.git
  apps:
    - { name: orders, stack: app-orders, namespace: orders, serviceAccount: orders, autoSync: { dev: true, hml: true, prod: false } }
```
`schema/stacks.schema.json` gives editors autocomplete via `$schema`; the engine validates the same rules in plain code, to keep runtime dependencies to `yaml`. Cross-field rules (cycles, unknown `dependsOn`, `gitops.apps[].stack` exists, ≤ 25 GitHub inputs) live in `check-manifest`.

**4. Templates rendered by the engine, not written freely by the agent.** Placeholders are `{{name}}` with no logic; loops (stages per stack, inputs per stack) are built in code. *Alternative:* the agent writes every file guided by references. Rejected: output changes between runs, and the conditional `dependsOn` blocks are exactly what a model gets subtly wrong. *Alternative:* a template engine (Handlebars, EJS). Rejected: one more dependency for little gain; the files are few.

**5. Dependency graph drives pipelines.** `dependsOn` in the manifest generates, for Azure DevOps, conditional `dependsOn` entries wrapped in `${{ if eq(parameters.<x>, true) }}`, and for GitHub Actions `needs:` plus `if: ${{ !cancelled() && !failure() && inputs.<x> }}`. Stage names are the stack name with `-` replaced by `_`; parameter names are camelCase for Azure DevOps (`appOrders`) and snake_case for GitHub (`app_orders`), as in the articles. The Argo CD bootstrap depends on every stack that a `gitops.apps[].stack` names plus the AKS stack.

**6. Profile `private-aks-postgres` ships full minimal modules.** The seven modules (`network`, `private-endpoint`, `postgresql`, `key-vault`, `workload-identity`, `acr`, `aks`) are completed from the article snippets with variables, outputs and safe defaults (`public_network_access_enabled = false`, ACR `Premium`, Key Vault RBAC, `private_cluster_enabled`, OIDC issuer and Workload Identity on). Provider and Terraform constraints default to the articles' (`azurerm ~> 4.0`, Terraform `~> 1.9`); `SKILL.md` tells the agent to confirm the current versions in the registry before scaffolding and to write them into the manifest. With `profile: none`, stacks get an empty `main.tf` with backend, provider and the `environment`/`instance` variables.

**7. `check` rules.** Each rule has an id, a severity and a link to the reference that explains it. Initial set:

| Id | Rule | Source |
|---|---|---|
| `state-key` | Backend `key` is `<stack>-<env>-<instance>.tfstate` | Parte 1 |
| `backend-partial` | Stack declares `backend "azurerm" {}` with no inline values | Parte 1, HashiCorp backend docs |
| `naming` | Literal names follow `<type>-<name>-<env>-<region>-<seq>`; ACR 5–50 alphanumeric; Key Vault 3–24 | CAF naming, resource name rules |
| `pipeline-params` | Every stack has one boolean parameter/input and one stage/job; none extra | Parte 1 |
| `pipeline-deps` | Pipeline dependencies match the manifest graph | Parte 1 |
| `no-prod-destroy` | `destroy` is not an allowed `action` when `prod` is an environment | Parte 1, trap 3 |
| `manual-trigger` | Orchestrator has `trigger: none` / only `workflow_dispatch` | Parte 1, trap 4 |
| `plan-default` | `action` defaults to `plan`; stack booleans default to `false` | Parte 1 |
| `oidc` | No client secrets or access keys in pipelines; GitHub workflows have `id-token: write` | Parte 1 |
| `wi-subject` | Federated credential subject equals `system:serviceaccount:<namespace>:<serviceAccount>` of the Argo CD app | Parte 2 |
| `argocd-prod-sync` | Prod Application has no `syncPolicy.automated` unless the manifest says so | Parte 2 |
| `argocd-finalizer` | Applications carry `resources-finalizer.argocd.argoproj.io` | Parte 2 |
| `argocd-pinned` | Bootstrap installs a pinned Argo CD version | Parte 2, Argo CD install docs |
| `bridge-placeholders` | Overlays have no unresolved `<output>` placeholders | Parte 2, trap 1 |
| `gha-inputs` | GitHub orchestrator has ≤ 25 inputs | GitHub changelog 2025-12-04 |

When `terraform` is on `PATH`, `check --deep` also runs `terraform fmt -check` and `terraform init -backend=false && terraform validate` per stack; with `actionlint`, it lints workflows; with `kubectl`, it runs `kubectl kustomize` on each overlay. Skipped tools are listed in the report. Output is human-readable by default and `--json` for agents.

**8. Bridge from Terraform outputs to the overlay.** `bridge --stack app-orders --env prod --instance brs-01 --outputs outputs.json` reads `terraform output -json`, maps outputs to overlay fields declared in the manifest (`gitops.apps[].values: { DB_HOST: postgres_fqdn, clientId: app_client_id }`) and rewrites only those lines in `kustomization.yaml`. Outputs marked `sensitive: true` are refused. The generated pipelines include an optional step, off by default, that runs `bridge` after `apply` and opens a pull request; Parte 2 leaves this choice to the reader, so the skill asks. *Alternative:* the cluster reads outputs at runtime (e.g., an operator). Rejected for v1: more moving parts in the cluster.

**9. Agent workflow (SKILL.md).** (1) Detect existing `infra/`; if present, run `check` first and offer `add-stack` or fixes instead of `scaffold`. (2) Interview: CI platform, environments, instances and region code, stacks and owners, profile, GitOps yes/no, bridge step yes/no. (3) Write `infra/stacks.yaml`, run `check-manifest`, show the manifest. (4) Run `plan`, show the file list, ask before writing. (5) `scaffold`, then `check --deep`. (6) Report: files written, checks passed/skipped, and the manual prerequisites list (state storage account, service connections or federated credentials per environment, Environments with approvals, self-hosted agents in the VNet, Argo CD repo credentials if private). The skill never runs `apply`.

**10. Dependencies.** Runtime: `yaml` only. Dev: none beyond `node --test`. `package-lock.json` committed. If `node_modules` is missing in the skill folder, `SKILL.md` tells the agent to run `npm ci --omit=dev` there (same as `docs-generator`).

**11. Tests.** Golden fixtures: manifests for (a) the articles' setup with both CI platforms and GitOps, (b) `profile: none` with two stacks and GitHub only, (c) one stack with no dependencies. `scaffold` output is compared byte-for-byte with committed expected trees. One test per `check` rule with a failing fixture. In CI, a job installs Terraform and `actionlint` and runs `check --deep` on fixture (a).

## Risks / Trade-offs

- [Article code is simplified and partly not executed] → Modules completed and validated with `terraform validate`; a real deploy of fixture (a) in a sandbox subscription before release, recorded in the PR (task 8.3).
- [Provider and Argo CD versions age] → Versions live in the manifest, not hard-coded; `SKILL.md` makes checking current versions a step; `check` warns when the Argo CD version is older than the one in the templates.
- [Users with an existing, different layout] → `check` reports, `scaffold` refuses to overwrite without `--force`, `add-stack` touches only new files and the two orchestrators.
- [Azure DevOps conditional `dependsOn` format is marked "not executed" in Parte 1] → Covered by the sandbox run in task 8.3 for both empty and non-empty dependency lists.
- [GitHub OIDC immutable subjects for repos created after 2026-07-15] → `references/pipelines-github-actions.md` explains both subject formats; the skill asks which applies and does not generate federated credentials itself.
- [Scope creep into a generic Terraform generator] → Only the modules of the profile; anything else is `profile: none` plus the user's own modules.

## Open Questions

- Plugin and skill name: `azure-terraform-stacks` (proposed) vs. a broader name if Bicep is planned later.
- Should the bridge step open the pull request with the platform CLI (`az repos`, `gh`) or only write the file and leave the PR to the user? Proposed: only write the file in v1.
- Should a future `stacks-auditor` subagent ship in the same plugin? Proposed: separate change, after this one is archived.
