---
name: azure-terraform-stacks
description: Sets up and checks Terraform on Azure as independent stacks (one tfstate per stack and instance) driven by one parameterized Azure DevOps or GitHub Actions pipeline, with an optional private AKS + PostgreSQL reference architecture (standalone or Azure Landing Zone), Argo CD delivery, a Terraform-to-Kustomize bridge and an editable draw.io architecture diagram. Use when the user wants to split Terraform into stacks, choose which stacks a pipeline runs, scaffold or review an Azure IaC repository with Azure DevOps or GitHub Actions, add a stack, check state keys, naming or pipeline guardrails, bridge Terraform outputs into GitOps manifests, or draw the architecture.
---

# Azure Terraform stacks

Generates and checks a repository where Terraform on Azure is split into stacks (one state per stack and instance), one pipeline chooses which stacks run, where and with which action, and applications reach a private AKS cluster through Argo CD. Everything is derived from one manifest, `infra/stacks.yaml`. You write the manifest and talk to the user; the engine in `scripts/` writes the files and runs the checks.

Paths below are relative to this skill's folder (the folder that holds this file). Run the engine from the user's repository root, or pass `--root <repo>`.

## When to use

- The user wants Terraform on Azure split into stacks with a parameterized pipeline (Azure DevOps runtime parameters or GitHub Actions `workflow_dispatch`).
- The user wants the private AKS + PostgreSQL reference architecture, with or without an Azure Landing Zone.
- The user has such a repository and wants to add a stack, check it, bridge Terraform outputs into the Kustomize overlay, or draw the architecture.

## Hard rules

- **Never run `terraform apply`, `terraform destroy`, `kubectl apply` or anything that changes Azure, Azure DevOps, GitHub or a cluster.** Changes go through the generated pipeline with `action: apply`. If the user asks you to apply, say so and point to the pipeline run.
- **Never offer `destroy` when `prod` is an environment**, never store secrets in the manifest, pipelines or Git, and keep `plan` as the default action.
- **Ask before any write**: show the `plan` output first. Never use `--force` on `scaffold`, `add-stack` or `diagram` without the user's yes for the files listed.
- `bridge --open-pr` is the only outward action. Run it only after the user confirms; it never merges.

## Workflow

1. **Install the engine on first use.** If `node_modules/` does not exist in this skill's folder, run `npm ci --omit=dev` there. Node.js 20 or later is required.
2. **Look at the repository.** If `infra/stacks.yaml` exists, run `node scripts/stacks.mjs check` first and report the findings. Then offer `add-stack`, fixes in the manifest, or a regeneration. Do not run `scaffold` over existing files without `--force` and the user's confirmation.
3. **Interview the user** (one question tool call with several questions, or one short message). Ask only what the request does not already answer:
   - CI platform: Azure DevOps, GitHub Actions or both.
   - Environments and the subscription ID of each one (one subscription per environment), and the state storage (subscription, resource group, storage account, container).
   - Regions with a short code each (for example `brazilsouth: brs`) and instances (`brs-01`).
   - Naming: propose the default `{type}-{name}-{env}-{region}-{seq}` with Cloud Adoption Framework abbreviations, and accept their own order, separator or abbreviations.
   - Profile: `private-aks-postgres` (VNet, AKS, apps with PostgreSQL and Key Vault) or `none` (empty stacks for their own modules).
   - Landing zone: `standalone` (the network stack owns the Private DNS zones) or `alz` (spoke peered to an existing hub, central zones, DNS records by Azure Policy). For `alz`, ask for the hub VNet ID, the zone IDs, the hub's DNS servers, and who creates the peering.
   - Stacks and owners (`<type>-<owner>`, for example `app-orders`), GitOps apps, and whether a pipeline step should open the bridge pull request.

   **Never invent subscription IDs, hub IDs or zone IDs.** If the user does not have them yet, write clearly fake placeholders (`00000000-...`) and list them in the final report as values to replace.
