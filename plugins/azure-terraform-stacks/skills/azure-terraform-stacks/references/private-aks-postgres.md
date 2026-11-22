# Private AKS and PostgreSQL profile

One application in AKS with a dedicated PostgreSQL server, everything on a private network. Source: Parte 2 of the series ([AKS e PostgreSQL em rede privada](https://www.rezendesfelipe.com/blog/pt-br/2026-11-22/aks-postgresql-rede-privada-terraform-argocd/)), with the fixes of its code review.

| Stack | Resources | Modules |
|---|---|---|
| `vnet-<owner>` | Resource group, VNet, four subnets (aks, endpoints, postgres delegated, agents), one NSG per subnet, Private DNS zones linked to the VNet (standalone) or peering to the hub (alz) | `network` |
| `aks-<owner>` | Resource group, private AKS, Premium ACR with public access off and its Private Endpoint | `aks`, `acr`, `private-endpoint` |
| `app-<owner>` | Resource group, PostgreSQL flexible server (private access), Key Vault (RBAC) and its Private Endpoint, the app's user-assigned identity federated with its service account | `postgresql`, `key-vault`, `private-endpoint`, `workload-identity` |
| outside Terraform | Argo CD and the app's pods | `infra/argocd`, bootstrap script |

Decisions and the documentation behind them:

- **Private AKS**: `private_cluster_enabled` gives the API an internal IP reached through Private Link ([private clusters](https://learn.microsoft.com/azure/aks/private-clusters)). `oidc_issuer_enabled` and `workload_identity_enabled` for Workload ID. Azure CNI overlay. `outbound_type` is a variable: egress (firewall or NAT) is a separate decision.
- **AKS identity**: the cluster uses a subnet outside its resource group, so its identity needs `Network Contributor` on the subnet ([AKS managed identity](https://learn.microsoft.com/azure/aks/system-assigned-managed-identity)). With a custom private DNS zone (alz mode), a user-assigned identity gets `Private DNS Zone Contributor` and `Network Contributor` before the cluster is created.
- **PostgreSQL private access**: delegated subnet of at least `/28`, a Private DNS zone ending in `postgres.database.azure.com` linked to the VNet, and `public_network_access_enabled = false` ([private access](https://learn.microsoft.com/azure/postgresql/network/concepts-networking-private)). Entra ID authentication only. The server is dedicated to the app: blast radius, privilege and sizing per app, at the cost of more servers.
- **ACR and Key Vault through Private Endpoints**: ACR Private Link needs Premium ([ACR private link](https://learn.microsoft.com/azure/container-registry/container-registry-private-link)); Key Vault the same mechanism ([Key Vault private link](https://learn.microsoft.com/azure/key-vault/general/private-link-service)); zones and subresources (`registry`, `vault`) per the [DNS zone table](https://learn.microsoft.com/azure/private-link/private-endpoint-dns).
- **NSGs**: one per subnet with Azure's default rules only. AKS does not create or change NSGs on a subnet you bring ([AKS NSGs](https://learn.microsoft.com/azure/aks/concepts-network#network-security-groups)); PostgreSQL needs 5432 inside its subnet and outbound to `Storage` if you deny traffic; the endpoints subnet enables `private_endpoint_network_policies = "NetworkSecurityGroupEnabled"` so the NSG applies to Private Endpoints ([network policies](https://learn.microsoft.com/azure/private-link/disable-private-endpoint-network-policy)).
- **Workload Identity**: subject `system:serviceaccount:<namespace>:<service account>`, the `azure.workload.identity/client-id` annotation on the ServiceAccount and the `azure.workload.identity/use: "true"` label on the pods ([Workload ID](https://learn.microsoft.com/azure/aks/workload-identity-deploy-cluster)). The identity gets `Key Vault Secrets User`. No secret goes to Git.
- **Self-hosted agents in the VNet**: the pipeline must reach the private API (bootstrap), ACR and, if closed, the state account ([access a private cluster](https://learn.microsoft.com/azure/aks/access-private-cluster)). The agents are outside the stacks (the `agents` subnet is created for them).

Default CIDRs (`10.10.0.0/16`, `/22` for AKS, `/27` for endpoints, `/28` for PostgreSQL, `/27` for agents) are in each environment's tfvars: change them before peering environments or connecting to a hub.

Out of scope: egress design, Argo CD repository credentials, ApplicationSets, Helm charts.
