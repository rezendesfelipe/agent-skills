// Loads infra/stacks.yaml, fills defaults and validates it (check-manifest).
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import YAML from "yaml";
import {
  TOKENS, splitInstance, literalName, checkName, suggestStackName, naming,
} from "./naming.mjs";

export const PROFILE_MODULES = ["network", "private-endpoint", "postgresql", "key-vault", "workload-identity", "acr", "aks"];
export const TYPE_MODULES = {
  vnet: ["network"],
  aks: ["aks", "acr", "private-endpoint"],
  app: ["postgresql", "key-vault", "private-endpoint", "workload-identity"],
};
export const DEFAULTS = {
  terraform: { version: "1.12.2", requiredVersion: ">= 1.12, < 2.0", azurerm: ">= 4.65, < 5.0" },
  argocdVersion: "v3.6.2",
  azureDevOps: {
    pool: "private-agents",
    serviceConnection: "sc-terraform-{env}",
    bootstrapServiceConnection: "sc-aks-bootstrap-{env}",
    environment: "azure-{env}",
  },
  githubActions: { runsOn: ["self-hosted", "linux", "vnet-private"] },
};
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LOWER = /^[a-z][a-z0-9]*$/;

export function loadManifest(file) {
  const text = readFileSync(file, "utf8");
  let raw;
  try {
    raw = YAML.parse(text);
  } catch (e) {
    return { manifest: null, errors: [{ path: "", message: `YAML: ${e.message}` }] };
  }
  return validateManifest(raw ?? {}, { root: join(file, "..", "..") });
}

