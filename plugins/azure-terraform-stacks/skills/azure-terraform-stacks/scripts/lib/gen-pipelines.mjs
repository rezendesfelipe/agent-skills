// Generates the Azure DevOps and GitHub Actions pipelines from the manifest.
import { camel, snake, transitiveDeps } from "./manifest.mjs";

const HEADER = "# Generated from infra/stacks.yaml by azure-terraform-stacks. Regenerate instead of editing by hand.\n";
const stageName = (s) => snake(s.name);
const KUBECTL = "v1.33.0";

// Stacks the Argo CD bootstrap waits for: the cluster and every app stack with a GitOps app.
export function bootstrapDeps(m) {
  if (!m.gitops) return [];
  const names = new Set([m.clusterStack.name, ...m.gitops.apps.map((a) => a.stack)]);
  return m.stacks.filter((s) => names.has(s.name));
}

// ---------- Azure DevOps ----------
function adoOrchestrator(m) {
  const a = m.pipelines.azureDevOps;
  const sc = a.serviceConnection.replace("{env}", "${{ parameters.environment }}");
  const env = a.environment.replace("{env}", "${{ parameters.environment }}");
  const params = [
    `  - name: environment
    displayName: Environment
    type: string
    default: ${m.envNames[0]}
    values: [${m.envNames.join(", ")}]`,
    `  - name: instance
    displayName: Instance (region-seq)
    type: string
    default: ${m.instances[0]}
    values: [${m.instances.join(", ")}]`,
    `  - name: action
    displayName: Action
    type: string
    default: plan
    values: [plan, apply] # no destroy: see references/traps.md`,
    ...m.stacks.map((s) => `  - name: ${camel(s.name)}
    displayName: "${s.name}"
    type: boolean
    default: false`),
  ];
  if (m.gitops) params.push(`  - name: argocd
    displayName: "argocd · install and root Application (once per cluster, apply only)"
    type: boolean
    default: false`);

  const bools = m.stacks.map((s) => `eq(parameters.${camel(s.name)}, false)`);
  if (m.gitops) bools.push("eq(parameters.argocd, false)");
  const none = bools.length === 1 ? bools[0] : `and(${bools.join(", ")})`;
  const deps = (list) => list.length
    ? `\n          dependsOn:\n${list.map((d) => `            - \${{ if eq(parameters.${camel(d.name)}, true) }}:\n                - ${stageName(d)}`).join("\n")}`
    : "";
  const byName = new Map(m.stacks.map((s) => [s.name, s]));
  const stages = [
    `  # Fails fast when nothing was selected.
  - \${{ if ${none} }}:
      - stage: nothing_selected
        jobs:
          - job: fail
            pool:
              name: ${a.pool}
            steps:
              - checkout: none
              - script: echo "Select at least one stack or step." && exit 1`,
    ...m.stacks.map((s) => `  - \${{ if eq(parameters.${camel(s.name)}, true) }}:
      - template: templates/terraform-stack.yml
        parameters:
          stack: ${s.name}
          stageName: ${stageName(s)}
          environment: \${{ parameters.environment }}
          instance: \${{ parameters.instance }}
          action: \${{ parameters.action }}
          serviceConnection: ${sc}
          deploymentEnvironment: ${env}${deps([...transitiveDeps(m, s.name)].map((n) => byName.get(n)).filter(Boolean))}`),
  ];
  if (m.gitops) {
    stages.push(`  # Argo CD bootstrap: only on apply, after the cluster and the app stacks selected in the same run.
  - \${{ if and(eq(parameters.argocd, true), eq(parameters.action, 'apply')) }}:
      - template: templates/argocd-bootstrap.yml
        parameters:
          environment: \${{ parameters.environment }}
          instance: \${{ parameters.instance }}
          serviceConnection: ${a.bootstrapServiceConnection.replace("{env}", "${{ parameters.environment }}")}
          deploymentEnvironment: ${env}${deps(bootstrapDeps(m))}`);
  }
  return `${HEADER}# infra/pipelines/azure-pipelines.yml
trigger: none # always an intentional run; a triggered run would use the defaults
pr: none

parameters:
${params.join("\n\n")}

stages:
${stages.join("\n\n")}
`;
}

function installTerraform(m, indent) {
  const v = m.terraform.version;
  const pad = " ".repeat(indent);
  return `${pad}- bash: |
${pad}    set -euo pipefail
${pad}    d="$(Agent.TempDirectory)/terraform-${v}"
${pad}    if [ ! -x "$d/terraform" ]; then
${pad}      mkdir -p "$d"
${pad}      curl -sSfL -o "$d/terraform.zip" "https://releases.hashicorp.com/terraform/${v}/terraform_${v}_linux_amd64.zip"
${pad}      unzip -o -q "$d/terraform.zip" -d "$d"
${pad}    fi
${pad}    echo "##vso[task.prependpath]$d"
${pad}  displayName: install terraform ${v}`;
}

