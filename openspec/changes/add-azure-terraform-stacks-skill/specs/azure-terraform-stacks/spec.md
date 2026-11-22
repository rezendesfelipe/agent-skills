## Purpose

Lets an agent set up and maintain Terraform on Azure as independent stacks (one state per stack and instance) driven by one parameterized pipeline in Azure DevOps or GitHub Actions, with an optional private-network reference architecture and Argo CD delivery, all derived from one manifest and checked against the rules of the source articles.

## ADDED Requirements

### Requirement: Stacks manifest
The skill SHALL use `infra/stacks.yaml` as the single source of truth. The engine's `check-manifest` command SHALL validate it and report every problem with the field path.

| Field | Required | Content |
|-------|----------|---------|
| `version` | yes | `1` |
| `regions` | yes | Map of Azure region name to a short code chosen by the user, for example `{ brazilsouth: brs }` |
| `environments` | yes | Map of lowercase environment name to `{ subscriptionId }`, one subscription per environment |
| `instances` | yes | Non-empty list of `<region-code>-<seq>`, for example `[brs-01]`; every region code must exist in `regions` |
| `naming` | no | `{ pattern, separator, abbreviations }`; default pattern `{type}-{name}-{env}-{region}-{seq}` |
| `landingZone` | no | `{ mode: standalone }` (default) or `{ mode: alz, hubVnetId, privateDnsZoneIds, dnsByPolicy, peering, dnsServers }` |
| `ci` | yes | Non-empty subset of `[azure-devops, github-actions]` |
| `profile` | no | `none` (default) or `private-aks-postgres` |
| `state` | yes | `{ subscriptionId, resourceGroup, storageAccount, container }` of the state storage |
| `stacks` | yes | List of `{ name, type, owner, modules?, dependsOn?, remoteState? }` |
| `gitops` | no | `{ tool: argocd, argocdVersion, repoURL, apps: [...] }` |

#### Scenario: Valid manifest
- **WHEN** the agent runs `check-manifest` on a manifest with all required fields and an acyclic `dependsOn` graph
- **THEN** the command reports no errors and exits with code 0

#### Scenario: Dependency cycle
- **WHEN** stack `a` depends on `b` and `b` depends on `a`
- **THEN** `check-manifest` fails and names the cycle

#### Scenario: Unknown dependency or module
- **WHEN** a stack's `dependsOn` names a stack that does not exist, or `modules` names a module that is neither bundled by the profile nor present in `infra/modules/`
- **THEN** `check-manifest` fails and reports the field path and the unknown name

#### Scenario: Unknown region code
- **WHEN** an instance is `eus-01` and `regions` has no region with code `eus`
- **THEN** `check-manifest` fails and lists the known codes

#### Scenario: Shared subscription
- **WHEN** two environments have the same `subscriptionId`
- **THEN** `check-manifest` fails, because the skill assumes one subscription per environment

#### Scenario: Stack name does not match type and owner
- **WHEN** a stack has `type: aks`, `owner: core` and `name: cluster`
- **THEN** `check-manifest` fails and suggests `aks-core`, because a stack is named `<type>-<owner>`

### Requirement: Naming and state keys
Generated resource names SHALL follow the manifest's `naming.pattern`, whose default is `{type}-{name}-{env}-{region}-{seq}` with Cloud Adoption Framework abbreviations. The user MAY change the token order, the separator and the abbreviations; every pattern MUST contain all five tokens. Resource groups SHALL be `rg` plus the separator plus the main resource name. Names of resources with global or restricted rules SHALL follow those rules: Container Registry names only letters and digits, 5 to 50 characters; Key Vault names 3 to 24 characters. Every stack's state key SHALL be the stack name, environment and instance joined by the pattern, plus `.tfstate` (with the default pattern, `<stack>-<environment>-<instance>.tfstate`).

#### Scenario: Derived names
- **WHEN** the manifest has stack `aks-core`, environment `prod` and instance `brs-01`
- **THEN** the cluster is `aks-core-prod-brs-01`, its resource group `rg-aks-core-prod-brs-01`, the registry `crcoreprodbrs01` and the state key `aks-core-prod-brs-01.tfstate`

