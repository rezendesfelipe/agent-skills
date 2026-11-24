Paths below are relative to `plugins/assessment-report/skills/assessment-report/` (the skill folder) unless they start with `.github`, `docs` or `scripts`. Effort figures are estimates in days. No task may write a credential-shaped literal: build test values at run time with `fakeSecret` in `test/helpers.mjs`.

## 1. Gate 1 and baseline

- [x] 1.1 The maintainer reviews this proposal on its draft pull request and answers the eight items of "Decisions for the maintainer" in `design.md` (0.1). Verify: an approval or an explicit written reply is linked on the pull request before any task below starts.
- [ ] 1.2 Run the baseline on `main`: `node --test test/*.test.mjs` in the skill folder, `node scripts/validate-skills.mjs`, `npm test` and `npx --yes @fission-ai/openspec@1.7.0 validate --all --strict --no-interactive`. Verify: record the four exit codes and the test counts (194 tests, 188 passing and 6 skipped without `npm ci`, as measured at 41c9d1d) in the pull request. Open: the baseline on `main` was not run as a separate step; the counts after the change are in the pull request.
- [x] 1.3 Create the implementation branch `claude/harden-assessment-secret-scan-impl` or continue on the branch the maintainer names, and keep `package.json` `version` unchanged. Verify: `git diff origin/main -- package.json` is empty at the end. Done: the branch is `claude/implement-harden-assessment-secret-scan`; `package.json` is unchanged.

## 2. Scanner: linear time and no hidden content

- [x] 2.1 Before changing anything, add the table-driven test of the current behavior (inputs with the kinds the previous patterns report, built at run time) and a frozen list of 200 or more short generated inputs with their expected kinds, so the later change is checked against the old behavior (0.25). Verify: the test passes on `main` and fails when a pattern is edited to match one kind less.
- [x] 2.2 Remove the repeated prefix of `SECRET_NAME` and bound the scheme part of the `url-credential` pattern in `scripts/lib/secrets.mjs` (0.25). Verify: the table test of 2.1 still passes (0 differences), and a 1 MiB line of repeated short tokens and separators scans in at most `SCAN_TIME_BOUND_MS` (initial 500 ms).
- [x] 2.3 Add the window guard: lines longer than `MAX_SCAN_LINE_CHARS` (initial 8,192) are scanned in windows with an overlap (initial 512), short lines are scanned as a whole (0.5). Verify: tests plant a synthetic secret-like assignment at the start, in the middle, at the end and across a window boundary of a 1 MiB line, and all four are found; a text with only short lines gives the same kinds as before.
- [x] 2.4 Export the constants (`SCAN_TIME_BOUND_MS` lives in the test, `MAX_SCAN_LINE_CHARS` and the overlap in the module) with a comment that says they are initial values to calibrate. Verify: `git grep -n "initial value" scripts/lib/secrets.mjs test` lists each constant.
- [x] 2.5 Mutation check by hand: restore the old prefix, then remove the window guard, then raise the scheme bound to unbounded (0.1). Verify: each mutation fails at least one test; record it in the pull request.

## 3. Scanner: tags, anchors and aliases (R-2)

- [x] 3.1 Replace the `YAML_NODE` negative lookahead with the rule of Decision 3: ignore a lone tag, anchor or alias, a block indicator alone, and a tag followed by a reference operand; flag a tag, anchor, alias, custom tag or function tag followed by a literal (0.5). Verify: the scenarios of "YAML tags, anchors and aliases do not hide a literal" pass, one test per scenario, each value assembled at run time.
- [x] 3.2 Run the new scanner and the previous one over the corpus of the repository (task 5.2) and over the goldens of the other skills (0.1). Verify: zero new flags, or each new flag is listed in the pull request with its file and the maintainer's decision (accept as a false positive, or fall back to documenting the gap). Done: the corpus test (262 files) flags nothing new; no fallback to documenting the gap was needed.
- [x] 3.3 Mutation check by hand: restore the whole-line exclusion (0.05). Verify: the tag, anchor and alias tests fail.

## 4. Scanner: missing cases (N-1)

- [x] 4.1 Add tests for a value that is exactly each reference prefix, including `path` and `self` (flagged), the same prefix with one segment and with an index (ignored) (0.1). Verify: removing the "at least one more segment" requirement fails a test.
- [x] 4.2 Add tests for a value that starts with an exclamation mark followed by text, and for a custom tag with digits followed by text (flagged) (0.05). Verify: allowing digits in a tag fails a test.
- [x] 4.3 Add tests for a resource-type-shaped value with an underscore and two or more segments (ignored) and with one segment (flagged) (0.05). Verify: both cases pass, and changing the segment count in the pattern fails one.

## 5. Property test and corpus test

