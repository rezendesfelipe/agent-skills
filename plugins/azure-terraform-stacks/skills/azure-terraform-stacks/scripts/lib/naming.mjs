// Name derivation: one function for resources, resource groups and state keys,
// for literal names (checks, diagram) and Terraform expressions (generated code).

export const DEFAULT_PATTERN = "{type}-{name}-{env}-{region}-{seq}";
export const TOKENS = ["type", "name", "env", "region", "seq"];

// Cloud Adoption Framework abbreviations used by the skill.
// https://learn.microsoft.com/azure/cloud-adoption-framework/ready/azure-best-practices/resource-abbreviations
export const CAF = {
  rg: "rg",
  vnet: "vnet",
  snet: "snet",
  nsg: "nsg",
  pep: "pep",
  peer: "peer",
  aks: "aks",
  cr: "cr",
  kv: "kv",
  pgsql: "psql",
  id: "id",
  app: "app",
};
// Parte 1 uses "pgsql" for PostgreSQL flexible server; keep it as the default.
CAF.pgsql = "pgsql";

// Resource types whose names cannot hold a separator.
export const NO_SEPARATOR = new Set(["cr", "st"]);

// Length and character rules: https://learn.microsoft.com/azure/azure-resource-manager/management/resource-name-rules
export const RULES = {
  cr: { min: 5, max: 50, re: /^[a-zA-Z0-9]+$/, text: "letters and digits only, 5 to 50 characters" },
  kv: { min: 3, max: 24, re: /^[a-zA-Z][a-zA-Z0-9-]*[a-zA-Z0-9]$/, text: "letters, digits and hyphens, 3 to 24 characters, starting with a letter" },
  pgsql: { min: 3, max: 63, re: /^[a-z0-9][a-z0-9-]*[a-z0-9]$/, text: "lowercase letters, digits and hyphens, 3 to 63 characters" },
  aks: { min: 1, max: 63, re: /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/, text: "letters, digits, hyphens and underscores, up to 63 characters" },
  rg: { min: 1, max: 90, re: /^[\w.()-]+$/, text: "up to 90 characters" },
};

export function splitInstance(instance) {
  const m = /^([a-z0-9]+)-(\d+)$/.exec(instance);
  if (!m) return null;
  return { region: m[1], seq: m[2] };
}

export function naming(manifest) {
  const cfg = manifest.naming ?? {};
  return {
    pattern: cfg.pattern ?? DEFAULT_PATTERN,
    separator: cfg.separator ?? "-",
    abbreviations: { ...CAF, ...(cfg.abbreviations ?? {}) },
  };
}

function render(pattern, sepIn, values, sep) {
  // The pattern uses "-" between tokens in the default; any non-token text is
  // replaced by the configured separator.
  const parts = [];
  const re = /\{(\w+)\}/g;
  let m;
  while ((m = re.exec(pattern))) parts.push(values[m[1]]);
  return parts.filter((p) => p !== "" && p != null).join(sep);
}

export function abbr(n, type) {
  return n.abbreviations[type] ?? type;
}

// Literal name, e.g. aks-core-prod-brs-01
export function literalName(manifest, type, owner, env, instance) {
  const n = naming(manifest);
  const inst = splitInstance(instance);
  const sep = NO_SEPARATOR.has(type) ? "" : n.separator;
  return render(n.pattern, n.separator, {
    type: abbr(n, type), name: owner, env, region: inst?.region ?? instance, seq: inst?.seq ?? "",
  }, sep);
}

export function literalRg(manifest, mainType, owner, env, instance) {
  const n = naming(manifest);
  return `${abbr(n, "rg")}${n.separator}${literalName(manifest, mainType, owner, env, instance)}`;
}

export function stateKey(manifest, stack, env, instance) {
  return `${literalName(manifest, stack.type, stack.owner, env, instance)}.tfstate`;
}

// Terraform expression, e.g. "aks-core-${var.environment}-${local.region_code}-${local.seq}"
export function hclName(manifest, type, owner) {
  const n = naming(manifest);
  const sep = NO_SEPARATOR.has(type) ? "" : n.separator;
  return '"' + render(n.pattern, n.separator, {
    type: abbr(n, type), name: owner, env: "${var.environment}", region: "${local.region_code}", seq: "${local.seq}",
  }, sep) + '"';
}

export function hclRg(manifest, mainType, owner) {
  const n = naming(manifest);
  return '"' + `${abbr(n, "rg")}${n.separator}` + hclName(manifest, mainType, owner).slice(1);
}

export function checkName(type, name) {
  const r = RULES[type];
  if (!r) return null;
  if (name.length < r.min || name.length > r.max || !r.re.test(name)) {
    return `${name} (${name.length} characters) does not follow the ${type} rules: ${r.text}`;
  }
  return null;
}

export function suggestStackName(stack) {
  return `${stack.type}-${stack.owner}`;
}