export function validateManifest(raw, { root } = {}) {
  const errors = [];
  const warnings = [];
  const err = (path, message) => errors.push({ path, message });
  const m = structuredClone(raw);

  if (m.version !== 1) err("version", "must be 1");

  // regions
  if (!m.regions || typeof m.regions !== "object" || Array.isArray(m.regions) || !Object.keys(m.regions).length) {
    err("regions", "required: map of Azure region name to a short code, e.g. { brazilsouth: brs }");
    m.regions = {};
  }
  for (const [name, code] of Object.entries(m.regions)) {
    if (!/^[a-z0-9]+$/.test(name)) err(`regions.${name}`, "region names are lowercase Azure names such as brazilsouth");
    if (typeof code !== "string" || !/^[a-z0-9]{2,6}$/.test(code)) err(`regions.${name}`, "code must be 2 to 6 lowercase letters or digits");
  }
  const codes = Object.values(m.regions);

  // environments: one subscription each
  if (!m.environments || typeof m.environments !== "object" || Array.isArray(m.environments) || !Object.keys(m.environments).length) {
    err("environments", "required: map of environment name to { subscriptionId }");
    m.environments = {};
  }
  const subs = new Map();
  for (const [env, v] of Object.entries(m.environments)) {
    if (!LOWER.test(env)) err(`environments.${env}`, "environment names are lowercase letters and digits");
    const id = v?.subscriptionId;
    if (!id || !GUID.test(String(id))) err(`environments.${env}.subscriptionId`, "required GUID of the environment's subscription");
    else if (subs.has(id)) err(`environments.${env}.subscriptionId`, `same subscription as ${subs.get(id)}; the skill assumes one subscription per environment`);
    else subs.set(id, env);
  }
  m.envNames = Object.keys(m.environments);

  // instances
  if (!Array.isArray(m.instances) || !m.instances.length) {
    err("instances", "required: list of <region code>-<seq>, e.g. [brs-01]");
    m.instances = [];
  }
  m.instances.forEach((inst, i) => {
    const s = splitInstance(String(inst));
    if (!s) err(`instances[${i}]`, `${inst} is not <region code>-<seq>, e.g. brs-01`);
    else if (!codes.includes(s.region)) err(`instances[${i}]`, `region code ${s.region} is not in regions; known codes: ${codes.join(", ") || "none"}`);
  });
  m.locationOf = (instance) => {
    const s = splitInstance(instance);
    return Object.entries(m.regions).find(([, c]) => c === s?.region)?.[0];
  };

  // naming
  if (m.naming) {
    const p = m.naming.pattern;
    if (p != null) {
      const found = [...String(p).matchAll(/\{(\w+)\}/g)].map((x) => x[1]);
      for (const t of TOKENS) if (!found.includes(t)) err("naming.pattern", `missing {${t}}: names of different ${t === "env" ? "environments" : t === "seq" ? "instances" : t + "s"} would collide`);
      for (const t of found) if (!TOKENS.includes(t)) err("naming.pattern", `unknown token {${t}}; use ${TOKENS.map((x) => `{${x}}`).join(", ")}`);
    }
    if (m.naming.separator != null && !/^[-_]?$/.test(m.naming.separator)) err("naming.separator", 'must be "-", "_" or ""');
  }

  // ci
  const CI = ["azure-devops", "github-actions"];
  if (!Array.isArray(m.ci) || !m.ci.length || m.ci.some((c) => !CI.includes(c))) err("ci", `non-empty subset of ${CI.join(", ")}`);
  m.ci = Array.isArray(m.ci) ? m.ci : [];

  // profile
  m.profile = m.profile ?? "none";
  if (!["none", "private-aks-postgres"].includes(m.profile)) err("profile", "none or private-aks-postgres");

  // state
  const st = m.state ?? {};
  for (const k of ["subscriptionId", "resourceGroup", "storageAccount", "container"]) if (!st[k]) err(`state.${k}`, "required");
  if (st.subscriptionId && !GUID.test(st.subscriptionId)) err("state.subscriptionId", "must be a GUID");
  if (st.storageAccount && !/^[a-z0-9]{3,24}$/.test(st.storageAccount)) err("state.storageAccount", "3 to 24 lowercase letters and digits");
  if (st.subscriptionId && subs.has(st.subscriptionId)) warnings.push({ path: "state.subscriptionId", message: `the state lives in the ${subs.get(st.subscriptionId)} subscription; a separate subscription keeps it outside every stack` });

  // terraform and pipelines defaults
  m.terraform = { ...DEFAULTS.terraform, ...(m.terraform ?? {}) };
  m.pipelines = {
    azureDevOps: { ...DEFAULTS.azureDevOps, ...(m.pipelines?.azureDevOps ?? {}) },
    githubActions: { ...DEFAULTS.githubActions, ...(m.pipelines?.githubActions ?? {}) },
  };

  // landing zone
  m.landingZone = { mode: "standalone", ...(m.landingZone ?? {}) };
  const lz = m.landingZone;
  if (!["standalone", "alz"].includes(lz.mode)) err("landingZone.mode", "standalone or alz");
  if (lz.mode === "alz") {
    lz.peering = lz.peering ?? "managed";
    lz.dnsByPolicy = lz.dnsByPolicy ?? true;
    lz.dnsServers = lz.dnsServers ?? [];
    if (!["managed", "external"].includes(lz.peering)) err("landingZone.peering", "managed or external");
    if (lz.peering === "managed" && !/^\/subscriptions\/.+\/virtualNetworks\/.+$/i.test(lz.hubVnetId ?? "")) err("landingZone.hubVnetId", "required resource ID of the hub VNet when peering is managed");
    if (m.profile === "private-aks-postgres") {
      for (const z of ["acr", "keyVault", "aks", "postgres"]) {
        if (!/^\/subscriptions\/.+\/privateDnsZones\/.+$/i.test(lz.privateDnsZoneIds?.[z] ?? "")) err(`landingZone.privateDnsZoneIds.${z}`, "required resource ID of the central Private DNS zone");
      }
    }
  }

  // stacks
  if (!Array.isArray(m.stacks) || !m.stacks.length) {
    err("stacks", "required: list of { name, type, owner }");
    m.stacks = [];
  }
  const names = new Set();
  m.stacks.forEach((s, i) => {
    const p = `stacks[${i}]`;
    if (!s?.type || !LOWER.test(s.type)) err(`${p}.type`, "required lowercase type, e.g. vnet, aks, app");
    if (!s?.owner || !LOWER.test(s.owner)) err(`${p}.owner`, "required lowercase owner, e.g. core, orders");
    if (s?.type && s?.owner && s.name !== suggestStackName(s)) err(`${p}.name`, `${s.name ?? "(missing)"} must be ${suggestStackName(s)}: a stack is named <type>-<owner>`);
    if (names.has(s.name)) err(`${p}.name`, `duplicate stack ${s.name}`);
    names.add(s.name);
    s.modules = s.modules ?? (m.profile === "private-aks-postgres" ? TYPE_MODULES[s.type] ?? [] : []);
    s.dependsOn = s.dependsOn ?? [];
    s.remoteState = s.remoteState === true;
  });
  m.stacks.forEach((s, i) => {
    s.dependsOn.forEach((d, j) => { if (!names.has(d)) err(`stacks[${i}].dependsOn[${j}]`, `unknown stack ${d}`); });
    s.modules.forEach((mod, j) => {
      const bundled = m.profile === "private-aks-postgres" && PROFILE_MODULES.includes(mod);
      const local = root && existsSync(join(root, "infra", "modules", mod));
      if (!bundled && !local) err(`stacks[${i}].modules[${j}]`, `unknown module ${mod}: not bundled by the profile and not in infra/modules/`);
    });
  });
  const cycle = findCycle(m.stacks);
  if (cycle) err("stacks", `dependency cycle: ${cycle.join(" -> ")}`);
  m.stacks = topoSort(m.stacks);

  if (m.profile === "private-aks-postgres") {
    const count = (t) => m.stacks.filter((s) => s.type === t).length;
    if (count("vnet") !== 1) err("stacks", "the private-aks-postgres profile needs exactly one stack of type vnet");
    if (count("aks") !== 1) err("stacks", "the private-aks-postgres profile needs exactly one stack of type aks");
    if (count("app") < 1) err("stacks", "the private-aks-postgres profile needs at least one stack of type app");
    const net = m.stacks.find((s) => s.type === "vnet");
    const aks = m.stacks.find((s) => s.type === "aks");
    for (const s of m.stacks) {
      const need = s.type === "aks" ? [net] : s.type === "app" ? [net, aks] : [];
      for (const n of need) if (n && !s.dependsOn.includes(n.name)) warnings.push({ path: `stacks.${s.name}.dependsOn`, message: `${s.name} reads ${n.name}; add it to dependsOn so the pipeline runs it first` });
    }
  }
  m.networkStack = m.stacks.find((s) => s.type === "vnet");
  m.clusterStack = m.stacks.find((s) => s.type === "aks");
  m.appStacks = m.stacks.filter((s) => s.type === "app");

  // gitops
  if (m.gitops) {
    const g = m.gitops;
    if (g.tool !== "argocd") err("gitops.tool", "argocd");
    g.argocdVersion = g.argocdVersion ?? DEFAULTS.argocdVersion;
    if (!/^v\d+\.\d+\.\d+$/.test(g.argocdVersion)) err("gitops.argocdVersion", "pinned version such as v3.6.2");
    if (!g.repoURL) err("gitops.repoURL", "required Git URL the cluster reads");
    g.targetRevision = g.targetRevision ?? "main";
    if (!m.clusterStack) err("gitops", "needs a stack of type aks");
    g.apps = Array.isArray(g.apps) ? g.apps : [];
    if (!g.apps.length) err("gitops.apps", "at least one app");
    g.apps.forEach((a, i) => {
      const p = `gitops.apps[${i}]`;
      if (!a.name || !LOWER.test(a.name)) err(`${p}.name`, "required lowercase name");
      const st = m.stacks.find((s) => s.name === a.stack);
      if (!st) err(`${p}.stack`, `unknown stack ${a.stack}`);
      a.namespace = a.namespace ?? a.name;
      a.serviceAccount = a.serviceAccount ?? a.name;
      a.image = a.image ?? a.name;
      a.tag = String(a.tag ?? "0.1.0");
      a.autoSync = Object.fromEntries(m.envNames.map((e) => [e, a.autoSync?.[e] ?? e !== "prod"]));
      a.values = a.values ?? (m.profile === "private-aks-postgres" ? { DB_HOST: "postgres_fqdn", clientId: "app_client_id" } : {});
    });
  }

  // diagram theme
  m.diagram = { theme: "default", ...(m.diagram ?? {}) };

  // GitHub inputs
  if (m.ci.includes("github-actions")) {
    const inputs = 3 + m.stacks.length + (m.gitops ? 1 : 0);
    if (inputs > 25) err("stacks", `the GitHub orchestrator would have ${inputs} inputs; workflow_dispatch allows 25`);
  }

  // global and restricted names, for every environment and instance
  if (!errors.length && m.profile === "private-aks-postgres") {
    for (const env of m.envNames) for (const inst of m.instances) {
      const checks = [["aks", m.clusterStack.owner], ["cr", m.clusterStack.owner]];
      for (const a of m.appStacks) checks.push(["kv", a.owner], ["pgsql", a.owner]);
      for (const [type, owner] of checks) {
        const msg = checkName(type, literalName(m, type, owner, env, inst));
        if (msg) err(`naming (${env}, ${inst})`, msg);
      }
    }
  }
  m.namingConfig = naming(m);
  return { manifest: errors.length ? null : m, errors, warnings, raw };
}