function tfTask(cmd, planPath, indent) {
  const pad = " ".repeat(indent);
  return `${pad}- task: AzureCLI@2
${pad}  displayName: terraform ${cmd === "plan" ? "init + plan" : "apply"}
${pad}  inputs:
${pad}    azureSubscription: \${{ parameters.serviceConnection }}
${pad}    scriptType: bash
${pad}    scriptLocation: scriptPath
${pad}    scriptPath: infra/scripts/tf.sh
${pad}    arguments: ${cmd} \${{ parameters.stack }} \${{ parameters.environment }} \${{ parameters.instance }} ${planPath}
${pad}    addSpnToEnvironment: true
${pad}  env:
${pad}    SYSTEM_ACCESSTOKEN: $(System.AccessToken)
${pad}    SYSTEM_OIDCREQUESTURI: $(System.OidcRequestUri)`;
}

function adoStackTemplate(m) {
  const pool = m.pipelines.azureDevOps.pool;
  return `${HEADER}# infra/pipelines/templates/terraform-stack.yml
parameters:
  - name: stack
    type: string
  - name: stageName
    type: string
  - name: environment
    type: string
  - name: instance
    type: string
  - name: action
    type: string
  - name: serviceConnection
    type: string
  - name: deploymentEnvironment
    type: string
  - name: dependsOn
    type: object
    default: []

stages:
  - stage: \${{ parameters.stageName }}
    displayName: "\${{ parameters.stack }}-\${{ parameters.environment }}-\${{ parameters.instance }}"
    dependsOn: \${{ parameters.dependsOn }}
    jobs:
      - job: plan
        pool:
          name: ${pool} # self-hosted, inside the VNet
        steps:
          - checkout: self
${installTerraform(m, 10)}
${tfTask("plan", "$(Build.ArtifactStagingDirectory)/${{ parameters.stack }}.tfplan", 10)}
          - publish: $(Build.ArtifactStagingDirectory)/\${{ parameters.stack }}.tfplan
            artifact: plan-\${{ parameters.stageName }}

      # Approvals and checks live on the Environment, not in this YAML.
      - \${{ if eq(parameters.action, 'apply') }}:
          - deployment: apply
            dependsOn: plan
            pool:
              name: ${pool}
            environment: \${{ parameters.deploymentEnvironment }}
            strategy:
              runOnce:
                deploy:
                  steps:
                    - checkout: self
                    - download: current
                      artifact: plan-\${{ parameters.stageName }}
${installTerraform(m, 20)}
${tfTask("apply", "$(Pipeline.Workspace)/plan-${{ parameters.stageName }}/${{ parameters.stack }}.tfplan", 20)}
`;
}

function adoBootstrapTemplate(m) {
  const pool = m.pipelines.azureDevOps.pool;
  return `${HEADER}# infra/pipelines/templates/argocd-bootstrap.yml
parameters:
  - name: environment
    type: string
  - name: instance
    type: string
  - name: serviceConnection
    type: string
  - name: deploymentEnvironment
    type: string
  - name: dependsOn
    type: object
    default: []

stages:
  - stage: argocd
    displayName: "argocd-bootstrap-\${{ parameters.environment }}-\${{ parameters.instance }}"
    dependsOn: \${{ parameters.dependsOn }}
    jobs:
      - deployment: bootstrap
        pool:
          name: ${pool} # must reach the private AKS API
        environment: \${{ parameters.deploymentEnvironment }}
        strategy:
          runOnce:
            deploy:
              steps:
                - checkout: self
                - bash: |
                    set -euo pipefail
                    d="$(Agent.TempDirectory)/kubectl-${KUBECTL}"
                    mkdir -p "$d"
                    curl -sSfL -o "$d/kubectl" "https://dl.k8s.io/release/${KUBECTL}/bin/linux/amd64/kubectl"
                    chmod +x "$d/kubectl"
                    echo "##vso[task.prependpath]$d"
                  displayName: install kubectl ${KUBECTL}
                - task: AzureCLI@2
                  displayName: install Argo CD and the root Application
                  inputs:
                    azureSubscription: \${{ parameters.serviceConnection }} # own identity, not the Terraform one
                    scriptType: bash
                    scriptLocation: scriptPath
                    scriptPath: infra/scripts/bootstrap-argocd.sh
                    arguments: \${{ parameters.environment }} \${{ parameters.instance }}
`;
}

