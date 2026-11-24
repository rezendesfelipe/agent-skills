## ADDED Requirements

### Requirement: The total time of the property test is bounded in proportion to the runner
The property test of the scanner (`test/secrets-property.test.mjs`) SHALL NOT assert an absolute wall-clock limit on the whole test. It SHALL assert that the total time is below a ceiling computed in the same run from the cost of the runner itself: the larger of `DEADLINE_MS` and `TOTAL_FACTOR` times the number of Workers the run started times the smallest wall time of one `measure()` call observed in that run. `TOTAL_FACTOR` SHALL be an initial value of 8, labeled as an initial value to calibrate in the code. The test SHALL NOT start any Worker beyond those its measurements need. A failure of this assertion SHALL name the total, the ceiling, the reference and the Worker count, and SHALL NOT print an input. The figure "at most 5 seconds on a developer machine" of the requirement "Property test of the scanner" (change `harden-assessment-secret-scan`) remains an expectation for a developer machine and is not an assertion.

#### Scenario: A uniformly slower runner
- **WHEN** every Worker start-up on a runner takes 3 times as long as on a developer machine
- **THEN** the reference grows with it, the ceiling grows with it, and the total assertion passes

#### Scenario: A skewed run
- **WHEN** a mutation of the test delays the Worker of about half of the measurements by a time several times the best round trip
- **THEN** the total assertion fails, and the message names the total, the ceiling, the reference and the Worker count

#### Scenario: No absolute limit
- **WHEN** a reader searches `secrets-property.test.mjs` for a constant that is compared with the elapsed time of the whole test
- **THEN** the only comparison is with the computed ceiling, and no fixed millisecond constant other than `DEADLINE_MS` enters it

#### Scenario: No extra Worker
- **WHEN** the test runs after the change
- **THEN** it starts the same number of Workers as before the change (60 with the current seed, when no `scalesFor` attempt is repeated)

### Requirement: Detection of a quadratic scan does not depend on the total
The detection of a super-linear pattern in the property test SHALL rest on `DEADLINE_MS` (a measurement that does not finish is terminated and fails), on the ratio below `SCALE_RATIO_BOUND` when the input doubles, and on `SCAN_TIME_BOUND_MS` measured inside the Worker. These three SHALL keep their values and their code. Each of the two known mutations of the scanner SHALL make the test fail through one of these three, and not through the total: the quadratic prefix before the secret name restored in `generic-credential`, and the scheme part of `url-credential` made unbounded.

#### Scenario: Quadratic prefix restored
- **WHEN** the quadratic prefix is restored in `generic-credential` and the property test runs
- **THEN** it fails with a message that names the seed and the case index, through `DEADLINE_MS` or the ratio, and the total assertion is not the one that fired

#### Scenario: Unbounded URL scheme
- **WHEN** the scheme part of `url-credential` is made unbounded and the property test runs
- **THEN** it fails with a message that names the seed and the case index, through the ratio or `DEADLINE_MS`, and the total assertion is not the one that fired

#### Scenario: Constants unchanged
- **WHEN** the diff of the implementation is read
- **THEN** `DEADLINE_MS`, `SCALE_RATIO_BOUND` and `SCAN_TIME_BOUND_MS` have the same values as before, and `scripts/lib/secrets.mjs` is not changed

### Requirement: The test reports its timing for calibration
The property test SHALL report once, as a test diagnostic, the number of Workers started, the reference round trip, the total, the ceiling and the largest in-worker scan time among its cases, as numbers only. The diagnostic SHALL NOT contain an input, a match or a secret-like value, and a runtime that does not provide the diagnostic call SHALL NOT make the test fail.

#### Scenario: Figures in the CI log
- **WHEN** the `assessment-report` job runs on any leg
- **THEN** its log contains one diagnostic line with those five numbers for the property test

#### Scenario: Nothing but numbers
- **WHEN** the diagnostic line is read
- **THEN** it holds no text derived from an input

### Requirement: The reference states the CI figures honestly
`references/read-only-and-untrusted-input.md` SHALL state the durations of the property test measured on the CI runners, with their source (the workflow runs read) and date, SHALL say that the total is a ceiling relative to the runner, and SHALL keep `SCAN_TIME_BOUND_MS` and the ratio labeled as initial values that are not yet calibrated. It SHALL separate what was measured, what was inferred and what was not measured, and SHALL NOT claim a figure for macOS.

#### Scenario: CI figures with a source
- **WHEN** a reader looks for the time of the property test on the CI runners
- **THEN** the reference gives the minimum and the maximum seen per operating system, the date, and says how they were read

#### Scenario: Initial values still labeled
- **WHEN** a reader looks at `SCAN_TIME_BOUND_MS` and the ratio
- **THEN** the reference says they are initial values to calibrate and that the diagnostic of the property test will provide the Windows figures

#### Scenario: Context budget unchanged
- **WHEN** `node scripts/context-budget.mjs` runs after the change
- **THEN** `skill:assessment-report` stays within its declared budget, and the reference is not part of the preloaded text
