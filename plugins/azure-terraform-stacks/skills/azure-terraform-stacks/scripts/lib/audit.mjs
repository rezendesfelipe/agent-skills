// "audit": reads a repository that has no infra/stacks.yaml and reports against the stacks pattern.
// Read-only: it writes nothing and runs no external tool. The rules that need no manifest are the
// same functions `check` uses (rules.mjs); the rest are listed as not evaluated, with the reason.
import { discover, inventoryView } from "./discover.mjs";
import {
  RULE_DOCS, ruleBackendBlock, ruleTerraformVersion, ruleProviderVersion, ruleRgOwned, ruleCredentials,
  ruleAdoPipeline, ruleAdoParams, ruleAdoBootstrapStage, ruleGhaWorkflow, ruleGhaInputs, ruleGhaBootstrapJob,
  ruleArgoFinalizer, ruleArgoProdSync, ruleBootstrapScript,
} from "./rules.mjs";
import { lineOf } from "./util.mjs";

const NEEDS_MANIFEST = "needs infra/stacks.yaml";
export const NOT_EVALUATED = {
  "state-key": `${NEEDS_MANIFEST} (the naming pattern and the list of stacks)`,
  "pipeline-params": `${NEEDS_MANIFEST} (one parameter per stack)`,
  "pipeline-deps": `${NEEDS_MANIFEST} (the dependency graph)`,
  "lz-dns-zone-group": `${NEEDS_MANIFEST} (the landing zone mode)`,
  "lz-no-local-privatelink-zone": `${NEEDS_MANIFEST} (the landing zone mode)`,
  drift: `${NEEDS_MANIFEST} (what the skill would generate)`,
  "bridge-placeholders": `${NEEDS_MANIFEST} (the outputs mapped to the overlays)`,
};
const PROD = /\bprod(uction)?\b/i;
const ACTION_NAME = /^(action|operation|terraform_?action|command|mode)$/i;
const NOT_COVERED = [
  "terraform fmt, init and validate, actionlint, kustomize build and shellcheck were not run (they would create files in the repository); run them on a copy",
  "a Terraform root is recognized by a backend or provider block, or by a terraform block that no other folder uses as a module; Terragrunt, generated Terraform and dynamic module sources are not followed",
  "values read from variables, workspaces or generated files are not resolved",
];

const SEV = { error: 0, warning: 1, info: 2 };

