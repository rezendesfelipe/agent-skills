## 1. Setup

- [ ] 1.1 Create `plugins/azure-terraform-stacks/skills/azure-terraform-stacks/` from `templates/skill/` with `name: azure-terraform-stacks` and a description of what it does and when to use it (Terraform on Azure, Azure DevOps or GitHub Actions)
- [ ] 1.2 Add `plugins/azure-terraform-stacks/.claude-plugin/plugin.json` and the plugin entry in `.claude-plugin/marketplace.json`
- [ ] 1.3 Add the skill's `package.json` (Node 20+, `type: module`, runtime dependency `yaml`) and commit `package-lock.json`
- [ ] 1.4 Run `node scripts/validate-skills.mjs` to validate the frontmatter and the marketplace manifest

## 2. Manifest

- [ ] 2.1 Write `schema/stacks.schema.json` and `references/manifest-format.md` with the full example from the design
- [ ] 2.2 Implement manifest loading and `check-manifest` (required fields, cycles, unknown stacks and modules, stack name `<type>-<owner>`, GitHub input count), one test per scenario
- [ ] 2.3 Implement name derivation from `naming.pattern` (default and custom patterns, separator, abbreviation overrides, resource groups, ACR and Key Vault rules, state keys) and `references/naming.md`, with tests for the derived-names, custom-pattern, missing-token and over-the-limit scenarios
- [ ] 2.4 Validate `regions`, `environments.<env>.subscriptionId` (one per environment) and `landingZone` fields, one test per scenario

## 3. Terraform templates

- [ ] 3.1 Stack template (`terraform {}` with constraints from the manifest, empty `backend "azurerm" {}`, provider, `environment` and `instance` variables) and `envs/<env>-<instance>.tfvars`
- [ ] 3.2 Profile `private-aks-postgres`: complete the seven modules from the Parte 2 snippets with variables, outputs and private-by-default settings
- [ ] 3.3 Profile stacks `vnet-core`, `aks-core`, `app-<owner>` with data-source reads; `remoteState: true` variant
- [ ] 3.4 Landing zone modes: `standalone` and `alz` variants of `vnet-core` (spoke VNet, DNS servers, managed or external peering), connectivity provider alias, zone reads by ID, Private Endpoints without zone group when `dnsByPolicy: true`, AKS `private_dns_zone_id` and role assignments; `references/landing-zones.md`
- [ ] 3.5 `infra/scripts/tf.sh` (init with backend config, plan to file, apply the planned file) and `references/stacks-and-state.md`

## 4. Pipelines

- [ ] 4.1 Azure DevOps orchestrator and stack template (runtime parameters, conditional stages and `dependsOn`, plan artifact, deployment job with Environment, OIDC variables) and `references/pipelines-azure-devops.md`
- [ ] 4.2 GitHub Actions orchestrator and reusable stack workflow (`workflow_dispatch`, `needs` + `!cancelled() && !failure()`, `id-token: write`) and `references/pipelines-github-actions.md`, including both OIDC subject formats
- [ ] 4.3 Tests: compiled stage list for single-stack and all-stacks selections; no `destroy` with `prod`; `trigger: none`; defaults `plan` and `false`

## 5. GitOps

- [ ] 5.1 Argo CD templates: root Application, per-app Application with finalizer and `CreateNamespace=true`, Kustomize base (ServiceAccount, Deployment with Workload Identity label) and overlays, prod without `automated` by default
- [ ] 5.2 Bootstrap script with pinned version and server-side apply; bootstrap stage/job with own identity and dependencies from the manifest
- [ ] 5.3 `bridge` command (map outputs to overlay fields, refuse sensitive outputs, touch only mapped lines) with tests
- [ ] 5.4 `bridge --open-pr`: remote detection, branch naming, `gh pr create` / `az repos pr create`, reuse of an open PR, no-change and not-logged-in paths; tests with stubbed `gh` and `az` on `PATH`; optional post-apply pipeline step (off by default) with the pipeline identity's permissions documented
- [ ] 5.5 `references/gitops-argocd.md` and `references/private-aks-postgres.md` with the documentation links from Parte 2

## 6. Engine commands

- [ ] 6.1 Renderer for `{{placeholders}}` and the file planner (`create`/`update`/`unchanged`)
- [ ] 6.2 `plan`, `scaffold` (no overwrite without `--force`, writes only inside `infra/`, `.github/workflows/` and the manifest) and `add-stack`
- [ ] 6.3 `check` with every rule in design Decision 7, `--json`, and `--deep` with tool detection and a skipped-tools list; one failing fixture per rule; `references/traps.md` mapping each article trap to its rule

## 7. Skill instructions and catalog

- [ ] 7.1 Write `SKILL.md`: detection, interview, manifest, plan confirmation, scaffold, deep check, manual-prerequisites report, never apply
- [ ] 7.2 Add the plugin to the README catalog table
- [ ] 7.3 Add a CI job to `.github/workflows/validate.yml` that runs the skill tests and `check --deep` (with Terraform and `actionlint` installed) on the full fixture

## 8. Verification

- [ ] 8.1 Golden fixtures: articles' setup (both CI, GitOps), `profile: none` with GitHub only, single stack; byte-for-byte comparison
- [ ] 8.2 `node scripts/validate-skills.mjs`, `npm test`, `openspec validate --all --strict` pass
- [ ] 8.3 Manual run in a sandbox subscription: scaffold the full fixture, run the Azure DevOps and GitHub pipelines with single-stack and all-stacks selections (`plan` and `apply`), bootstrap Argo CD, sync `orders`, confirm Workload Identity reads Key Vault, run `bridge --open-pr` against GitHub and Azure Repos; repeat in `alz` mode with a minimal hub and central zones; record results and gaps in the PR
- [ ] 8.4 Install with the CLI into Claude Code and Codex (`npx @frcloudsolutions/agent-skills add azure-terraform-stacks --tool claude,codex --dry-run`) and confirm the skill is listed
