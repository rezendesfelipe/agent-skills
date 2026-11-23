## 1. Setup

- [x] 1.1 Create `plugins/assessment-report/skills/assessment-report/` from `templates/skill/` with `name: assessment-report` and a description (at most 1024 characters, third person) that says what it does and when to use it. Verify: `node scripts/validate-skills.mjs` passes.
- [x] 1.2 Add `plugins/assessment-report/.claude-plugin/plugin.json` and the plugin entry in `.claude-plugin/marketplace.json`. Verify: the validator reports the plugin and no duplicate skill or agent name.
- [x] 1.3 Validate the frontmatter and the marketplace manifest: `node scripts/validate-skills.mjs` and `npm test` pass, and `npx @frcloudsolutions/agent-skills add assessment-report --tool claude,codex --dry-run` lists the skill.
- [x] 1.4 Add the skill's `package.json` (`type: module`, Node 20 or later, no dependencies, a `test` script using `node --test`). Verify: `npm ls` shows no dependencies and no `npm ci` is needed to run `node scripts/assess.mjs --help`.

## 2. Schema and state

- [x] 2.1 Write `schema/assessment.schema.json` (`schemaVersion` 1.0) and the in-house validator; one failing fixture per schema rule (missing evidence list, unknown kind, bad ID pattern, missing framework version or date, computed field present with a wrong value). Verify: each fixture fails with the field path.
- [x] 2.2 Implement `scripts/lib/graph.mjs` (nodes, allowed transitions, gates by content hash) and `.state/run.json`; `assess.mjs status` prints the current node and the allowed next nodes. Verify: calling `classify` before `verify`, and `render` before review, exits 1 and names the missing node.
- [x] 2.3 Implement `init` (writes a skeleton `assessment.json` from the scope answers; refuses to overwrite) and the output-folder rules (only inside `--out`, refuses `.git`). Verify: a before/after directory snapshot test shows nothing outside `--out` changed.

## 3. Inventory and verifier

- [x] 3.1 `inventory`: list files in scope with size and SHA-256, git revision when present, exclusions (`.git`, `node_modules`, binary, over the size cap), no network. Verify: golden `inventory.json` for the synthetic repository.
- [x] 3.2 `verify` for `file` evidence: path containment with symlink resolution, text and size checks, range check, quote comparison with line-ending and trailing-space normalization, excerpt cap, `excerptSha256`, `drift`. Verify: one fixture per failure code (`path-escape`, `not-found`, `not-text`, `too-large`, `range-invalid`, `quote-mismatch`, `drift`) plus CRLF and Unicode passes.
- [x] 3.3 `verify` for `absence` evidence: in-house glob (`*`, `**`, `?`), empty scope fails, matches fail with the first matches shown, regex cost bound. Verify: fixtures for pass, `absence-violated`, `scope-empty`, `pattern-too-costly`.
- [x] 3.4 `verify` for `output`, `document`, `url` (snapshot only) and `statement` evidence. Verify: a `url` without snapshot is reported as not machine-checked and never fetched (test with the network disabled).
- [x] 3.5 Secret handling: redacted evidence, pattern scan of every string in `assessment.json`, `secret-in-quote`. Verify: fixture with a synthetic fake secret fails unredacted and passes redacted, and the report never contains the value.
- [x] 3.6 Computed-field tamper check. Verify: editing `confidence` or `severity` by hand makes `verify` fail.

## 4. Classification and roadmap

- [x] 4.1 `classify`: confidence by the Decision 6 table, severity table, confidence cap with `severityUncapped`, demotion to Not verified with a wave-1 collect-evidence action, `potentialSeverity`. Verify: a table-driven test covers every cell of the severity table and every confidence rule.
- [x] 4.2 Severity x effort matrix and the derived quick-wins list. Verify: golden Markdown table.
- [x] 4.3 Roadmap checks: acyclic dependencies, wave order, every Medium-or-above finding addressed or with a recorded disposition, Critical after wave 1 needs a reason, wave effort totals and capacity warning. Verify: one failing fixture per rule.
- [x] 4.4 `check` (consistency): every finding has evidence, ID, severity and confidence; every action has a wave; every cited framework is registered with version and date; catalog check when supplied; no orphan references. Verify: one failing fixture per rule, exit codes 0, 1, 2.

## 5. Rendering and delegation

