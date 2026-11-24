## Why

The CI job `assessment-report` (added by pull request #23, merged) runs the engine tests of the `assessment-report` skill on Ubuntu and Windows, Node 20 and 24. One test in it failed intermittently on Windows and passed on re-run:

- `property: pathological inputs (seed 424242, 36 cases) ...` in `plugins/assessment-report/skills/assessment-report/test/secrets-property.test.mjs` takes **5182 ms** (windows-latest, Node 20, pull request #24 at 169ce27, [job](https://github.com/rezendesfelipe/agent-skills/actions/runs/45407144261/job/138490803561)) and **5035 ms** (windows-latest, Node 24, pull request #24 at 928f273, [job](https://github.com/rezendesfelipe/agent-skills/actions/runs/45411236110/job/138505257801)). The last assertion of the test is `performance.now() - started < BUDGET_MS`, with `BUDGET_MS = 5000`, a constant the file itself labels "initial value" (line 13, assertion on line 62). Both re-runs passed with 2689 ms and 3053 ms for the same code.
- Every other timing assertion passed in all of the 26 executions of the job that ran the current test (linearity ratio below 3, `SCAN_TIME_BOUND_MS` of 500 ms per 1 MiB line, `DEADLINE_MS` of 10 s). The measurements are in `design.md`, "Measured".

The cause is not the scanner. Since the last commit of pull request #23 (6ab9547) each measurement runs in a Worker thread, one per case (`measure()` in `test/scan-inputs.mjs`, `test/scan-worker.mjs`), so that a super-linear pattern is cut off by `DEADLINE_MS` instead of hanging. The test now starts 60 Workers. Before that commit the same test took 371 to 684 ms on all four CI legs (0545dd1); after it, 2.2 to 5.2 s. On a Linux machine here, 60 Worker start-ups account for about 2.8 s of the 3.3 s of the test, and the scanning itself for about 0.1 s. The absolute wall-clock limit on the whole test therefore measures process start-up cost on a noisy runner, not the property the test exists to check (linear scanning).

This is task 7.4 of `harden-assessment-secret-scan` ("calibrate `timeout-minutes` and `SCAN_TIME_BOUND_MS` from the observed times"), which stayed open. This change closes the part of it that is a defect (the absolute total) and leaves the rest open on purpose (see Non-goals).

## What Changes

- **Replace the absolute limit of the whole property test** (`BUDGET_MS = 5000`) by a ceiling proportional to the cost of a Worker round trip measured on the same runner in the same run, with a generous factor and a floor of `DEADLINE_MS`. Recommended criterion in `design.md`, Decision 1, with the alternatives that were weighed.
- **Keep the primary criteria exactly as they are:** `DEADLINE_MS` against a hang, the linearity ratio below 3 (`SCALE_RATIO_BOUND`) and `SCAN_TIME_BOUND_MS`. Neither the numbers nor the code of those three are touched, so the detection of a quadratic regression does not change. The proof is by mutation (Decision 3).
- **Emit a diagnostic from the test** (worker count, reference round trip, total, ceiling, worst in-worker scan time, no input text) so the next CI runs give the figures that this proposal could not measure on Windows, such as the real margin of `SCAN_TIME_BOUND_MS` there.
- **Correct the reference** `references/read-only-and-untrusted-input.md` (the sentence that says both bounds are "initial values to calibrate on the CI runners, so no CI figure is claimed here") to state the CI figures with their source and what stays initial.
- **Nothing else.** No scanner change, no workflow change, no version bump, no tag, no `npm` publish.

## Capabilities

### New Capabilities
None.

### Modified Capabilities
- `assessment-secret-scan`: ADDED requirements for the proportional total ceiling, for the unchanged primary criteria with their mutation proof, for the test diagnostic, and for the honest CI figures in the reference. The requirement "Property test of the scanner" of `harden-assessment-secret-scan` (merged, not yet archived) is not modified here because it is not in `openspec/specs/` yet; a MODIFIED delta fails at `openspec archive` against an absent base spec (checked on a scratch copy, `design.md` Decision 4).

## Non-goals

- Changing the scanner (`scripts/lib/secrets.mjs`), its patterns, `MAX_SCAN_LINE_CHARS` or the window overlap.
- Changing `SCAN_TIME_BOUND_MS` (500 ms), `SCALE_RATIO_BOUND` (3) or `DEADLINE_MS` (10 s). They stay initial values; no CI data in hand shows a failure of them (design.md, "What else may be affected").
- Reducing the number of Workers (a reusable Worker per test file) in this change. It would restore the old speed but changes the measurement harness; it is listed as an option and left to the maintainer's answer (Question Q2).
- Completing the calibration of the initial values. That needs weeks of CI runs, not the 26 executions of one afternoon; it stays open (tasks.md, section 6).
- Adding the four `assessment-report` checks to the `main-protection` ruleset. That is the maintainer's action in the repository settings, as recorded in `docs/aep/repository-protection.md`.
- Touching `validate.yml`, `publish.yml`, `package.json` version, the marketplace manifest or the `README.md` catalog.
- A different test runner or a dependency.

## Impact

- **Files, implementation phase:** `plugins/assessment-report/skills/assessment-report/test/secrets-property.test.mjs` (the constant and the last assertion), `test/scan-inputs.mjs` (a counter of started Workers, exported), `references/read-only-and-untrusted-input.md` (one paragraph). Nothing outside the skill folder.
- **Proposal phase (this pull request):** only `openspec/changes/calibrate-assessment-secret-scan-timing/`.
- **Behavior:** none for users of the skill; the change is in a test. The test gets no slower (no extra Worker is started), and a hung or super-linear scan fails exactly as before.
- **CI:** the intermittent failure of the `assessment-report` job on Windows stops. Time of the job is unchanged. The job is not a required check, so no merge was ever blocked by it.
- **Effort:** about 0.5 working day (estimate): 0.1 test change, 0.2 mutation runs, 0.1 documentation, 0.1 CI reading.
