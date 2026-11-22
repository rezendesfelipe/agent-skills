# GitOps with Argo CD

Argo CD runs in the cluster and reconciles it with Git ([overview](https://argo-cd.readthedocs.io/en/stable/)). The pipeline only installs it once per cluster; after that, a deploy is a pull request.

```text
infra/argocd/
├── bootstrap/root-<env>-<instance>.yaml       # root Application (app of apps), applied by the bootstrap
├── apps/<env>-<instance>/<app>.yaml           # one Application per app and instance
└── manifests/<app>/
    ├── base/                                  # kustomization, ServiceAccount, Deployment, Service
    └── overlays/<env>-<instance>/kustomization.yaml
```

The root follows the app-of-apps pattern ([cluster bootstrapping](https://argo-cd.readthedocs.io/en/stable/operator-manual/cluster-bootstrapping/)). The same page warns that app of apps is an admin capability: only admins should push to the parent Application's path, with reviewed pull requests. Protect `infra/argocd/apps` with a branch policy.

## Sync policy

The root has `automated: {}`. App Applications sync automatically except in `prod` (`autoSync` per environment in the manifest): in production the merge updates Git and the sync is manual. Automated sync does not prune by default ([auto sync](https://argo-cd.readthedocs.io/en/stable/user-guide/auto_sync/)). `CreateNamespace=true` creates the destination namespace ([sync options](https://argo-cd.readthedocs.io/en/stable/user-guide/sync-options/)). Rule `argocd-prod-sync`.

## Finalizer

Every Application has `resources-finalizer.argocd.argoproj.io`, so deleting the Application deletes what it manages; without it, it does not ([declarative setup](https://argo-cd.readthedocs.io/en/stable/operator-manual/declarative-setup/)). Decide this on purpose, mostly in production. Rule `argocd-finalizer`.

## Workload identity

The federated credential's subject (`system:serviceaccount:<namespace>:<serviceAccount>`) must match the Application's destination namespace and the ServiceAccount's name. The generator takes both from the same manifest fields; rule `wi-subject` catches a later edit on either side.

## Bootstrap

`infra/scripts/bootstrap-argocd.sh <env> <instance>` gets the cluster credentials (`az aks get-credentials`, which needs network and DNS access to the private API, hence a self-hosted agent), installs Argo CD with `kubectl apply --server-side --force-conflicts` and a pinned version ([getting started](https://argo-cd.readthedocs.io/en/stable/getting_started/)), and applies the root Application. It runs only when `action` is `apply` (rule `argocd-apply-only`) and uses its own identity, separate from Terraform's. Rule `argocd-pinned` fails on `stable`/`latest` and warns when the version is older than the one the skill was tested with. If the Git repository is private, Argo CD needs credentials ([private repositories](https://argo-cd.readthedocs.io/en/stable/user-guide/private-repositories/)); the skill does not create them.

## Bridge

Two overlay values come from Terraform: `postgres_fqdn` and `app_client_id`, outputs of the app stack. Overlay lines marked `# bridge: <output>` hold placeholders until `stacks.mjs bridge` writes the outputs (listed by `check` as pending, not as errors). If someone recreates the database or the identity and forgets the bridge, Argo CD keeps syncing the old values, because for Argo CD Git is right. `bridge` refuses sensitive outputs: secrets are read from Key Vault through Workload Identity. With `--open-pr`, the change goes through a pull request, which is the deploy approval.
