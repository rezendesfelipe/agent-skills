locals {
  region_code = split("-", var.instance)[0]
  seq         = split("-", var.instance)[1]
}

resource "azurerm_resource_group" "this" {
  name     = "rg-vnet-core-${var.environment}-${local.region_code}-${local.seq}"
  location = var.location
}

module "network" {
  source = "../../modules/network"

  name                = "vnet-core-${var.environment}-${local.region_code}-${local.seq}"
  location            = var.location
  resource_group_name = azurerm_resource_group.this.name
  address_space       = var.address_space
  dns_servers         = var.dns_servers
  hub_vnet_id         = var.hub_vnet_id

  subnets = {
    ("snet-aks-${var.environment}-${local.region_code}-${local.seq}") = {
      cidr     = var.subnet_cidrs["aks"]
      nsg_name = "nsg-aks-${var.environment}-${local.region_code}-${local.seq}"
    }
    ("snet-endpoints-${var.environment}-${local.region_code}-${local.seq}") = {
      cidr                              = var.subnet_cidrs["endpoints"]
      nsg_name                          = "nsg-endpoints-${var.environment}-${local.region_code}-${local.seq}"
      private_endpoint_network_policies = "NetworkSecurityGroupEnabled"
    }
    ("snet-postgres-${var.environment}-${local.region_code}-${local.seq}") = {
      cidr       = var.subnet_cidrs["postgres"]
      nsg_name   = "nsg-postgres-${var.environment}-${local.region_code}-${local.seq}"
      delegation = "Microsoft.DBforPostgreSQL/flexibleServers"
    }
    ("snet-agents-${var.environment}-${local.region_code}-${local.seq}") = {
      cidr     = var.subnet_cidrs["agents"]
      nsg_name = "nsg-agents-${var.environment}-${local.region_code}-${local.seq}"
    }
  }

  # alz mode: the Private DNS zones are central, in the connectivity subscription.
  private_dns_zones = {}
}
