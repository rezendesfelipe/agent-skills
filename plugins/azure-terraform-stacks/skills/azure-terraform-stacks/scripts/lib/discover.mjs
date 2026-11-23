// Discovery for "audit": reads a repository that has no manifest and describes what is in it.
// Nothing is written and no external tool runs. Roots, pipelines and Applications are recognized
// by their contents, not by folder names. Everything deduced rather than read is tagged `inferred`.
import { readFileSync, statSync } from "node:fs";
import { join, posix } from "node:path";
import YAML from "yaml";
import { walk, stripHclComments, braceBody, lineOf } from "./util.mjs";

const MAX_BYTES = 1_500_000;
const TERRAFORM_WORD = /\bterraform\b|tf\.sh/i;

export const GROUPS = ["network", "compute", "data", "security", "other"];
// Heuristic grouping of Azure resource types, only to describe what a root holds.
const GROUP_RULES = [
  ["network", /^azurerm_(virtual_network|subnet|network_|private_(endpoint|dns|link)|dns_|public_ip|lb|load_balancer|application_gateway|firewall|route|nat_gateway|bastion|express_route|vpn|virtual_wan|frontdoor|cdn|web_application_firewall)/],
  ["compute", /^azurerm_(kubernetes|virtual_machine|linux_|windows_|container_(group|app)|app_service|service_plan|function_app|batch|orchestrated|availability_set)/],
  ["data", /^azurerm_(postgresql|mysql|mssql|sql_|mariadb|cosmosdb|redis|storage_|eventhub|servicebus|data_factory|synapse|kusto|managed_disk|backup)/],
  ["security", /^(azurerm_(user_assigned_identity|role_|federated_identity|key_vault|management_lock)|azuread_)/],
];
export const groupOf = (type) => GROUP_RULES.find(([, re]) => re.test(type))?.[0] ?? "other";

const readText = (root, rel) => {
  const abs = join(root, rel);
  try { if (statSync(abs).size > MAX_BYTES) return null; return readFileSync(abs, "utf8"); } catch { return null; }
};

const yamlDocs = (text) => {
  try { return YAML.parseAllDocuments(text).filter((d) => !d.errors.length).map((d) => d.toJS()).filter((d) => d && typeof d === "object"); } catch { return []; }
};

