# Manifest format (`infra/stacks.yaml`)

The manifest is the single source of truth: every generated file comes from it. Change the manifest, then `plan` and `scaffold`, instead of editing generated files by hand. `schema/stacks.schema.json` gives editors autocomplete when the manifest starts with `# yaml-language-server: $schema=<path to schema>`.

## Fields

| Field | Required | Content |
|---|---|---|
| `version` | yes | `1` |
| `regions` | yes | Map of Azure region name to a short code you choose: `{ brazilsouth: brs }` |
| `environments` | yes | Map of environment name to `{ subscriptionId }`. One subscription per environment; two environments with the same ID fail |
| `instances` | yes | List of `<region code>-<seq>`, e.g. `[brs-01]`. Every code must be in `regions` |
| `naming` | no | `{ pattern, separator, abbreviations }`. Default `{type}-{name}-{env}-{region}-{seq}`, `-`, CAF abbreviations (see `naming.md`) |
| `ci` | yes | Subset of `[azure-devops, github-actions]` |
| `profile` | no | `none` (default) or `private-aks-postgres` |
| `landingZone` | no | `{ mode: standalone }` (default) or `alz` with `hubVnetId`, `privateDnsZoneIds` (`acr`, `keyVault`, `aks`, `postgres`), `dnsServers`, `dnsByPolicy` (default `true`), `peering` (`managed` default, or `external`). See `landing-zones.md` |
| `state` | yes | `{ subscriptionId, resourceGroup, storageAccount, container }` of the state storage, ideally in its own subscription |
| `terraform` | no | `{ version, requiredVersion, azurerm }`. Defaults `1.12.2`, `>= 1.12, < 2.0`, `>= 4.65, < 5.0` |
| `pipelines` | no | `azureDevOps: { pool, serviceConnection, bootstrapServiceConnection, environment }` (`{env}` is replaced) and `githubActions: { runsOn }` |
| `stacks` | yes | List of `{ name, type, owner, modules?, dependsOn?, remoteState? }`. `name` is `<type>-<owner>` |
| `gitops` | no | `{ tool: argocd, argocdVersion, repoURL, targetRevision?, apps: [...] }` |
| `diagram` | no | `{ theme }`: `default`, `dark` or custom tokens (see `diagram.md`) |

`gitops.apps[]`: `{ name, stack, namespace?, serviceAccount?, image?, tag?, autoSync?, values? }`. `namespace`, `serviceAccount` and `image` default to `name`. `autoSync` is per environment, `true` except for `prod`. `values` maps overlay fields to Terraform outputs; in the profile it defaults to `{ DB_HOST: postgres_fqdn, clientId: app_client_id }` (`clientId` is the ServiceAccount's Workload Identity annotation; every other key becomes a ConfigMap literal).

## Profile `private-aks-postgres`

Needs exactly one stack of type `vnet`, one of type `aks` and at least one of type `app`. Modules default by type: `vnet` → `network`; `aks` → `aks`, `acr`, `private-endpoint`; `app` → `postgresql`, `key-vault`, `private-endpoint`, `workload-identity`. `check-manifest` warns when an `app` stack does not depend on the `vnet` and `aks` stacks.

## Full example

```yaml
version: 1
regions:
  brazilsouth: brs
environments:
  dev: { subscriptionId: 00000000-0000-0000-0000-000000000001 }
  hml: { subscriptionId: 00000000-0000-0000-0000-000000000002 }
  prod: { subscriptionId: 00000000-0000-0000-0000-000000000003 }
instances: [brs-01]
ci: [azure-devops, github-actions]
profile: private-aks-postgres
state:
  subscriptionId: 00000000-0000-0000-0000-0000000000ff
  resourceGroup: rg-tfstate
  storageAccount: sttfstatecorp001
  container: tfstate
stacks:
  - { name: vnet-core, type: vnet, owner: core }
  - { name: aks-core, type: aks, owner: core, dependsOn: [vnet-core] }
  - { name: app-orders, type: app, owner: orders, dependsOn: [vnet-core, aks-core] }
gitops:
  tool: argocd
  argocdVersion: v3.6.2
  repoURL: https://github.com/example/platform.git
  apps:
    - { name: orders, stack: app-orders, tag: "1.8.3" }
```

## Regenerating

`check` reports `drift` when a generated file differs from what the manifest produces. Either move the change into the manifest (preferred), or keep the local change and accept the warning. Overlays are excluded, because `bridge` writes into them.
