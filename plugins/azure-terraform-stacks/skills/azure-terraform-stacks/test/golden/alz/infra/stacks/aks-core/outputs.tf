output "cluster_name" {
  value = module.aks.name
}

output "oidc_issuer_url" {
  value = module.aks.oidc_issuer_url
}

output "acr_login_server" {
  value = module.acr.login_server
}
