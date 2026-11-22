# vnet-core for dev-brs-01 (generated from infra/stacks.yaml; edit values, not keys)
location      = "brazilsouth"
address_space = ["10.10.0.0/16"]
subnet_cidrs = {
  aks       = "10.10.0.0/22"
  endpoints = "10.10.4.0/27"
  postgres  = "10.10.4.32/28"
  agents    = "10.10.4.64/27"
}
