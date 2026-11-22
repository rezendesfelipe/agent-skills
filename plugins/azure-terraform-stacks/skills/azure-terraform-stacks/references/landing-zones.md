# Landing zone modes

## `standalone` (default)

The articles' design: the `vnet` stack creates the VNet, subnets, NSGs and the Private DNS zones (`privatelink.azurecr.io`, `privatelink.vaultcore.azure.net`, `<env>-<instance>.postgres.database.azure.com`) and links them to its VNet. Private Endpoints carry a DNS zone group. AKS manages its own private DNS zone.

## `alz` (Azure Landing Zone)

For a spoke in an [Azure Landing Zone](https://learn.microsoft.com/azure/cloud-adoption-framework/ready/landing-zone/) with a hub in a connectivity subscription and central Private DNS zones ([Private Link and DNS at scale](https://learn.microsoft.com/azure/cloud-adoption-framework/ready/azure-best-practices/private-link-and-dns-integration-at-scale)).

```yaml
landingZone:
  mode: alz
  hubVnetId: /subscriptions/<connectivity>/resourceGroups/<rg>/providers/Microsoft.Network/virtualNetworks/<hub>
  dnsServers: [10.0.0.4]      # the hub's resolver
  peering: managed            # the vnet stack creates the spoke-to-hub side; "external" if the platform team does it
  dnsByPolicy: true           # ALZ DeployIfNotExists policies create the Private Endpoint DNS records
  privateDnsZoneIds:
    acr: /subscriptions/.../privateDnsZones/privatelink.azurecr.io
    keyVault: /subscriptions/.../privateDnsZones/privatelink.vaultcore.azure.net
    aks: /subscriptions/.../privateDnsZones/privatelink.<region>.azmk8s.io
    postgres: /subscriptions/.../privateDnsZones/<name>.postgres.database.azure.com
```

What changes:

- The `vnet` stack creates the spoke VNet with the hub's DNS servers and, with `peering: managed`, the spoke-to-hub peering. The hub-to-spoke side stays with the platform team. It creates **no** `privatelink.*` zone (rule `lz-no-local-privatelink-zone`).
- Stacks receive the central zone IDs from their tfvars (generated from the manifest). They need no data source or provider alias for the connectivity subscription; the identity running Terraform needs read access to the zones and, for AKS, the role assignment on the AKS zone.
- With `dnsByPolicy: true`, Private Endpoints are created **without** a DNS zone group and Terraform ignores changes to it, so it does not fight the policy (rule `lz-dns-zone-group`). With `false`, Terraform manages the zone group with the central zone ID.
- AKS gets `private_dns_zone_id` (the central `privatelink.<region>.azmk8s.io` zone) and a user-assigned identity with `Private DNS Zone Contributor` on that zone and `Network Contributor` on the subnet, both assigned before the cluster.
- The PostgreSQL zone must be linked to the hub VNet by the platform team.

Out of scope: building the hub (Firewall, DNS Private Resolver, Azure Policy assignments) and routing egress through the hub firewall (`outbound_type = "userDefinedRouting"` with a route table is a variable, not generated).
