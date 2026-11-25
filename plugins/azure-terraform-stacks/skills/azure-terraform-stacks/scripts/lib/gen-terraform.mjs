// Generates infra/stacks/*, infra/modules/* (profile), infra/envs/* and infra/scripts/tf.sh.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { hclName, hclRg, naming, stateKey } from "./naming.mjs";
import { formatHcl } from "./hcl-format.mjs";

// The templates directory as a filesystem path. `new URL(...).pathname` is `/D:/a/...` on Windows, so convert with fileURLToPath.
// `opts.windows` lets a test exercise the Windows conversion on any platform.
export const templatesDir = (base = import.meta.url, opts) => fileURLToPath(new URL("../../templates/", base), opts);
const TEMPLATES = templatesDir();

const hq = (s) => JSON.stringify(s); // HCL string literal

// "kv-orders" with the configured separator
const part = (m, ...xs) => xs.join(naming(m).separator || "");

function versionsTf(m) {
  return `terraform {
  required_version = ${hq(m.terraform.requiredVersion)}

  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = ${hq(m.terraform.azurerm)}
    }
  }

  # Partial configuration: resource group, storage account, container and key come
  # from terraform init -backend-config (infra/scripts/tf.sh). Entra ID auth, no access key.
  backend "azurerm" {}
}

# The subscription comes from ARM_SUBSCRIPTION_ID, set per environment by the pipeline.
provider "azurerm" {
  features {}
}
`;
}

function commonVariables(extra = "") {
  return `variable "environment" {
  type = string
}

variable "instance" {
  description = "<region code>-<seq>, e.g. brs-01"
  type        = string
}

variable "location" {
  type = string
}
${extra}`;
}

const LOCALS = `locals {
  region_code = split("-", var.instance)[0]
  seq         = split("-", var.instance)[1]
}
`;

function remoteStateBlock(m, dep) {
  return `data "terraform_remote_state" ${hq(dep.name.replace(/-/g, "_"))} {
  backend = "azurerm"
  config = {
    subscription_id      = ${hq(m.state.subscriptionId)}
    resource_group_name  = ${hq(m.state.resourceGroup)}
    storage_account_name = ${hq(m.state.storageAccount)}
    container_name       = ${hq(m.state.container)}
    key                  = "${hclName(m, dep.type, dep.owner).slice(1, -1)}.tfstate"
    use_azuread_auth     = true
  }
}
`;
}

// Cross-stack references: provider data sources by default, remote state when the
// stack opts in. Each returns { blocks, expr }.
function refs(m, stack) {
  const net = m.networkStack;
  const aks = m.clusterStack;
  const alz = m.landingZone.mode === "alz";
  const rs = stack.remoteState;
  const blocks = new Map();
  const rsName = (s) => `data.terraform_remote_state.${s.name.replace(/-/g, "_")}.outputs`;
  const vnetName = hclName(m, "vnet", net.owner);
  const vnetRg = hclRg(m, "vnet", net.owner);

  const subnet = (purpose) => {
    const key = `subnet_${purpose}`;
    if (rs) {
      blocks.set(net.name, remoteStateBlock(m, net));
      return `${rsName(net)}.subnet_ids[${hclName(m, "snet", purpose)}]`;
    }
    blocks.set(key, `data "azurerm_subnet" ${hq(purpose)} {
  name                 = ${hclName(m, "snet", purpose)}
  virtual_network_name = ${vnetName}
  resource_group_name  = ${vnetRg}
}
`);
    return `data.azurerm_subnet.${purpose}.id`;
  };
  const zone = (key, zoneName) => {
    if (alz) return `var.${key}_dns_zone_id`;
    if (rs) {
      blocks.set(net.name, remoteStateBlock(m, net));
      return `${rsName(net)}.private_dns_zone_ids[${hq(key)}]`;
    }
    blocks.set(`zone_${key}`, `data "azurerm_private_dns_zone" ${hq(key)} {
  name                = ${zoneName}
  resource_group_name = ${vnetRg}
}
`);
    return `data.azurerm_private_dns_zone.${key}.id`;
  };
  const oidc = () => {
    if (rs) {
      blocks.set(aks.name, remoteStateBlock(m, aks));
      return `${rsName(aks)}.oidc_issuer_url`;
    }
    blocks.set("aks", `data "azurerm_kubernetes_cluster" "this" {
  name                = ${hclName(m, "aks", aks.owner)}
  resource_group_name = ${hclRg(m, "aks", aks.owner)}
}
`);
    return "data.azurerm_kubernetes_cluster.this.oidc_issuer_url";
  };
  return { subnet, zone, oidc, blocks };
}

export const PG_ZONE = '"${var.environment}-${var.instance}.postgres.database.azure.com"';
export const SUBNETS = ["aks", "endpoints", "postgres", "agents"];

