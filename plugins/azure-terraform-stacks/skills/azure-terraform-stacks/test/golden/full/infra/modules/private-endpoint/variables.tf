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

variable "target_resource_id" {
  type = string
}

variable "subresource_name" {
  description = "registry, vault, ... (see the Private Endpoint DNS zone table)."
  type        = string
}

variable "private_dns_zone_id" {
  type    = string
  default = null
}

variable "dns_by_policy" {
  type    = bool
  default = false
}

variable "tags" {
  type    = map(string)
  default = {}
}