export function audit(root) {
  const inv = discover(root);
  const findings = [];
  const examined = new Map();
  const DEDUCED = new Set(["state-shared", "state-unknown", "wi-subject"]); // findings built from values the audit inferred
  const add = (rule, severity, file, line, message) => findings.push({ rule, severity, file, line, message, ref: RULE_DOCS[rule], ...(DEDUCED.has(rule) ? { inferred: true } : {}) });
  const saw = (rule, n = 1) => examined.set(rule, (examined.get(rule) ?? 0) + n);

  // ---- Terraform roots ----
  for (const r of inv.roots) {
    const rootFiles = inv.tfFiles.filter((f) => r.files.includes(f.file));
    if (r.backend?.type === "azurerm") {
      saw("backend-partial");
      if (!r.backend.empty) { const f = rootFiles.find((x) => x.file === r.backend.file); ruleBackendBlock(f.file, f.text, add); }
    }
    saw("versions");
    const tvFile = rootFiles.find((f) => /required_version/.test(f.text));
    if (tvFile) ruleTerraformVersion(tvFile.file, tvFile.text, add);
    else add("versions", "error", r.dir, undefined, "no required_version: Terraform must be >= 1.12 (backend OIDC on Azure DevOps)");
    if (r.usesAzurerm) {
      const avFile = rootFiles.find((f) => /azurerm\s*=\s*\{/.test(f.text));
      if (avFile) ruleProviderVersion(avFile.file, avFile.text, add);
      else add("versions", "error", r.dir, undefined, "azurerm has no version constraint: it must be >= 4.65 (rbac_authorization_enabled, user_assigned_identity_id)");
    }
    if (!r.backend) add("state-local", "warning", r.dir, undefined, "no backend block: this root uses local state, which is lost with the machine and cannot be locked");
    else saw("state-local");
    if (r.backend && r.key.status === "unknown") add("state-unknown", "warning", r.backend.file, r.backend.line, `the state key of ${r.dir} is not literal and no script or pipeline names it; the audit cannot tell whether it shares state with another root`);
    if (r.backend) saw("state-unknown");
  }
  // state-shared: two roots that resolve to one key
  const withKeys = inv.roots.filter((r) => r.key.keys.length);
  saw("state-shared", inv.roots.length);
  for (let i = 0; i < withKeys.length; i++) for (let j = i + 1; j < withKeys.length; j++) {
    const a = withKeys[i], b = withKeys[j];
    const common = a.key.keys.filter((k) => b.key.keys.includes(k));
    if (!common.length) continue;
    const acc = (r) => `${r.backend.attrs.storage_account_name ?? "?"}/${r.backend.attrs.container_name ?? "?"}`;
    const sure = a.backend.attrs.storage_account_name && a.backend.attrs.container_name && acc(a) === acc(b) && a.key.status === "literal" && b.key.status === "literal";
    add("state-shared", sure ? "error" : "warning", a.backend.file, a.backend.line, `${a.dir} and ${b.dir} resolve to the same state key ${common[0]}${sure ? ` in ${acc(a)}` : " (storage account or container not stated, or the key was inferred)"}; two roots on one state overwrite each other`);
    if (sure) delete findings.at(-1).inferred; // two literal keys in the same account and container: nothing was deduced
  }
  // rg-owned over every Terraform file
  saw("rg-owned", inv.tfFiles.length);
  ruleRgOwned(inv.tfFiles, add);
  // stored credentials in Terraform, pipelines and scripts
  const credFiles = [...inv.tfFiles, ...inv.pipelines.map((p) => ({ file: p.file, text: p.text })), ...inv.scripts.filter((s) => s.file.endsWith(".sh"))];
  saw("oidc", credFiles.length);
  ruleCredentials(credFiles, add);

  // ---- Pipelines ----
  for (const p of inv.pipelines) {
    const prodPossible = PROD.test(p.text);
    const actionKey = p.inputs.find((i) => ACTION_NAME.test(i.name) && (i.options ?? []).some((o) => /^(plan|apply)$/i.test(String(o))))?.name ?? null;
    const selectors = actionKey ? p.inputs.filter((i) => i.type === "boolean" && i.name !== actionKey).map((i) => i.name) : [];
    const base = { actionKey, requireAction: false, prodPossible, selectors, selectorSeverity: "warning" };
    for (const r of ["manual-trigger", "no-prod-destroy", "plan-default", "gha-inputs", "argocd-apply-only", "oidc"]) saw(r);
    if (p.kind === "azure-devops") {
      const params = ruleAdoPipeline(p.file, p.text, p.doc, { entry: p.entry }, add);
      ruleAdoParams(p.file, p.text, params, base, add);
      ruleAdoBootstrapStage(p.file, p.text, p.doc, add);
    } else {
      const { inputs } = ruleGhaWorkflow(p.file, p.text, p.doc, { allowWorkflowCall: true }, add);
      const hasIdToken = (d) => d?.permissions?.["id-token"] === "write" || Object.values(d?.jobs ?? {}).some((j) => j?.permissions?.["id-token"] === "write");
      const usesOidc = /azure\/login|ARM_USE_OIDC/.test(p.text);
      ruleGhaInputs(p.file, p.text, p.doc, inputs, { ...base, requireIdToken: usesOidc && p.entry && !hasIdToken(p.doc) }, add);
      if (p.entry) ruleGhaBootstrapJob(p.file, p.text, p.doc, add); // a reusable workflow cannot see the caller's action input
    }
  }

  // ---- Argo CD ----
  const dirOf = (f) => f.split("/").slice(0, -1).join("/");
  for (const a of inv.applications) {
    saw("argocd-finalizer"); saw("argocd-prod-sync");
    ruleArgoFinalizer(a.file, a.text, a.doc, add);
    // An app of apps syncs by itself on purpose: what must wait in production are the Applications it creates.
    const path = a.path.replace(/^\.?\//, "").replace(/\/$/, "");
    const appOfApps = Boolean(path) && inv.applications.some((o) => o !== a && (dirOf(o.file) === path || dirOf(o.file).startsWith(`${path}/`)));
    if (!appOfApps) ruleArgoProdSync(a.file, a.text, a.doc, { isProd: PROD.test(`${a.name} ${a.path} ${a.namespace}`), allowAutomated: false, message: "a production Application syncs automatically; production syncs by hand unless you decide otherwise on purpose" }, add);
  }
  for (const b of inv.bootstrapScripts) { saw("argocd-pinned"); ruleBootstrapScript(b.file, b.text, add, { required: false }); }

  // wi-subject, best effort: literal subjects in Terraform against Application namespaces and ServiceAccounts
  const subjects = [];
  for (const f of inv.tfFiles) {
    for (const m of f.text.matchAll(/system:serviceaccount:([\w-]+):([\w-]+)/g)) subjects.push({ file: f.file, text: f.text, ns: m[1], sa: m[2], needle: m[0] });
  }
  if (subjects.length && (inv.applications.length || inv.serviceAccounts.length)) {
    for (const s of subjects) {
      saw("wi-subject");
      const apps = inv.applications.filter((a) => a.namespace === s.ns);
      const sas = inv.serviceAccounts.filter((x) => x.name === s.sa && (!x.namespace || x.namespace === s.ns));
      if (inv.applications.length && !apps.length) add("wi-subject", "warning", s.file, lineOf(s.text, s.needle), `the federated subject names namespace ${s.ns}, but no Argo CD Application deploys to it (best effort, from literals)`);
      else if (inv.serviceAccounts.length && !sas.length) add("wi-subject", "warning", s.file, lineOf(s.text, s.needle), `the federated subject names service account ${s.sa}, but no ServiceAccount with that name was found (best effort, from literals)`);
    }
  }

  // ---- what was and was not evaluated ----
  const emptyReason = {
    "backend-partial": "no Terraform root with an azurerm backend", versions: "no Terraform root", "state-local": "no Terraform root", "state-unknown": "no Terraform root with a backend",
    "state-shared": "no Terraform root", "rg-owned": "no Terraform files", oidc: "nothing to scan",
    "manual-trigger": "no pipeline that runs Terraform", "no-prod-destroy": "no pipeline that runs Terraform", "plan-default": "no pipeline that runs Terraform",
    "gha-inputs": "no pipeline that runs Terraform", "argocd-apply-only": "no pipeline that runs Terraform", "argocd-finalizer": "no Argo CD Application",
    "argocd-prod-sync": "no Argo CD Application", "argocd-pinned": "no Argo CD install script", "wi-subject": "no literal federated subject, or no Argo CD manifests to compare it with",
  };
  const evaluated = [], notEvaluated = [];
  for (const [rule, reason] of Object.entries(emptyReason)) {
    const n = examined.get(rule) ?? 0;
    if (n > 0) evaluated.push({ rule, examined: n }); else notEvaluated.push({ rule, reason: `nothing to examine: ${reason}` });
  }
  for (const [rule, reason] of Object.entries(NOT_EVALUATED)) notEvaluated.push({ rule, reason });
  findings.sort((a, b) => SEV[a.severity] - SEV[b.severity] || a.rule.localeCompare(b.rule) || a.file.localeCompare(b.file));

  const counts = findings.reduce((c, f) => ({ ...c, [f.severity]: (c[f.severity] ?? 0) + 1 }), {});
  return {
    ok: !(counts.error > 0),
    summary: { roots: inv.roots.length, pipelines: inv.pipelines.length, applications: inv.applications.length, findings: counts },
    inventory: inventoryView(inv),
    findings, evaluated, notEvaluated,
    notCovered: [...NOT_COVERED, ...(inv.terragrunt ? [`${inv.terragrunt} terragrunt.hcl file(s) found: Terragrunt is not supported, so the roots above may be incomplete`] : [])],
    nothingFound: inv.roots.length + inv.pipelines.length + inv.applications.length === 0,
  };
}

export function formatAudit(r) {
  const L = [];
  const s = r.summary;
  if (r.nothingFound) {
    L.push("nothing discovered: no Terraform roots, pipelines that run Terraform, or Argo CD Applications");
  } else {
    L.push(`${s.roots} Terraform root(s), ${s.pipelines} pipeline(s) that run Terraform, ${s.applications} Argo CD Application(s); findings: ${s.findings.error ?? 0} error, ${s.findings.warning ?? 0} warning, ${s.findings.info ?? 0} info`);
    L.push("", "Terraform roots (resource blocks, modules expanded once; groups are a heuristic):");
    for (const t of r.inventory.terraformRoots) {
      const g = Object.entries(t.groups).filter(([, n]) => n).map(([k, n]) => `${k} ${n}`).join(", ") || "none";
      const key = t.stateKey.status === "none" ? "no backend" : `${t.backend.type}${t.backend.partial ? " (partial)" : ""}, key ${t.stateKey.status}${t.stateKey.keys.length ? `: ${t.stateKey.keys.slice(0, 2).join(", ")}${t.stateKey.keys.length > 2 ? ", ..." : ""}` : ""}${t.stateKey.inferred ? " [inferred]" : ""}`;
      L.push(`  ${t.dir}: ${t.resourceBlocks} resource blocks (${g}); ${key}`);
    }
    for (const p of r.inventory.pipelines) L.push(`  pipeline ${p.file} (${p.kind}${p.entry ? "" : ", template or reusable"}): triggers ${p.triggers.join(", ")}`);
  }
  L.push("", "Findings:");
  if (!r.findings.length) L.push("  none");
  for (const f of r.findings) L.push(`  ${f.severity === "error" ? "✗" : f.severity === "warning" ? "!" : "-"} [${f.rule}] ${f.file}${f.line ? `:${f.line}` : ""}: ${f.message}${f.inferred ? " [inferred]" : ""}\n      see ${f.ref}`);
  L.push("", "Not evaluated:");
  for (const n of r.notEvaluated) L.push(`  ${n.rule}: ${n.reason}`);
  L.push("", "Not covered by this audit:");
  for (const n of r.notCovered) L.push(`  - ${n}`);
  L.push("", "No file in the repository was changed.");
  return L.join("\n");
}