4. **Write `infra/stacks.yaml`** following `references/manifest-format.md`, then run `node scripts/stacks.mjs check-manifest`. Fix every error and rerun. Show the user the manifest.
5. **Plan:** `node scripts/stacks.mjs plan`. Show the list (create / update / unchanged) and ask for confirmation.
6. **Write:** `node scripts/stacks.mjs scaffold` (or `add-stack --name <type-owner> --type <t> --owner <o> --depends-on a,b` for one new stack). If it refuses files that differ, show them and ask before `--force`.
7. **Check:** `node scripts/stacks.mjs check --deep`. It runs `terraform fmt` and `validate`, `actionlint`, `kustomize build` and `shellcheck` when they are installed and lists what it skipped. Report each as passed, failed or skipped. Overlays waiting for the bridge are listed as pending; that is expected before the first apply.
8. **Diagram** (offer it): `node scripts/stacks.mjs diagram [--env prod] [--instance brs-01] [--export svg,png]` writes `docs/architecture/<env>-<instance>.drawio`. If the user has a design system or brand, map it to `diagram.theme` tokens (see `references/diagram.md`). If an export is available, review a draft with `--draft` (one PNG, no embedded XML) at most twice, then show it. Run `check-diagram` on the file. Without the draw.io desktop app, deliver the `.drawio` file and say SVG and PNG were skipped.
9. **Report:** files written, checks passed, failed and skipped, and the **manual prerequisites**:
   - the state storage account (outside every stack, Entra ID auth, `Storage Blob Data Contributor`);
   - one federated identity per environment for Terraform, and a separate one for the Argo CD bootstrap (Azure DevOps service connections `sc-terraform-<env>` and `sc-aks-bootstrap-<env>`, or GitHub Environments with `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_BOOTSTRAP_CLIENT_ID`);
   - Environments with approvals (Azure DevOps `azure-<env>`, GitHub Environments named after the environments);
   - self-hosted agents or runners inside the VNet (the API, ACR and Key Vault are private);
   - Argo CD credentials for the Git repository when it is private;
   - every placeholder value still in the manifest.

## Bridge (after the first apply)

When the app stack has been applied, get its outputs (`terraform output -json > outputs.json` in `infra/stacks/<stack>`, or from the pipeline) and run:

```bash
node scripts/stacks.mjs bridge --stack app-orders --env prod --instance brs-01 --outputs outputs.json
```

It writes only the overlay lines marked `# bridge: <output>` and refuses outputs marked sensitive. With `--open-pr`, after the user agrees, it commits only the overlay on a `bridge/...` branch and opens a pull request with `gh` (GitHub) or `az repos` (Azure Repos), using the CLI's existing login. If the CLI is not logged in, it keeps the change on disk and prints the login command.

## Commands

| Command | Does |
|---|---|
| `check-manifest` | Validates `infra/stacks.yaml` |
| `plan` | Lists files as create / update / unchanged; writes nothing |
| `scaffold [--force]` | Writes the files; refuses files that differ unless `--force` |
| `add-stack ...` | Adds a stack to the manifest and writes only new files plus the pipelines and scripts |
| `check [--deep]` | Rules from `references/traps.md`; `--deep` also runs the external tools |
| `bridge ...` | Terraform outputs into the overlay; `--open-pr` opens a pull request |
| `diagram ...` | Writes the draw.io diagram; protects manual edits unless `--force` |
| `check-diagram <file>` | Structural check of a diagram |

Every command accepts `--root <repo>` and `--json`. Exit codes: 0 success, 1 validation or check failure, 2 usage error.

## References

- `references/manifest-format.md`: every manifest field, defaults and a full example.
- `references/naming.md`: the naming pattern, abbreviations and the resource name rules.
- `references/stacks-and-state.md`: stacks, modules and instances, the backend, state keys and cross-stack reads.
- `references/pipelines-azure-devops.md` and `references/pipelines-github-actions.md`: how the pipelines are built and why.
- `references/private-aks-postgres.md`: the reference architecture and the documentation behind each decision.
- `references/landing-zones.md`: `standalone` versus `alz`.
- `references/gitops-argocd.md`: layout, sync policy, finalizer, bootstrap and bridge.
- `references/traps.md`: each trap from the source articles and the review, with the `check` rule that catches it.
- `references/diagram.md`: diagram content, XML rules, theme, export and review loop.

## Examples

**Input:** "Split our Terraform into network, cluster and orders stacks, with a pipeline in Azure DevOps where I choose what to run."
**Output:** after the interview, `infra/stacks.yaml` with three stacks and `ci: [azure-devops]`, the plan shown and confirmed, about 50 files scaffolded, `check --deep` results, and the prerequisites list.

**Input:** "Check our infra repo against the stacks pattern."
**Output:** `check` findings, each with rule, file, line and the reference to read, plus suggested manifest changes.