export function discover(root) {
  const all = walk(root, root);
  const tf = [], yml = [], sh = [];
  let terragrunt = 0;
  for (const f of all) {
    if (f.endsWith(".tf")) tf.push(f);
    else if (/\.ya?ml$/.test(f)) yml.push(f);
    else if (f.endsWith(".sh")) sh.push(f);
    if (f.endsWith("terragrunt.hcl")) terragrunt++;
  }

  // ---- Terraform ----
  const tfFiles = [];
  const byDir = new Map();
  for (const f of tf) {
    const raw = readText(root, f);
    if (raw === null) continue;
    const entry = { file: f, text: stripHclComments(raw) };
    tfFiles.push(entry);
    const dir = posix.dirname(f);
    if (!byDir.has(dir)) byDir.set(dir, []);
    byDir.get(dir).push(entry);
  }
  const moduleSources = (dir) => (byDir.get(dir) ?? []).flatMap(({ text }) => [...text.matchAll(/source\s*=\s*"(\.{1,2}\/[^"]*)"/g)].map((m) => posix.normalize(posix.join(dir, m[1]))));
  const moduleDirs = new Set([...byDir.keys()].flatMap(moduleSources));

  const scriptKeys = [];
  const scripts = [];
  for (const f of [...sh, ...yml]) {
    const text = readText(root, f);
    if (text === null) continue;
    scripts.push({ file: f, text });
    // Literal state file names in scripts and pipelines: a key table in a script, or -backend-config="key=x.tfstate".
    for (const m of text.matchAll(/(?<![\w$.{-])([A-Za-z0-9][\w.-]*\.tfstate)\b/g)) scriptKeys.push({ key: m[1], file: f, line: lineOf(text, m[0]), literal: true });
  }

  const resourcesIn = (dir, seen = new Set()) => {
    const out = { types: {}, local: 0, remote: 0 };
    if (seen.has(dir)) return out;
    seen.add(dir);
    for (const { text } of byDir.get(dir) ?? []) {
      for (const m of text.matchAll(/^\s*resource\s+"([\w]+)"\s+"/gm)) out.types[m[1]] = (out.types[m[1]] ?? 0) + 1;
      for (const m of text.matchAll(/^\s*module\s+"[^"]+"\s*\{([\s\S]*?)\n\}/gm)) {
        const src = /source\s*=\s*"([^"]*)"/.exec(m[1])?.[1] ?? "";
        if (/^\.{1,2}\//.test(src)) {
          out.local++;
          const sub = resourcesIn(posix.normalize(posix.join(dir, src)), seen);
          for (const [t, n] of Object.entries(sub.types)) out.types[t] = (out.types[t] ?? 0) + n;
          out.local += sub.local; out.remote += sub.remote;
        } else out.remote++;
      }
    }
    return out;
  };

  const roots = [];
  const modules = [];
  for (const [dir, files] of [...byDir].sort(([a], [b]) => a.localeCompare(b))) {
    const text = files.map((f) => f.text).join("\n");
    const hasBackend = /\bbackend\s+"[\w-]+"\s*\{/.test(text);
    const hasProvider = /^\s*provider\s+"/m.test(text);
    const hasTerraform = /^\s*terraform\s*\{/m.test(text);
    const isModule = moduleDirs.has(dir);
    if (!(hasBackend || (!isModule && (hasProvider || hasTerraform)))) { if (isModule) modules.push(dir); continue; }

    // backend
    let backend = null;
    for (const f of files) {
      const m = /\bbackend\s+"([\w-]+)"\s*\{/.exec(f.text);
      if (!m) continue;
      const open = m.index + m[0].length - 1;
      const body = braceBody(f.text, open) ?? "";
      const attrs = Object.fromEntries([...body.matchAll(/^\s*(\w+)\s*=\s*"([^"]*)"/gm)].map((x) => [x[1], x[2]]));
      backend = { type: m[1], empty: body.trim() === "", attrs, file: f.file, line: lineOf(f.text, m[0]) };
      break;
    }
    const res = resourcesIn(dir);
    const groups = Object.fromEntries(GROUPS.map((g) => [g, 0]));
    for (const [t, n] of Object.entries(res.types)) groups[groupOf(t)] += n;
    roots.push({
      dir, files: files.map((f) => f.file), backend,
      key: null, // filled below
      resources: Object.values(res.types).reduce((a, b) => a + b, 0), types: res.types, groups,
      localModules: res.local, remoteModules: res.remote,
      usesAzurerm: /\bazurerm\b/.test(text),
    });
  }

  // state key: from the backend block when literal; otherwise from scripts and pipelines, marked inferred
  for (const r of roots) {
    const literal = r.backend?.attrs?.key;
    if (literal) { r.key = { status: "literal", keys: [literal], source: r.backend.file, inferred: false }; continue; }
    if (!r.backend) { r.key = { status: "none", keys: [], inferred: false }; continue; }
    // Compare without "-" and "_": a naming pattern may use either between the parts.
    const norm = (x) => x.toLowerCase().replace(/[-_]/g, "");
    const base = norm(posix.basename(r.dir));
    const hits = [...new Set(scriptKeys.filter((k) => k.literal && base.length >= 3 && norm(k.key).includes(base)).map((k) => k.key))];
    if (hits.length === 1) r.key = { status: "inferred", keys: hits, source: "scripts or pipelines", inferred: true };
    else if (hits.length > 1) r.key = { status: "per-instance", keys: hits, source: "scripts or pipelines", inferred: true };
    else r.key = { status: "unknown", keys: [], inferred: false };
  }

  // ---- Pipelines (GitHub Actions and Azure DevOps entry pipelines and templates) ----
  const pipelines = [];
  const adoTemplates = new Set();
  const adoCandidates = [];
  for (const { file, text } of scripts.filter((s) => /\.ya?ml$/.test(s.file))) {
    const docs = yamlDocs(text);
    const doc = docs[0];
    if (!doc || doc.apiVersion || !TERRAFORM_WORD.test(text)) continue;
    if (/^\.github\/workflows\/[^/]+\.ya?ml$/.test(file)) {
      const on = doc.on ?? doc[true];
      const triggers = typeof on === "string" ? [on] : Array.isArray(on) ? on : Object.keys(on ?? {});
      const inputs = Object.entries(on?.workflow_dispatch?.inputs ?? {}).map(([name, v]) => ({ name, type: v?.type ?? "string", default: v?.default, options: v?.options }));
      pipelines.push({ file, kind: "github-actions", doc, text, entry: !(triggers.length === 1 && triggers[0] === "workflow_call"), triggers, inputs });
    } else if (doc.stages || doc.jobs || doc.steps) {
      adoCandidates.push({ file, doc, text });
      for (const m of text.matchAll(/template:\s*([^\s#]+)/g)) adoTemplates.add(posix.basename(m[1]));
    }
  }
  for (const { file, doc, text } of adoCandidates) {
    const inputs = (Array.isArray(doc.parameters) ? doc.parameters : []).map((p) => ({ name: p.name, type: p.type ?? "string", default: p.default, options: p.values }));
    pipelines.push({ file, kind: "azure-devops", doc, text, entry: !adoTemplates.has(posix.basename(file)), triggers: doc.trigger === undefined ? ["(default CI trigger)"] : [JSON.stringify(doc.trigger)], inputs });
  }
  pipelines.sort((a, b) => a.file.localeCompare(b.file));

  // ---- Argo CD ----
  const applications = [];
  const serviceAccounts = [];
  const bootstrapScripts = [];
  for (const { file, text } of scripts) {
    if (/argo-cd\/[^/\s"']+\/manifests\/install\.yaml|argocd_version=/.test(text)) bootstrapScripts.push({ file, text });
    if (!/\.ya?ml$/.test(file) || !/argoproj\.io|ServiceAccount/.test(text)) continue;
    for (const doc of yamlDocs(text)) {
      if (doc.kind === "Application" && String(doc.apiVersion ?? "").startsWith("argoproj.io/")) {
        applications.push({ file, text, doc, name: doc.metadata?.name, namespace: doc.spec?.destination?.namespace, path: doc.spec?.source?.path ?? "", automated: Boolean(doc.spec?.syncPolicy?.automated), finalizer: (doc.metadata?.finalizers ?? []).includes("resources-finalizer.argocd.argoproj.io") });
      } else if (doc.kind === "ServiceAccount") {
        serviceAccounts.push({ file, name: doc.metadata?.name, namespace: doc.metadata?.namespace, workloadIdentity: Boolean(doc.metadata?.annotations?.["azure.workload.identity/client-id"]) });
      }
    }
  }
  applications.sort((a, b) => a.file.localeCompare(b.file));

  return { root, fileCount: all.length, tfFiles, roots, modules, scripts, scriptKeys, pipelines, applications, serviceAccounts, bootstrapScripts, terragrunt };
}

// The JSON form of the inventory: no file contents, deduced values tagged.
export function inventoryView(inv) {
  return {
    files: inv.fileCount,
    terragruntFiles: inv.terragrunt,
    terraformRoots: inv.roots.map((r) => ({
      dir: r.dir, backend: r.backend ? { type: r.backend.type, partial: r.backend.empty, file: r.backend.file } : null,
      stateKey: { status: r.key.status, keys: r.key.keys, inferred: r.key.inferred },
      resourceBlocks: r.resources, groups: r.groups, localModules: r.localModules, remoteModules: r.remoteModules,
    })),
    terraformModules: inv.modules,
    pipelines: inv.pipelines.map((p) => ({ file: p.file, kind: p.kind, entry: p.entry, triggers: p.triggers, inputs: p.inputs.map((i) => ({ name: i.name, type: i.type, default: i.default })) })),
    argocdApplications: inv.applications.map((a) => ({ file: a.file, name: a.name, namespace: a.namespace, automatedSync: a.automated, finalizer: a.finalizer })),
    argocdBootstrapScripts: inv.bootstrapScripts.map((b) => b.file),
  };
}