- [x] 5.1 `locales/en.json`, `pt-BR.json`, `es.json` and the label lookup. Verify: a test fails if a key exists in one locale and not in the others.
- [x] 5.2 `render`: `report/report.md` (frontmatter with `sources` and `annexes`, executive body) and `annex-*.md`, `report.json`; fence escaping, table pipe escaping, secret scan of the output, stamp for `--unreviewed`. Verify: golden files for the fixtures in the three languages.
- [x] 5.3 Contract test: render the fixtures and run the repository's `docs-generator` `check` (and `build --format docx`) on the result. Verify: exit 0; a fixture whose quote contains three backticks and `<script>` also passes.
- [x] 5.4 `references/report-format.md` documenting the mapping and what is delegated. Verify: it states that no layout, PDF or DOCX code exists in this skill, and a test greps the skill folder for a PDF or DOCX library import.

## 6. Skill instructions

- [ ] 6.1 Write `SKILL.md` (at most 150 lines): when to use, hard rules (read-only, no invented author/version/framework data, never auto-approve), the graph as numbered nodes with one command each, the interrupts, the delegation step and the final report of what was not verified. Verify: a test enforces the line limit and that every referenced file exists.
- [ ] 6.2 Write the references: `evidence-and-confidence.md`, `severity-effort.md`, `roadmap-waves.md`, `framework-mapping.md`, `report-format.md`, `read-only-and-untrusted-input.md`. Verify: each is linked from `SKILL.md` at the node that uses it, and none is a checklist of technology-specific checks.
- [ ] 6.3 Scope interview (N0): ask for client, questions, in and out of scope, assumptions, framework and its version and date, language, author, version, date; never infer them. Verify: a transcript review in the manual run (task 8.4) shows each question asked and no invented value.

## 7. Evals (capability `assessment-evals`)

- [ ] 7.1 Deterministic cases (verifier, severity, consistency, render contract) under `evals/cases/deterministic/`, run by `npm test`. Verify: a failing case is reported by ID.
- [ ] 7.2 Synthetic fixtures with planted flaws, decoys and answer keys: `M-01` infrastructure repository (pipeline plus Terraform-like files, including a synthetic fake secret and a prompt-injection file), `M-02` application repository with a clean area, `M-03` documents-and-interviews-only case. Verify: each `key.json` validates against `evals/key.schema.json`, and every key location exists in its fixture (a test).
- [ ] 7.3 Scorer: matching by location overlap, metrics (recall of planted flaws, citation validity, false positives, decoy reports, severity in range, correct Not verified labelling, injection followed, secret leaked), per-run output. Verify: scorer tests with hand-built outputs for each metric.
- [ ] 7.4 Runner-agnostic harness: `evals/run.mjs prepare` builds a workspace and prompt, `score` reads the outputs, `record` writes the result and refuses without `--model` and the skill version. Verify: `record` without `--model` exits 2.
- [ ] 7.5 Run the model cases for at least one model, N runs each, and publish `evals/results/<date>_<model>_<skill-version>.json` and a generated `evals/RESULTS.md` with every run, not the best. Verify: the table lists the model identifier, skill version, date and number of runs; no threshold is claimed.

## 8. Verification

- [ ] 8.1 `node scripts/validate-skills.mjs`, `npm test` and `openspec validate --all --strict` pass.
- [ ] 8.2 Add the catalog row to `README.md` and a CI job in `.github/workflows/validate.yml` that runs the skill tests and the deterministic evals.
- [ ] 8.3 Install with the CLI into Claude Code and Codex (dry run) and confirm the skill is listed.
- [ ] 8.4 Manual end-to-end run on a synthetic repository: scope, verify with a planted wrong line number, repair, demotion of an unsupported claim, review, render, `docs-generator` PDF and DOCX with a chosen theme. Verify: the PR records what was checked and what was not (for example, PDF skipped when no browser is installed).

## 9. Validation with consultants (before declaring v1.0)

- [ ] 9.1 Recruit 5-10 consultants who write assessment reports for clients. Verify: the list of roles and years of experience is recorded; no names are published without consent.
- [ ] 9.2 Prepare two generated reports from the synthetic fixtures (no client data) and a short structured questionnaire (usefulness of the structure, wording of certainty, prioritization, roadmap realism, what they would rewrite, what they would never send to a client, tools they use today). Verify: the questionnaire is committed under `evals/validation/`.
- [ ] 9.3 Run the sessions and record the answers verbatim in an anonymized file. Verify: the file exists and the summary quotes it; nothing in it is invented or inferred beyond the answers.
- [ ] 9.4 Turn recurring complaints into changes or new open questions; decide with the maintainer whether v1.0 ships, and whether to build a SARIF exporter, a maturity score or other deferred items. Verify: a dated decision record in the change's archive notes.
