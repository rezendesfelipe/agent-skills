## ADDED Requirements

### Requirement: CI job for the assessment-report tests
`.github/workflows/validate.yml` SHALL have a job named `assessment-report` that runs the engine tests of the skill (`npm test` in `plugins/assessment-report/skills/assessment-report`) and the contract test with `docs-generator`. The job SHALL run on `ubuntu-latest` and `windows-latest` with Node 20 and 24 (`fail-fast: false`), install the `docs-generator` dependencies with `npm ci` in `plugins/docs-generator/skills/docs-generator` before the tests, and set a `timeout-minutes` (an initial value of 10, to calibrate). The implementation SHALL change `validate.yml` only by adding this job: no existing job, trigger or line changes, and `publish.yml` is not touched.

#### Scenario: Tests run in CI
- **WHEN** a pull request is opened
- **THEN** four checks named `assessment-report (ubuntu-latest, 20)`, `assessment-report (ubuntu-latest, 24)`, `assessment-report (windows-latest, 20)` and `assessment-report (windows-latest, 24)` run the 194 or more engine tests

#### Scenario: Only an addition
- **WHEN** the diff of `validate.yml` against `main` is read
- **THEN** it shows added lines only (no removed or changed line), and `git diff` of `.github/workflows/publish.yml` is empty

#### Scenario: Windows entry present
- **WHEN** the job definition is read
- **THEN** its matrix includes `windows-latest`

### Requirement: The contract test cannot be skipped in CI
In CI the contract test with `docs-generator` MUST fail instead of being skipped when the `docs-generator` dependencies are missing. A variable set only by the job SHALL turn the skip into a failure; a local run without the variable SHALL keep skipping with its reason. The job SHALL report how many tests were skipped, and SHALL fail when the count of skipped tests is not zero.

#### Scenario: Dependencies missing in CI
- **WHEN** the variable is set and `npm ci` was not run in the `docs-generator` folder
- **THEN** the contract tests fail with a message naming the missing install

#### Scenario: Local run without install
- **WHEN** a developer runs `npm test` in the skill folder without the variable and without `npm ci`
- **THEN** the contract tests are skipped with their reason and the run passes

#### Scenario: Skipped tests in CI
- **WHEN** the job finishes with one or more skipped tests
- **THEN** the job fails

### Requirement: Least privilege and safe workflow expressions
The `assessment-report` job SHALL inherit the workflow's `permissions: contents: read` and SHALL NOT add or widen permissions. The workflow SHALL NOT use the `pull_request_target` trigger. No `run:` line of the job SHALL interpolate a `github.*` expression; the matrix values are used only in `runs-on` and in `with`. The job SHALL use only the actions already used by the other jobs (`actions/checkout@v4`, `actions/setup-node@v4`), with the same version style, and SHALL NOT use a path filter, so it can be made required without blocking pull requests that do not touch the skill.

#### Scenario: Static check of the job
- **WHEN** the job text is read
- **THEN** it has no `permissions` block that widens `contents: read`, no `pull_request_target`, no `${{ github.` inside a `run:` value, and no action other than the two above

#### Scenario: Every pull request
- **WHEN** a pull request changes only documentation
- **THEN** the job still runs and reports a result

### Requirement: Tests do not depend on line endings
Tests of the skill that read versioned files (the skill documentation, references, locales, schema and templates) SHALL give the same result with LF and CRLF line endings. The repository SHALL force LF for the skill's text files in `.gitattributes`, or the tests SHALL normalize line endings when they read a file, or both. The Windows entries of the job are the proof.

#### Scenario: Windows checkout
- **WHEN** the job runs on `windows-latest`
- **THEN** every engine test passes, including the tests that count lines or compare the text of `SKILL.md` and the references

#### Scenario: CRLF in a versioned file
- **WHEN** a test reads a reference file whose line endings were converted to CRLF
- **THEN** the test gives the same result as with LF

### Requirement: Relation to the main-protection ruleset
Adding the job SHALL NOT make it a required check. The change SHALL record the four exact check names in `docs/aep/repository-protection.md` as a decision for the maintainer, who alone edits the ruleset (a repository setting). The documentation SHALL state that until the names are added the job reports but does not block a merge, and that the required count would go from 15 to 19.

#### Scenario: Names recorded
- **WHEN** `docs/aep/repository-protection.md` is read after the change
- **THEN** it lists the four check names and says the maintainer decides whether to require them

#### Scenario: Not required by default
- **WHEN** the job fails on a pull request and the ruleset was not edited
- **THEN** the merge is not blocked by that check, and the documentation says so
