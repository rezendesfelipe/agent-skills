# vnet-core for prod-brs-01 (generated from infra/stacks.yaml; edit values, not keys)
location      = "brazilsouth"
address_space = ["10.10.0.0/16"]
subnet_cidrs = {
  aks       = "10.10.0.0/22"
  endpoints = "10.10.4.0/27"
  postgres  = "10.10.4.32/28"
  agents    = "10.10.4.64/27"
}
dns_servers = ["10.0.0.4"]
hub_vnet_id = "/subscriptions/00000000-0000-0000-0000-0000000000aa/resourceGroups/rg-hub/providers/Microsoft.Network/virtualNetworks/vnet-hub"
