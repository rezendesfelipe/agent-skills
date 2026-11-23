# Fixture: a federated credential whose subject names a namespace and service account that no Application deploys to.
terraform {
  required_version = ">= 1.12, < 2.0"
  backend "azurerm" {}
}

resource "azurerm_federated_identity_credential" "orders" {
  name                      = "fic-orders"
  user_assigned_identity_id = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/rg/providers/Microsoft.ManagedIdentity/userAssignedIdentities/id"
  issuer                    = "https://example.com/oidc"
  subject                   = "system:serviceaccount:shop:api"
  audience                  = ["api://AzureADTokenExchange"]
}
