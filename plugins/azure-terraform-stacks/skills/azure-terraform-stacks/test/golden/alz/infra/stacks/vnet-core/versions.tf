terraform {
  required_version = ">= 1.12, < 2.0"

  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = ">= 4.65, < 5.0"
    }
  }

  # Partial configuration: resource group, storage account, container and key come
  # from terraform init -backend-config (infra/scripts/tf.sh). Entra ID auth, no access key.
  backend "azurerm" {}
}

# The subscription comes from ARM_SUBSCRIPTION_ID, set per environment by the pipeline.
provider "azurerm" {
  features {}
}
