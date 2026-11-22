variable "name" {
  type = string
}

variable "location" {
  type = string
}

variable "resource_group_name" {
  type = string
}

variable "delegated_subnet_id" {
  type = string
}

variable "private_dns_zone_id" {
  type = string
}

variable "postgres_version" {
  type    = string
  default = "16"
}

variable "sku_name" {
  type = string
}

variable "storage_mb" {
  type = number
}

variable "zone" {
  type    = string
  default = null
}

variable "backup_retention_days" {
  type    = number
  default = 7
}

variable "tags" {
  type    = map(string)
  default = {}
}