function findCycle(stacks) {
  const by = new Map(stacks.map((s) => [s.name, s]));
  const state = new Map();
  const path = [];
  const visit = (n) => {
    if (state.get(n) === 1) return [...path.slice(path.indexOf(n)), n];
    if (state.get(n) === 2) return null;
    state.set(n, 1); path.push(n);
    for (const d of by.get(n)?.dependsOn ?? []) { if (!by.has(d)) continue; const c = visit(d); if (c) return c; }
    path.pop(); state.set(n, 2);
    return null;
  };
  for (const s of stacks) { const c = visit(s.name); if (c) return c; }
  return null;
}

function topoSort(stacks) {
  const by = new Map(stacks.map((s) => [s.name, s]));
  const out = []; const seen = new Set();
  const visit = (s) => {
    if (!s || seen.has(s.name)) return;
    seen.add(s.name);
    for (const d of s.dependsOn) visit(by.get(d));
    out.push(s);
  };
  stacks.forEach(visit);
  return out;
}

// All stacks a stack depends on, directly or not.
export function transitiveDeps(manifest, name) {
  const by = new Map(manifest.stacks.map((s) => [s.name, s]));
  const out = new Set();
  const walk = (n) => { for (const d of by.get(n)?.dependsOn ?? []) if (!out.has(d)) { out.add(d); walk(d); } };
  walk(name);
  return out;
}

export const camel = (s) => s.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());
export const snake = (s) => s.replace(/-/g, "_");