#### Scenario: Custom pattern
- **WHEN** the manifest sets `naming.pattern: "{env}-{region}-{type}-{name}-{seq}"` and `separator: "_"`
- **THEN** the cluster is `prod_brs_aks_core_01`, the registry drops the separator (`prodbrscrcore01`), and `check` validates names against this pattern instead of the default

#### Scenario: Pattern missing a token
- **WHEN** `naming.pattern` has no `{env}`
- **THEN** `check-manifest` fails, because names of different environments would collide

#### Scenario: Name over the limit
- **WHEN** a derived Key Vault name would exceed 24 characters
- **THEN** `check-manifest` fails, shows the derived name and its length, and does not shorten it silently

### Requirement: Repository layout
`scaffold` SHALL write `infra/modules/<module>/`, `infra/stacks/<stack>/`, `infra/envs/<env>-<instance>.tfvars`, `infra/scripts/` and the pipeline files for each platform in `ci`. Each stack SHALL create its own resource group, pass `location` and `resource_group_name` to every module call, require Terraform `>= 1.12` and `azurerm >= 4.65`, declare an empty `backend "azurerm" {}` and receive the backend values at `init`, authenticate to the backend with Microsoft Entra ID, and take `environment` and `instance` as variables. Stacks SHALL read other stacks' resources through provider data sources, and SHALL use `terraform_remote_state` only when the stack sets `remoteState: true`.

#### Scenario: Scaffold from a manifest
- **WHEN** the agent runs `scaffold` on a valid manifest with three stacks and both CI platforms
- **THEN** the layout above exists, each stack has its own backend block with no inline values, and no file outside `infra/`, `.github/workflows/` and the manifest is written

#### Scenario: Every read resource group exists
- **WHEN** a stack's data source or the bootstrap script reads `rg-aks-core-prod-brs-01`
- **THEN** the `aks-core` stack creates that resource group, and `check` reports `rg-owned` if no stack does

#### Scenario: Existing file
- **WHEN** a file that `scaffold` would write already exists and differs
- **THEN** `scaffold` does not change it, lists it, and exits with a non-zero code unless `--force` is given

#### Scenario: Preview
- **WHEN** the agent runs `plan`
- **THEN** the engine lists each file as `create`, `update` or `unchanged` and writes nothing

### Requirement: Azure DevOps pipeline
For `azure-devops`, the engine SHALL generate an orchestrator with `trigger: none`, runtime parameters `environment` and `instance` (closed `values` lists), `action` (`plan` default; `apply`), and one boolean per stack defaulting to `false`; a stage per stack inserted only when its boolean is true, through template expressions; `dependsOn` entries that exist only when the dependency's boolean is true; and a stack template that publishes the plan as an artifact and applies that plan in a deployment job bound to the environment's Environment, using a service connection with workload identity federation.

#### Scenario: Conditional dependencies
- **WHEN** only `app-orders` is selected in a run
- **THEN** the compiled pipeline contains only the `app_orders` stage and its `dependsOn` list is empty

#### Scenario: Apply uses the reviewed plan
- **WHEN** `action` is `apply`
- **THEN** the apply job downloads the plan artifact of the same stage and runs `terraform apply` on that file

### Requirement: GitHub Actions workflow
For `github-actions`, the engine SHALL generate an orchestrator triggered only by `workflow_dispatch` with inputs `environment` (type `environment`), `instance` and `action` (type `choice`, `plan` default) and one boolean per stack defaulting to `false`; one job per stack calling a reusable workflow, chained with `needs` and `if: ${{ !cancelled() && !failure() && inputs.<stack> }}`; `permissions: id-token: write, contents: read`; and OIDC authentication with no stored secret. The orchestrator SHALL NOT exceed 25 inputs.

#### Scenario: Skipped dependency
- **WHEN** `vnet_core` is false and `aks_core` is true
- **THEN** the `aks-core` job runs after the skipped `vnet-core` job

