# Private Endpoint. With a zone ID, Terraform manages the DNS zone group.
# With dns_by_policy (Azure Landing Zone DeployIfNotExists policies), the zone group is
# left to Azure Policy and Terraform ignores it, so the two do not fight.
resource "azurerm_private_endpoint" "managed_dns" {
  count               = var.dns_by_policy ? 0 : 1
  name                = var.name
  location            = var.location
  resource_group_name = var.resource_group_name
  subnet_id           = var.subnet_id
  tags                = var.tags

  private_service_connection {
    name                           = var.name
    private_connection_resource_id = var.target_resource_id
    subresource_names              = [var.subresource_name]
    is_manual_connection           = false
  }

  private_dns_zone_group {
    name                 = "default"
    private_dns_zone_ids = [var.private_dns_zone_id]
  }
}

resource "azurerm_private_endpoint" "policy_dns" {
  count               = var.dns_by_policy ? 1 : 0
  name                = var.name
  location            = var.location
  resource_group_name = var.resource_group_name
  subnet_id           = var.subnet_id
  tags                = var.tags

  private_service_connection {
    name                           = var.name
    private_connection_resource_id = var.target_resource_id
    subresource_names              = [var.subresource_name]
    is_manual_connection           = false
  }

  lifecycle {
    ignore_changes = [private_dns_zone_group]
  }
}
