// "check": rules from the articles' traps and the code review, run on an existing repository.
import { existsSync, readFileSync, readdirSync, statSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { spawnSync } from "node:child_process";
import YAML from "yaml";
import { camel, snake, transitiveDeps, DEFAULTS } from "./manifest.mjs";
import { stateKey, literalRg, literalName } from "./naming.mjs";
import { generateAll } from "./generate.mjs";
import { bootstrapDeps } from "./gen-pipelines.mjs";
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
};

function walk(dir, root = dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (e === ".terraform" || e === "node_modules" || e === ".git") continue;
    if (statSync(p).isDirectory()) walk(p, root, out); else out.push(relative(root, p));
  }
  return out;
}

const lineOf = (text, re) => {
  const lines = text.split("\n");
  const i = lines.findIndex((l) => (typeof re === "string" ? l.includes(re) : re.test(l)));
  return i < 0 ? undefined : i + 1;
};

const semver = (v) => v.replace(/^v/, "").split(".").map(Number);
const older = (a, b) => { const x = semver(a), y = semver(b); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i]; return false; };
const lowerBound = (c) => { const m = />=\s*([\d.]+)/.exec(c ?? ""); return m ? m[1] : null; };

export function runCheck(root, m) {
  const findings = [];
  const add = (rule, severity, file, line, message) => findings.push({ rule, severity, file, line, message, ref: RULE_DOCS[rule] });
  const read = (p) => (existsSync(join(root, p)) ? readFileSync(join(root, p), "utf8") : null);
  const expected = generateAll(m);

  // drift: files the manifest generates that differ or are missing
  for (const [p, content] of expected) {
    const cur = read(p);
    if (cur === null) add("drift", "warning", p, undefined, "missing; run scaffold to create it");
    else if (cur !== content && !/\/overlays\//.test(p)) add("drift", "warning", p, undefined, "differs from what infra/stacks.yaml generates; regenerate with scaffold --force or move the change into the manifest");
  }

  // state-key
  const tfsh = read("infra/scripts/tf.sh");
  if (tfsh) {
    for (const s of m.stacks) for (const env of m.envNames) for (const inst of m.instances) {
      const want = stateKey(m, s, env, inst);
      const re = new RegExp(`"${s.name}:${env}:${inst}"\\)\\s*echo\\s*"([^"]+)"`);
      const got = re.exec(tfsh)?.[1];
      if (got !== want) add("state-key", "error", "infra/scripts/tf.sh", lineOf(tfsh, `"${s.name}:${env}:${inst}"`), `${s.name} ${env} ${inst}: found ${got ?? "no key"}, expected ${want}`);
    }
  }
  const valid = new Set(m.stacks.flatMap((s) => m.envNames.flatMap((e) => m.instances.map((i) => stateKey(m, s, e, i)))));
  for (const f of [...walk(join(root, "infra"), root), ...walk(join(root, ".github"), root)].filter((f) => /\.(ya?ml|sh)$/.test(f))) {
    const text = read(f);
    for (const mt of text.matchAll(/key=([\w.${}-]+\.tfstate)/g)) {
      if (!mt[1].includes("$") && !valid.has(mt[1])) add("state-key", "error", f, lineOf(text, mt[0]), `found key=${mt[1]}; expected one of the manifest's keys, e.g. ${[...valid][0]}`);
    }
  }

  // backend-partial and versions
  for (const s of m.stacks) {
    const dir = `infra/stacks/${s.name}`;
    const tfFiles = walk(join(root, dir), root).filter((f) => f.endsWith(".tf"));
    const all = tfFiles.map((f) => [f, read(f)]);
    const backend = all.find(([, t]) => /backend\s+"azurerm"/.test(t));
    if (!backend) add("backend-partial", "error", dir, undefined, 'no backend "azurerm" block');
    else if (!/backend\s+"azurerm"\s*\{\s*\}/.test(backend[1])) add("backend-partial", "error", backend[0], lineOf(backend[1], 'backend "azurerm"'), "the backend block must be empty: values come from terraform init -backend-config");
    const versions = all.find(([, t]) => /required_version/.test(t));
    if (versions) {
      const tv = lowerBound(/required_version\s*=\s*"([^"]+)"/.exec(versions[1])?.[1]);
      const av = lowerBound(/azurerm\s*=\s*\{[^}]*version\s*=\s*"([^"]+)"/s.exec(versions[1])?.[1]);
      if (!tv || older(tv, "1.12.0")) add("versions", "error", versions[0], lineOf(versions[1], "required_version"), "Terraform must be >= 1.12 (backend OIDC on Azure DevOps)");
      if (!av || older(av, "4.65.0")) add("versions", "error", versions[0], lineOf(versions[1], "azurerm"), "azurerm must be >= 4.65 (rbac_authorization_enabled, user_assigned_identity_id)");
    }
  }

  // rg-owned: every resource group a data source reads is created by a stack
  const created = new Set();
  const readRgs = [];
  for (const s of m.stacks) for (const f of walk(join(root, `infra/stacks/${s.name}`), root).filter((x) => x.endsWith(".tf"))) {
    const t = read(f);
    for (const r of t.matchAll(/resource\s+"azurerm_resource_group"\s+"\w+"\s*\{\s*name\s*=\s*("[^"]+")/g)) created.add(r[1]);
    for (const d of t.matchAll(/data\s+"azurerm_[a-z_]+"\s+"\w+"\s*\{([\s\S]*?)\n\}/g)) {
      const rg = /resource_group_name\s*=\s*("[^"]+")/.exec(d[1])?.[1];
      if (rg) readRgs.push([f, rg, t]);
    }
  }
  for (const [f, rg, t] of readRgs) if (!created.has(rg)) add("rg-owned", "error", f, lineOf(t, rg), `reads resource group ${rg}, which no stack creates`);
  const boot = read("infra/scripts/bootstrap-argocd.sh");
  if (boot && m.clusterStack) for (const env of m.envNames) for (const inst of m.instances) {
    const want = literalRg(m, "aks", m.clusterStack.owner, env, inst);
    if (!boot.includes(` ${want} `)) add("rg-owned", "error", "infra/scripts/bootstrap-argocd.sh", undefined, `${env} ${inst}: expected cluster resource group ${want}`);
  }

  // Azure DevOps
  const adoFile = "infra/pipelines/azure-pipelines.yml";
  const ado = m.ci.includes("azure-devops") ? read(adoFile) : null;
  if (ado) {
    let doc; try { doc = YAML.parse(ado); } catch (e) { add("pipeline-params", "error", adoFile, undefined, `YAML: ${e.message}`); }
    if (doc) {
      if (doc.trigger !== "none") add("manual-trigger", "error", adoFile, lineOf(ado, "trigger"), "trigger must be none: a triggered run uses the defaults");
      const params = new Map((doc.parameters ?? []).map((p) => [p.name, p]));
      const expectedParams = ["environment", "instance", "action", ...m.stacks.map((s) => camel(s.name)), ...(m.gitops ? ["argocd"] : [])];
      for (const n of expectedParams) if (!params.has(n)) add("pipeline-params", "error", adoFile, undefined, `missing parameter ${n}`);
      for (const n of params.keys()) if (!expectedParams.includes(n)) add("pipeline-params", "error", adoFile, lineOf(ado, `name: ${n}`), `parameter ${n} has no stack in the manifest`);
      const action = params.get("action");
      if (action && action.default !== "plan") add("plan-default", "error", adoFile, lineOf(ado, "name: action"), "action must default to plan");
      if (action && m.envNames.includes("prod") && (action.values ?? []).includes("destroy")) add("no-prod-destroy", "error", adoFile, lineOf(ado, "destroy"), "destroy is offered while prod is an environment");
      for (const s of m.stacks) { const p = params.get(camel(s.name)); if (p && p.default !== false) add("plan-default", "error", adoFile, lineOf(ado, `name: ${camel(s.name)}`), `${camel(s.name)} must default to false`); }
      // dependencies
      for (const item of doc.stages ?? []) {
        const [cond, body] = Object.entries(item)[0] ?? [];
        const stackParam = /eq\(parameters\.(\w+), true\)\s*\}\}$/.exec(cond ?? "")?.[1];
        const tpl = Array.isArray(body) ? body[0] : null;
        if (!tpl?.template) continue;
        if (/argocd-bootstrap/.test(tpl.template)) {
          if (!/eq\(parameters\.action, 'apply'\)/.test(cond)) add("argocd-apply-only", "error", adoFile, lineOf(ado, "argocd-bootstrap"), "the bootstrap stage must be inserted only when action is apply");
          continue;
        }
        const s = m.stacks.find((x) => camel(x.name) === stackParam);
        if (!s) continue;
        const want = [...transitiveDeps(m, s.name)].map(snake).sort();
        const got = (tpl.parameters?.dependsOn ?? []).flatMap((d) => Object.values(d).flat()).sort();
        if (JSON.stringify(want) !== JSON.stringify(got)) add("pipeline-deps", "error", adoFile, lineOf(ado, `stack: ${s.name}`), `${s.name} depends on [${got.join(", ")}], the manifest says [${want.join(", ")}]`);
        for (const d of tpl.parameters?.dependsOn ?? []) {
          const [k, v] = Object.entries(d)[0] ?? [];
          const dep = m.stacks.find((x) => snake(x.name) === [].concat(v ?? [])[0]);
          const param = /^\$\{\{ if eq\(parameters\.(\w+), true\) \}\}$/.exec(k ?? "")?.[1];
          if (!dep || param !== camel(dep.name)) add("pipeline-deps", "error", adoFile, lineOf(ado, `stack: ${s.name}`), `dependency ${JSON.stringify(d)} must be inserted only when its own stack is selected`);
        }
      }
    }
  }

  // GitHub Actions
  const ghaFile = ".github/workflows/infra.yml";
  const gha = m.ci.includes("github-actions") ? read(ghaFile) : null;
  if (gha) {
    let doc; try { doc = YAML.parse(gha); } catch (e) { add("pipeline-params", "error", ghaFile, undefined, `YAML: ${e.message}`); }
    if (doc) {
      const on = doc.on ?? doc[true];
      const triggers = typeof on === "string" ? [on] : Object.keys(on ?? {});
      if (triggers.some((t) => t !== "workflow_dispatch")) add("manual-trigger", "error", ghaFile, lineOf(gha, "on:"), `only workflow_dispatch is allowed, found ${triggers.join(", ")}`);
      const inputs = on?.workflow_dispatch?.inputs ?? {};
      const expectedInputs = ["environment", "instance", "action", ...m.stacks.map((s) => snake(s.name)), ...(m.gitops ? ["argocd"] : [])];
      for (const n of expectedInputs) if (!inputs[n]) add("pipeline-params", "error", ghaFile, undefined, `missing input ${n}`);
      for (const n of Object.keys(inputs)) if (!expectedInputs.includes(n)) add("pipeline-params", "error", ghaFile, lineOf(gha, `${n}:`), `input ${n} has no stack in the manifest`);
      if (Object.keys(inputs).length > 25) add("gha-inputs", "error", ghaFile, undefined, `${Object.keys(inputs).length} inputs; workflow_dispatch allows 25`);
      if (inputs.action?.default !== "plan") add("plan-default", "error", ghaFile, lineOf(gha, "action:"), "action must default to plan");
      if (m.envNames.includes("prod") && (inputs.action?.options ?? []).includes("destroy")) add("no-prod-destroy", "error", ghaFile, lineOf(gha, "destroy"), "destroy is offered while prod is an environment");
      for (const s of m.stacks) { const i = inputs[snake(s.name)]; if (i && i.default !== false) add("plan-default", "error", ghaFile, lineOf(gha, `${snake(s.name)}:`), `${snake(s.name)} must default to false`); }
      if (doc.permissions?.["id-token"] !== "write") add("oidc", "error", ghaFile, lineOf(gha, "permissions"), "needs permissions: id-token: write for OIDC");
      for (const s of m.stacks) {
        const job = doc.jobs?.[s.name];
        if (!job) continue;
        const want = [...transitiveDeps(m, s.name)].sort();
        const got = [].concat(job.needs ?? []).sort();
        if (JSON.stringify(want) !== JSON.stringify(got)) add("pipeline-deps", "error", ghaFile, lineOf(gha, `  ${s.name}:`), `${s.name} needs [${got.join(", ")}], the manifest says [${want.join(", ")}]`);
        if (want.length && !/!cancelled\(\) && !failure\(\)/.test(job.if ?? "")) add("pipeline-deps", "error", ghaFile, lineOf(gha, `  ${s.name}:`), "use !cancelled() && !failure() so the job runs when a dependency was skipped");
      }
      if (m.gitops) {
        const job = doc.jobs?.argocd;
        if (job && !/inputs\.action == 'apply'/.test(job.if ?? "")) add("argocd-apply-only", "error", ghaFile, lineOf(gha, "  argocd:"), "the bootstrap job must run only when action is apply");
        if (job) {
          const want = bootstrapDeps(m).map((s) => s.name).sort();
          const got = [].concat(job.needs ?? []).sort();
          if (JSON.stringify(want) !== JSON.stringify(got)) add("pipeline-deps", "error", ghaFile, lineOf(gha, "  argocd:"), `argocd needs [${got.join(", ")}], expected [${want.join(", ")}]`);
        }
      }
    }
  }

  // oidc: no stored credentials anywhere in pipelines or scripts
  for (const f of [...walk(join(root, "infra/pipelines"), root), ...walk(join(root, ".github/workflows"), root), ...walk(join(root, "infra/scripts"), root)]) {
    const t = read(f);
    const bad = /(ARM_CLIENT_SECRET|ARM_ACCESS_KEY|client-secret:|access_key\s*=|servicePrincipalKey)/.exec(t);
    if (bad) add("oidc", "error", f, lineOf(t, bad[1]), `uses ${bad[1]}; authenticate with workload identity federation (OIDC) instead`);
  }

  // landing zone
  if (m.landingZone.mode === "alz") {
    for (const s of m.stacks) {
      const t = read(`infra/stacks/${s.name}/main.tf`);
      if (!t) continue;
      if (m.landingZone.dnsByPolicy && /dns_by_policy\s*=\s*false/.test(t)) add("lz-dns-zone-group", "error", `infra/stacks/${s.name}/main.tf`, lineOf(t, /dns_by_policy\s*=\s*false/), "dnsByPolicy is on: Private Endpoints must leave the DNS zone group to Azure Policy");
      if (/private_dns_zone_group\s*\{/.test(t) && m.landingZone.dnsByPolicy) add("lz-dns-zone-group", "error", `infra/stacks/${s.name}/main.tf`, lineOf(t, "private_dns_zone_group"), "no DNS zone group when DNS is created by policy");
      if (/"privatelink\.[^"]+"/.test(t) && /private_dns_zones\s*=/.test(t) && !/private_dns_zones\s*=\s*\{\}/.test(t)) add("lz-no-local-privatelink-zone", "error", `infra/stacks/${s.name}/main.tf`, lineOf(t, "privatelink."), "alz mode: privatelink zones are central, do not create them in the spoke");
    }
  }

  // GitOps
  if (m.gitops) {
    for (const a of m.gitops.apps) {
      const stackMain = read(`infra/stacks/${a.stack}/main.tf`);
      if (stackMain) {
        const ns = /namespace\s*=\s*"([^"]+)"/.exec(stackMain)?.[1];
        const sa = /service_account_name\s*=\s*"([^"]+)"/.exec(stackMain)?.[1];
        if (ns !== a.namespace || sa !== a.serviceAccount) add("wi-subject", "error", `infra/stacks/${a.stack}/main.tf`, lineOf(stackMain, "service_account_name"), `federated subject is system:serviceaccount:${ns}:${sa}, the app expects system:serviceaccount:${a.namespace}:${a.serviceAccount}`);
      }
      const saFile = read(`infra/argocd/manifests/${a.name}/base/serviceaccount.yaml`);
      if (saFile && YAML.parse(saFile)?.metadata?.name !== a.serviceAccount) add("wi-subject", "error", `infra/argocd/manifests/${a.name}/base/serviceaccount.yaml`, lineOf(saFile, "name:"), `ServiceAccount must be named ${a.serviceAccount}`);
      for (const env of m.envNames) for (const inst of m.instances) {
        const f = `infra/argocd/apps/${env}-${inst}/${a.name}.yaml`;
        const t = read(f);
        if (!t) continue;
        const doc = YAML.parse(t);
        if (doc?.spec?.destination?.namespace !== a.namespace) add("wi-subject", "error", f, lineOf(t, "namespace:"), `destination namespace must be ${a.namespace}, the federated credential's namespace`);
        if (!(doc?.metadata?.finalizers ?? []).includes(FINALIZER)) add("argocd-finalizer", "error", f, lineOf(t, "metadata:"), `add the ${FINALIZER} finalizer`);
        if (env === "prod" && doc?.spec?.syncPolicy?.automated && !a.autoSync.prod) add("argocd-prod-sync", "error", f, lineOf(t, "automated"), "prod syncs manually unless autoSync.prod is set in the manifest");
        const ov = `infra/argocd/manifests/${a.name}/overlays/${env}-${inst}/kustomization.yaml`;
        const ovt = read(ov);
        if (ovt && /<\w+>/.test(ovt)) add("bridge-placeholders", "info", ov, lineOf(ovt, /<\w+>/), `waiting for the outputs of ${a.stack}: run "stacks.mjs bridge --stack ${a.stack} --env ${env} --instance ${inst} --outputs <terraform output -json file>" after apply`);
      }
    }
    for (const env of m.envNames) for (const inst of m.instances) {
      const f = `infra/argocd/bootstrap/root-${env}-${inst}.yaml`;
      const t = read(f);
      if (t && !(YAML.parse(t)?.metadata?.finalizers ?? []).includes(FINALIZER)) add("argocd-finalizer", "error", f, lineOf(t, "metadata:"), `add the ${FINALIZER} finalizer`);
    }
    if (boot) {
      const v = /argocd_version="([^"]+)"/.exec(boot)?.[1];
      if (!v || !/^v\d+\.\d+\.\d+$/.test(v) || /stable|latest/.test(boot.match(/install\.yaml.*/)?.[0] ?? "")) add("argocd-pinned", "error", "infra/scripts/bootstrap-argocd.sh", lineOf(boot, "argocd_version"), "install a pinned Argo CD version (vX.Y.Z), not stable or latest");
      else if (older(v, DEFAULTS.argocdVersion)) add("argocd-pinned", "warning", "infra/scripts/bootstrap-argocd.sh", lineOf(boot, "argocd_version"), `${v} is older than ${DEFAULTS.argocdVersion}, the version this skill was tested with; check the current stable release`);
    }
  }

  const order = { error: 0, warning: 1, info: 2 };
  findings.sort((a, b) => order[a.severity] - order[b.severity] || a.rule.localeCompare(b.rule) || a.file.localeCompare(b.file));
  return findings;
}

