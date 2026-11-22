## Why

Terraform repositories on Azure tend to grow into one large state: slow plans, contended locks, a pipeline identity with `Owner` on the subscription and a blast radius that includes the database. The pattern described in two articles of the maintainer's blog fixes this with two halves that only work together: infrastructure split into independent **stacks** (one `tfstate` per stack and instance, built from reusable modules, with names that say what each resource and state holds) and **one parameterized pipeline** (Azure DevOps runtime parameters or GitHub Actions `workflow_dispatch` inputs) that chooses which stacks run, where and with which action. The second article adds a private-network reference architecture (private AKS, PostgreSQL with delegated subnet, ACR and Key Vault behind Private Endpoints, Workload Identity) and application delivery through Argo CD.

Applying this by hand is error-prone in exactly the places the articles flag as traps: conditional `dependsOn` that break validation, a state `key` that drifts from the naming convention, a Workload Identity `subject` that does not match the Argo CD namespace and service account, Terraform outputs that never reach the Kustomize overlay, `destroy` offered in production. A skill that generates the layout from one manifest and checks these rules makes the pattern repeatable.

Sources: [Parte 1 — Parâmetros no pipeline](https://www.rezendesfelipe.com/blog/pt-br/2026-11-21/parametros-no-pipeline-escolha-o-que-provisionar/) and [Parte 2 — AKS e PostgreSQL em rede privada](https://www.rezendesfelipe.com/blog/pt-br/2026-11-22/aks-postgresql-rede-privada-terraform-argocd/).

## Skill or agent

This change ships a **skill**, not a subagent. Summary of the decision (full trade-off in `design.md`, Decision 1):

- The repository's contract (`skill-catalog`, `cli-installer`) distributes `SKILL.md` folders to Claude Code, Codex, Gemini CLI, Cursor and Copilot. A Claude Code subagent (`agents/*.md`) is not part of the Agent Skills format and the CLI would not install it.
- The work is procedural know-how plus deterministic files (templates, a generator, a checker), which is what skills package: instructions loaded on demand and scripts that run without spending context on the file contents.
- The workflow needs the user in the loop (CI platform, environments, stacks, overwrite confirmation). A subagent runs in its own context and returns one result; it is the wrong place for an interview.
- A subagent earns its place later for one narrow job, auditing a large existing repository against the pattern in an isolated context. That is a non-goal here.

## What Changes

- New plugin `azure-terraform-stacks` with skill `azure-terraform-stacks` (`plugins/azure-terraform-stacks/skills/azure-terraform-stacks/`).
- **Manifest as the single source of truth.** The agent writes `infra/stacks.yaml` (environments with one subscription each, regions and instances, naming pattern, landing zone mode, stacks with their modules and dependencies, CI platform, optional GitOps). Every generated file is derived from it.
- **Naming.** The articles' pattern `<type>-<name>-<env>-<region>-<seq>` with CAF abbreviations is the proposed default; the user can replace it in the manifest with their own component order, separator and abbreviations. Resource-specific rules (ACR alphanumeric, Key Vault length) always apply.
- **Regions.** Any Azure region, listed in the manifest with a short code chosen by the user (for example `brazilsouth: brs`). Multi-region comes from `instances`.
- **Subscriptions.** One subscription per environment, with one federated identity per environment and stack scope.
- **Landing zone mode.** `standalone` (the articles: `vnet-core` owns the VNet and the Private DNS zones) or `alz` (Azure Landing Zone: the stack creates a spoke VNet peered to an existing hub, reads the central Private DNS zones from the connectivity subscription and leaves DNS records to Azure Policy when the platform deploys it).
- **Bundled Node engine** (`scripts/stacks.mjs`, no network access, no Azure calls) with commands:
  - `check-manifest`: validates the manifest (names, dependency cycles, unknown modules, global-name rules).
  - `plan`: lists the files it would create or change, without writing.
  - `scaffold`: writes the repository layout from the manifest; never overwrites a file without `--force`.
  - `add-stack`: adds a stack to the manifest and generates only what changes.
  - `check`: checks an existing `infra/` against the rules (state keys, naming, pipeline parameters vs. stacks, `dependsOn` vs. manifest, Workload Identity subject vs. Argo CD Application, no `destroy` in production, `trigger: none`).
  - `bridge`: writes Terraform outputs (from `terraform output -json`) into the Kustomize overlay, refusing values marked `sensitive`, and with `--open-pr` opens a pull request with the change through `gh` (GitHub) or `az repos` (Azure Repos), never merging it.
- **Generated content**, following the articles:
  - Layout `infra/{modules,stacks,envs,scripts,pipelines}` and, with GitOps, `infra/argocd/{bootstrap,apps,manifests}`.
  - Naming `<type>-<name>-<env>-<region>-<seq>` with Cloud Adoption Framework abbreviations; state `key` = `<stack>-<env>-<instance>.tfstate`; partial `backend "azurerm" {}` with Entra ID auth.
  - Cross-stack reads through provider data sources by default; `terraform_remote_state` only when a stack opts in.
  - Azure DevOps: orchestrator with runtime parameters, conditional stages and `dependsOn`, a stack template with plan artifact and approval through Environments.
  - GitHub Actions: `workflow_dispatch` orchestrator, reusable stack workflow, OIDC, `!cancelled() && !failure()` chaining.
  - Optional profile `private-aks-postgres`: the three stacks and seven modules of the reference architecture.
  - Optional GitOps: Argo CD root Application (app of apps), one Application per app and instance, Kustomize base and overlays, bootstrap script with a pinned version, bootstrap stage with its own identity.
- Marketplace manifest and README catalog list the new plugin.

## Capabilities

### New Capabilities
- `azure-terraform-stacks`: the manifest format, naming and state rules, generated layout and pipelines, the reference-architecture profile, the Argo CD GitOps layer, the `check` and `bridge` commands, and the agent workflow in `SKILL.md`.

### Modified Capabilities
<!-- none: the skill follows the existing skill-catalog and marketplace-distribution requirements -->

## Non-goals

- Running `terraform apply`, `destroy`, `kubectl apply` or any command that changes Azure, Azure DevOps, GitHub or a cluster. The skill writes files and runs local, read-only checks. The one outward action is `bridge --open-pr`, which opens (never merges) a pull request after the user confirms.
- Creating service connections, federated credentials, Environments, approvals, branch policies or self-hosted agents. The skill documents what must exist and checks references to it.
- Deploying the landing zone itself (hub, Firewall, DNS Private Resolver, Azure Policy assignments). In `alz` mode the skill consumes an existing hub; it does not build it.
- Cluster egress design (firewall, NAT, `outbound_type` choice), left open by the articles on purpose.
- Argo CD credentials for private Git repositories, ApplicationSets, Helm charts as app sources, multi-cluster Argo CD.
- Bicep, Pulumi, Terraform Cloud/HCP workspaces, other clouds. OpenTofu is not tested in this release.
- Migrating an existing single state into stacks (`moved`/`removed`/`import` blocks). `check` may report what to split; it does not move state.
- A Claude Code subagent for repository audits (see "Skill or agent"). Decided on 2026-11-22: it will be a separate change, after this one is archived.
- Content in Portuguese: skill content is in English per repository rules; the generated files' comments are in English too.

## Impact

- New: `plugins/azure-terraform-stacks/` (skill, references, templates, Node engine with no runtime dependencies beyond `yaml`, tests with golden fixtures).
- Changed: `.claude-plugin/marketplace.json`, README catalog, `.github/workflows/validate.yml` (a job that runs the skill tests and, when available, `terraform validate` on the generated fixture).
- Users need Node.js 20+. `terraform`, `actionlint` and `kubectl` are optional: `check` uses them when found and says which checks it skipped.
- The generated Terraform and pipelines come from simplified article code, parts of which the articles mark as not executed. The tasks include a real deploy in a sandbox subscription before release.
