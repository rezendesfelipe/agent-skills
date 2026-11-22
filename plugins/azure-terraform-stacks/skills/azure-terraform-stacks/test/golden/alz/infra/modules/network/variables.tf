variable "name" {
  type = string
}

variable "location" {
  type = string
}

variable "resource_group_name" {
  type = string
}

variable "address_space" {
  type = list(string)
}

variable "subnets" {
  description = "Subnet name => settings. nsg_name is the NSG created for the subnet."
  type = map(object({
    cidr                              = string
    nsg_name                          = string
    delegation                        = optional(string)
    private_endpoint_network_policies = optional(string, "Disabled")
  }))
}

variable "private_dns_zones" {
  description = "Key => zone name. Empty in alz mode, where the zones are central."
  type        = map(string)
  default     = {}
}

variable "dns_servers" {
  description = "Custom DNS servers (alz mode: the hub's resolver). Empty uses Azure DNS."
  type        = list(string)
  default     = []
}

variable "hub_vnet_id" {
  description = "Hub VNet ID for the spoke-to-hub peering (alz mode with managed peering)."
  type        = string
  default     = null
}

variable "tags" {
  type    = map(string)
  default = {}
}