// --deep: external tools when installed
export function runDeep(root, m) {
  const results = [];
  const has = (bin) => spawnSync(process.platform === "win32" ? "where" : "which", [bin], { encoding: "utf8" }).status === 0;
  const run = (name, cmd, args, cwd) => {
    const r = spawnSync(cmd, args, { cwd, encoding: "utf8" });
    results.push({ check: name, ok: r.status === 0, output: (r.stdout + r.stderr).trim().split("\n").slice(-15).join("\n") });
  };
  const skipped = [];
  if (has("terraform")) {
    run("terraform fmt -check", "terraform", ["fmt", "-check", "-recursive", "infra"], root);
    for (const s of m.stacks) {
      const cwd = join(root, "infra/stacks", s.name);
      if (!existsSync(cwd)) continue;
      const init = spawnSync("terraform", ["init", "-backend=false", "-input=false"], { cwd, encoding: "utf8" });
      if (init.status !== 0) { results.push({ check: `terraform init ${s.name}`, ok: false, output: init.stderr.trim().split("\n").slice(-10).join("\n") }); continue; }
      run(`terraform validate ${s.name}`, "terraform", ["validate", "-no-color"], cwd);
    }
  } else skipped.push("terraform fmt and validate (terraform not found)");
  if (m.ci.includes("github-actions")) {
    if (has("actionlint")) {
      // Declare the self-hosted runner labels from the manifest unless the repository has its own config.
      const own = existsSync(join(root, ".github/actionlint.yaml")) || existsSync(join(root, ".github/actionlint.yml"));
      const args = [];
      if (!own) {
        const labels = m.pipelines.githubActions.runsOn.filter((l) => !["self-hosted", "linux", "windows", "macos", "x64", "arm64"].includes(l));
        const cfg = join(mkdtempSync(join(tmpdir(), "ats-actionlint-")), "actionlint.yaml");
        writeFileSync(cfg, `self-hosted-runner:\n  labels: [${labels.join(", ")}]\n`);
        args.push("-config-file", cfg);
      }
      run("actionlint", "actionlint", args, root);
    } else skipped.push("actionlint (not found)");
  }
  if (m.gitops) {
    const overlays = walk(join(root, "infra/argocd/manifests"), root).filter((f) => /overlays\/[^/]+\/kustomization\.yaml$/.test(f)).map((f) => join(root, f, ".."));
    const tool = has("kubectl") ? ["kubectl", ["kustomize"]] : has("kustomize") ? ["kustomize", ["build"]] : null;
    if (tool) for (const o of overlays) run(`${tool[0]} ${tool[1][0]} ${relative(root, o)}`, tool[0], [...tool[1], o], root);
    else skipped.push("kustomize build (kubectl or kustomize not found)");
  }
  if (has("shellcheck")) run("shellcheck", "shellcheck", walk(join(root, "infra/scripts"), root).filter((f) => f.endsWith(".sh")).map((f) => join(root, f)), root);
  else skipped.push("shellcheck (not found)");
  return { results, skipped };
}
