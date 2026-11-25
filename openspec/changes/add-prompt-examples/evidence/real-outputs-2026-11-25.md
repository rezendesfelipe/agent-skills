# Real outputs behind the excerpts, and the test runs

Re-run on 2026-11-25 after the independent review: every `Real output` block of the three `prompts.md` files is the exact output of one command (cuts as `...`, absolute paths as `...`); the earlier excerpts joined several commands and are replaced. The fixtures below are unchanged except where noted. Blocks that no command prints (the headings read from a DOCX) are labeled `Derived from the generated file`.

Made on 2026-11-25 in a scratch folder (not in the repository), with Node v22.23.5 on Linux, against the engines of this branch. All data is fictitious ("Cliente Exemplo S.A.", subscription IDs of zeros). Paths below are shortened to `./`. A reviewer can recreate each fixture and re-run the command; the excerpts in the `prompts.md` files are shortened (at most 30 lines) from these outputs.

## azure-terraform-stacks (`node scripts/stacks.mjs ...`, no `node_modules`, `git init` first)

Fixture `infra/stacks.yaml` of the first setup (the sample in `references/manifest-format.md`, trimmed to two environments, one CI, three stacks):

```yaml
version: 1
regions: { brazilsouth: brs }
environments:
  dev: { subscriptionId: 00000000-0000-0000-0000-000000000001 }
  prod: { subscriptionId: 00000000-0000-0000-0000-000000000003 }
instances: [brs-01]
ci: [azure-devops]
profile: private-aks-postgres
state: { subscriptionId: 00000000-0000-0000-0000-0000000000ff, resourceGroup: rg-tfstate, storageAccount: sttfstateexemplo001, container: tfstate }
stacks:
  - { name: vnet-core, type: vnet, owner: core }
  - { name: aks-core, type: aks, owner: core, dependsOn: [vnet-core] }
  - { name: app-orders, type: app, owner: orders, dependsOn: [vnet-core, aks-core] }
gitops: { tool: argocd, argocdVersion: v3.6.2, repoURL: https://git.example.com/exemplo/platform.git, apps: [{ name: orders, stack: app-orders, tag: "1.8.3" }] }
```

(the real file was written in block style; same content). Results: `check-manifest` printed `✓ infra/stacks.yaml is valid`; `plan` listed 54 `create` lines and ended with the summary line `54 create`; `scaffold` printed `54 file(s) written`; `check` printed `✓ no findings` and the two `pending` overlay lines (dev and prod); `audit --root .` on the result reported 3 roots, 3 pipelines, 4 Argo CD Applications, 0 findings. `add-stack --name app-billing --type app --owner billing --depends-on vnet-core,aks-core` printed `added app-billing to infra/stacks.yaml; 8 file(s) written`, and `check` still printed `✓ no findings`.

ALZ manifest (`landingZone: { mode: alz, hubVnetId: <zeros resource ID> }`, `ci: [github-actions]`, no `privateDnsZoneIds`): `check-manifest` printed `infra/stacks.yaml has 4 problem(s):` with `landingZone.privateDnsZoneIds.acr`, `.keyVault`, `.aks` and `.postgres` required.

Legacy fixture for the auditor examples (`legacy-infra/`, `git init` and `git add -A` first): `terraform/main.tf` with a `terraform { required_providers { azurerm = { source = "hashicorp/azurerm" } } }` block, a provider block, a resource group and a virtual network; `.github/workflows/infra.yml` with `on: push: branches: [main]` and steps `terraform -chdir=terraform init` and `terraform -chdir=terraform apply -auto-approve`.

- `audit --root ./legacy-infra` (run from the parent folder): 38 lines; `1 Terraform root(s), 1 pipeline(s) that run Terraform, 0 Argo CD Application(s); findings: 3 error, 1 warning, 0 info`, the roots, four findings each followed by its `see references/...` line, 14 "Not evaluated" items, three "Not covered" bullets and `No file in the repository was changed.` The excerpt in `stacks-auditor-basic` is the first 15 lines, a line `...` and the last line.
- `audit --root ./legacy-infra/terraform`: `1 Terraform root(s), 0 pipeline(s) that run Terraform ... findings: 2 error, 1 warning, 0 info`, root `.`, findings `versions` (twice) and `state-local`; no `manual-trigger` finding, because the workflow is outside the root. The excerpt in `stacks-auditor-scoped` is the first 13 lines and `...`.
- `audit --root ./legacy-infra/terraform --root ./legacy-infra/.github`: `0 Terraform root(s), 1 pipeline(s) that run Terraform ... findings: 1 error`: the last `--root` wins (the first folder is not audited), and the pipeline is listed as `workflows/infra.yml (azure-devops)`, which is not how the repository root reads it. So two folders are two audits, and a folder that only holds `.github` is not a substitute for the repository root.

