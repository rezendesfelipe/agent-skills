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

variable "vm_size" {
  type    = string
  default = "Standard_D4ds_v5"
}

variable "node_count" {
  type    = number
  default = 3
}

variable "outbound_type" {
  type    = string
  default = "loadBalancer"
}

variable "acr_dns_zone_id" {
  type = string
}

variable "aks_dns_zone_id" {
  type = string
}
