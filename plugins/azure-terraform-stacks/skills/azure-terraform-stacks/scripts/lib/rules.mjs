// Rules that need no manifest. `check` (with the manifest) and `audit` (without) call the same
// functions, so a finding has the same id, wording and reference in both. Each function receives
// what was read from one file (or a list of files), a context for the few things that differ,
// and `add(rule, severity, file, line, message)`.
import YAML from "./yaml.mjs";
import { lineOf, lineAfter, older, lowerBound } from "./util.mjs";
import { DEFAULTS } from "./manifest.mjs";
import { FINALIZER } from "./gen-gitops.mjs";

export const RULE_DOCS = {
  "state-key": "references/stacks-and-state.md#state-keys",
  "backend-partial": "references/stacks-and-state.md#backend",
  "pipeline-params": "references/pipelines-azure-devops.md",
  "pipeline-deps": "references/pipelines-azure-devops.md#dependencies",
  "no-prod-destroy": "references/traps.md#destroy-in-production",
  "manual-trigger": "references/traps.md#who-can-click-run",
  "plan-default": "references/traps.md#partial-selection",
  oidc: "references/pipelines-github-actions.md#oidc",
  "wi-subject": "references/gitops-argocd.md#workload-identity",
  "argocd-prod-sync": "references/gitops-argocd.md#sync-policy",
  "argocd-finalizer": "references/gitops-argocd.md#finalizer",
  "argocd-pinned": "references/gitops-argocd.md#bootstrap",
  "argocd-apply-only": "references/gitops-argocd.md#bootstrap",
  "bridge-placeholders": "references/gitops-argocd.md#bridge",
  "gha-inputs": "references/pipelines-github-actions.md",
  "rg-owned": "references/traps.md#resource-groups",
  versions: "references/stacks-and-state.md#versions",
  "lz-dns-zone-group": "references/landing-zones.md",
  "lz-no-local-privatelink-zone": "references/landing-zones.md",
  drift: "references/manifest-format.md#regenerating",
  manifest: "references/manifest-format.md",
  "state-shared": "references/stacks-and-state.md#state-keys",
  "state-local": "references/stacks-and-state.md#backend",
  "state-unknown": "references/stacks-and-state.md#state-keys",
};

export const BOOTSTRAP_NAME = /argocd.?bootstrap|bootstrap.?argocd/i;

// ---- Terraform ----

// An azurerm backend block must be empty (values come from terraform init -backend-config).
export function ruleBackendBlock(file, text, add) {
  if (!/backend\s+"azurerm"\s*\{\s*\}/.test(text)) add("backend-partial", "error", file, lineOf(text, 'backend "azurerm"'), "the backend block must be empty: values come from terraform init -backend-config");
}

export function ruleTerraformVersion(file, text, add) {
  const tv = lowerBound(/required_version\s*=\s*"([^"]+)"/.exec(text)?.[1]);
  if (!tv || older(tv, "1.12.0")) add("versions", "error", file, lineOf(text, "required_version"), "Terraform must be >= 1.12 (backend OIDC on Azure DevOps)");
}
export function ruleProviderVersion(file, text, add) {
  const av = lowerBound(/azurerm\s*=\s*\{[^}]*version\s*=\s*"([^"]+)"/s.exec(text)?.[1]);
  if (!av || older(av, "4.65.0")) add("versions", "error", file, lineOf(text, "azurerm"), "azurerm must be >= 4.65 (rbac_authorization_enabled, user_assigned_identity_id)");
}
export function ruleVersions(file, text, add) {
  ruleTerraformVersion(file, text, add);
  ruleProviderVersion(file, text, add);
}

