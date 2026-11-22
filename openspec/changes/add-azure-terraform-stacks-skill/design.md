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
regions:                             # any Azure region, short code chosen by the user
  brazilsouth: brs
environments:                        # one subscription per environment
  dev:  { subscriptionId: 00000000-0000-0000-0000-000000000001 }
  hml:  { subscriptionId: 00000000-0000-0000-0000-000000000002 }
  prod: { subscriptionId: 00000000-0000-0000-0000-000000000003 }
instances: [brs-01]                  # <region code>-<seq>
naming:                              # optional; default is the articles' pattern
  pattern: "{type}-{name}-{env}-{region}-{seq}"
  separator: "-"
  abbreviations: {}                  # overrides of CAF abbreviations, e.g. { pgsql: psql }
landingZone:
  mode: standalone                   # or alz (see Decision 12)
ci: [azure-devops, github-actions]   # one or both
profile: private-aks-postgres        # or "none" for empty stacks
state: { subscriptionId: …, resourceGroup: rg-tfstate, storageAccount: sttfstatecorp001, container: tfstate }
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

**6. Profile `private-aks-postgres` ships full minimal modules.** The seven modules (`network`, `private-endpoint`, `postgresql`, `key-vault`, `workload-identity`, `acr`, `aks`) are completed from the article snippets with variables, outputs and safe defaults (`public_network_access_enabled = false`, ACR `Premium`, Key Vault RBAC, `private_cluster_enabled`, OIDC issuer and Workload Identity on). Provider and Terraform constraints default to `azurerm >= 4.65, < 5.0` and Terraform `>= 1.12, < 2.0`, not the articles' `~> 4.0` / `~> 1.9` (see Decision 15); `SKILL.md` tells the agent to confirm the current versions in the registry before scaffolding and to write them into the manifest. With `profile: none`, stacks get an empty `main.tf` with backend, provider and the `environment`/`instance` variables.

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
| `argocd-apply-only` | Bootstrap stage/job runs only when `action` is `apply` | Review finding I7 |
| `rg-owned` | Every resource group a stack or script reads is created by some stack | Review finding B1 |
| `versions` | `required_version` allows only ≥ 1.12 and `azurerm` only ≥ 4.65 | Review findings I1–I2 |
| `bridge-placeholders` | Overlays have no unresolved `<output>` placeholders | Parte 2, trap 1 |
| `gha-inputs` | GitHub orchestrator has ≤ 25 inputs | GitHub changelog 2025-12-04 |

When `terraform` is on `PATH`, `check --deep` also runs `terraform fmt -check` and `terraform init -backend=false && terraform validate` per stack; with `actionlint`, it lints workflows; with `kubectl`, it runs `kubectl kustomize` on each overlay. Skipped tools are listed in the report. Output is human-readable by default and `--json` for agents.

