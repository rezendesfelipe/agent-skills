# Stacks, modules and state

- **Module** is the *how*: a reusable recipe in `infra/modules/<name>`, without backend or state.
- **Stack** is the *what and where*: a Terraform root in `infra/stacks/<type>-<owner>` that calls modules, has its own backend and is what the pipeline runs.
- **Instance** (environment, region, sequence) is data: a tfvars file per stack (`infra/envs/<stack>/<env>-<instance>.tfvars`) and a different state key.

Split by lifecycle and owner, not by size or resource type. HashiCorp's [workspace best practices](https://developer.hashicorp.com/terraform/cloud-docs/workspaces/best-practices) recommend keeping the blast radius small: group by volatility, separate stateful from stateless, and split by responsibility and privileges. The [state refactoring guide](https://developer.hashicorp.com/terraform/language/state/refactor) says resources with different cadences should be managed separately.

## Backend

Each stack declares an empty `backend "azurerm" {}` (partial configuration). `infra/scripts/tf.sh` passes the state subscription, resource group, storage account, container and key at `terraform init`, with `use_azuread_auth=true`. The [azurerm backend](https://developer.hashicorp.com/terraform/language/backend/azurerm) marks access keys as not recommended and suggests `Storage Blob Data Contributor` on the container. Rule `backend-partial` fails when the block has inline values.

## State keys

The key is the stack name rendered with the naming pattern, plus `.tfstate`: `vnet-core-prod-brs-01.tfstate`. Whoever opens the container sees what each blob holds. `tf.sh` has a table with every key for every stack, environment and instance, generated from the manifest. Rule `state-key` compares it, and any literal `key=...tfstate` in pipelines or scripts, with the manifest.

## Versions

Terraform `>= 1.12` because OIDC for the backend on Azure DevOps is documented from 1.12 (the backend docs before 1.12 do not mention Azure DevOps). `azurerm >= 4.65` because `rbac_authorization_enabled` (Key Vault) arrived in 4.42 and `user_assigned_identity_id` (federated identity credential, replacing the deprecated `parent_id`) in 4.65. Rule `versions` checks both lower bounds. Pipelines install a pinned Terraform (`terraform.version`).

## Cross-stack reads

By default a stack reads other stacks' resources with provider data sources (`azurerm_subnet`, `azurerm_private_dns_zone`, `azurerm_kubernetes_cluster`), found by name thanks to the naming convention: weak coupling and no access to another stack's state. With `remoteState: true`, the stack reads the other stacks' outputs through `terraform_remote_state` instead (it then needs read access to their state). HashiCorp recommends exposing only the outputs you need when sharing state.

Every resource group a stack or script reads must be created by a stack (rule `rg-owned`). Each stack creates its own resource group.

## Execution order

Dependencies become pipeline order: stages and jobs wait for every stack they depend on, directly or not, when those stacks are selected in the same run. Creation runs `vnet` → `aks` → `app`; a destroy would be the reverse, which is why the pipelines never offer it in production.
