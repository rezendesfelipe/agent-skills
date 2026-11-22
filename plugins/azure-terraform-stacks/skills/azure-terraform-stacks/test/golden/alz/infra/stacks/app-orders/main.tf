locals {
  region_code = split("-", var.instance)[0]
  seq         = split("-", var.instance)[1]
}

data "azurerm_subnet" "postgres" {
  name                 = "snet-postgres-${var.environment}-${local.region_code}-${local.seq}"
  virtual_network_name = "vnet-core-${var.environment}-${local.region_code}-${local.seq}"
  resource_group_name  = "rg-vnet-core-${var.environment}-${local.region_code}-${local.seq}"
}

data "azurerm_subnet" "endpoints" {
  name                 = "snet-endpoints-${var.environment}-${local.region_code}-${local.seq}"
  virtual_network_name = "vnet-core-${var.environment}-${local.region_code}-${local.seq}"
  resource_group_name  = "rg-vnet-core-${var.environment}-${local.region_code}-${local.seq}"
}

data "azurerm_kubernetes_cluster" "this" {
  name                = "aks-core-${var.environment}-${local.region_code}-${local.seq}"
  resource_group_name = "rg-aks-core-${var.environment}-${local.region_code}-${local.seq}"
}

resource "azurerm_resource_group" "this" {
  name     = "rg-app-orders-${var.environment}-${local.region_code}-${local.seq}"
  location = var.location
}

# Database dedicated to the orders application
module "postgresql" {
  source = "../../modules/postgresql"

  name                = "pgsql-orders-${var.environment}-${local.region_code}-${local.seq}"
  location            = var.location
  resource_group_name = azurerm_resource_group.this.name
  delegated_subnet_id = data.azurerm_subnet.postgres.id
  private_dns_zone_id = var.postgres_dns_zone_id
  sku_name            = var.postgres_sku_name
  storage_mb          = var.postgres_storage_mb
}

module "key_vault" {
  source = "../../modules/key-vault"

  name                = "kv-orders-${var.environment}-${local.region_code}-${local.seq}"
  location            = var.location
  resource_group_name = azurerm_resource_group.this.name
}

module "key_vault_private_endpoint" {
  source = "../../modules/private-endpoint"

  name                = "pep-kv-orders-${var.environment}-${local.region_code}-${local.seq}"
  location            = var.location
  resource_group_name = azurerm_resource_group.this.name
  subnet_id           = data.azurerm_subnet.endpoints.id
  target_resource_id  = module.key_vault.id
  subresource_name    = "vault"
  private_dns_zone_id = var.key_vault_dns_zone_id
  dns_by_policy       = true
}

# The subject must match the Argo CD Application: namespace orders, service account orders.
module "workload_identity" {
  source = "../../modules/workload-identity"

  name                 = "id-orders-${var.environment}-${local.region_code}-${local.seq}"
  location             = var.location
  resource_group_name  = azurerm_resource_group.this.name
  oidc_issuer_url      = data.azurerm_kubernetes_cluster.this.oidc_issuer_url
  namespace            = "orders"
  service_account_name = "orders"
  key_vault_id         = module.key_vault.id
}