// ---------- GitHub Actions ----------
function ghaOrchestrator(m) {
  const inputs = [
    `      environment:
        description: Environment (GitHub Environment)
        type: environment
        required: true`,
    `      instance:
        description: Instance (region-seq)
        type: choice
        options: [${m.instances.join(", ")}]
        default: ${m.instances[0]}`,
    `      action:
        description: Action
        type: choice
        options: [plan, apply] # no destroy: see references/traps.md
        default: plan`,
    ...m.stacks.map((s) => `      ${snake(s.name)}:
        description: "${s.name}"
        type: boolean
        default: false`),
  ];
  if (m.gitops) inputs.push(`      argocd:
        description: "argocd · install and root Application (once per cluster, apply only)"
        type: boolean
        default: false`);
  const any = [...m.stacks.map((s) => `inputs.${snake(s.name)}`), ...(m.gitops ? ["inputs.argocd"] : [])].join(" || ");
  const jobs = [
    `  nothing-selected:
    if: \${{ !(${any}) }}
    runs-on: ubuntu-latest
    steps:
      - run: echo "Select at least one stack or step." && exit 1`,
    ...m.stacks.map((s) => {
      const needs = [...transitiveDeps(m, s.name)];
      return `  ${s.name}:${needs.length ? `\n    needs: [${needs.join(", ")}]` : ""}
    if: \${{ !cancelled() && !failure() && inputs.${snake(s.name)} }}
    uses: ./.github/workflows/terraform-stack.yml
    with:
      stack: ${s.name}
      environment: \${{ inputs.environment }}
      instance: \${{ inputs.instance }}
      action: \${{ inputs.action }}`;
    }),
  ];
  if (m.gitops) jobs.push(`  argocd:
    needs: [${bootstrapDeps(m).map((s) => s.name).join(", ")}]
    if: \${{ !cancelled() && !failure() && inputs.argocd && inputs.action == 'apply' }}
    uses: ./.github/workflows/argocd-bootstrap.yml
    with:
      environment: \${{ inputs.environment }}
      instance: \${{ inputs.instance }}`);
  return `${HEADER}name: infra

on:
  workflow_dispatch:
    inputs:
${inputs.join("\n")}

permissions:
  id-token: write
  contents: read

jobs:
${jobs.join("\n\n")}
`;
}

function subscriptionMap(m) {
  return JSON.stringify(Object.fromEntries(m.envNames.map((e) => [e, m.environments[e].subscriptionId])));
}

function ghaStackWorkflow(m) {
  const runsOn = JSON.stringify(m.pipelines.githubActions.runsOn).replace(/","/g, '", "');
  return `${HEADER}name: terraform-stack

on:
  workflow_call:
    inputs:
      stack: { type: string, required: true }
      environment: { type: string, required: true }
      instance: { type: string, required: true }
      action: { type: string, required: true }

permissions:
  id-token: write
  contents: read

jobs:
  terraform:
    runs-on: ${runsOn} # inside the VNet
    environment: \${{ inputs.environment }}
    env:
      ARM_CLIENT_ID: \${{ vars.AZURE_CLIENT_ID }} # federated credential for this Environment
      ARM_TENANT_ID: \${{ vars.AZURE_TENANT_ID }}
    steps:
      - uses: actions/checkout@v4
      - uses: hashicorp/setup-terraform@v3
        with:
          terraform_version: ${m.terraform.version}
          terraform_wrapper: false
      - name: plan
        run: bash infra/scripts/tf.sh plan "\${{ inputs.stack }}" "\${{ inputs.environment }}" "\${{ inputs.instance }}" "$RUNNER_TEMP/tfplan"
      - name: apply
        if: \${{ inputs.action == 'apply' }}
        run: bash infra/scripts/tf.sh apply "\${{ inputs.stack }}" "\${{ inputs.environment }}" "\${{ inputs.instance }}" "$RUNNER_TEMP/tfplan"
`;
}

function ghaBootstrapWorkflow(m) {
  const runsOn = JSON.stringify(m.pipelines.githubActions.runsOn).replace(/","/g, '", "');
  return `${HEADER}name: argocd-bootstrap

on:
  workflow_call:
    inputs:
      environment: { type: string, required: true }
      instance: { type: string, required: true }

permissions:
  id-token: write
  contents: read

jobs:
  bootstrap:
    runs-on: ${runsOn} # must reach the private AKS API
    environment: \${{ inputs.environment }}
    steps:
      - uses: actions/checkout@v4
      - uses: azure/login@v2
        with:
          client-id: \${{ vars.AZURE_BOOTSTRAP_CLIENT_ID }} # own identity, not the Terraform one
          tenant-id: \${{ vars.AZURE_TENANT_ID }}
          subscription-id: \${{ fromJSON('${subscriptionMap(m)}')[inputs.environment] }}
      - uses: azure/setup-kubectl@v4
        with:
          version: ${KUBECTL}
      - name: install Argo CD and the root Application
        run: bash infra/scripts/bootstrap-argocd.sh "\${{ inputs.environment }}" "\${{ inputs.instance }}"
`;
}

export function generatePipelines(m) {
  const files = new Map();
  if (m.ci.includes("azure-devops")) {
    files.set("infra/pipelines/azure-pipelines.yml", adoOrchestrator(m));
    files.set("infra/pipelines/templates/terraform-stack.yml", adoStackTemplate(m));
    if (m.gitops) files.set("infra/pipelines/templates/argocd-bootstrap.yml", adoBootstrapTemplate(m));
  }
  if (m.ci.includes("github-actions")) {
    files.set(".github/workflows/infra.yml", ghaOrchestrator(m));
    files.set(".github/workflows/terraform-stack.yml", ghaStackWorkflow(m));
    if (m.gitops) files.set(".github/workflows/argocd-bootstrap.yml", ghaBootstrapWorkflow(m));
  }
  return files;
}