function vnetStack(m, s) {
  const alz = m.landingZone.mode === "alz";
  const subnetLines = SUBNETS.map((p) => {
    const opts = [`cidr = var.subnet_cidrs[${hq(p)}]`, `nsg_name = ${hclName(m, "nsg", p)}`];
    if (p === "postgres") opts.push('delegation = "Microsoft.DBforPostgreSQL/flexibleServers"');
    if (p === "endpoints") opts.push('private_endpoint_network_policies = "NetworkSecurityGroupEnabled"');
    return `    (${hclName(m, "snet", p)}) = {\n      ${opts.join("\n      ")}\n    }`;
  }).join("\n");
  const zones = alz ? "{}" : `{
    acr       = "privatelink.azurecr.io"
    key_vault = "privatelink.vaultcore.azure.net"
    postgres  = ${PG_ZONE}
  }`;
  const main = `${LOCALS}
resource "azurerm_resource_group" "this" {
  name     = ${hclRg(m, "vnet", s.owner)}
  location = var.location
}

module "network" {
  source = "../../modules/network"

  name                = ${hclName(m, "vnet", s.owner)}
  location            = var.location
  resource_group_name = azurerm_resource_group.this.name
  address_space       = var.address_space
  dns_servers         = var.dns_servers
  hub_vnet_id         = var.hub_vnet_id

  subnets = {
${subnetLines}
  }

  # ${alz ? "alz mode: the Private DNS zones are central, in the connectivity subscription." : "standalone mode: this stack owns the Private DNS zones."}
  private_dns_zones = ${zones}
}
`;
  const vars = commonVariables(`
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
`);
  const outputs = `output "vnet_id" {
  value = module.network.vnet_id
}

# Keyed by subnet name, for stacks that read this one through terraform_remote_state.
output "subnet_ids" {
  value = module.network.subnet_ids
}

output "private_dns_zone_ids" {
  value = module.network.private_dns_zone_ids
}
`;
  return { main, vars, outputs };
}

function aksStack(m, s) {
  const alz = m.landingZone.mode === "alz";
  const r = refs(m, s);
  const aksSubnet = r.subnet("aks");
  const epSubnet = r.subnet("endpoints");
  const acrZone = r.zone("acr", '"privatelink.azurecr.io"');
  const body = `resource "azurerm_resource_group" "this" {
  name     = ${hclRg(m, "aks", s.owner)}
  location = var.location
}

module "acr" {
  source = "../../modules/acr"

  name                = ${hclName(m, "cr", s.owner)}
  location            = var.location
  resource_group_name = azurerm_resource_group.this.name
}

module "acr_private_endpoint" {
  source = "../../modules/private-endpoint"

  name                = ${hclName(m, "pep", part(m, "cr", s.owner))}
  location            = var.location
  resource_group_name = azurerm_resource_group.this.name
  subnet_id           = ${epSubnet}
  target_resource_id  = module.acr.id
  subresource_name    = "registry"
  private_dns_zone_id = ${acrZone}
  dns_by_policy       = ${alz && m.landingZone.dnsByPolicy ? "true" : "false"}
}

module "aks" {
  source = "../../modules/aks"

  name                = ${hclName(m, "aks", s.owner)}
  location            = var.location
  resource_group_name = azurerm_resource_group.this.name
  subnet_id           = ${aksSubnet}
  acr_id              = module.acr.id
  vm_size             = var.vm_size
  node_count          = var.node_count
  outbound_type       = var.outbound_type
  private_dns_zone_id = ${alz ? "var.aks_dns_zone_id" : "null"}
}
`;
  const main = `${LOCALS}\n${[...r.blocks.values()].join("\n")}\n${body}`;
  const vars = commonVariables(`
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
${alz ? `
variable "acr_dns_zone_id" {
  type = string
}

variable "aks_dns_zone_id" {
  type = string
}
` : ""}`);
  const outputs = `output "cluster_name" {
  value = module.aks.name
}

output "oidc_issuer_url" {
  value = module.aks.oidc_issuer_url
}

output "acr_login_server" {
  value = module.acr.login_server
}
`;
  return { main, vars, outputs };
}

