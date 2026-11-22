locals {
  region_code = split("-", var.instance)[0]
  seq         = split("-", var.instance)[1]
}

resource "azurerm_resource_group" "this" {
  name     = "rg-app-demo-${var.environment}-${local.region_code}-${local.seq}"
  location = var.location
}
