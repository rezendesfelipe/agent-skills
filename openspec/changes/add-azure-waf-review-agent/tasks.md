## 0. Proposal (this pull request)

- [x] 0.1 Read the sources and record claims, status and what could not be confirmed in `design.md` ("Verification of the research", "Not verified"). Verify: every claim row names a URL or a file.
- [x] 0.2 Write `proposal.md`, `design.md`, four specs and this file. Verify: `npx --yes @fission-ai/openspec@1.7.0 validate --all --strict --no-interactive` passes.
- [x] 0.3 Verify the pull request only touches `openspec/changes/add-azure-waf-review-agent/`. Verify: `node scripts/delivery-check.mjs scope add-azure-waf-review-agent` passes (gate 1 not yet given).
- [ ] 0.4 Maintainer's gate 1 with the answers to Q1 to Q12 of `design.md`. Nothing below starts before it.

## 1. Pull request 1: catalog, collector and fixtures (no tenant, no MCP)

- [ ] 1.1 Create the plugin folder `plugins/azure-waf-review/` with `.claude-plugin/plugin.json` and the skill `azure-waf-review` from `templates/skill/` (`name` equal to the folder, description at most 1024 characters, third person), and add the plugin entry to `.claude-plugin/marketplace.json`. Verify: `node scripts/validate-skills.mjs` passes and the name is unique across skills and agents.
- [ ] 1.2 Write `catalog/check.schema.json` and the in-house validator, and the KQL allowlist and host allowlist. Verify: one failing fixture per rule (missing `doesNotProve`, forbidden operator, other host, unknown `kind`, WAF ID not in the shipped list).
- [ ] 1.3 Write the first catalog (about 40 checks across the five pillars, each with `waf` IDs and doc dates, `chain`, `proves`, `doesNotProve`) and the list of WAF IDs with own short titles (no Microsoft text). Verify: the catalog test passes and every pillar has at least one check and at least one practice-only questionnaire item.
- [ ] 1.4 Implement `scripts/waf.mjs`: `plan`, `collect` (paging, limits, timeout retry, throttling wait, resume), result states, error classes, `--fixtures`. No dependency; Node 20. Verify: tests with fixture pages, a truncated page, a 403, a timeout and a throttled response; `node scripts/waf.mjs --help` runs in a clean copy.
- [ ] 1.5 Implement redaction, the strict alias mode, the secret scan (port of `assessment-report`'s scanner with a parity test, skipped when that plugin is absent) and string limits. Verify: planted secret-shaped value, `appSettings` block, tag value and hostile tag never appear in any output file.
- [ ] 1.6 Implement `manifest.json` sealing, `seal-check`, `coverage` (per check and per pillar counts), `questionnaire` and `map` (evidence entries of kind `file`, finding stubs, the cap table of Decision 7). Verify: `assess.mjs verify` passes on the mapped evidence of the fixture and fails after a one-byte edit of a collected line.
- [ ] 1.7 Implement `reverify` (user only) and `purge`, and the self-ignoring `waf-review/.gitignore`. Verify: `git status` shows nothing under `waf-review/` in a temp repository; `reverify` against a fixture covers `match`, `changed`, `gone`, `error`.
- [ ] 1.8 Build the synthetic tenant "Contoso Exemplo" (`test/fixtures/contoso-exemplo/`: tenant, 2 readable and 1 invisible subscriptions, about 60 resources, planted flaws, decoys, a hostile tag, Advisor, Defender, policy and role data), the MCP fixtures labeled illustrative, and `key.json` with its schema. Verify: a test checks every key location exists in the fixture; no real GUID, no credential-shaped literal, no personal data.
- [ ] 1.9 Scorer and deterministic fixture run. Verify: every planted flaw found, every decoy `pass`, the invisible subscription `scope-incomplete`, coverage counts equal the manifest.
- [ ] 1.10 Windows and CRLF cases (`path.win32` paths, CRLF in catalog and fixtures, the `az` launcher case with constant arguments). Verify: tests pass on the Windows CI job; the `az.cmd` spawn is recorded as not verified until manual test M-8.

## 2. Pull request 2: `architecture-diagram`

- [ ] 2.1 Create the skill `architecture-diagram` (`SKILL.md` at most 70 lines) and `scripts/diagram.mjs` with `build` and `check`; add the topology schema and `waf.mjs topology` (from collected data). Verify: an invalid edge, a missing parent and a duplicate id each exit 1.
- [ ] 2.2 Deterministic layout, levels L0, L1, L2 (and L3 by tag key), page caps (80 nodes, 120 edges) and "+N more" nodes. Verify: a 2,000-node input yields pages within the caps and two runs are byte-identical.
- [ ] 2.3 Theme: the design system tokens of `CLAUDE.md`, `adaptiveColors="none"`, fonts and fallback note, contrast routine, severity badges by letter, legend. Verify: a palette test, a contrast failure fixture, and the maintainer's answer to Q6 recorded.
- [ ] 2.4 Icon map ported from `azure-terraform-stacks/diagram/icons.json` for the kinds of the catalog, unknown kind as a labeled box, no external image URL, parity test. Verify: the test fails on a path missing from the source map and is skipped with a message when the other plugin is absent.
- [ ] 2.5 `check`: in-house XML tokenizer, unique ids, expanded edges, caps, label length, secret scan, ARM ID rule, content hash and edit refusal. Verify: one failing fixture per rule.
- [ ] 2.6 Optional export when the draw.io desktop CLI exists; reported as skipped otherwise. Verify: a test without draw.io prints the skip and exits 0.
- [ ] 2.7 Add the skill to `docs/aep/context-budgets.json` and write `references/prompts.md` (positive and anti-example, English and pt-BR) and the README starter prompt. Verify: `node scripts/context-budget.mjs` and `npm test` (`test/prompt-examples.test.mjs`) pass.

## 3. Pull request 3: the skill, the mapping and the pt-BR pipeline

- [ ] 3.1 Write `SKILL.md` of `azure-waf-review` (at most 100 lines: when to use, hard rules, the steps, the interrupts, the final message) and the references (`procedure.md`, `catalog-format.md`, `coverage.md`, `pillars.md`, `privacy.md`, `questionnaire.md`, `manual-test.md`), each linked at the step that uses it. Verify: a test enforces the line limit and that every referenced file exists.
- [ ] 3.2 Register the framework `azure-waf` in the scope file (version label, date, URL) and map controls to the shipped ID catalog (`verify --catalog azure-waf=<file>`). Verify: an unknown ID fails the consistency check of `assessment-report`.
- [ ] 3.3 Pipeline test: fixture `assessment.json` → `assess.mjs` verify, classify, check, render `--lang pt-BR --unreviewed` → `docs-generator check`. Verify: golden `report.md` and `coverage.md` (pt-BR), the stamp present, no secret.
- [ ] 3.4 Cap-rule tests for each row of the table in Decision 7 (sealed, MCP-only, questionnaire, both, none, Critical with and without a passing `reverify`). Verify: a table-driven test.
- [ ] 3.5 `references/prompts.md` for the skill and `## Agent: azure-waf-reviewer` with the ids `waf-first-review`, `waf-one-pillar`, `waf-coverage-gaps`, `waf-diagram-levels` and the anti-example `waf-do-not-apply`, English and pt-BR twins, labeled outputs from commands run on the synthetic tenant; README starter prompt equal to the first example. Verify: `test/prompt-examples.test.mjs` passes; a reviewer re-runs one `Real output` command.
- [ ] 3.6 Add `skill:azure-waf-review` to `docs/aep/context-budgets.json` by the repository's rule. Verify: `node scripts/context-budget.mjs` passes.

## 4. Pull request 4: the agent, the MCP declaration and the guard

- [ ] 4.1 Write `agents/azure-waf-reviewer.md` from `templates/agent/agent-name.md` with the tools and skills of the spec, the "Rules you never break", the commands it may run, the graph, the interrupts and the final report; add the `## Agent graph` section content from `design.md` to the pull request description. Verify: `node scripts/validate-skills.mjs` passes; a test checks no forbidden field and that `skills` exist.
- [ ] 4.2 Write `.mcp.json` (read-only, pinned stable version re-checked on the day, namespace allowlist, no `dangerously`) and its static test. Verify: the test fails on `@latest`, a prerelease, a missing flag, a `keyvault` namespace.
- [ ] 4.3 Write `hooks/hooks.json` and `hooks/azure-waf-reviewer-guard.mjs` with the shapes, path rules, MCP namespace rule and namespaced `agent_type` handling; port the precedent's tests and fixtures (`hook-input-plugin-agent.json` style) and add cases for `Write`, `Edit` and MCP matchers, Windows paths and CRLF. Verify: the guard test suite passes; a test keeps the agent file's shapes equal to the guard's list.
- [ ] 4.4 Add `docs/aep/context-budgets.json` entry `agent:azure-waf-reviewer` (agent file plus the three pre-loaded `SKILL.md` files). Verify: `node scripts/context-budget.mjs` passes.
- [ ] 4.5 README: catalog rows (plugin, agent, two skills), prerequisites (Node 22 for the MCP package, read-only identity, Reader and Security Reader at the root management group, never elevated access), the data-through-the-model statement, the layered read-only statement and the `permissions.deny` snippet. Verify: `test/readme.test.mjs` passes.
- [ ] 4.6 CLI path: install the agent and its skills with the `agent-skills` CLI for Claude Code (dry run) and confirm the plugin's `.mcp.json` is not part of the CLI install and the README says so. Verify: the dry run lists the agent and the three skills; the conversion report for other tools is read and recorded.
- [ ] 4.7 Validate frontmatter and the marketplace manifest; run `node scripts/validate-skills.mjs`, `npm test`, `node scripts/context-budget.mjs` and `npx --yes @fission-ai/openspec@1.7.0 validate --all --strict --no-interactive`. Verify: all pass.

## 5. Pull request 5: smoke by the user on the private tenant (not by an agent)

- [ ] 5.1 The user runs manual tests M-0 to M-10 of `references/manual-test.md` and reports counts, states, tool names, error classes and durations only. Verify: the pull request records which steps were run, which were not, and nothing from the tenant.
- [ ] 5.2 Record the results of the "not verified" list of `design.md`: `--read-only` and tool names (M-1, M-2), wildcard in `tools` (M-3), cross-plugin pre-loading (M-4), live guard behavior, Resource Graph volume and throttling (M-5, M-7), Windows `az` spawn (M-8), draw.io open and fonts (M-6). Verify: each item is marked verified, failed with the fix, or still open.
- [ ] 5.3 If M-4 fails, apply plan B of Decision 1 and update the agent file, the budget and the tests. Verify: the budget check and the agent tests pass.
- [ ] 5.4 Measure real token use of one full run (M-7) and replace the estimate in `design.md` with the measurement and the method, or keep the estimate labeled. Verify: the number and its method are written next to each other.
- [ ] 5.5 The maintainer counts the loaded context officially for the three capabilities (`docs/aep/context-budget.md`). Verify: `official` entries recorded or the task left open with the reason.

## 6. Out of this change

- Release: version bumps, tag and npm publish need the maintainer's explicit OK naming the version (gate 2). No task here edits a version.
- Follow-ups to propose separately: the general cap rule for the `output` kind of `assessment-report` (Q9), an `appendices` field for the coverage annex (Q10), `azqr` as an optional source (Q11), an own MCP server for the collector (Decision 3, T3), Entra ID checks through Microsoft Graph, and Cost Management data.