function appStack(m, s) {
  const alz = m.landingZone.mode === "alz";
  const r = refs(m, s);
  const pgSubnet = r.subnet("postgres");
  const epSubnet = r.subnet("endpoints");
  const pgZone = r.zone("postgres", PG_ZONE);
  const kvZone = r.zone("key_vault", '"privatelink.vaultcore.azure.net"');
  const issuer = r.oidc();
  const app = m.gitops?.apps.find((a) => a.stack === s.name);
  const ns = app?.namespace ?? s.owner;
  const sa = app?.serviceAccount ?? s.owner;
  const body = `resource "azurerm_resource_group" "this" {
  name     = ${hclRg(m, "app", s.owner)}
  location = var.location
}

# Database dedicated to the ${s.owner} application
module "postgresql" {
  source = "../../modules/postgresql"

  name                = ${hclName(m, "pgsql", s.owner)}
  location            = var.location
  resource_group_name = azurerm_resource_group.this.name
  delegated_subnet_id = ${pgSubnet}
  private_dns_zone_id = ${pgZone}
  sku_name            = var.postgres_sku_name
  storage_mb          = var.postgres_storage_mb
}

module "key_vault" {
  source = "../../modules/key-vault"

  name                = ${hclName(m, "kv", s.owner)}
  location            = var.location
  resource_group_name = azurerm_resource_group.this.name
}

module "key_vault_private_endpoint" {
  source = "../../modules/private-endpoint"

  name                = ${hclName(m, "pep", part(m, "kv", s.owner))}
  location            = var.location
  resource_group_name = azurerm_resource_group.this.name
  subnet_id           = ${epSubnet}
  target_resource_id  = module.key_vault.id
  subresource_name    = "vault"
  private_dns_zone_id = ${kvZone}
  dns_by_policy       = ${alz && m.landingZone.dnsByPolicy ? "true" : "false"}
}

# The subject must match the Argo CD Application: namespace ${ns}, service account ${sa}.
module "workload_identity" {
  source = "../../modules/workload-identity"

  name                 = ${hclName(m, "id", s.owner)}
  location             = var.location
  resource_group_name  = azurerm_resource_group.this.name
  oidc_issuer_url      = ${issuer}
  namespace            = ${hq(ns)}
  service_account_name = ${hq(sa)}
  key_vault_id         = module.key_vault.id
}
`;
  const main = `${LOCALS}\n${[...r.blocks.values()].join("\n")}\n${body}`;
  const vars = commonVariables(`
variable "postgres_sku_name" {
  type    = string
  default = "GP_Standard_D2ds_v5"
}

variable "postgres_storage_mb" {
  type    = number
  default = 32768
}
${alz ? `
variable "postgres_dns_zone_id" {
  type = string
}

variable "key_vault_dns_zone_id" {
  type = string
}
` : ""}`);
  const outputs = `# Bridged into the Kustomize overlay by "stacks.mjs bridge" (never a secret).
output "postgres_fqdn" {
  value = module.postgresql.fqdn
}

output "app_client_id" {
  value = module.workload_identity.client_id
}

output "key_vault_uri" {
  value = module.key_vault.uri
}
`;
  return { main, vars, outputs };
}

function emptyStack(m, s) {
  const main = `${LOCALS}
resource "azurerm_resource_group" "this" {
  name     = ${hclRg(m, s.type, s.owner)}
  location = var.location
}
${s.modules.map((mod) => `
module ${hq(mod.replace(/-/g, "_"))} {
  source = "../../modules/${mod}"

  # location            = var.location
  # resource_group_name = azurerm_resource_group.this.name
}
`).join("")}`;
  return { main, vars: commonVariables(), outputs: `output "resource_group_name" {\n  value = azurerm_resource_group.this.name\n}\n` };
}

function tfvars(m, s, env, instance) {
  const lines = [
    `# ${s.name} for ${env}-${instance} (generated from infra/stacks.yaml; edit values, not keys)`,
    `location = ${hq(m.locationOf(instance))}`,
  ];
  const lz = m.landingZone;
  if (m.profile === "private-aks-postgres") {
    if (s.type === "vnet") {
      lines.push('address_space = ["10.10.0.0/16"]',
        "subnet_cidrs = {",
        '  aks       = "10.10.0.0/22"',
        '  endpoints = "10.10.4.0/27"',
        '  postgres  = "10.10.4.32/28"',
        '  agents    = "10.10.4.64/27"',
        "}");
      if (lz.mode === "alz") {
        lines.push(`dns_servers = ${JSON.stringify(lz.dnsServers)}`);
        lines.push(`hub_vnet_id = ${lz.peering === "managed" ? hq(lz.hubVnetId) : "null"}`);
      }
    }
    if (s.type === "aks") {
      lines.push('vm_size       = "Standard_D4ds_v5"', "node_count    = 3", 'outbound_type = "loadBalancer" # egress is a separate decision');
      if (lz.mode === "alz") lines.push(`acr_dns_zone_id = ${hq(lz.privateDnsZoneIds.acr)}`, `aks_dns_zone_id = ${hq(lz.privateDnsZoneIds.aks)}`);
    }
    if (s.type === "app") {
      lines.push('postgres_sku_name   = "GP_Standard_D2ds_v5"', "postgres_storage_mb = 32768");
      if (lz.mode === "alz") lines.push(`postgres_dns_zone_id = ${hq(lz.privateDnsZoneIds.postgres)}`, `key_vault_dns_zone_id = ${hq(lz.privateDnsZoneIds.keyVault)}`);
    }
  }
  return lines.join("\n") + "\n";
}

