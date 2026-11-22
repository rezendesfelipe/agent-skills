variable "environment" {
  type = string
}

variable "instance" {
  description = "<region code>-<seq>, e.g. brs-01"
  type        = string
}

variable "location" {
  type = string
}

variable "address_space" {
  type = list(string)
}

variable "subnet_cidrs" {
  description = "CIDR per subnet: aks, endpoints, postgres (at least /28, delegated) and agents."
  type        = map(string)
}

variable "dns_servers" {
  type    = list(string)
  default = []
}

variable "hub_vnet_id" {
  type    = string
  default = null
}
