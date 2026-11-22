# aks-core for prod-brs-01 (generated from infra/stacks.yaml; edit values, not keys)
location        = "brazilsouth"
vm_size         = "Standard_D4ds_v5"
node_count      = 3
outbound_type   = "loadBalancer" # egress is a separate decision
acr_dns_zone_id = "/subscriptions/00000000-0000-0000-0000-0000000000aa/resourceGroups/rg-dns/providers/Microsoft.Network/privateDnsZones/privatelink.azurecr.io"
aks_dns_zone_id = "/subscriptions/00000000-0000-0000-0000-0000000000aa/resourceGroups/rg-dns/providers/Microsoft.Network/privateDnsZones/privatelink.brazilsouth.azmk8s.io"
