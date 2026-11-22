locals {
  region_code = split("-", var.instance)[0]
  seq         = split("-", var.instance)[1]
}

data "azurerm_subnet" "aks" {
  name                 = "snet-aks-${var.environment}-${local.region_code}-${local.seq}"
  virtual_network_name = "vnet-core-${var.environment}-${local.region_code}-${local.seq}"
  resource_group_name  = "rg-vnet-core-${var.environment}-${local.region_code}-${local.seq}"
}

data "azurerm_subnet" "endpoints" {
  name                 = "snet-endpoints-${var.environment}-${local.region_code}-${local.seq}"
  virtual_network_name = "vnet-core-${var.environment}-${local.region_code}-${local.seq}"
  resource_group_name  = "rg-vnet-core-${var.environment}-${local.region_code}-${local.seq}"
}

resource "azurerm_resource_group" "this" {
  name     = "rg-aks-core-${var.environment}-${local.region_code}-${local.seq}"
  location = var.location
}

module "acr" {
  source = "../../modules/acr"

  name                = "crcore${var.environment}${local.region_code}${local.seq}"
  location            = var.location
  resource_group_name = azurerm_resource_group.this.name
}

module "acr_private_endpoint" {
  source = "../../modules/private-endpoint"

  name                = "pep-cr-core-${var.environment}-${local.region_code}-${local.seq}"
  location            = var.location
  resource_group_name = azurerm_resource_group.this.name
  subnet_id           = data.azurerm_subnet.endpoints.id
  target_resource_id  = module.acr.id
  subresource_name    = "registry"
  private_dns_zone_id = var.acr_dns_zone_id
  dns_by_policy       = true
}

module "aks" {
  source = "../../modules/aks"

  name                = "aks-core-${var.environment}-${local.region_code}-${local.seq}"
  location            = var.location
  resource_group_name = azurerm_resource_group.this.name
  subnet_id           = data.azurerm_subnet.aks.id
  acr_id              = module.acr.id
  vm_size             = var.vm_size
  node_count          = var.node_count
  outbound_type       = var.outbound_type
  private_dns_zone_id = var.aks_dns_zone_id
}
