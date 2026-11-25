## 0. Gate 1

- [x] 0.1 Gate 1 approved by the maintainer on 2026-11-25: Q1 to Q10 as recommended in `design.md` section 13, plus two amendments (section 14). The approval is recorded in a comment on pull request #29 (linked in the pull request description). **How to verify:** `node scripts/delivery-check.mjs scope add-prompt-examples --approved` passes (the implementation files are declared under "Impact" in `proposal.md`).
- [x] 0.2 Proposal checks: `npx @fission-ai/openspec@1.7.0 validate --all --strict --no-interactive` (17 passed) and `scope`. **How to verify:** both exit 0.
- [x] 0.3 Bring `main` into the branch with a merge (no force push) and re-measure the budgets: azure `SKILL.md` was 13,904 bytes (96 bytes under 14,000; 43 under the 13,947 ceiling of `no-install.test.mjs`). **How to verify:** `git log --oneline -3` shows the merge `a53e5c5`; sizes in `design.md` section 17.

## 1. Red first

- [x] 1.1 Write `test/prompt-examples.test.mjs` before any content and see it fail. **How to verify:** commit fc2d6e1 alone: 15 tests, 1 pass, 14 fail (`evidence/real-outputs-2026-11-25.md`, "Test runs").

## 2. Examples (amendments 1 and 2)

- [x] 2.1 Run the real tools on fictitious data and keep the commands and fixtures. **How to verify:** `evidence/real-outputs-2026-11-25.md` names each command; a reviewer re-runs one per skill.
- [x] 2.2 Write `references/prompts.md` for `docs-generator` (3 positive, 1 anti), `azure-terraform-stacks` (4 positive, 1 anti, plus the section `## Agent: stacks-auditor` with 4 positive and, under "What not to ask", 1 anti) and `assessment-report` (4 positive, 1 anti, 149 lines, no technology word, no checkbox list). Each example: prompts in English and pt-BR, what you get, labeled output, tips in both languages. **How to verify:** `node --test test/prompt-examples.test.mjs`; `wc -l` of the assessment file is at most 150; `npm test` in `plugins/assessment-report/skills/assessment-report` passes (229, 0 skipped).
- [x] 2.3 One pointer line in each `SKILL.md`; azure: Q4 option B (the `## Examples` block keeps one example; the pointer names the auditor); the agent file, `BUDGET`, `no-install` ceiling and `docs/aep/context-budgets.json` are not touched. **How to verify:** azure `SKILL.md` 13,836 bytes; `node scripts/context-budget.mjs` ok; azure `npm test` 0 failed.
- [x] 2.4 `README.md` section "Example prompts" with a starter prompt (English and pt-BR) for each of the four capabilities, equal to the first example of each file. **How to verify:** the test compares them; `test/readme.test.mjs` passes.
- [x] 2.5 `templates/prompts/prompts.md`, the pointer in `templates/skill/SKILL.md`, the `CONTRIBUTING.md` section "Example prompts" and checklist items (resolving "Content is in English"), the checklist item in `.github/pull_request_template.md`. **How to verify:** read the diff; the template test passes.

## 3. Tests

- [x] 3.1 The test discovers the catalog, checks every rule of the spec and has the mutation tests (a fictitious skill, a fictitious agent, a missing twin, a missing label, a secret-shaped line built at run time, a GUID, a path, a second pointer, an unsafe auditor example, a block in the agent file, a README difference, a missing README entry). It also installs each skill and the skill an agent lists with the CLI into a temporary home, and checks `npm pack --dry-run`. **How to verify:** 18 of 18 pass; the by-hand run with `zz-fake-skill` and `zz-fake-agent` failed as expected (evidence file).
- [x] 3.2 `test/prompt-examples.test.mjs` is in `scripts.test` of `package.json`. **How to verify:** root `npm test`: 327 of 327.
- [x] 3.3 All checks: `node scripts/validate-skills.mjs`, root `npm test`, `npm test` in each plugin (azure without `node_modules`; docs-generator after `npm ci`; assessment-report with `ASSESSMENT_REPORT_REQUIRE_CONTRACT=1`), `node scripts/vendor-yaml.mjs verify`, `node scripts/context-budget.mjs`, `openspec validate --all --strict`. **How to verify:** see `evidence/real-outputs-2026-11-25.md`, "Test runs", and the pull request.
- [ ] 3.4 CI green on every leg at the final head, and the required contexts of ruleset 27931984 present with success. **How to verify:** `gh api` of the check runs and of the ruleset, compared by name; recorded in the pull request.

## 4. Manual smoke (maintainer; needs a model session)

- [ ] 4.1 Run S1 to S7 of `design.md`, section 8, and write `evidence/smoke-<date>.md` (model, tool and plugin versions, what was observed, failures included). Until then each `prompts.md` status says the prompts were not run against a model. **How to verify:** the file exists and the three status lines name what was run. Open on purpose: it needs the user.
- [ ] 4.2 If S7 shows that `references/prompts.md` is not readable after a marketplace or CLI install in some tool, record it under Known limitations. **How to verify:** an entry, or a note that it was not needed.

## 4b. Correction round after the independent review (2026-11-25, verdict: approved with reservations, no blocker)

- [x] 4b.1 Red first: commit 0f045ca makes the test require one command per `Real output` label, no comment line in its body, one label per block (`Real`, `Derived` or `Illustrative`), and one anti-example per agent; 18 of 22 failed on the then-current files. **How to verify:** the commit alone.
- [x] 4b.2 Rewrite every `Real output` block as one command with its exact output (cuts as `...`, paths as `...`), move the DOCX headings to `Derived` blocks, re-run each command (`evidence/real-outputs-2026-11-25.md`). **How to verify:** the test; a reviewer re-runs one command per skill.
- [x] 4b.3 `stacks-auditor`: remove the false "dependency install" claim; rewrite `stacks-auditor-scoped` for one root (re-run: with two `--root` the last wins; GitHub workflows are read only under `<root>/.github/workflows`); no `[inferred]` on a root without a backend. **How to verify:** `grep -rn "dependency install" .` finds nothing in this change.
- [x] 4b.4 `docs-generator` wording about the default theme follows `SKILL.md` (a run with no one to answer uses it and says so). `CONTRIBUTING.md`: the language exception covers the README section and the pt-BR labels; the agent checklist; the gaps the test does not cover.
- [x] 4b.5 `CHANGELOG.md` has one `## [Unreleased]`.

## 5. Review and hand-off

- [x] 5.1 `CHANGELOG.md`: the entries are merged into the one `## [Unreleased]` section that pull request #28 created (a second heading added by mistake was removed), with Added, Changed and Known limitations; no version, date or tag. **How to verify:** `grep -c '^## \[Unreleased\]' CHANGELOG.md` prints 1.
- [ ] 5.2 Independent review in a fresh context, read-only, of the whole change against the spec scenarios (secret-shaped text, auditor examples, labels honest, pt-BR meaning, budget numbers). Verdict `review:approved` or `review:changes-requested`, comment linked in the pull request. Open on purpose: the author does not review itself.
- [ ] 5.3 Draft pull request body updated with the template; labels `node:*` and `cycle:<n>` of 3. Merge, archive (`openspec archive add-prompt-examples`) and the release are for the integrator and the maintainer.

## Out of scope (not tasks)

- Version bump of `package.json` or of any `plugin.json`, the tag, the npm publish, any change to `publish.yml`, any workflow, any ruleset: release is gate 2 and needs the maintainer's explicit OK naming the version.
- A Spanish twin, a model eval in CI, a change to a trigger `description`.
