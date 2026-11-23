# Test fixture for a linter. It is intentionally insecure and is never deployed.
resource "azurerm_storage_account" "example" {
  public_network_access_enabled = true
  min_tls_version               = "TLS1_0"
}