## assessment-report (`node scripts/assess.mjs ...`)

Fixture: `cliente-infra/infra/main.tf` with a storage account (`min_tls_version = "TLS1_0"` at line 7) and a database server with no backup block; `cliente-infra/docs/runbook.md`; scope file with one question, `in: ["infra/**"]`, `out: ["docs/**"]`. Commands in order: `init --model unknown --root ./cliente-infra --out ./assessment-report --client "Cliente Exemplo S.A." --title "Avaliação técnica" --author "Ana Exemplo" --version 0.1 --date 2026-11-25 --lang pt-BR --scope-file scope.json`; `inventory` (`1 file(s) in scope, revision inventory:750ad78e46d7372b`); `status` (`Current node: investigate`); evidence E-001 (file, line 7), E-002 (absence of `backup` in `infra/**/*.tf`), E-003 (statement from the CTO) and findings F-001, F-002 written into `assessment.json` by hand, as the skill does; `verify` (`Verified: 2 pass, 0 fail, 1 not machine-checked.`); `classify` (F-001 Medium verified, F-002 High verified); `check` (`Check passed.`); `review` (the packet, F-002 first); `review --approve --by "Ana Exemplo" --date 2026-11-25`; `render` (`Wrote 5 file(s)`: `report.md`, three annexes, `report.json`).

## docs-generator (`node scripts/docs.mjs ...`, after `npm ci`)

Source `agendamento.md` (pt-BR, one table, one source, one change log entry): `check` printed `✓ source is valid`; `build --theme clean-modern --format docx` wrote the DOCX; with no `--format` it wrote the PDF and the DOCX (Chrome present). The headings were read from `word/document.xml` of the DOCX. The same was done with the `report.md` written by `assess.mjs render`: `check` passed and the DOCX has the Title, Subtitle and the headings listed in the excerpt.

## Test runs

- Red first: commit fc2d6e1 holds `test/prompt-examples.test.mjs` alone: 15 tests, 1 passed, 14 failed (no `prompts.md` existed).
- After the implementation: `node --test test/prompt-examples.test.mjs`: 18 tests, 18 passed (13 mutation tests, the template test, the discovery test, the main test, the install test and the pack test).
- Correction round after the review: red first in commit 0f045ca (18 of 22 failed on the then-current files); after the rewrite of the blocks `node --test test/prompt-examples.test.mjs`: 22 tests, 22 passed (four new mutation tests: a comment line in a `Real output` body, two commands in one label, two labels for one block, an agent without an anti-example). A one-off script compared each of the 15 `Real output` blocks with the captured output of its command (every line present, in order, `...` as a cut): 15 of 15 matched. Root `npm test`: 331 of 331; azure (no `node_modules`) 192 passed and 8 skipped by design; docs-generator 80; assessment-report 229 with the contract required, 0 skipped; `delivery-check evidence` passes on this file and on `design.md`.
- By hand, once: `plugins/zz-fake/skills/zz-fake-skill` and `plugins/zz-fake/agents/zz-fake-agent.md` added to the worktree; the test failed with `skill zz-fake-skill: missing references/prompts.md`, `... must contain "references/prompts.md" exactly once (found 0)`, `agent zz-fake-agent: has no \`skills:\``, and two README errors; the folder was removed and the test passed again.
- Root `npm test`: 327 tests, 327 passed. `node scripts/validate-skills.mjs`: valid. `node scripts/context-budget.mjs`: all ok (azure `SKILL.md` about 3,459 tokens, auditor about 5,969 before margin).
- `npm test` in `azure-terraform-stacks` (no `node_modules`): 200 tests, 192 passed, 8 skipped (the parity tests that need the npm package, as the workflow says), 0 failed; `node scripts/vendor-yaml.mjs verify`: ok, 76 files, yaml 2.9.1.
- `npm test` in `docs-generator`: 80 passed. `npm test` in `assessment-report` with `ASSESSMENT_REPORT_REQUIRE_CONTRACT=1`: 229 passed, 0 skipped.
- `npx @fission-ai/openspec@1.7.0 validate --all --strict --no-interactive`: 17 passed, 0 failed.