- [x] 5.1 Add `test/secrets-property.test.mjs`: a seeded generator of pathological inputs, the no-throw check, the scaling ratio (initial 3) and the 1 MiB bound; the total takes at most 5 s locally (0.5). Verify: the test passes; reverting task 2.2 makes it fail with the seed and case index in the message.
- [x] 5.2 Add `test/secrets-corpus.test.mjs`: scan the versioned text files of the skill folder and the goldens of the other skills (fixtures after the marker is replaced), with an allowlist of file, kind and reason (0.25). Verify: it prints the count of files scanned (about 200 expected; record the real number), flags none, and fails when a test source gets an assignment of a literal credential-shaped value (try it once, then undo).
- [x] 5.3 Add to `test/helpers.mjs` the helper for a short eight-character value assembled from two parts, and use only it and `fakeSecret` for new cases (0.05). Verify: before every commit, run the literal scan of task 8.3 on the diff and get 0 occurrences.

## 6. Documentation

- [x] 6.1 Update `references/read-only-and-untrusted-input.md`: the tag, anchor and alias rule (what is ignored, what is flagged, the function-expression gap), all placeholder prefixes with the ones that have no word boundary named, the resource-type-shaped false negative, the window limit, and a "Measured, estimated and extrapolated" paragraph with the file count, the method and the date (0.25). Verify: the skill documentation test passes, and the new documentation test that compares the code's placeholder prefixes with the reference passes and fails when a prefix is added to the code only.
- [x] 6.2 Remove from the reference any statement the new behavior makes false ("a value that is exactly a tag or alias" is replaced by the new rule). Verify: `git grep -n "exactly a tag" references` finds nothing stale.

## 7. CI job and line endings

- [x] 7.1 Make the contract test fail instead of skipping when a CI variable is set (0.1). Verify: with the variable set and without `npm ci` in `plugins/docs-generator/skills/docs-generator` the contract tests fail with the install hint; without the variable they skip as before.
- [x] 7.2 Make the tests that read versioned files independent of line endings: normalize in the file-reading helper and extend `.gitattributes` to LF for the skill's text files (0.25). Verify: convert a copy of the references and `SKILL.md` to CRLF locally and run the tests (they pass); the Windows entries of 7.4 pass.
- [x] 7.3 Add the job `assessment-report` to `.github/workflows/validate.yml` as described in Decision 6, adding lines only (0.15). Verify: `git diff origin/main -- .github/workflows/validate.yml | grep '^-' | grep -v '^---'` prints nothing; `git diff origin/main -- .github/workflows/publish.yml` is empty; a read of the job shows no `permissions` block, no `pull_request_target`, no `github.` expression in a `run:` line and only the two existing actions.
- [ ] 7.4 Open the pull request and read the four check names, the run times and the skipped-test count from the first runs (0.1). Verify: the four names match the spec, the Windows entries pass, the skipped count is zero; calibrate `timeout-minutes` and `SCAN_TIME_BOUND_MS` from the observed times and record the figures as measured on the runner. Open until the first CI runs of the pull request are read; the names and times are recorded in the pull request.
- [x] 7.5 Record the four check names in `docs/aep/repository-protection.md` as a decision for the maintainer, with the count change from 15 to 19 (0.05). Verify: the page lists the names and states that the job is not required until the maintainer edits the ruleset.

## 8. Verification

- [x] 8.1 Run `node --test test/*.test.mjs` in the skill folder with `npm ci` done in `plugins/docs-generator/skills/docs-generator`, then `node scripts/validate-skills.mjs`, `npm test` and `npx --yes @fission-ai/openspec@1.7.0 validate --all --strict --no-interactive`. Verify: all exit 0 and the skipped count is 0.
- [x] 8.2 Run `node scripts/context-budget.mjs`. Verify: `skill:assessment-report` is within its 3,000-token budget and the output labels the figures as an estimate by bytes divided by 4; SKILL.md is unchanged (`git diff origin/main --stat -- SKILL.md` is empty).
- [x] 8.3 Scan the diff for credential-shaped literals before each commit: search the added lines for an assignment of a literal value to a secret-like name, a credential in a URL, a bearer value and a signed-URL signature, and print only file names and counts. Verify: 0 occurrences. Never print a matched value.
- [x] 8.4 Update the marketplace manifest and the `README.md` catalog only if needed; no new plugin or skill is added, so none is expected. Verify: `node scripts/validate-skills.mjs` passes, and `git diff origin/main --stat -- README.md .claude-plugin` is empty or the pull request says why it is not. Done: no README or marketplace change.
- [ ] 8.5 Run `node scripts/delivery-check.mjs tasks harden-assessment-secret-scan`. Verify: it exits 0 when every task is ticked, or each open task says why it stays open in the pull request.
- [ ] 8.6 Hand the pull request to the independent reviewer (fresh context, read-only) with the measured and estimated table of `design.md` updated with the new numbers. Verify: a verdict comment is linked; reservations loop back to `apply` within the 3-cycle limit. Open: depends on the independent reviewer, not on the implementer.
- [ ] 8.7 After merge, the integrator archives the change (`openspec archive harden-assessment-secret-scan`), and tick task 8.2 of `add-assessment-report-skill` with a note that this change closed it. Verify: `openspec/specs/assessment-secret-scan/` and `openspec/specs/assessment-report-ci/` exist and `openspec validate --all --strict` passes. Open: after merge, by the integrator.
