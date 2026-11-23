## Why

The `azure-terraform-stacks` skill creates new repositories from a manifest and checks the ones it generated. The common case in practice is the opposite: an infrastructure repository that already exists, written by hand over years, with one large Terraform state, long plans and a pipeline identity with wide permissions. Before anyone decides to split it, they need an inventory and an honest list of what deviates from the pattern. Doing that in the main conversation reads hundreds of files into the context that is also used for the actual work.

A Claude Code **subagent** fits this job and not the skill's: it runs in its own context window, can be limited to read-only tools, does not need to ask the user anything while it works, and returns one report. The skill's interview and write steps, which need the user in the loop, stay a skill (decision recorded in `add-azure-terraform-stacks-skill`, Decision 1).

## What Changes

- New subagent `stacks-auditor` in the existing plugin: `plugins/azure-terraform-stacks/agents/stacks-auditor.md`. Read-only tool set; it audits the repository the user points to and returns a report. It never edits files, never opens pull requests, and never runs Terraform or `kubectl`.
- New engine command `node scripts/stacks.mjs audit`, which works **without** `infra/stacks.yaml`. Today `check` needs the manifest, so the auditor cannot reuse it as it is. `audit` discovers Terraform roots, backends and state keys, pipelines and Argo CD Applications, and then:
  - runs the rules of `check` that do not need the manifest, with the same ids and references (`backend-partial`, `versions`, `rg-owned`, `oidc`, `no-prod-destroy`, `manual-trigger`, `plan-default`, `gha-inputs`, `argocd-*`, `wi-subject`);
  - adds audit-only rules: `state-shared` (two roots share one state), `state-local` (no backend), `state-unknown` (key cannot be determined);
  - lists every rule it could not evaluate, with the reason, instead of silently skipping it.
- Inventory with the number of `resource` blocks and the Azure resource types per root, so the report can support a "this root mixes network, compute and data" observation with numbers. The report labels any split suggestion as the auditor's reading.
- The validator learns about plugin agents (`plugins/*/agents/*.md`): `name` equal to the file name, `description`, a `tools` list, unique names.
- README and `SKILL.md` document the auditor, and say that the `agent-skills` CLI installs skills only: the subagent comes with the Claude Code plugin or by copying the file.

## Capabilities

### New Capabilities
- `stacks-auditor`: the read-only auditor subagent, the `audit` command, discovery, rules without a manifest, audit-only rules, the report format and how the auditor finds the engine.

### Modified Capabilities
- `skill-catalog`: adds the requirement for plugin subagents (format and validation).

## Decisions taken with the maintainer

Proposed and accepted on 2026-11-23 (the maintainer answered "Quero" to the written recommendations):

1. **v1 is the minimal auditor**: discover, inventory and run the rules that do not need a manifest. It does not deduce a draft `infra/stacks.yaml`.
2. **It ships in the same plugin**, because it depends on the skill's engine.
3. **It only reads and reports.** No fix proposals as pull requests in v1.

## Non-goals

- Deducing or writing a draft `infra/stacks.yaml`, or a migration plan. A later change can add it once real audits show what the deduction must cover.
- Moving state (`moved`, `removed`, `import` blocks), splitting roots, or editing any file of the audited repository.
- Opening pull requests or posting comments.
- Running `terraform init`, `validate`, `plan`, `actionlint`, `kustomize build` or `shellcheck` in the audited repository. `terraform init -backend=false` creates `.terraform/` and lock files in the repository, which breaks the read-only guarantee. The report tells the user how to run them on a copy.
- Auditing clouds other than Azure, Bicep, Pulumi or HCP Terraform workspaces.
- Installing the subagent through the `agent-skills` CLI (it installs skills only; supporting agents is a separate change to `cli-installer`).
- Content in Portuguese: agent and spec text is in English per repository rules; the report follows the user's language.

## Impact

- New: `plugins/azure-terraform-stacks/agents/stacks-auditor.md`; `scripts/lib/audit.mjs` and the `audit` command in the skill's engine; fixtures and tests.
- Changed: `src/lib/validate.mjs` (plugin agents) and its tests, README catalog, `SKILL.md` (a short section on the auditor), `references/traps.md` (which rules `audit` evaluates).
- No new runtime dependency. The auditor works only where the engine is installed (Claude Code plugin, or the skill folder); without it, it stops and says how to install.
- Claude Code only. Codex, Gemini CLI, Cursor and Copilot can still run `node scripts/stacks.mjs audit` by hand.