#### Scenario: Too many inputs
- **WHEN** the manifest would produce more than 25 inputs
- **THEN** `check-manifest` fails and says how many inputs would be generated

### Requirement: Production guardrails
Generated pipelines SHALL NOT offer `destroy` as an `action` value when `prod` is in `environments`, SHALL default `action` to `plan`, SHALL set each environment's subscription from the manifest, and SHALL NOT contain client secrets, storage access keys or other credentials. The skill SHALL NOT run `terraform apply`, `terraform destroy`, `kubectl apply` or any command that changes cloud, CI or cluster state. The only outward action SHALL be `bridge --open-pr`, run by the agent only after the user confirms.

#### Scenario: Destroy requested for prod
- **WHEN** the user asks to add `destroy` to the actions and `prod` is an environment
- **THEN** the agent explains the rule, and `check` fails on any pipeline that offers `destroy` with `prod` available

#### Scenario: Agent asked to apply
- **WHEN** the user asks the agent to apply the stacks
- **THEN** the agent does not run `apply` and points to the pipeline run with `action: apply`

### Requirement: Private AKS and PostgreSQL profile
With `profile: private-aks-postgres`, the engine SHALL generate the stacks `vnet-core` (VNet, subnets including a subnet delegated to `Microsoft.DBforPostgreSQL/flexibleServers` of at least `/28`, NSGs, Private DNS zones), `aks-core` (private AKS with OIDC issuer and Workload Identity, Premium ACR with public access disabled and a Private Endpoint, `AcrPull` for the kubelet identity) and one `app-<owner>` stack per application (PostgreSQL Flexible Server with private access, Key Vault with RBAC and a Private Endpoint, a user-assigned identity federated with the app's Kubernetes service account and `Key Vault Secrets User`), and the modules they call.

#### Scenario: Generated modules validate
- **WHEN** the profile is scaffolded and `terraform` is installed
- **THEN** `check --deep` runs `terraform init -backend=false` and `terraform validate` on every stack, and all pass

#### Scenario: Private by default
- **WHEN** the profile is scaffolded
- **THEN** PostgreSQL, ACR and Key Vault have public network access disabled, and the AKS cluster has `private_cluster_enabled = true`

### Requirement: Landing zone modes
With `landingZone.mode: standalone`, the network stack SHALL create the VNet, subnets, NSGs and the Private DNS zones and link them to its VNet. With `landingZone.mode: alz`, the network stack SHALL create a spoke VNet that uses `dnsServers`, SHALL create the spoke-to-hub peering only when `peering: managed`, and SHALL NOT create `privatelink.*` zones; stacks SHALL read the central zones by resource ID from `privateDnsZoneIds` through a provider alias for the connectivity subscription. When `dnsByPolicy: true`, Private Endpoints SHALL be generated without `private_dns_zone_group` and SHALL ignore changes to it.

#### Scenario: Standalone
- **WHEN** the manifest has `landingZone.mode: standalone` and the `private-aks-postgres` profile
- **THEN** `vnet-core` creates the `privatelink.azurecr.io`, `privatelink.vaultcore.azure.net` and PostgreSQL zones, and every Private Endpoint has a DNS zone group

#### Scenario: ALZ with DNS by policy
- **WHEN** the manifest has `landingZone.mode: alz` and `dnsByPolicy: true`
- **THEN** no `privatelink.*` zone is created, Private Endpoints have no DNS zone group, AKS gets `private_dns_zone_id` from the manifest, and `check` fails if a zone group or a local `privatelink.*` zone is added later

#### Scenario: ALZ missing hub data
- **WHEN** `mode: alz` is set without `hubVnetId` or without a zone ID that the profile needs
- **THEN** `check-manifest` fails and names the missing field

### Requirement: Argo CD delivery
When `gitops.tool` is `argocd`, the engine SHALL generate `infra/argocd/bootstrap/root-<env>-<instance>.yaml` (app of apps), `infra/argocd/apps/<env>-<instance>/<app>.yaml` per app, Kustomize `base` and `overlays/<env>-<instance>`, a bootstrap script that installs a pinned Argo CD version with server-side apply, Kustomize `base/kustomization.yaml`, and a bootstrap stage or job behind its own boolean parameter, inserted only when `action` is `apply`, with its own identity and the same Environment as the stacks. Federated credentials SHALL use `user_assigned_identity_id`, not the deprecated `parent_id`. Applications SHALL carry the `resources-finalizer.argocd.argoproj.io` finalizer and `CreateNamespace=true`. The production Application SHALL NOT have `syncPolicy.automated` unless the manifest enables it for `prod`.

#### Scenario: Workload Identity subject matches
- **WHEN** an app has `namespace: orders` and `serviceAccount: orders`
- **THEN** the federated credential subject is `system:serviceaccount:orders:orders`, the Application's destination namespace is `orders`, and the ServiceAccount is named `orders`

#### Scenario: Plan run does not bootstrap
- **WHEN** the bootstrap boolean is true and `action` is `plan`
- **THEN** no bootstrap stage or job runs

#### Scenario: Overlay builds
- **WHEN** the GitOps layer is scaffolded and `kubectl` or `kustomize` is installed
- **THEN** `check --deep` builds every overlay without errors

#### Scenario: Bootstrap ordering
- **WHEN** the bootstrap boolean and the AKS stack boolean are both true
- **THEN** the bootstrap stage or job runs after the AKS stack and after every app stack selected in the same run

### Requirement: Terraform-to-overlay bridge
The `bridge` command SHALL read a `terraform output -json` file for one stack and instance, write the outputs mapped in the manifest into the matching Kustomize overlay, change no other line, and refuse outputs marked sensitive.

#### Scenario: Outputs written
- **WHEN** `bridge` runs with outputs `postgres_fqdn` and `app_client_id` mapped to `DB_HOST` and the ServiceAccount client-id annotation
- **THEN** the overlay holds those values and no placeholder remains

#### Scenario: Sensitive output
- **WHEN** a mapped output has `"sensitive": true`
- **THEN** `bridge` fails, names the output, and writes nothing

#### Scenario: Open a pull request on GitHub
- **WHEN** `bridge --open-pr` runs, the overlay changed and `origin` is a GitHub remote
- **THEN** it commits only the overlay on a `bridge/<stack>-<env>-<instance>-<hash>` branch, pushes it and opens a pull request with `gh pr create`, and does not merge it

#### Scenario: Open a pull request on Azure Repos
- **WHEN** `bridge --open-pr` runs and `origin` is an Azure Repos remote
- **THEN** it opens the pull request with `az repos pr create` in the same way

#### Scenario: Nothing changed or PR already open
- **WHEN** the overlay already holds the outputs, or an open pull request exists for the same branch
- **THEN** `bridge --open-pr` opens no new pull request and prints the existing one, if any

#### Scenario: CLI not logged in
- **WHEN** `gh` or `az` is missing or not authenticated
- **THEN** `bridge` keeps the overlay change on disk, prints the command to log in, and exits with a non-zero code without storing any token

### Requirement: Architecture diagram
The `diagram` command SHALL write an editable draw.io file per selected environment and instance, derived only from the manifest. The diagram SHALL show one container per subscription, the VNet and one container per subnet, every resource of the profile with an official Azure icon from a closed icon map, its derived name and a label with its owning stack, Private Endpoints with an edge to their target, the Private DNS zones (local in `standalone`, central in `alz`), the Argo CD flow when GitOps is enabled, the pipeline agents, and a legend of the roles present. The XML SHALL contain the reserved cells `0` and `1`, stable ids, `html=1` labels, edges in expanded form with orthogonal style, and coordinates on a 10 px grid. Colors and fonts SHALL come from `diagram.theme` (`default`, `dark` or custom tokens that pass WCAG contrast). When the draw.io desktop CLI is installed, `--export` SHALL also write SVG and PNG; otherwise the command SHALL write the `.drawio` file, list the skipped exports and exit with code 0.

#### Scenario: Diagram from the articles' manifest
- **WHEN** `diagram --env prod --instance brs-01` runs on the full fixture in `standalone` mode
- **THEN** `docs/architecture/prod-brs-01.drawio` shows the subscription, `vnet-core-prod-brs-01` with its four subnets, `aks-core-prod-brs-01`, `crcoreprodbrs01`, `pgsql-orders-prod-brs-01`, `kv-orders-prod-brs-01`, two Private Endpoints, three Private DNS zones and the Argo CD flow, and every resource carries the label of its stack

#### Scenario: ALZ mode
- **WHEN** the manifest has `landingZone.mode: alz`
- **THEN** the hub and the central Private DNS zones appear in a separate connectivity subscription container marked as external, and no `privatelink.*` zone appears inside the workload subscription

#### Scenario: Deterministic output
- **WHEN** `diagram` runs twice on the same manifest
- **THEN** both files are byte-for-byte identical

#### Scenario: Manual edits preserved
- **WHEN** the `.drawio` file was edited after generation and `diagram` runs again without `--force`
- **THEN** the file is not changed and the command reports that it was edited

#### Scenario: Export without draw.io
- **WHEN** `diagram --export svg,png` runs and no draw.io binary is found
- **THEN** the `.drawio` file is written, the report lists SVG and PNG as skipped with the install hint, and the exit code is 0

#### Scenario: Structural check
- **WHEN** `check-diagram` runs on a file with an edge whose target id does not exist, an unknown icon or two overlapping sibling shapes
- **THEN** it fails and names each problem with the cell id

### Requirement: Repository check
The `check` command SHALL check an existing repository against the rules listed in the design (state key, partial backend, naming, pipeline parameters and dependencies versus the manifest, production guardrails, OIDC, Workload Identity subject, Argo CD sync, finalizer, pinned version, unresolved overlay placeholders, GitHub input limit, landing zone DNS rules). Each finding SHALL show the rule id, the file and line when known, and the reference to read. With `--deep`, it SHALL also run `terraform fmt -check`, `terraform validate`, `actionlint` and `kubectl kustomize` when those tools are installed, and list the ones it skipped. With `--json`, it SHALL print the findings as JSON.

#### Scenario: Clean repository
- **WHEN** `check` runs on a freshly scaffolded repository
- **THEN** it reports no findings and exits with code 0

#### Scenario: Drifted state key
- **WHEN** a stack's pipeline passes `key=aks.tfstate`
- **THEN** `check` reports `state-key` with the file, the found key and the expected `aks-core-<env>-<instance>.tfstate`

#### Scenario: Missing tools
- **WHEN** `check --deep` runs without `terraform` on `PATH`
- **THEN** the report lists the Terraform checks as skipped, and the exit code reflects only the checks that ran

### Requirement: Agent workflow
`SKILL.md` SHALL instruct the agent to: detect an existing `infra/` and run `check` before proposing changes; interview the user for CI platform, environments and their subscriptions, regions and instances, naming pattern (proposing the articles' default), landing zone mode and its hub data, stacks and owners, profile, GitOps and the bridge step; write the manifest and run `check-manifest`; show the `plan` output and get confirmation before writing; run `scaffold` (or `add-stack`) and then `check --deep`; offer to generate the architecture diagram and, when an export is available, review the draft PNG at most twice before showing it; and end with the list of manual prerequisites (state storage, federated identities per environment, Environments and approvals, self-hosted agents inside the VNet for private resources, Argo CD repository credentials when the repository is private). The skill's `description` SHALL say that it applies to Terraform on Azure with Azure DevOps or GitHub Actions.

#### Scenario: New repository
- **WHEN** a user asks to set up Terraform stacks with a parameterized pipeline in a repository without `infra/`
- **THEN** the agent interviews, shows the manifest and the file plan, writes only after confirmation, runs `check --deep`, and lists the manual prerequisites

#### Scenario: Existing repository
- **WHEN** the repository already has `infra/stacks.yaml`
- **THEN** the agent runs `check` first and offers `add-stack` or fixes, and does not run `scaffold` over the existing files without `--force` and the user's confirmation
