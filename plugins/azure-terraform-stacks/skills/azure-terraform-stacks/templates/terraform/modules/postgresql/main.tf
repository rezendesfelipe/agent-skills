data "azurerm_client_config" "current" {}

# PostgreSQL Flexible Server with private access (VNet integration): delegated subnet,
# Private DNS zone, public access off, Microsoft Entra authentication only.
resource "azurerm_postgresql_flexible_server" "this" {
  name                = var.name
  location            = var.location
  resource_group_name = var.resource_group_name
  version             = var.postgres_version

  delegated_subnet_id           = var.delegated_subnet_id
  private_dns_zone_id           = var.private_dns_zone_id
  public_network_access_enabled = false

  sku_name   = var.sku_name
  storage_mb = var.storage_mb
  zone       = var.zone

  authentication {
    active_directory_auth_enabled = true
    password_auth_enabled         = false
    tenant_id                     = data.azurerm_client_config.current.tenant_id
  }

  backup_retention_days = var.backup_retention_days
  tags                  = var.tags
}
