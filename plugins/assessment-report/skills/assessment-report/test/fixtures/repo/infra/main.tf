terraform {
  required_version = ">= 1.6"
}

resource "azurerm_storage_account" "logs" {
  name                     = "stlogsdemo001"
  resource_group_name      = var.resource_group_name
  location                 = var.location
  account_tier             = "Standard"
  account_replication_type = "LRS"
  min_tls_version          = "TLS1_0"
  public_network_access_enabled = true
}

resource "azurerm_key_vault" "main" {
  name                = "kv-demo-001"
  location            = var.location
  resource_group_name = var.resource_group_name
  tenant_id           = var.tenant_id
  sku_name            = "standard"
  purge_protection_enabled = false
}
