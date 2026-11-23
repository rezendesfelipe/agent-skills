# Fixture: one large hand-written root with local state, old version constraints and a data
# source that reads a resource group nobody creates.
terraform {
  required_version = "~> 1.9"
  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 4.0"
    }
  }
}

provider "azurerm" {
  features {}
}

data "azurerm_subnet" "legacy" {
  name                 = "snet-legacy"
  virtual_network_name = "vnet-legacy"
  resource_group_name  = "rg-network-legacy"
}

resource "azurerm_resource_group" "main" {
  name     = "rg-platform"
  location = "brazilsouth"
}

resource "azurerm_virtual_network" "main" {
  name                = "vnet-platform"
  location            = "brazilsouth"
  resource_group_name = azurerm_resource_group.main.name
  address_space       = ["10.0.0.0/16"]
}

resource "azurerm_subnet" "aks" {
  name                 = "snet-aks"
  resource_group_name  = azurerm_resource_group.main.name
  virtual_network_name = azurerm_virtual_network.main.name
  address_prefixes     = ["10.0.0.0/22"]
}

resource "azurerm_kubernetes_cluster" "main" {
  name                = "aks-platform"
  location            = "brazilsouth"
  resource_group_name = azurerm_resource_group.main.name
  dns_prefix          = "aks-platform"
}

resource "azurerm_postgresql_flexible_server" "orders" {
  name                = "pgsql-orders"
  location            = "brazilsouth"
  resource_group_name = azurerm_resource_group.main.name
}

resource "azurerm_storage_account" "logs" {
  name                = "stplatformlogs"
  location            = "brazilsouth"
  resource_group_name = azurerm_resource_group.main.name
}

resource "azurerm_key_vault" "main" {
  name                = "kv-platform"
  location            = "brazilsouth"
  resource_group_name = azurerm_resource_group.main.name
}
