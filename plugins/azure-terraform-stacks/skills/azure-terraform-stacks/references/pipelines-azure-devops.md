# Azure DevOps

Files: `infra/pipelines/azure-pipelines.yml` (orchestrator), `templates/terraform-stack.yml` and, with GitOps, `templates/argocd-bootstrap.yml`.

- **Runtime parameters** ([docs](https://learn.microsoft.com/azure/devops/pipelines/process/runtime-parameters)): `environment` and `instance` with closed `values`, `action` (`plan` default, `apply`), one boolean per stack (default `false`) and `argocd`.
- **Template expressions** ([docs](https://learn.microsoft.com/azure/devops/pipelines/process/template-expressions)): `${{ if }}` is resolved when the pipeline is compiled, so an unselected stage does not exist in the run (it is not "skipped").
- **`trigger: none` and `pr: none`**: a triggered run would use the defaults.
- **Nothing selected** inserts a stage that fails with a message.
- **Approvals** live on the Environment (`azure-<env>`), not in YAML ([docs](https://learn.microsoft.com/azure/devops/pipelines/process/approvals)).
- **Plan as artifact**: the plan job publishes the plan; the apply deployment job downloads it and applies exactly that file.
- **Authentication**: `AzureCLI@2` with a workload identity federation service connection per environment and `addSpnToEnvironment: true` exposes `servicePrincipalId` and `tenantId` ([AzureCLI@2](https://learn.microsoft.com/azure/devops/pipelines/tasks/reference/azure-cli-v2)). The tasks pass `SYSTEM_ACCESSTOKEN` and `SYSTEM_OIDCREQUESTURI` for the provider ([azurerm OIDC guide](https://registry.terraform.io/providers/hashicorp/azurerm/latest/docs/guides/service_principal_oidc)); `tf.sh` sets `ARM_ADO_PIPELINE_SERVICE_CONNECTION_ID` from `AZURESUBSCRIPTION_SERVICE_CONNECTION_ID`, which the backend docs (1.12+) say the AzureCLI task sets.
- **Subscription per environment**: `tf.sh` sets `ARM_SUBSCRIPTION_ID` from the manifest.
- **Pool**: self-hosted agents inside the VNet (`pipelines.azureDevOps.pool`), because the cluster API, ACR and Key Vault are private.

## Dependencies

Each stage's `dependsOn` lists every stack it depends on (directly or not), and each entry is inserted only when that stack is selected (`${{ if eq(parameters.vnetCore, true) }}`): depending on a stage that is not in the run fails validation. Inserting an array into an array flattens it, per the template-expressions docs. Rule `pipeline-deps` compares the YAML with the manifest. The Argo CD bootstrap stage is inserted only when `argocd` is true **and** `action` is `apply` (rule `argocd-apply-only`), after the cluster and the app stacks selected in the same run.

Not verified by the skill's tests on the service itself: the tests expand the templates with a minimal expander. Task 9.3 of the change runs the pipelines in a sandbox.
