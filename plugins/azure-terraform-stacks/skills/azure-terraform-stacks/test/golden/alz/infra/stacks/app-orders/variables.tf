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

variable "postgres_sku_name" {
  type    = string
  default = "GP_Standard_D2ds_v5"
}

variable "postgres_storage_mb" {
  type    = number
  default = 32768
}

variable "postgres_dns_zone_id" {
  type = string
}

variable "key_vault_dns_zone_id" {
  type = string
}
