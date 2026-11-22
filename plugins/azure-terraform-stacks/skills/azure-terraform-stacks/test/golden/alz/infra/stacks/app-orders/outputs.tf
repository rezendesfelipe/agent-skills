# Bridged into the Kustomize overlay by "stacks.mjs bridge" (never a secret).
output "postgres_fqdn" {
  value = module.postgresql.fqdn
}

output "app_client_id" {
  value = module.workload_identity.client_id
}

output "key_vault_uri" {
  value = module.key_vault.uri
}
