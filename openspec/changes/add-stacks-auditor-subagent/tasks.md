## 1. Share the rules between `check` and `audit`

- [ ] 1.1 Run the skill's tests as the baseline (`npm test` in the skill folder) and keep them passing through every step below
- [ ] 1.2 Move the manifest-independent rules out of `scripts/lib/check.mjs` into functions that take a list of discovered files (Terraform roots, pipelines, Argo CD manifests); `check` calls them, with no change in output
- [ ] 1.3 Add a test that `check` output is unchanged on all four fixtures (golden findings) after the refactor

## 2. Discovery and audit

- [ ] 2.1 `scripts/lib/discover.mjs`: Terraform roots by content (`terraform {}` or `backend` block), modules excluded, backend type and literal state key (block, `-backend-config`, `key=`), "passed at init" and "unknown" cases, resource counts and Azure resource types grouped into network, compute, data, identity and other; pipelines that run Terraform with triggers, inputs and defaults; Argo CD Applications; every deduced value tagged `inferred`
- [ ] 2.2 `scripts/lib/audit.mjs`: run the shared rules (design Decision 1 table), the audit-only rules `state-shared`, `state-local`, `state-unknown`, and a "not evaluated" list with reasons; `--json` output; exit codes 0, 1, 2
- [ ] 2.3 `audit` command in `scripts/stacks.mjs` and `--help`; it writes nothing and runs no external tool
- [ ] 2.4 Fixtures of repositories **without** a manifest: a single large root with local state; two roots sharing one key; hand-made pipelines with `destroy` offered for prod, a stored client secret and a triggered run; an Argo CD Application without finalizer; a repository with no Terraform at all; a Terragrunt repository (reported as not covered)
- [ ] 2.5 Tests: one per scenario of the spec; `git status` identical before and after `audit` (also with uncommitted changes); every rule that needs the manifest appears under "not evaluated" and never as passed; a freshly scaffolded repository audited with `audit` reports no errors

## 3. Validator

- [ ] 3.1 `validateAgent` in `src/lib/validate.mjs` and its call for `plugins/*/agents/*.md` (frontmatter, name equals file name, description, `tools`, unique names across plugins)
- [ ] 3.2 Tests in `test/validate.test.mjs` for each scenario of the `skill-catalog` delta (valid, name mismatch, missing `tools`, duplicate name)

## 4. Subagent

- [ ] 4.1 `plugins/azure-terraform-stacks/agents/stacks-auditor.md`: frontmatter (`name`, `description` in third person saying when to use it, `tools: Read, Grep, Glob, Bash`, `disallowedTools` with the patterns of the spec), and the instructions: scope, read-only rules, how to run `audit`, how to find the engine (plugin path in the body, then the skill folders, `test -f` first), the report format, and the limits to state
- [ ] 4.2 Plugin test that parses the agent file: no `Write`, `Edit` or `NotebookEdit`, every required `disallowedTools` pattern present, the report sections named in the instructions
- [ ] 4.3 Validate the plugin manifest still passes (`node scripts/validate-skills.mjs`) and that `.claude-plugin/plugin.json` needs no `agents` entry (the default folder is scanned)

## 5. Documentation and verification

- [ ] 5.1 `SKILL.md`: a short "Auditing an existing repository" section (when to delegate to `stacks-auditor`, the `audit` command, the residual `Bash` risk, the Claude Code-only note); `references/traps.md`: which rules `audit` evaluates; README catalog row mentions the subagent and that the `agent-skills` CLI installs skills only
- [ ] 5.2 Install the plugin from the marketplace in a clean Claude Code session and confirm that the agent is listed, that `${CLAUDE_PLUGIN_ROOT}` is substituted in its body, and that delegating "audit this repository" runs the engine; record the result in the pull request. If the substitution does not work, fix the fallback order and update design Decision 6
- [ ] 5.3 Run the auditor on at least two real repositories (the maintainer chooses them), compare its findings with a manual review, and record false positives and gaps in the pull request
- [ ] 5.4 `node scripts/validate-skills.mjs`, `npm test` (repository and skill), `openspec validate --all --strict` pass
- [ ] 5.5 Update the marketplace manifest description if the plugin's summary changes (change rule from `openspec/config.yaml`: every skill change validates frontmatter and updates the manifest)
