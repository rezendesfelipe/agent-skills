# GitHub Actions

Files: `.github/workflows/infra.yml` (orchestrator), `terraform-stack.yml` (reusable) and, with GitOps, `argocd-bootstrap.yml` (reusable).

- **`workflow_dispatch` inputs** ([input types](https://github.blog/changelog/2021-11-10-github-actions-input-types-for-manual-workflows)): `environment` (type `environment`), `instance` and `action` (`choice`, `plan` default), one boolean per stack, `argocd`. At most 25 inputs ([changelog 2025-12-04](https://github.blog/changelog/2025-12-04-actions-workflow-dispatch-workflows-now-support-25-inputs/)); `check-manifest` counts them.
- **Run-time conditions**: unselected jobs appear as skipped. A job that needs a skipped job is skipped too, unless its `if` uses a status function ([workflow syntax](https://docs.github.com/actions/reference/workflows-and-actions/workflow-syntax)); `!cancelled() && !failure() && inputs.<stack>` means "run if nothing failed, even if a dependency was skipped". The `inputs` context keeps booleans as booleans.
- **Reusable workflows** are called at job level with `with`; the caller job cannot use `environment`, so the reusable job declares it ([reuse workflows](https://docs.github.com/actions/how-tos/reuse-automations/reuse-workflows)).
- **Plan and apply in the same job**: with required reviewers on the Environment, approval is asked before the plan. Use two Environments or split the job if that matters.
- **Nothing selected** runs a job that fails with a message.

## OIDC

`permissions: id-token: write` and `contents: read`. The Terraform job sets `ARM_CLIENT_ID` and `ARM_TENANT_ID` from the Environment's variables; `tf.sh` sets `ARM_SUBSCRIPTION_ID` from the manifest and `ARM_USE_OIDC=true`; the provider finds the GitHub token variables itself. The bootstrap uses `azure/login@v2` with its own identity (`AZURE_BOOTSTRAP_CLIENT_ID`) and the subscription from the manifest ([OIDC in Azure](https://docs.github.com/actions/how-tos/secure-your-work/security-harden-deployments/oidc-in-azure)).

With an Environment on the job, the token subject is `repo:ORG/REPO:environment:NAME`, so each environment needs its own federated credential. Repositories created after 2026-07-15 use, by default, an immutable subject with owner and repository IDs ([OIDC reference](https://docs.github.com/actions/reference/security/oidc)), and Microsoft recommends migrating name-based credentials ([immutable subjects](https://learn.microsoft.com/entra/workload-id/workload-identities-github-immutable-subjects)). Ask the user which format their repository uses; the skill does not create federated credentials. Rule `oidc` fails on stored secrets or a missing `id-token: write`.
