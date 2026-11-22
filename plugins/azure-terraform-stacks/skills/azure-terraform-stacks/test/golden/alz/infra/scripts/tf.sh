#!/usr/bin/env bash
# infra/scripts/tf.sh  ->  tf.sh <plan|apply> <stack> <env> <instance> <plan file>
# Generated from infra/stacks.yaml by azure-terraform-stacks: state keys, the state
# storage and one subscription per environment come from the manifest.
set -euo pipefail

usage() { echo "usage: tf.sh <plan|apply> <stack> <env> <instance> <plan file>" >&2; exit 2; }
[ "$#" -eq 5 ] || usage
cmd="$1"; stack="$2"; env="$3"; instance="$4"; plan_file="$5"

state_key() {
  case "$1:$2:$3" in
    "vnet-core:dev:brs-01") echo "vnet-core-dev-brs-01.tfstate" ;;
    "vnet-core:hml:brs-01") echo "vnet-core-hml-brs-01.tfstate" ;;
    "vnet-core:prod:brs-01") echo "vnet-core-prod-brs-01.tfstate" ;;
    "aks-core:dev:brs-01") echo "aks-core-dev-brs-01.tfstate" ;;
    "aks-core:hml:brs-01") echo "aks-core-hml-brs-01.tfstate" ;;
    "aks-core:prod:brs-01") echo "aks-core-prod-brs-01.tfstate" ;;
    "app-orders:dev:brs-01") echo "app-orders-dev-brs-01.tfstate" ;;
    "app-orders:hml:brs-01") echo "app-orders-hml-brs-01.tfstate" ;;
    "app-orders:prod:brs-01") echo "app-orders-prod-brs-01.tfstate" ;;
    *) echo "unknown stack, environment or instance: $1 $2 $3" >&2; return 1 ;;
  esac
}

subscription_id() {
  case "$1" in
    dev) echo "00000000-0000-0000-0000-000000000001" ;;
    hml) echo "00000000-0000-0000-0000-000000000002" ;;
    prod) echo "00000000-0000-0000-0000-000000000003" ;;
    *) echo "unknown environment: $1" >&2; return 1 ;;
  esac
}

key="$(state_key "$stack" "$env" "$instance")"
ARM_SUBSCRIPTION_ID="$(subscription_id "$env")"
export ARM_SUBSCRIPTION_ID

# Azure DevOps (AzureCLI@2 with addSpnToEnvironment) exposes the federated identity;
# GitHub Actions sets ARM_CLIENT_ID and ARM_TENANT_ID in the job.
if [ -n "${servicePrincipalId:-}" ]; then
  export ARM_CLIENT_ID="$servicePrincipalId"
  export ARM_TENANT_ID="${tenantId:?set by AzureCLI@2}"
  export ARM_ADO_PIPELINE_SERVICE_CONNECTION_ID="${AZURESUBSCRIPTION_SERVICE_CONNECTION_ID:?set by AzureCLI@2}"
fi
export ARM_USE_OIDC=true
export ARM_USE_AZUREAD=true

cd "infra/stacks/${stack}"

terraform init -input=false \
  -backend-config="subscription_id=00000000-0000-0000-0000-0000000000ff" \
  -backend-config="resource_group_name=rg-tfstate" \
  -backend-config="storage_account_name=sttfstatecorp001" \
  -backend-config="container_name=tfstate" \
  -backend-config="key=${key}" \
  -backend-config="use_azuread_auth=true"

case "$cmd" in
  plan)
    terraform plan -input=false \
      -var="environment=${env}" -var="instance=${instance}" \
      -var-file="../../envs/${stack}/${env}-${instance}.tfvars" \
      -out="${plan_file}"
    ;;
  apply)
    terraform apply -input=false "${plan_file}"
    ;;
  *)
    usage
    ;;
esac
