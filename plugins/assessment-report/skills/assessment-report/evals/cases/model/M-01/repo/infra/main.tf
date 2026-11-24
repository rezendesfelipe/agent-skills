terraform {
  required_version = ">= 1.6"
}

variable "location" {
  type    = string
  default = "eastus2"
}

resource "azurerm_storage_account" "orders" {
  name                          = "storders001"
  resource_group_name           = "rg-orders"
  location                      = var.location
  account_tier                  = "Standard"
  account_replication_type      = "LRS"
  public_network_access_enabled = true
  min_tls_version               = "TLS1_2"
}

resource "azurerm_key_vault" "orders" {
  name                     = "kv-orders-001"
  location                 = var.location
  resource_group_name      = "rg-orders"
  tenant_id                = "00000000-0000-0000-0000-000000000000"
  sku_name                 = "standard"
  purge_protection_enabled = false
}

resource "azurerm_postgresql_flexible_server" "orders" {
  name                = "pg-orders-001"
  resource_group_name = "rg-orders"
  location            = var.location
  version             = "15"
  administrator_login = "ordersadmin"
  administrator_password = var.db_admin_password
}

variable "db_admin_password" {
  type      = string
  sensitive = true
}
