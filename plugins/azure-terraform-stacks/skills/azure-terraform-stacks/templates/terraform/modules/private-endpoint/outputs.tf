output "id" {
  value = one(concat(azurerm_private_endpoint.managed_dns[*].id, azurerm_private_endpoint.policy_dns[*].id))
}