// Every resource group a data source reads is created by some root. files: [{ file, text }]
export function ruleRgOwned(files, add) {
  const created = new Set();
  const read = [];
  for (const { file, text } of files) {
    for (const r of text.matchAll(/resource\s+"azurerm_resource_group"\s+"\w+"\s*\{\s*name\s*=\s*("[^"]+")/g)) created.add(r[1]);
    for (const d of text.matchAll(/data\s+"azurerm_[a-z_]+"\s+"\w+"\s*\{([\s\S]*?)\n\}/g)) {
      const rg = /resource_group_name\s*=\s*("[^"]+")/.exec(d[1])?.[1];
      if (rg) read.push([file, rg, text]);
    }
  }
  for (const [file, rg, text] of read) if (!created.has(rg)) add("rg-owned", "error", file, lineOf(text, rg), `reads resource group ${rg}, which no stack creates`);
}

// No stored credentials in pipelines or scripts. files: [{ file, text }]
export function ruleCredentials(files, add) {
  for (const { file, text } of files) {
    const bad = /(ARM_CLIENT_SECRET|ARM_ACCESS_KEY|client-secret:|(?<!\w)access_key\s*=|servicePrincipalKey)/.exec(text);
    if (bad) add("oidc", "error", file, lineOf(text, bad[1]), `uses ${bad[1]}; authenticate with workload identity federation (OIDC) instead`);
  }
}

// ---- Pipelines ----
// ctx: { prodPossible, actionKey, requireAction, selectors, selectorSeverity }
//   prodPossible   the pipeline can target prod (the manifest has a prod environment, or the pipeline offers one)
//   actionKey      name of the plan/apply input (null: none found)
//   requireAction  report a missing action input as "must default to plan" (check does; audit does not)
//   selectors      names of boolean stack-selector inputs that must default to false
//   selectorSeverity  severity for those

// An Azure DevOps entry pipeline. Returns the parameters by name.
export function ruleAdoPipeline(file, text, doc, ctx, add) {
  if (ctx.entry !== false && doc.trigger !== "none") add("manual-trigger", "error", file, lineOf(text, /^trigger\s*:/) ?? lineOf(text, "trigger"), "trigger must be none: a triggered run uses the defaults");
  const params = new Map((doc.parameters ?? []).map((p) => [p.name, p]));
  return params;
}
export function ruleAdoParams(file, text, params, ctx, add) {
  const act = params.get(ctx.actionKey);
  if (act ? act.default !== "plan" : ctx.requireAction) add("plan-default", "error", file, lineOf(text, `name: ${ctx.actionKey ?? "action"}`), "action must default to plan");
  if (act && ctx.prodPossible && (act.values ?? []).includes("destroy")) add("no-prod-destroy", "error", file, lineAfter(text, `name: ${ctx.actionKey}`, "destroy"), "destroy is offered while prod is an environment");
  for (const n of ctx.selectors ?? []) {
    const p = params.get(n);
    if (p && p.default !== false) add("plan-default", ctx.selectorSeverity ?? "error", file, lineOf(text, `name: ${n}`), `${n} must default to false`);
  }
}
// The stage that bootstraps Argo CD must be inserted only when action is apply.
export function ruleAdoBootstrapStage(file, text, doc, add) {
  for (const item of doc.stages ?? []) {
    const [cond, body] = Object.entries(item)[0] ?? [];
    const tpl = Array.isArray(body) ? body[0] : null;
    if (!tpl?.template || !BOOTSTRAP_NAME.test(tpl.template)) continue;
    if (!/eq\(parameters\.action, 'apply'\)/.test(cond)) add("argocd-apply-only", "error", file, lineOf(text, BOOTSTRAP_NAME), "the bootstrap stage must be inserted only when action is apply");
  }
}

// A GitHub Actions workflow. Returns { on, inputs }.
export function ruleGhaWorkflow(file, text, doc, ctx, add) {
  const on = doc.on ?? doc[true];
  let triggers = typeof on === "string" ? [on] : Array.isArray(on) ? on : Object.keys(on ?? {});
  if (ctx.allowWorkflowCall) triggers = triggers.filter((t) => t !== "workflow_call");
  if (triggers.some((t) => t !== "workflow_dispatch")) add("manual-trigger", "error", file, lineOf(text, /^on\s*:/) ?? lineOf(text, "on:"), `only workflow_dispatch is allowed, found ${triggers.join(", ")}`);
  const inputs = on?.workflow_dispatch?.inputs ?? {};
  return { on, inputs };
}
export function ruleGhaInputs(file, text, doc, inputs, ctx, add) {
  if (Object.keys(inputs).length > 25) add("gha-inputs", "error", file, undefined, `${Object.keys(inputs).length} inputs; workflow_dispatch allows 25`);
  const act = inputs[ctx.actionKey];
  if (act ? act.default !== "plan" : ctx.requireAction) add("plan-default", "error", file, lineOf(text, `${ctx.actionKey ?? "action"}:`), "action must default to plan");
  if (act && ctx.prodPossible && (act.options ?? []).includes("destroy")) add("no-prod-destroy", "error", file, lineAfter(text, `${ctx.actionKey}:`, "destroy"), "destroy is offered while prod is an environment");
  for (const n of ctx.selectors ?? []) {
    const i = inputs[n];
    if (i && i.default !== false) add("plan-default", ctx.selectorSeverity ?? "error", file, lineOf(text, `${n}:`), `${n} must default to false`);
  }
  if (ctx.requireIdToken && doc.permissions?.["id-token"] !== "write") add("oidc", "error", file, lineOf(text, "permissions"), "needs permissions: id-token: write for OIDC");
}
// The job that bootstraps Argo CD must run only when action is apply.
export function ruleGhaBootstrapJob(file, text, doc, add) {
  for (const [name, job] of Object.entries(doc.jobs ?? {})) {
    const looksLikeBootstrap = BOOTSTRAP_NAME.test(job?.uses ?? "") || BOOTSTRAP_NAME.test(name) || (job?.steps ?? []).some((s) => BOOTSTRAP_NAME.test(s?.run ?? "") || BOOTSTRAP_NAME.test(s?.uses ?? ""));
    if (looksLikeBootstrap && !/inputs\.action == 'apply'/.test(job.if ?? "")) add("argocd-apply-only", "error", file, lineOf(text, `  ${name}:`), "the bootstrap job must run only when action is apply");
  }
}

// ---- Argo CD ----

export function ruleArgoFinalizer(file, text, doc, add) {
  if (!(doc?.metadata?.finalizers ?? []).includes(FINALIZER)) add("argocd-finalizer", "error", file, lineOf(text, "metadata:"), `add the ${FINALIZER} finalizer`);
}
// Production syncs by hand unless the user decided otherwise.
export function ruleArgoProdSync(file, text, doc, ctx, add) {
  if (ctx.isProd && doc?.spec?.syncPolicy?.automated && !ctx.allowAutomated) add("argocd-prod-sync", "error", file, lineOf(text, "automated"), ctx.message ?? "prod syncs manually unless automated sync is decided on purpose");
}
// The bootstrap script installs a pinned Argo CD. required: a script without a version is itself a finding (check).
export function ruleBootstrapScript(file, text, add, { required = true } = {}) {
  const byVar = /argocd_version="([^"]+)"/.exec(text)?.[1];
  const byUrl = /argo-cd\/([^/\s"']+)\/manifests\/install\.yaml/.exec(text)?.[1];
  const v = byVar ?? (byUrl && !byUrl.includes("$") ? byUrl : undefined);
  if (!required && !byVar && !byUrl) return;
  const line = lineOf(text, byVar ? "argocd_version" : "install.yaml");
  if (!v || !/^v\d+\.\d+\.\d+$/.test(v) || /stable|latest/.test(text.match(/install\.yaml.*/)?.[0] ?? "")) add("argocd-pinned", "error", file, line, "install a pinned Argo CD version (vX.Y.Z), not stable or latest");
  else if (older(v, DEFAULTS.argocdVersion)) add("argocd-pinned", "warning", file, line, `${v} is older than ${DEFAULTS.argocdVersion}, the version this skill was tested with; check the current stable release`);
}

export const parseYaml = (text) => { try { return YAML.parse(text); } catch { return null; } };