**8. Bridge from Terraform outputs to the overlay.** `bridge --stack app-orders --env prod --instance brs-01 --outputs outputs.json` reads `terraform output -json`, maps outputs to overlay fields declared in the manifest (`gitops.apps[].values: { DB_HOST: postgres_fqdn, clientId: app_client_id }`) and rewrites only those lines in `kustomization.yaml`. Outputs marked `sensitive: true` are refused. With `--open-pr`, it creates a branch `bridge/<stack>-<env>-<instance>-<short sha of outputs>`, commits only the overlay, pushes and opens a pull request with `gh pr create` when the remote is GitHub or `az repos pr create` when it is Azure Repos (detected from `git remote get-url origin`, overridable with `--provider`). It uses the CLI's existing login (`gh auth`, `az login` / `AZURE_DEVOPS_EXT_PAT` in pipelines), never stores tokens, never merges, and reuses an open PR from the same branch instead of opening a second one. When the agent runs it, it asks the user before `--open-pr`. The generated pipelines include an optional post-apply step (off by default) that runs `bridge --open-pr` with the pipeline's own identity (`GH_TOKEN` from a GitHub App or `GITHUB_TOKEN` with `pull-requests: write`; `System.AccessToken` with "Contribute to pull requests" on Azure Repos). *Alternative:* the cluster reads outputs at runtime (e.g., an operator). Rejected for v1: more moving parts in the cluster. Sources: [gh pr create](https://cli.github.com/manual/gh_pr_create), [az repos pr create](https://learn.microsoft.com/en-us/cli/azure/repos/pr#az-repos-pr-create).

**9. Agent workflow (SKILL.md).** (1) Detect existing `infra/`; if present, run `check` first and offer `add-stack` or fixes instead of `scaffold`. (2) Interview: CI platform, environments, instances and region code, stacks and owners, profile, GitOps yes/no, bridge step yes/no. (3) Write `infra/stacks.yaml`, run `check-manifest`, show the manifest. (4) Run `plan`, show the file list, ask before writing. (5) `scaffold`, then `check --deep`. (6) Report: files written, checks passed/skipped, and the manual prerequisites list (state storage account, service connections or federated credentials per environment, Environments with approvals, self-hosted agents in the VNet, Argo CD repo credentials if private). The skill never runs `apply`.

**10. Dependencies.** Runtime: `yaml` only. Dev: none beyond `node --test`. `package-lock.json` committed. If `node_modules` is missing in the skill folder, `SKILL.md` tells the agent to run `npm ci --omit=dev` there (same as `docs-generator`).

**11. Tests.** Golden fixtures: manifests for (a) the articles' setup with both CI platforms and GitOps, (b) `profile: none` with two stacks and GitHub only, (c) one stack with no dependencies. `scaffold` output is compared byte-for-byte with committed expected trees. One test per `check` rule with a failing fixture. In CI, a job installs Terraform and `actionlint` and runs `check --deep` on fixture (a).

**12. Landing zone mode.** Decided with the user on 2026-11-22: both modes, chosen in the manifest.
- `standalone` (the articles): `vnet-core` creates the VNet, subnets, NSGs and the Private DNS zones, and links the zones to its VNet. Private Endpoints carry a `private_dns_zone_group`.
- `alz`: assumes an Azure Landing Zone with a hub in a connectivity subscription ([ALZ architecture](https://learn.microsoft.com/en-us/azure/cloud-adoption-framework/ready/landing-zone/), [Private Link and DNS at scale](https://learn.microsoft.com/en-us/azure/cloud-adoption-framework/ready/azure-best-practices/private-link-and-dns-integration-at-scale)). The manifest adds `landingZone: { hubVnetId, privateDnsZoneIds: { acr, keyVault, aks, postgres }, dnsByPolicy: true|false, peering: managed|external, dnsServers: [...] }`. `vnet-core` becomes a spoke: it creates the VNet with the hub's DNS servers and, with `peering: managed`, the spoke-to-hub peering (the hub-to-spoke side stays with the platform team); it creates no `privatelink.*` zones. Stacks read zones by resource ID through an aliased `azurerm` provider for the connectivity subscription. With `dnsByPolicy: true` (ALZ's DeployIfNotExists policies), Private Endpoints are generated **without** `private_dns_zone_group` and with `lifecycle { ignore_changes = [private_dns_zone_group] }`, so Terraform does not fight the policy. The AKS cluster receives `private_dns_zone_id` from the manifest (zone `privatelink.<region>.azmk8s.io`) and its identity gets `Private DNS Zone Contributor` on that zone plus `Network Contributor` on the subnet; the PostgreSQL server receives a central zone ending in `.postgres.database.azure.com`, which must be linked to the hub VNet.
- `check` gains `lz-dns-zone-group` (no zone group when `dnsByPolicy: true`) and `lz-no-local-privatelink-zone` (no `privatelink.*` zone created in `alz` mode).
- Egress through the hub firewall (`outbound_type = userDefinedRouting` with a route table) remains out of scope, as in the articles; the module exposes the variable.

**13. Naming is configurable, articles' pattern by default.** `naming.pattern` takes the tokens `{type}`, `{name}`, `{env}`, `{region}`, `{seq}` in any order; `separator` and `abbreviations` override the defaults. One function derives every name from it (resources, resource groups, state keys, Argo CD Applications), so `check` validates any pattern the same way. Names that cannot hold the separator (ACR, storage accounts) drop it; length limits are checked after derivation and never shortened silently. Sources: [CAF naming](https://learn.microsoft.com/en-us/azure/cloud-adoption-framework/ready/azure-best-practices/resource-naming), [CAF abbreviations](https://learn.microsoft.com/en-us/azure/cloud-adoption-framework/ready/azure-best-practices/resource-abbreviations), [resource name rules](https://learn.microsoft.com/en-us/azure/azure-resource-manager/management/resource-name-rules).

**14. One subscription per environment.** Each `environments.<env>.subscriptionId` sets `ARM_SUBSCRIPTION_ID` for that environment's runs (instead of the article's `az account show`), and the generated docs list one federated identity per environment, scoped per stack where the user wants least privilege. The state storage lives in its own subscription (`state.subscriptionId`), outside every stack.

**15. Fixes from the expert review of the articles' code (2026-11-22).** A review extracted every code block, ran Terraform 1.9.8 with azurerm 4.81.0 (`fmt`, `init -backend=false`, `validate`), actionlint 1.7.7, shellcheck 0.10.0, kustomize 5.4.3, the Argo CD v3.2.0 CRD schema and an expansion simulator over the 32 parameter combinations of the Azure DevOps pipeline. With minimal additions all stacks validate; as published, three blocks are broken. The templates SHALL include these fixes:

| Id | Severity | Finding | Template fix |
|---|---|---|---|
| B1 | blocking | No code creates `rg-aks-core-<suffix>` or any resource group for `app-orders`, but data sources and the bootstrap script read them | Every stack creates its own `azurerm_resource_group` (`rg-<stack name>`) and passes it to its modules |
| B2 | blocking | Module calls omit `location`, `resource_group_name`, and `vm_size`/`node_count`/`outbound_type` for `aks` (`Missing required argument`) | Every module call passes `location` and `resource_group_name`; `aks` inputs come from the stack with documented defaults |
| B3 | blocking | Kustomize `base/` has no `kustomization.yaml` (`kustomize build` fails) | Generate `base/kustomization.yaml` listing ServiceAccount and Deployment |
| I1 | important | Backend OIDC for Azure DevOps is documented only from Terraform 1.12; `~> 1.9` allows 1.9–1.11 | `required_version = ">= 1.12, < 2.0"`; pipelines install a pinned Terraform |
| I2 | important | `rbac_authorization_enabled` exists only from azurerm 4.42; `user_assigned_identity_id` from 4.65 | `azurerm >= 4.65, < 5.0` |
| I3 | important | `azurerm_federated_identity_credential.parent_id` and `resource_group_name` deprecated in 4.65, removed in 5.0 | Use `user_assigned_identity_id`; drop `resource_group_name` |
| I4 | important | AKS with SystemAssigned identity on a subnet in another resource group lacks `Network Contributor` ([AKS managed identity](https://learn.microsoft.com/azure/aks/system-assigned-managed-identity)) | Assign `Network Contributor` on the subnet; use UserAssigned identity in `alz` mode (custom private DNS zone requires it) |
| I5 | important | `TFSTATE_RG` / `TFSTATE_SA` are never defined in the Azure DevOps YAML; `set -u` aborts | Values come from `state` in the manifest and are rendered into pipeline variables |
| I6 | important | `export X="$(az …)"` hides a failing `az` (SC2155) | Assign, then export |
| I7 | important | Argo CD bootstrap runs even when `action=plan` | Bootstrap stage/job inserted only when `action == apply` |
| I8 | important | Network module not shown: subnet `delegation`/`service_delegation` and Private DNS VNet links missing ([PostgreSQL private networking](https://learn.microsoft.com/azure/postgresql/network/concepts-networking-private)) | Full `network` module with delegation and `azurerm_private_dns_zone_virtual_network_link` |
| M1–M9 | minor | `terraform fmt` drift; `case` without `*)`; one shared tfvars warns on other stacks' variables; NSGs in the table but not in code; no Terraform/kubectl install step; script exec bit; Argo CD `v3.2.0` older than stable `3.6.2`; ADO run with no stack selected yields zero stages (not verified) | `fmt` in tests; `*)` usage error; one tfvars per stack and instance; NSG per subnet; pinned tool install steps; call scripts with `bash`; Argo CD version from manifest with an age warning; orchestrator fails fast when no stack boolean is set |

Not verified by the review and covered by task 8.3: real `plan`/`apply`, Azure DevOps execution of conditional `dependsOn` (the simulator and the [template-expressions doc](https://learn.microsoft.com/azure/devops/pipelines/process/template-expressions) agree), `az aks get-credentials` permissions for the bootstrap identity, and PostgreSQL authentication settings. A follow-up for the blog (outside this repository): correct the articles with B1–B3 and I1–I7.

## Risks / Trade-offs

- [Article code is simplified and partly not executed] → Modules completed and validated with `terraform validate`; a real deploy of fixture (a) in a sandbox subscription before release, recorded in the PR (task 8.3).
- [Provider and Argo CD versions age] → Versions live in the manifest, not hard-coded; `SKILL.md` makes checking current versions a step; `check` warns when the Argo CD version is older than the one in the templates.
- [Users with an existing, different layout] → `check` reports, `scaffold` refuses to overwrite without `--force`, `add-stack` touches only new files and the two orchestrators.
- [Azure DevOps conditional `dependsOn` format is marked "not executed" in Parte 1] → Covered by the sandbox run in task 8.3 for both empty and non-empty dependency lists.
- [GitHub OIDC immutable subjects for repos created after 2026-07-15] → `references/pipelines-github-actions.md` explains both subject formats; the skill asks which applies and does not generate federated credentials itself.
- [Scope creep into a generic Terraform generator] → Only the modules of the profile; anything else is `profile: none` plus the user's own modules.

- [`alz` mode cannot be tested without a hub] → The sandbox run (task 8.3) includes a minimal hub VNet with central zones to exercise peering, zone reads and `dnsByPolicy: false`; `dnsByPolicy: true` is checked by `check` rules and by hand in a tenant with the ALZ policies, recorded in the PR.
- [`bridge --open-pr` is an outward action] → Asked before running, never merges, reuses an existing PR, uses only the CLI's existing login.

## Resolved Questions (2026-11-22, with the user)

- Skill name: `azure-terraform-stacks`.
- Bridge: opens the pull request with `gh` or `az repos` (Decision 8).
- Auditor subagent: separate change.
- Naming: articles' pattern proposed, configurable (Decision 13). Regions: free list in the manifest. Landing zone: `standalone` or `alz` (Decision 12). Subscriptions: one per environment (Decision 14).

## Open Questions

- None blocking. Decision 15 folds in the expert review; remaining unknowns are covered by task 8.3.
