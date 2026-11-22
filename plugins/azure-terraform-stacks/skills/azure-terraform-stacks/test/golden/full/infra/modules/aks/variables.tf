variable "name" {
  type = string
}

variable "location" {
  type = string
}

variable "resource_group_name" {
  type = string
}

variable "subnet_id" {
  type = string
}

variable "acr_id" {
  type = string
}

variable "vm_size" {
  type    = string
  default = "Standard_D4ds_v5"
}

variable "node_count" {
  type    = number
  default = 3
}

variable "outbound_type" {
  description = "loadBalancer, userDefinedRouting, managedNATGateway, userAssignedNATGateway or none."
  type        = string
  default     = "loadBalancer"
}

variable "private_dns_zone_id" {
  description = "Central privatelink.<region>.azmk8s.io zone (alz mode). Null lets AKS manage the zone."
  type        = string
  default     = null
}

variable "sku_tier" {
  type    = string
  default = "Standard"
}

variable "kubernetes_version" {
  type    = string
  default = null
}

variable "tags" {
  type    = map(string)
  default = {}
}
