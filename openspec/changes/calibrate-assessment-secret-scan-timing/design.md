## Status

Proposed and implemented on 2026-11-24 (same pull request, #25). Gate 1 is recorded: the maintainer approved Q1 to Q4 as recommended (Q2: a reusable Worker is a follow-up outside this change). Evidence of the implementation (mutations, delays, CI times) is in `tasks.md` and the pull request.

## Context

`secrets-property.test.mjs` generates 36 pathological inputs from a fixed seed and, for each, (1) scans it on the main thread, (2) calls `measure()`, which starts a Worker (`test/scan-worker.mjs`) that times the scanner and every pattern, with a hang deadline `DEADLINE_MS = 10000`, and (3) for every third case calls `scalesFor()`, which starts two Workers per attempt (up to three attempts) to check that doubling the input multiplies the time by less than 3. The last line asserts that the whole test took less than `BUDGET_MS = 5000`. Counted on this machine with a counter in `measure()`: **60 Workers** per run, no retry.

All numbers below are labeled measured, inferred or not measured. Nothing is estimated silently.

## Measured

### M1. The test in CI (measured)

Source: the job logs, read with `gh api repos/rezendesfelipe/agent-skills/actions/jobs/<id>/logs`, for every run of the workflow `validate` that contains the job `assessment-report` since the Worker commit (7 runs; with the attempt 1 of the two re-run runs, 36 job logs), and for the 2 earlier failed runs, read for their cause. The duration is the `duration_ms` (Node 20, TAP) or the `(N ms)` (Node 24, spec reporter) printed for the test. A re-run in GitHub re-executes only the failed jobs, so a log of a passed job in an attempt 2 is the same execution as in attempt 1 and is listed once. Images: `windows-2025-vs2026` (Windows Server 2025, image 20261116.315.1) and `ubuntu-26.04` (20261116.202.1); Node 24.22.3 on both (the Node 20 patch version was not read). There is **no macOS leg** in the job, so there is no macOS figure.

Summary of the 26 executions with the Worker version of the test (6ab9547 and later); times in ms:

| Leg | n | property test min / median / max | "one line of 1 MiB" test min / median / max | whole `npm test` (s) |
|---|---|---|---|---|
| windows-latest, Node 20 | 7 | 2453 / 4051 / **5182** | 3446 / 5426 / 6392 | 13.7 to 24.5 |
| windows-latest, Node 24 | 7 | 2495 / 3412 / **5035** | 3574 / 4843 / 7031 | 15.0 to 21.6 |
| ubuntu-latest, Node 20 | 6 | 2424 / 3418 / 3729 | 2248 / 3327 / 3693 | 9.5 to 12.9 |
| ubuntu-latest, Node 24 | 6 | 2187 / 3578 / 3868 | 1960 / 3504 / 3746 | 8.9 to 13.1 |

Every execution, with its job log (Worker version unless the row says otherwise):

| OS | Node | Commit | Run | property (ms) | 1 MiB test (ms) | `npm test` (s) | result |
|---|---|---|---|---|---|---|---|
| windows | 20 | PR24 50bc7d5 | [45414392338](https://github.com/rezendesfelipe/agent-skills/actions/runs/45414392338/job/138516528972) | 2453 | 3446 | 13.7 | pass |
| windows | 20 | PR24 169ce27 (re-run) | [45407144261](https://github.com/rezendesfelipe/agent-skills/actions/runs/45407144261/job/138491660196) | 2689 | 3648 | 15.1 | pass |
| windows | 20 | PR23 6ab9547 | [45405674623](https://github.com/rezendesfelipe/agent-skills/actions/runs/45405674623/job/138485628053) | 3446 | 5305 | 17.9 | pass |
| windows | 20 | PR24 928f273 (attempt 1) | [45411236110](https://github.com/rezendesfelipe/agent-skills/actions/runs/45411236110/job/138505257896) | 4051 | 5426 | 19.5 | pass |
| windows | 20 | main e58f8be | [45406356420](https://github.com/rezendesfelipe/agent-skills/actions/runs/45406356420/job/138488030192) | 4141 | 6054 | 20.5 | pass |
| windows | 20 | main e0c7b06 | [45415398584](https://github.com/rezendesfelipe/agent-skills/actions/runs/45415398584/job/138520114435) | 4744 | 6193 | 20.9 | pass |
| windows | 20 | PR24 169ce27 (attempt 1) | [45407144261](https://github.com/rezendesfelipe/agent-skills/actions/runs/45407144261/job/138490803561) | **5182** | 6392 | 24.5 | **fail** |
| windows | 24 | PR24 169ce27 (attempt 1) | [45407144261](https://github.com/rezendesfelipe/agent-skills/actions/runs/45407144261/job/138490803591) | 2495 | 3574 | 15.0 | pass |
| windows | 24 | PR24 928f273 (re-run) | [45411236110](https://github.com/rezendesfelipe/agent-skills/actions/runs/45411236110/job/138506135059) | 3053 | 4045 | 15.5 | pass |
| windows | 24 | PR24 50bc7d5 | [45414392338](https://github.com/rezendesfelipe/agent-skills/actions/runs/45414392338/job/138516528590) | 3235 | 4462 | 15.8 | pass |
| windows | 24 | PR23 6ab9547 | [45405674623](https://github.com/rezendesfelipe/agent-skills/actions/runs/45405674623/job/138485627822) | 3412 | 4843 | 16.1 | pass |
| windows | 24 | main e58f8be | [45406356420](https://github.com/rezendesfelipe/agent-skills/actions/runs/45406356420/job/138488030188) | 4543 | 5972 | 18.8 | pass |
| windows | 24 | main e0c7b06 | [45415398584](https://github.com/rezendesfelipe/agent-skills/actions/runs/45415398584/job/138520114348) | 4880 | 6414 | 18.6 | pass |
| windows | 24 | PR24 928f273 (attempt 1) | [45411236110](https://github.com/rezendesfelipe/agent-skills/actions/runs/45411236110/job/138505257801) | **5035** | 7031 | 21.6 | **fail** |
| ubuntu | 20 | PR23 6ab9547 | [45405674623](https://github.com/rezendesfelipe/agent-skills/actions/runs/45405674623/job/138485627856) | 2424 | 2301 | 9.5 | pass |
| ubuntu | 20 | PR24 169ce27 | [45407144261](https://github.com/rezendesfelipe/agent-skills/actions/runs/45407144261/job/138490803623) | 2494 | 2248 | 10.2 | pass |
| ubuntu | 20 | main e0c7b06 | [45415398584](https://github.com/rezendesfelipe/agent-skills/actions/runs/45415398584/job/138520114326) | 3360 | 3281 | 11.7 | pass |
| ubuntu | 20 | PR24 50bc7d5 | [45414392338](https://github.com/rezendesfelipe/agent-skills/actions/runs/45414392338/job/138516528060) | 3475 | 3373 | 12.4 | pass |
| ubuntu | 20 | main e58f8be | [45406356420](https://github.com/rezendesfelipe/agent-skills/actions/runs/45406356420/job/138488029940) | 3508 | 3603 | 12.1 | pass |
| ubuntu | 20 | PR24 928f273 | [45411236110](https://github.com/rezendesfelipe/agent-skills/actions/runs/45411236110/job/138505258094) | 3729 | 3693 | 12.9 | pass |
| ubuntu | 24 | PR23 6ab9547 | [45405674623](https://github.com/rezendesfelipe/agent-skills/actions/runs/45405674623/job/138485627967) | 2187 | 1960 | 8.9 | pass |
| ubuntu | 24 | PR24 928f273 | [45411236110](https://github.com/rezendesfelipe/agent-skills/actions/runs/45411236110/job/138505257943) | 2376 | 2253 | 9.9 | pass |
| ubuntu | 24 | PR24 50bc7d5 | [45414392338](https://github.com/rezendesfelipe/agent-skills/actions/runs/45414392338/job/138516528535) | 3554 | 3667 | 12.2 | pass |
| ubuntu | 24 | PR24 169ce27 | [45407144261](https://github.com/rezendesfelipe/agent-skills/actions/runs/45407144261/job/138490803719) | 3603 | 3746 | 12.0 | pass |
| ubuntu | 24 | main e0c7b06 | [45415398584](https://github.com/rezendesfelipe/agent-skills/actions/runs/45415398584/job/138520114693) | 3656 | 3492 | 13.1 | pass |
| ubuntu | 24 | main e58f8be | [45406356420](https://github.com/rezendesfelipe/agent-skills/actions/runs/45406356420/job/138488030197) | 3868 | 3516 | 12.1 | pass |

Before the Worker per case (pull request #23 at 0545dd1, the same 36 cases, [run 45402836970](https://github.com/rezendesfelipe/agent-skills/actions/runs/45402836970)): property test 371 ms (ubuntu, Node 24, [job](https://github.com/rezendesfelipe/agent-skills/actions/runs/45402836970/job/138475628877)), 684 ms (ubuntu, 20, [job](https://github.com/rezendesfelipe/agent-skills/actions/runs/45402836970/job/138475629132)), 379 ms (windows, 24, [job](https://github.com/rezendesfelipe/agent-skills/actions/runs/45402836970/job/138475628858)) and 677 ms (windows, 20, [job](https://github.com/rezendesfelipe/agent-skills/actions/runs/45402836970/job/138475629391)). The two earlier failed runs of the job in pull request #23 ([45401937314](https://github.com/rezendesfelipe/agent-skills/actions/runs/45401937314), [45402549971](https://github.com/rezendesfelipe/agent-skills/actions/runs/45402549971)) failed for other reasons (the corpus test and a file URL test on Windows), none of them a timing assertion.

What the table says (measured):

1. The failures are 2 of 14 Windows executions and 0 of 12 Ubuntu executions. Both failures are the total assertion only: each of those logs has exactly 1 failing test out of 228, and the failure message is the budget one.
2. The same code on the same leg varies by up to 1.9 times between runs: 5182 ms then 2689 ms (169ce27, Windows, Node 20); 5035 ms then 3053 ms (928f273, Windows, Node 24). A fixed limit at 5000 ms sits above the median (3.4 to 4.1 s) by only 1.2 to 1.5 times on Windows, and 5 of 14 Windows executions were within 0.5 s of the limit or above it (4543, 4744, 4880, 5035, 5182).
3. Ubuntu never exceeded 3868 ms (1.3 times of margin under 5000).
4. The same 36 cases took 371 to 684 ms before the Worker per case and 2187 to 5182 ms after it, on the same four legs. The increase is 1.7 to 4.7 s, depending on the leg and the run.

### M2. Where the time goes (measured locally, Linux)

Machine: Linux 6.18, 4 CPUs, Node 22.23.5. Tools: throwaway scripts in the scratchpad that copy the test body and time each part; nothing in the repository was changed.

| Quantity | Value (measured here) |
|---|---|
| Whole property test, 3 runs | 3.17, 3.22, 3.23 s (`duration_ms` of node:test) |
| Workers started per run (counter in `measure()`) | 60 (36 from `measure`, 24 from 12 calls of `scalesFor`; no retry) |
| Round trip of one trivial Worker (module import included), average of 20 | 48.4 ms |
| `measure()` wall time per call, 36 calls | 1.69 s in total (47 ms per call); the scan inside the Worker, summed over the 36 calls: 0.10 s |
| `scalesFor()` wall time, 12 calls | 1.47 to 1.56 s (about 61 ms per Worker) |
| Scans on the main thread (`scanString`, 36 calls) | 0.11 to 0.14 s |
| 1 MiB test, 18 Workers | 3.2 to 3.9 s; worst in-worker scan of a 1 MiB line 100 to 124 ms (bound: 500 ms) |

So Worker start-up is about 60 x 47 ms = 2.8 s of 3.3 s (about 85 percent); the scanning is about 0.1 s in the Workers plus 0.12 s on the main thread. That agrees with M1 point 4: the work that grew is process start-up.

### M3. Not measured, and why

- **The split between Worker start-up and scanning on the Windows runners.** The logs print only the duration of each test. It is inferred, not measured, that start-up dominates there too (the 4 CI pairs of M1 point 4 show a jump of 1.7 to 4.7 s from 60 added Workers, which is 28 to 78 ms per Worker, the same order as the 47 ms measured here). No Windows machine is available to this session and a diagnostic run in CI needs a code change, which is the first implementation task (tasks 1.1 and 2.2).
- **The margin of `SCAN_TIME_BOUND_MS` on Windows.** The in-worker scan time of a 1 MiB line is not printed by the test. The only bound we have is indirect: the 1 MiB test, which also starts 18 Workers, took 3.4 to 7.0 s on Windows, that is at most 390 ms per shape including start-up, generation of the 1 MiB string and two scans. So a single scan on Windows is below that, and locally the worst is 124 ms. That does not prove a margin to 500 ms; the diagnostic of this change prints it.
- **macOS.** The job has no macOS leg.
- **A Windows reproduction of the failure.** Not available; the two failures in CI are the evidence.

### M4. After the implementation (measured in CI, first attempt, run [45426230948](https://github.com/rezendesfelipe/agent-skills/actions/runs/45426230948), head 4d37aad)

Read from the new diagnostic line in each job log; 228 tests, 0 failed, 0 skipped on every leg.

| Leg | Workers | reference (ms) | total (ms) | ceiling (ms) | worst in-worker scan (ms) | job |
|---|---|---|---|---|---|---|
| ubuntu-latest, Node 20 | 60 | 36.1 | 3494 | 17342 | 13.2 | [log](https://github.com/rezendesfelipe/agent-skills/actions/runs/45426230948/job/138558886956) |
| ubuntu-latest, Node 24 | 60 | 32.1 | 3154 | 15399 | 9.8 | [log](https://github.com/rezendesfelipe/agent-skills/actions/runs/45426230948/job/138558886720) |
| windows-latest, Node 20 | 60 | 46.3 | 4172 | 22213 | 13.2 | [log](https://github.com/rezendesfelipe/agent-skills/actions/runs/45426230948/job/138558886944) |
| windows-latest, Node 24 | 60 | 48.9 | 4535 | 23496 | 12.8 | [log](https://github.com/rezendesfelipe/agent-skills/actions/runs/45426230948/job/138558886921) |

This is one run, so it is a first data point and not a calibration. It replaces two inferences of M3 and of Decision 1: the Windows Worker round trip is 46 to 49 ms at best (inferred before: 60 ms), and the ceiling is about 22 to 23 s there (inferred before: 28.8 s), 5 times the total of this run. The worst in-worker scan of the 36 cases is about 13 ms on every leg; that is the 16 to 64 KB cases, not the 1 MiB line, so the Windows margin of `SCAN_TIME_BOUND_MS` (500 ms per 1 MiB) is still not measured. macOS: the job has no such leg.

## What else may be affected

Checked against M1, M2 and a search of the test sources for time assertions (`performance.now`, `Date.now`, `timeout`):

| Assertion | Where | Includes Worker start-up? | CI evidence | Verdict |
|---|---|---|---|---|
| Whole property test < `BUDGET_MS` 5000 | `secrets-property.test.mjs:62` | **Yes**, 60 Workers | 2 failures in 14 Windows executions | Defect. Fixed by this change. |
| In-worker scan of 1 MiB < `SCAN_TIME_BOUND_MS` 500 ms (per shape, and per pattern in `secrets-scan.test.mjs:28`) | `secrets-scan.test.mjs:46`, `secrets-property.test.mjs:56` | No: the time is measured inside the Worker, best of 1 to 3 runs | 0 failures in 26 executions; local worst 100 to 124 ms (4 to 5 times of margin); Windows margin not measured (M3) | Not shown to be at risk; it has the least known margin of the three, so the diagnostic of this change records it. Out of scope. |
| Ratio when the input doubles < `SCALE_RATIO_BOUND` 3 (`scalesFor`, up to 3 attempts, floor 8 ms) | `scan-inputs.mjs:161-171` | No: in-worker times | 0 failures in 26 executions | Not at risk on this evidence. A noisy runner makes a ratio fail only when two scans of the same input differ by 3 times; three attempts make that unlikely. Out of scope. |
| Hang deadline `DEADLINE_MS` 10000 per measurement | `scan-inputs.mjs:138-153` | Yes, for one Worker | 0 failures; one start-up is an inferred 30 to 90 ms (M3), more than 100 times below the deadline | Not at risk. Unchanged. |
| Search time limits in `verify.test.mjs:337-349` (8000 ms and 5000 ms around a call with its own `timeoutMs`) | `verify.test.mjs` | No Workers | 0 failures | Out of scope; not a scanner test. |

Left out of scope, explicitly: calibrating `SCAN_TIME_BOUND_MS`, `SCALE_RATIO_BOUND` and `DEADLINE_MS`; the `timeout-minutes: 10` of the job (the longest `npm test` seen is 24.5 s); the 18-Worker 1 MiB test (it has no total limit); the `verify.test.mjs` limits; macOS.

## Decisions for the maintainer

Each has a recommendation. Answer in the pull request; the implementation does not start before gate 1.

| # | Question | Recommendation |
|---|---|---|
| Q1 | Which criterion replaces the absolute total? | Alternative D (Decision 1): ceiling = max(`DEADLINE_MS`, 8 x Workers started x the smallest Worker round trip observed in the run). |
| Q2 | Also reduce the cost (a reusable Worker per file, Alternative F)? | No, not in this change. Offer it as a follow-up if the diagnostic shows start-up still dominates. |
| Q3 | Is a total ceiling needed at all, or is "no total" (Alternative B) enough? | Keep D: the spec of `harden-assessment-secret-scan` says the test is light; D keeps that guard at no flake risk. B is acceptable if you prefer no wall-clock assertion at all. |
| Q4 | Is the factor of 8 acceptable as the first value? | Yes, as an initial value; it is calibrated from the diagnostic after weeks of CI, like the other bounds. |

## Decisions

### Decision 1. The criterion that replaces the absolute total

**What the total assertion is for.** The harden spec asks the test to be light ("at most 5 seconds on a developer machine"). What detects a quadratic scanner is not the total: it is `DEADLINE_MS` (a hung scan is terminated at 10 s), the ratio below 3 and `SCAN_TIME_BOUND_MS` (both measured inside the Worker). The total is a guard against the test becoming heavy. A heavy test from a slow runner is not a defect of the scanner, so the guard must scale with the runner.

**Alternatives.**

| | Alternative | Pros | Cons |
|---|---|---|---|
| A | Raise `BUDGET_MS` to a fixed larger value (for example 15000) | One line. No design. | Another arbitrary number with the same flaw: it has no relation to the cost it bounds, and the next Worker added to the harness flakes it again. Windows margin would be 2.9 times (15000 over 5182), Ubuntu 3.9 times; the spread of one leg alone is 1.9 times. |
| B | Remove the total; rely on `DEADLINE_MS`, the ratio and `SCAN_TIME_BOUND_MS` | No wall-clock assertion of the whole test, so nothing to flake. Simplest. Detection of a quadratic regression is untouched (it never depended on the total). | The test has no guard against becoming heavy for non-scanner reasons (for example many more Workers). Departs from the harden spec sentence, which then has to be read as an expectation. |
| C | A ceiling per case derived from `DEADLINE_MS` (for example each case below `DEADLINE_MS` / 2 of wall time) | Reads simply. | `measure()` already rejects at `DEADLINE_MS`, so it only tightens the deadline and brings back a wall-clock limit that includes Worker start-up, on a runner where one start-up is an inferred 30 to 90 ms (M3): it can flake on a stalled runner and never catches a regression the deadline does not. |
| D | **A total ceiling proportional to a reference measured on the same runner in the same run: ceiling = max(`DEADLINE_MS`, `TOTAL_FACTOR` x Workers started x the smallest Worker round trip observed in the run)** | Scales with the runner, since it is derived from that runner's own start-up cost. It cannot flake on a uniformly slower Windows (the reference grows with it). It keeps a guard against a test that grows heavy or has a few stalled measurements. It adds no Worker: the reference is the smallest wall time of the `measure()` calls the test already makes (the smallest is the least noisy). The floor of `DEADLINE_MS` keeps the ceiling from being below one hang deadline. | More code than B (a counter and a minimum). Detects only a large skew inside the run (a subset of measurements about `TOTAL_FACTOR` times slower than the best), not a uniform slowdown; that is intended, and the primary criteria cover the scanner. |
| E | Warn only: print the total with `t.diagnostic`, assert nothing | No flake. Gives the data. | Same lost guard as B. It is included in D as the diagnostic requirement. |
| F | Reuse one Worker per test file; terminate and recreate it only at the deadline | Cuts the cost: 60 start-ups become 1 to 3, so the test returns to about the 0.4 to 0.7 s of the pre-Worker CI figures of M1 (0545dd1), and the absolute limit would then be safe again. | Changes the measurement harness (state between measurements: warm code makes later cases faster, which changes the ratio's baseline); more surface to get wrong. Not needed to remove the flake. Offered as a follow-up (Q2). |

**Recommendation: D, with E's diagnostic.** Initial values: `TOTAL_FACTOR = 8`, floor `DEADLINE_MS` (10000 ms), both labeled "initial value" in the code.

*Why 8.* On the local run the test is 1.15 times the product 60 x 48 ms, so a factor of 8 leaves a margin of about 7 times over the typical case. The largest spread seen in CI for one leg is 1.9 times; the largest spread between legs is about 1.5 times (Windows against Ubuntu, medians). A factor of 8 absorbs both and leaves room, and it is an initial value like the others.

*Inferred expected ceiling in CI, not measured.* If a Windows start-up is 60 ms at its best (the CI totals of 2.5 to 5.2 s over 60 Workers imply an average of 40 to 86 ms; the minimum is lower than the average), the ceiling is 8 x 60 x 60 = 28.8 s, about 5.5 times the worst total seen (5.2 s). On Ubuntu with a minimum of about 35 ms it is about 17 s, 4.4 times the worst seen (3.9 s). The diagnostic gives the real figures.

*Not slower than necessary.* D starts no Worker that the test did not start already. The cost of the change to the test run is a few microseconds for a counter and a minimum.

*What happens at the failure.* The message names the total, the ceiling, the reference and the Worker count, never an input (the existing rule that a failure names the seed and case index and not the input).

### Decision 2. How the reference and the count are obtained

`scan-inputs.mjs` exports a function that returns how many Workers `measure()` has started. The test records, for each `measure()` call it makes itself, the wall time of the call; the reference is the smallest of those (36 values). `scalesFor()` is not timed individually (it starts 2 to 6 Workers, and it can retry), but its Workers are counted, so the ceiling stays proportional if a retry happens. The count of Workers is read at the end. No extra Worker, no extra measurement, no change in what `measure()` returns.

Alternative rejected: a dedicated calibration Worker at the start (median of 3 trivial round trips). It is a cleaner reference but costs 3 Workers (about 0.15 s locally, 3 to 4 percent) for no gain over the minimum of 36 values.

### Decision 3. Proof that the detection of a quadratic regression does not get worse

The change touches only the last assertion of one test, and the new one is weaker than the old one in the direction of "fewer false failures", so what has to be proven is that the real detectors never relied on it. Measured here, on the current test, on a scratch copy of the skill folder, with each mutation applied to `scripts/lib/secrets.mjs` and then discarded:

| Mutation (the two known ones) | Result (measured, this machine, property file alone) | Which assertion fired |
|---|---|---|
| The scheme part of `url-credential` unbounded (`{0,31}` replaced by `*`) | fails at case 0 after 11.5 s: `url-credential: 140.9 ms -> 602.1 ms` (ratio 4.3) | the ratio (`scalesFor`), not the total |
| The quadratic prefix before the secret name restored in `generic-credential` | fails at case 12 after 38.9 s: `the scan did not finish within 10000 ms` | `DEADLINE_MS`, not the total |

Neither failure is the total assertion, so replacing it cannot make either mutation pass. (The figures of about 51 to 74 s and about 111 s reported earlier for these mutations were not re-measured here and differ from the ones above; the difference is not explained. The point stands either way: both mutations are detected by `DEADLINE_MS` or by the ratio, and the total never fired.) The implementation repeats both mutations on the new test and records the times (tasks 3.1 and 3.2), and adds a third mutation that proves the new ceiling can fail (task 3.3): a delay injected in the Worker for about half the measurements makes the average Worker round trip several times the best one, which the ceiling must catch with a message naming the ceiling, the reference and the count.

### Decision 4. ADDED, not MODIFIED

What exists: `openspec/specs/` has seven specs and none is `assessment-secret-scan`; the requirement "Property test of the scanner" lives in the delta of `harden-assessment-secret-scan`, which is merged (pull request #23) and still in `openspec/changes/` (its task 8.7, the archive, is open). The previous proposals of this repository faced the same state and used ADDED with new requirement names (`harden-assessment-secret-scan` for `assessment-report`; `fix-stacks-auditor-guard-agent-type` for `stacks-auditor`).

Checked here on a scratch copy of `openspec/` with `@fission-ai/openspec@1.7.0`:

1. `openspec validate --strict` accepts a MODIFIED delta even when the base spec is absent.
2. `openspec archive` of that change aborts with "target spec does not exist; only ADDED requirements are allowed for new specs. MODIFIED and RENAMED operations require an existing spec".
3. After archiving `harden-assessment-secret-scan` first, a MODIFIED delta of "Property test of the scanner" aborts unless it repeats all the scenarios of the base ("Pathological inputs", "Reproducible failure").

So MODIFIED would tie the archive of this change to the archive of the other and force copying its scenarios. ADDED works in either order. The sentence "take at most 5 seconds on a developer machine (an initial value)" of the old requirement stays true as an expectation (the test takes 3.2 s locally, M2); the new requirement says it is not an assertion. If the maintainer prefers MODIFIED, the integrator archives `harden-assessment-secret-scan` first and the delta is rewritten with both scenarios (Question to be raised at archive time; no impact on the implementation).

### Decision 5. The diagnostic

The test calls `t.diagnostic(...)` (available in Node 20 and 24, which the job uses) once, at the end, with: Workers started, reference round trip, total, ceiling, and the largest in-worker `scan` time among the 36 cases. It needs `measure()` results, which the test already has (`m.scan`). It prints numbers only. This is what lets the next CI runs answer M3 (the Windows margin of `SCAN_TIME_BOUND_MS` among others) without a second proposal. The `diagnostic` shows up in the `ℹ`/`#` lines of the log, readable with the same `gh api ... logs` command used for M1.

## Risks and residual limits

| Risk | Mitigation or note |
|---|---|
| The reference (minimum of 36 round trips) is unrealistically small and the ceiling too tight | The floor of `DEADLINE_MS` (10 s); the factor of 8; if it fails the message prints the four numbers, so the calibration is a one-line change. |
| The ceiling is too loose to catch anything useful | It is not meant to catch a scanner regression (Decision 3). It catches a skewed or stalled run. If the maintainer wants zero wall-clock assertions, Alternative B is the answer (Q3). |
| `scalesFor` retries inflate the Worker count and the ceiling | The count follows the Workers actually started, and the retries are bounded (3 attempts), so the ceiling is at most 108 Workers x 8 x the reference. |
| `t.diagnostic` is missing or different in a Node version of the job | It exists in Node 20 and 24 (the matrix). The call is guarded (`t.diagnostic?.(...)`), so its absence cannot fail the test. |
| The proposal's explanation (Worker start-up) is wrong on Windows | It is inferred there (M3). The diagnostic of the first implementation run on Windows confirms or refutes it before any later calibration; the change is still correct if the cause is other, because the ceiling scales with whatever the runner's per-measurement cost is. |
| A new intermittent failure elsewhere hides behind this fix | The other timing assertions have 0 failures in 26 executions (table above); the diagnostic gives the Windows margin of `SCAN_TIME_BOUND_MS`. |
| Nobody reads the calibration afterwards | Tasks 6.1 to 6.3 keep it open and named: the full calibration after weeks of CI is explicitly not closed here. |

## Impact on documentation

`references/read-only-and-untrusted-input.md` line 47 says that the 500 ms and ratio-3 bounds "are initial values to calibrate on the CI runners, so no CI figure is claimed here". That stays true for those two bounds, but the reference should now give the CI figures of the property test (3 to 5 s on Windows, 2 to 4 s on Ubuntu, with the date and the method), say that the total is a ceiling relative to the runner, and keep the line between measured and inferred. Lines 45 (window and overlap "initial values") are not related and stay.

## Release

Nothing is released. No version bump, no tag, no `npm publish`, no marketplace change; `package.json`, `plugin.json` and the workflows are untouched.
