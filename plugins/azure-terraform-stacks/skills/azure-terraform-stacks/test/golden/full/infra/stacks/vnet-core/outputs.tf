output "vnet_id" {
  value = module.network.vnet_id
}

# Keyed by subnet name, for stacks that read this one through terraform_remote_state.
output "subnet_ids" {
  value = module.network.subnet_ids
}

output "private_dns_zone_ids" {
  value = module.network.private_dns_zone_ids
}
