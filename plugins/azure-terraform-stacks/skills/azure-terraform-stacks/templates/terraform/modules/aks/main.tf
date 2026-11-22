# Private AKS cluster with OIDC issuer and Workload Identity.
# Without private_dns_zone_id: SystemAssigned identity and an AKS-managed private zone;
# Network Contributor on the subnet is assigned after the cluster exists.
# With private_dns_zone_id (alz mode): a UserAssigned identity gets Private DNS Zone
# Contributor and Network Contributor before the cluster is created, as AKS requires.
locals {
  custom_dns = var.private_dns_zone_id != null
}

resource "azurerm_user_assigned_identity" "cluster" {
  count               = local.custom_dns ? 1 : 0
  name                = "id-${var.name}"
  location            = var.location
  resource_group_name = var.resource_group_name
  tags                = var.tags
}

resource "azurerm_role_assignment" "dns_zone_contributor" {
  count                = local.custom_dns ? 1 : 0
  scope                = var.private_dns_zone_id
  role_definition_name = "Private DNS Zone Contributor"
  principal_id         = azurerm_user_assigned_identity.cluster[0].principal_id
}

resource "azurerm_role_assignment" "subnet_network_contributor_uai" {
  count                = local.custom_dns ? 1 : 0
  scope                = var.subnet_id
  role_definition_name = "Network Contributor"
  principal_id         = azurerm_user_assigned_identity.cluster[0].principal_id
}

resource "azurerm_kubernetes_cluster" "this" {
  name                = var.name
  location            = var.location
  resource_group_name = var.resource_group_name
  dns_prefix          = var.name
  sku_tier            = var.sku_tier
  kubernetes_version  = var.kubernetes_version

  private_cluster_enabled   = true
  private_dns_zone_id       = var.private_dns_zone_id
  oidc_issuer_enabled       = true
  workload_identity_enabled = true # requires oidc_issuer_enabled

  default_node_pool {
    name           = "system"
    vm_size        = var.vm_size
    node_count     = var.node_count
    vnet_subnet_id = var.subnet_id
  }

  identity {
    type         = local.custom_dns ? "UserAssigned" : "SystemAssigned"
    identity_ids = local.custom_dns ? [azurerm_user_assigned_identity.cluster[0].id] : null
  }

  network_profile {
    network_plugin      = "azure"
    network_plugin_mode = "overlay"
    outbound_type       = var.outbound_type # egress is a separate decision
  }

  tags = var.tags

  depends_on = [
    azurerm_role_assignment.dns_zone_contributor,
    azurerm_role_assignment.subnet_network_contributor_uai,
  ]
}

resource "azurerm_role_assignment" "subnet_network_contributor" {
  count                = local.custom_dns ? 0 : 1
  scope                = var.subnet_id
  role_definition_name = "Network Contributor"
  principal_id         = azurerm_kubernetes_cluster.this.identity[0].principal_id
}

resource "azurerm_role_assignment" "acr_pull" {
  scope                = var.acr_id
  role_definition_name = "AcrPull"
  principal_id         = azurerm_kubernetes_cluster.this.kubelet_identity[0].object_id
}
