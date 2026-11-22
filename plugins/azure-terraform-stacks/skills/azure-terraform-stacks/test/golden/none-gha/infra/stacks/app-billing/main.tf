locals {
  region_code = split("-", var.instance)[0]
  seq         = split("-", var.instance)[1]
}

resource "azurerm_resource_group" "this" {
  name     = "rg_${var.environment}_${local.region_code}_app_billing_${local.seq}"
  location = var.location
}
