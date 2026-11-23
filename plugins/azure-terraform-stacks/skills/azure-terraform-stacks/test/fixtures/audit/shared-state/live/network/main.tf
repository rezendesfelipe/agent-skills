# Fixture: two roots that write to the same state blob.
terraform {
  required_version = ">= 1.12, < 2.0"
  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = ">= 4.65, < 5.0"
    }
  }

  backend "azurerm" {
    resource_group_name  = "rg-state"
    storage_account_name = "stshared"
    container_name       = "tfstate"
    key                  = "platform.tfstate"
  }
}

provider "azurerm" {
  features {}
}

resource "azurerm_resource_group" "network" {
  name     = "rg-network"
  location = "brazilsouth"
}