export function tfSh(m) {
  const keys = [];
  for (const st of m.stacks) for (const env of m.envNames) for (const inst of m.instances) {
    keys.push(`    "${st.name}:${env}:${inst}") echo "${stateKey(m, st, env, inst)}" ;;`);
  }
  const subs = m.envNames.map((e) => `    ${e}) echo "${m.environments[e].subscriptionId}" ;;`);
  return `#!/usr/bin/env bash
# infra/scripts/tf.sh  ->  tf.sh <plan|apply> <stack> <env> <instance> <plan file>
# Generated from infra/stacks.yaml by azure-terraform-stacks: state keys, the state
# storage and one subscription per environment come from the manifest.
set -euo pipefail

usage() { echo "usage: tf.sh <plan|apply> <stack> <env> <instance> <plan file>" >&2; exit 2; }
[ "$#" -eq 5 ] || usage
cmd="$1"; stack="$2"; env="$3"; instance="$4"; plan_file="$5"

state_key() {
  case "$1:$2:$3" in
${keys.join("\n")}
    *) echo "unknown stack, environment or instance: $1 $2 $3" >&2; return 1 ;;
  esac
}

subscription_id() {
  case "$1" in
${subs.join("\n")}
    *) echo "unknown environment: $1" >&2; return 1 ;;
  esac
}

key="$(state_key "$stack" "$env" "$instance")"
ARM_SUBSCRIPTION_ID="$(subscription_id "$env")"
export ARM_SUBSCRIPTION_ID

# Azure DevOps (AzureCLI@2 with addSpnToEnvironment) exposes the federated identity;
# GitHub Actions sets ARM_CLIENT_ID and ARM_TENANT_ID in the job.
if [ -n "\${servicePrincipalId:-}" ]; then
  export ARM_CLIENT_ID="$servicePrincipalId"
  export ARM_TENANT_ID="\${tenantId:?set by AzureCLI@2}"
  export ARM_ADO_PIPELINE_SERVICE_CONNECTION_ID="\${AZURESUBSCRIPTION_SERVICE_CONNECTION_ID:?set by AzureCLI@2}"
fi
export ARM_USE_OIDC=true
export ARM_USE_AZUREAD=true

cd "infra/stacks/\${stack}"

terraform init -input=false \\
  -backend-config="subscription_id=${m.state.subscriptionId}" \\
  -backend-config="resource_group_name=${m.state.resourceGroup}" \\
  -backend-config="storage_account_name=${m.state.storageAccount}" \\
  -backend-config="container_name=${m.state.container}" \\
  -backend-config="key=\${key}" \\
  -backend-config="use_azuread_auth=true"

case "$cmd" in
  plan)
    terraform plan -input=false \\
      -var="environment=\${env}" -var="instance=\${instance}" \\
      -var-file="../../envs/\${stack}/\${env}-\${instance}.tfvars" \\
      -out="\${plan_file}"
    ;;
  apply)
    terraform apply -input=false "\${plan_file}"
    ;;
  *)
    usage
    ;;
esac
`;
}

export function generateTerraform(m) {
  const files = new Map();
  if (m.profile === "private-aks-postgres") {
    for (const mod of readdirSync(join(TEMPLATES, "terraform/modules"))) {
      for (const f of readdirSync(join(TEMPLATES, "terraform/modules", mod))) {
        files.set(`infra/modules/${mod}/${f}`, readFileSync(join(TEMPLATES, "terraform/modules", mod, f), "utf8"));
      }
    }
  }
  for (const s of m.stacks) {
    const gen = m.profile !== "private-aks-postgres" ? emptyStack
      : s.type === "vnet" ? vnetStack : s.type === "aks" ? aksStack : s.type === "app" ? appStack : emptyStack;
    const { main, vars, outputs } = gen(m, s);
    const dir = `infra/stacks/${s.name}`;
    files.set(`${dir}/versions.tf`, formatHcl(versionsTf(m)));
    files.set(`${dir}/main.tf`, formatHcl(main.replace(/\n{3,}/g, "\n\n")));
    files.set(`${dir}/variables.tf`, formatHcl(vars));
    files.set(`${dir}/outputs.tf`, formatHcl(outputs));
    for (const env of m.envNames) for (const inst of m.instances) {
      files.set(`infra/envs/${s.name}/${env}-${inst}.tfvars`, formatHcl(tfvars(m, s, env, inst)));
    }
  }
  files.set("infra/scripts/tf.sh", tfSh(m));
  return files;
}
