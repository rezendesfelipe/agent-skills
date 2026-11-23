// "check": rules from the articles' traps and the code review, run on a repository that has infra/stacks.yaml.
// The rules that need no manifest live in rules.mjs and are shared with "audit".
import { existsSync, readFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { spawnSync } from "node:child_process";
import YAML from "yaml";
import { camel, snake, transitiveDeps } from "./manifest.mjs";
import { stateKey, literalRg } from "./naming.mjs";
import { generateAll } from "./generate.mjs";
import { bootstrapDeps } from "./gen-pipelines.mjs";
import { walk, lineOf } from "./util.mjs";
import {
  RULE_DOCS, ruleBackendBlock, ruleVersions, ruleRgOwned, ruleCredentials, ruleAdoPipeline, ruleAdoParams,
  ruleAdoBootstrapStage, ruleGhaWorkflow, ruleGhaInputs, ruleGhaBootstrapJob, ruleArgoFinalizer, ruleArgoProdSync, ruleBootstrapScript,
} from "./rules.mjs";

export { RULE_DOCS };

export function runCheck(root, m) {
  const findings = [];
  const add = (rule, severity, file, line, message) => findings.push({ rule, severity, file, line, message, ref: RULE_DOCS[rule] });
  const read = (p) => (existsSync(join(root, p)) ? readFileSync(join(root, p), "utf8") : null);
  const expected = generateAll(m);
  const prodPossible = m.envNames.includes("prod");

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

  // backend-partial and versions, per stack
  const tfOfStacks = [];
  for (const s of m.stacks) {
    const dir = `infra/stacks/${s.name}`;
    const all = walk(join(root, dir), root).filter((f) => f.endsWith(".tf")).map((f) => ({ file: f, text: read(f) }));
    tfOfStacks.push(...all);
    const backend = all.find(({ text }) => /backend\s+"azurerm"/.test(text));
    if (!backend) add("backend-partial", "error", dir, undefined, 'no backend "azurerm" block');
    else ruleBackendBlock(backend.file, backend.text, add);
    const versions = all.find(({ text }) => /required_version/.test(text));
    if (versions) ruleVersions(versions.file, versions.text, add);
  }

  // rg-owned: every resource group a data source reads is created by a stack
  ruleRgOwned(tfOfStacks, add);
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
      const params = ruleAdoPipeline(adoFile, ado, doc, {}, add);
      const expectedParams = ["environment", "instance", "action", ...m.stacks.map((s) => camel(s.name)), ...(m.gitops ? ["argocd"] : [])];
      for (const n of expectedParams) if (!params.has(n)) add("pipeline-params", "error", adoFile, undefined, `missing parameter ${n}`);
      for (const n of params.keys()) if (!expectedParams.includes(n)) add("pipeline-params", "error", adoFile, lineOf(ado, `name: ${n}`), `parameter ${n} has no stack in the manifest`);
      ruleAdoParams(adoFile, ado, params, { actionKey: "action", requireAction: true, prodPossible, selectors: m.stacks.map((s) => camel(s.name)) }, add);
      ruleAdoBootstrapStage(adoFile, ado, doc, add);
      // dependencies
      for (const item of doc.stages ?? []) {
        const [cond, body] = Object.entries(item)[0] ?? [];
        const stackParam = /eq\(parameters\.(\w+), true\)\s*\}\}$/.exec(cond ?? "")?.[1];
        const tpl = Array.isArray(body) ? body[0] : null;
        if (!tpl?.template || /argocd-bootstrap/.test(tpl.template)) continue;
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
      const { inputs } = ruleGhaWorkflow(ghaFile, gha, doc, {}, add);
      const expectedInputs = ["environment", "instance", "action", ...m.stacks.map((s) => snake(s.name)), ...(m.gitops ? ["argocd"] : [])];
      for (const n of expectedInputs) if (!inputs[n]) add("pipeline-params", "error", ghaFile, undefined, `missing input ${n}`);
      for (const n of Object.keys(inputs)) if (!expectedInputs.includes(n)) add("pipeline-params", "error", ghaFile, lineOf(gha, `${n}:`), `input ${n} has no stack in the manifest`);
      ruleGhaInputs(ghaFile, gha, doc, inputs, { actionKey: "action", requireAction: true, prodPossible, requireIdToken: true, selectors: m.stacks.map((s) => snake(s.name)) }, add);
      for (const s of m.stacks) {
        const job = doc.jobs?.[s.name];
        if (!job) continue;
        const want = [...transitiveDeps(m, s.name)].sort();
        const got = [].concat(job.needs ?? []).sort();
        if (JSON.stringify(want) !== JSON.stringify(got)) add("pipeline-deps", "error", ghaFile, lineOf(gha, `  ${s.name}:`), `${s.name} needs [${got.join(", ")}], the manifest says [${want.join(", ")}]`);
        if (want.length && !/!cancelled\(\) && !failure\(\)/.test(job.if ?? "")) add("pipeline-deps", "error", ghaFile, lineOf(gha, `  ${s.name}:`), "use !cancelled() && !failure() so the job runs when a dependency was skipped");
      }
      if (m.gitops) {
        ruleGhaBootstrapJob(ghaFile, gha, doc, add);
        const job = doc.jobs?.argocd;
        if (job) {
          const want = bootstrapDeps(m).map((s) => s.name).sort();
          const got = [].concat(job.needs ?? []).sort();
          if (JSON.stringify(want) !== JSON.stringify(got)) add("pipeline-deps", "error", ghaFile, lineOf(gha, "  argocd:"), `argocd needs [${got.join(", ")}], expected [${want.join(", ")}]`);
        }
      }
    }
  }

  // oidc: no stored credentials anywhere in pipelines or scripts
  ruleCredentials([...walk(join(root, "infra/pipelines"), root), ...walk(join(root, ".github/workflows"), root), ...walk(join(root, "infra/scripts"), root)].map((f) => ({ file: f, text: read(f) })), add);

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
        ruleArgoFinalizer(f, t, doc, add);
        ruleArgoProdSync(f, t, doc, { isProd: env === "prod", allowAutomated: a.autoSync.prod, message: "prod syncs manually unless autoSync.prod is set in the manifest" }, add);
        const ov = `infra/argocd/manifests/${a.name}/overlays/${env}-${inst}/kustomization.yaml`;
        const ovt = read(ov);
        if (ovt && /<\w+>/.test(ovt)) add("bridge-placeholders", "info", ov, lineOf(ovt, /<\w+>/), `waiting for the outputs of ${a.stack}: run "stacks.mjs bridge --stack ${a.stack} --env ${env} --instance ${inst} --outputs <terraform output -json file>" after apply`);
      }
    }
    for (const env of m.envNames) for (const inst of m.instances) {
      const f = `infra/argocd/bootstrap/root-${env}-${inst}.yaml`;
      const t = read(f);
      if (t) ruleArgoFinalizer(f, t, YAML.parse(t), add);
    }
    if (boot) ruleBootstrapScript("infra/scripts/bootstrap-argocd.sh", boot, add, { required: true });
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
