## 1. Gate 1 and baseline

- [ ] 1.1 The maintainer reviews this proposal on its draft pull request and answers the Open Questions in `design.md`; the approval is recorded on the pull request (verify: an approval or an explicit written OK is on the pull request before any task below starts)
- [ ] 1.2 Run the baseline on `main`: `node scripts/validate-skills.mjs`, `npm test` and `npx --yes @fission-ai/openspec@1.7.0 validate --all --strict --no-interactive` all pass (verify: record the three exit codes in the pull request)

## 2. Documentation of the graph

- [ ] 2.1 Create `docs/aep/delivery-graph.md` with: the working-definition statement with the two cited sources and the line between source and adaptation, the consultancy adaptation, the AEP mapping table, the honest gaps list, the node table of Decision 1, the edges including the conditional ones, the cycle limit, the gates, and the Mermaid diagram from `design.md` (verify: the page labels AEP as a working definition, cites both sources, claims no endorsement or conformance, lists the gaps without promising them and says client data does not belong in the repository; all twelve nodes are present with a type)
- [ ] 2.2 Add to the page the roles table (author, implementer, reviewer, integrator) with what each may write and must not do, plus a "what is enforced and by what" table: tool allowlist, CI, repository settings, instructions only (verify: each permission in the roles table appears in exactly one enforcement row)
- [ ] 2.3 Add to the page the state table (`tasks.md`, pull request labels `node:*`, `cycle:1..3`, `review:*`, `needs:maintainer`, `.openspec.yaml`) and how a new session resumes from it (verify: following only the page, a reader can say where a change stands from a pull request and its `tasks.md`)
- [ ] 2.4 Add the parallelism rules: worktree and branch `claude/<name>` per change, rebase before merge, rules for `README.md`, `.claude-plugin/marketplace.json` and `package.json` (version changes only in a release change) (verify: the rules match the `Parallel changes` requirement)
- [ ] 2.5 Add the level 2 convention to the page and to `templates/skill/` guidance if it has a design checklist: the graph section for each agent or skill, node types, the verifier node and the evidence rule (verify: `CONTRIBUTING.md` links to the section and the skill checklist mentions it)
- [ ] 2.6 Update `CONTRIBUTING.md`: link to the page, name the two gates, and change step 6 ("the maintainer runs `/opsx:archive`") to say that the integrator archives after merge with an approved verdict and green CI; keep the release steps and state that a tag needs the maintainer's explicit OK (verify: `git grep -n "maintainer runs"` in `CONTRIBUTING.md` finds nothing stale; Conventional Commits and the `claude/` branch rule are stated)
- [ ] 2.7 Add `.github/pull_request_template.md` with a checklist that mirrors the gates: change name, gate 1 approval link, `tasks.md` complete, checks run, review verdict, cycle count, "no version bump" unless a release change (verify: opening a draft pull request shows the template)
- [ ] 2.8 Add to the page the "No graph runtime" decision: alternatives, pros and cons, and the reevaluation criteria of `design.md` Decision 11 (verify: the page states that no LangGraph or LangChain runtime is used, and `git grep -il "langgraph\|langchain" package.json src scripts` finds nothing)

## 3. Deterministic helper

- [ ] 3.1 Create `scripts/delivery-check.mjs` (no new dependency) with `scope <change>` (the diff against `main` touches only `openspec/changes/<change>/`; exits 1 and lists offending paths otherwise), `tasks <change>` (exits 1 and names the first unticked `- [ ]`) and `evidence <file>` (every `file:line` reference in the file exists; exits 1 and lists missing ones; lines marked "not verified" are reported, not failed) (verify: `node scripts/delivery-check.mjs --help` lists the three subcommands)
- [ ] 3.2 Tests in `test/` using temporary git repositories: one passing and one failing case per subcommand and per scenario of the `Human gate 1 before implementation`, `Roles and permissions` and `Verifier node for findings` requirements (verify: `npm test` passes, and each test fails when the helper's check is removed)
- [ ] 3.3 Run `delivery-check` in `.github/workflows/validate.yml` (the maintainer approved this default): add a step with the same pinned-versions style as the existing workflow, running `scope` on `claude/*` proposal branches (verify: a deliberately out-of-scope pull request fails the job). The workflow is edited at apply only, not in this proposal

## 4. Roles as instructions

- [ ] 4.1 Write the role instructions (author, implementer, reviewer, integrator) in `docs/aep/roles.md`: inputs, allowed paths and tools, the verdict format for the reviewer (`approved` or `changes-requested`, each reservation with `file:line`), the integrator's merge preconditions, and the escalation message format (verify: each requirement of `Independent review`, `Integrator acts only on an approved verdict and green CI` and `Escalation to the maintainer` is covered by a sentence in the file)
- [ ] 4.2 Define the reviewer's tool allowlist (read, search, and read-only shell) and deny list as the `stacks-auditor` precedent does, and say in the file that a deny list is not a hard guarantee (verify: the file lists no write, commit, push or merge tool for the reviewer)

## 5. GitHub settings (maintainer actions)

- [ ] 5.1 The maintainer creates the labels `node:*`, `cycle:1`, `cycle:2`, `cycle:3`, `review:approved`, `review:changes-requested` and `needs:maintainer`, and decides on branch protection for `main` (required checks `validate`, `test`, no direct pushes) (verify: the labels exist; the maintainer records the branch protection decision in the pull request; this task cannot be completed by an agent and stays unticked until the maintainer confirms)
- [ ] 5.2 Record which GitHub identity the integrator uses and confirm it cannot push a tag without the maintainer's OK (for example by tag protection rules) (verify: the decision is written in `docs/aep/roles.md`). This is a recommendation and a prerequisite: no release automation is built before the maintainer has put protection on `main` and on the `v*` tags in place

## 6. Diagram

- [ ] 6.1 Produce the editable draw.io source `docs/aep/delivery-graph.drawio` of the level 1 graph with the draw.io MCP or the draw.io desktop app, following the project's design system: background `#0b1326`, surfaces `#171f33` and `#222a3d`, borders `#45464d`, text `#dae2fd`, accents `#2fd9f4` (main), `#7bd0ff`, `#5bbfae` and `#8dc63f`, Space Grotesk for titles and Manrope for text with Geist Sans as fallback; agent nodes, deterministic nodes and gates use distinct shapes, cycles are dashed and labeled with the limit (verify: the file opens in draw.io; all twelve nodes, the three loops and the two gates appear; `grep -o '#[0-9a-fA-F]\{6\}'` over the file returns only colors from the palette)
- [ ] 6.2 Export a PNG of the diagram for the page, with the `.drawio` kept as the editable source, and reference both from `docs/aep/delivery-graph.md` (verify: the page shows the image and links the source; the PNG is regenerated from the `.drawio`, not drawn separately)

## 7. Verification

- [ ] 7.1 Dry run on a trivial change (for example a one-line documentation fix): walk the graph end to end on a `claude/` branch with a draft pull request, a read-only review and gate 1, without merging, and record which steps were unclear (verify: the notes are on the pull request and the page is adjusted where the walk-through exposed a gap)
- [ ] 7.2 `node scripts/validate-skills.mjs`, `npm test` and `npx --yes @fission-ai/openspec@1.7.0 validate --all --strict --no-interactive` pass (verify: CI is green on the pull request)
- [ ] 7.3 Confirm that no file outside the list of the Impact section changed and that `package.json`, `.claude-plugin/marketplace.json` and `publish.yml` are untouched except as stated (verify: `git diff --stat main` reviewed by the reviewer role, with `file:line` for any exception)
