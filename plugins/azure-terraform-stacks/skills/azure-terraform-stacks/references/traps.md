# Traps and the rules that catch them

From the two articles' "traps" sections and the 2026-11-22 code review (design Decision 15 of the OpenSpec change).

| Trap | What happens | Rule or guardrail |
|---|---|---|
| State key drifts from the naming | Two stacks share a blob, or nobody knows what a blob holds | `state-key` |
| Backend values inline | Different environments write the same state | `backend-partial` |
| Conditional `dependsOn` missing | Validation fails, or a stack runs before its dependency | `pipeline-deps` |
| <a id="destroy-in-production"></a>`destroy` offered with prod | One click removes the database | `no-prod-destroy`; never generated |
| <a id="who-can-click-run"></a>Triggered runs | A push runs with the defaults | `manual-trigger` (`trigger: none`, only `workflow_dispatch`) |
| <a id="partial-selection"></a>Partial selection on a stale base | Plan runs on an outdated dependency | `plan-default` (plan by default, booleans false); schedule a `plan` of everything to detect drift |
| Stored credentials | Secrets leak through logs and Git | `oidc` |
| Subject mismatch | The pod cannot read Key Vault | `wi-subject` |
| Auto-sync in prod | Merges deploy without the manual sync step | `argocd-prod-sync` |
| No finalizer, or one you did not decide on | Deleting an Application leaves or removes resources unexpectedly | `argocd-finalizer` |
| Unpinned Argo CD | A run installs a different version | `argocd-pinned` |
| Bootstrap on a plan run | A "plan" changes the cluster | `argocd-apply-only` |
| Terraform outputs never reach Git | Pods start without a database host or client ID | `bridge-placeholders` (pending) and `bridge` |
| Too many inputs | The GitHub workflow is rejected | `gha-inputs`, `check-manifest` |
| <a id="resource-groups"></a>Data sources read a resource group no stack creates | `plan` fails on a missing resource group | `rg-owned` |
| Old Terraform or provider | Backend OIDC on Azure DevOps or new attributes missing | `versions` |
| ALZ: Terraform fights Azure Policy over DNS | Endless diff on the zone group | `lz-dns-zone-group` |
| ALZ: local privatelink zones in a spoke | Split-brain DNS | `lz-no-local-privatelink-zone` |
| Hand edits to generated files | The next regeneration loses them | `drift` (warning) |
| Private network closes the pipeline's door | Microsoft-hosted agents cannot reach ACR, the API or the state | Self-hosted agents in the VNet (prerequisite) |
| Splitting too much | Twenty states, twenty dependencies | Split by lifecycle and owner (manifest review) |
| Parameters are not a vault | Values expand in logs | No secrets in parameters; Key Vault and OIDC |
