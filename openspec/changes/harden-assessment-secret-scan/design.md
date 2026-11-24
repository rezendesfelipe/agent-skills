## Context

`scripts/lib/secrets.mjs` holds 12 regular expressions (`SECRET_PATTERNS`) and three helpers: `scanString`, `hasSecretKind` and `scanValue`. `verify.mjs` calls `scanString` and `hasSecretKind` on the quote of an evidence item and on the lines it cites; `render.mjs` calls `scanString` on every rendered file. The regexes run in the main thread. Only `absence` evidence runs a user-supplied regex in a worker with a time limit (`regex-limited.mjs`), so that limit does not cover the scanner.

Relevant limits in code today: `MAX_FILE_BYTES` is 1 MiB, `MAX_EXCERPT_LINES` is 20, `MAX_LINE_CHARS` is 2,000 (used only by the `absence` search). Nothing limits the length of one line given to the scanner.

The `generic-credential` pattern is the one that matters for R-2 and I-2. In prose: a boundary (line start or a non-alphanumeric character), an optional repeated prefix of alphanumeric runs ending in `_`, `.` or `-`, a secret-like name, an optional closing quote, `:` or `=`, then either a quoted value that is not a placeholder, or an unquoted value that is neither a placeholder nor an "unquoted reference". The reference alternatives are Terraform references, YAML nodes (`YAML_NODE`) and schema words. The part that matters for R-2 is that `YAML_NODE` is a negative lookahead: when it matches at the start of the value, the whole pattern fails for that line.

The spec of the previous change (`add-assessment-report-skill`, capability `assessment-report`, requirement "Untrusted input and secrets") says secrets are scanned and the scan is heuristic. It does not fix the shape of the scanner, so this change can tighten the scanner without changing that requirement.

### Agent graph (convention: level 2 of `docs/aep/delivery-graph.md`)

This change does not alter the workflow graph of the skill. It changes one deterministic node. For the record:

| Node | Type | Reads | Writes | Tools |
|---|---|---|---|---|
| `verify` (scanner step) | fixed (code) | the quote and the cited lines of each evidence item, and every string of `assessment.json` | verification result: pass or a failure with the code `secret-in-quote`, never the value | none (no network, no process) |
| `render` (scanner step) | fixed (code) | the rendered files in memory | nothing when a secret is found; otherwise the output files | none |

- **No model node is added or changed.** The scanner is deterministic code; no step decides by asking a model whether a string is a secret.
- **Edges:** unchanged. `verify` fails the evidence (exit 1) and the existing demotion edge applies; `render` stops with `secret-in-output`. A scan that exceeds its time bound is a defect, not an edge: the property test (below) is the guard that keeps it from happening, and no new failure code is introduced.
- **State:** unchanged (`.state/run.json`, `assessment.json`).
- **Cycles:** none added. The existing repair loop (two attempts) is unchanged.
- **Human interruptions:** none added. A finding about a secret still requires `redacted: true`.
- **Verifier node:** the scanner is itself a gate that code runs after the model produced text. Its own verifier is the test suite: a corpus test, a differential test against the previous patterns, and a property test (see tasks 2 to 5).

### Context budget

SKILL.md is not edited. The reference file is read on demand and is not listed under `loadedWith` for `skill:assessment-report` in `docs/aep/context-budgets.json`, so the loaded cost stays at the current estimate (about 2,041 tokens, about 2,654 with the 30 percent margin, against a budget of 3,000; an approximation by bytes divided by 4, not an official count). It is checked with `node scripts/context-budget.mjs`. If the implementation must touch SKILL.md, the same command decides, and the budget is not raised in this change.

## Goals / Non-Goals

**Goals**
- A line of any length is scanned in time that grows linearly with its length, and a line of 1 MiB finishes within a bound that is defensible and labeled as an initial value.
- A real credential preceded by a YAML type tag, anchor or alias is flagged. A tag or alias that really stands for a reference, or stands alone, is not.
- Every behavior change is covered by a test that fails when the change is reverted (mutation-checked by hand, as in the previous change).
- The reference tells the truth: what is ignored, what is flagged, what is known to be missed, and which numbers were measured and which were estimated.
- The skill's tests run in CI on Linux and Windows, including the contract test, and a skipped contract test fails that job.
- No credential-shaped literal appears in this change or in the tests it asks for.

**Non-Goals**
- Making the scanner complete. It stays a heuristic with documented false negatives.
- New secret kinds, entropy detection, or a new scanner architecture (a tokenizer or a YAML parser). Considered and rejected for now (Decision 4).
- Runtime dependencies, external services, network access.
- Moving the scanner into a worker with a time limit (Decision 3 explains why that is not the first choice).
- Any change to trust rules, severity, confidence or the `absence` limits.

## Decisions

### Decision 1: a new capability `assessment-secret-scan`, not a MODIFIED delta

The requirement "Untrusted input and secrets" exists only in `openspec/changes/add-assessment-report-skill/specs/assessment-report/spec.md`. That change is merged to `main` but not archived, so `openspec/specs/assessment-report/` does not exist. A `## MODIFIED Requirements` delta must name a requirement of the base spec; without one, `openspec validate --strict` fails. The same holds for `assessment-evals`.

Chosen: create two new capabilities with `## ADDED Requirements`: `assessment-secret-scan` (the scanner) and `assessment-report-ci` (the job). Their requirements do not restate or contradict the existing one: the old requirement says secrets are scanned and the scan is heuristic; the new ones say how the scanner behaves, what it must not do and how it is tested. After the previous change is archived, a later housekeeping change can fold the text together if the maintainer wants a single capability.

Alternatives rejected:
- *MODIFIED against the unarchived spec.* Fails validation, and would copy a block whose home is another open change.
- *Wait until `add-assessment-report-skill` is archived, then MODIFIED.* Blocks a fix for an open review finding on an administrative step, and the archive order is the integrator's, not this change's.
- *A delta inside the folder of the old change.* Edits another change's folder, which the scope check forbids for this branch.

Verified: the proposal passes `openspec validate --strict` with the ADDED form (see the task list for the exact commands).

### Decision 2: make the patterns linear first; add a window as a second guard

The root cause of I-2 is the repeated prefix in the secret-name part. It is also redundant: the match must already start at the line start or right after a non-alphanumeric character, and the separator that ends each prefix segment is itself a non-alphanumeric character. So any text matched with the prefix is matched, from a later start, without it. A prototype (scratch, not committed) removed the prefix and ran a differential test of old against new on 200,000 random short strings built from the vocabulary of the patterns: 0 differences. The same prototype bounded the scheme part of `url-credential` to 32 characters (`{0,31}` after the first letter) with 0 differences. On 1 MiB single lines (repeated short tokens with a separator, repeated letter and dot) the two prototype patterns took 1 to 58 ms on one Linux machine and Node 22, where the current ones take seconds to minutes. These are measured on the prototype; the implementation must re-measure.

Chosen: (a) remove the prefix group from `SECRET_NAME` and bound the scheme part of `url-credential`, with the differential test kept in the suite as a permanent test against a frozen copy of the old patterns' matched set (a table of inputs and expected kinds, not a copy of the old regex); (b) as defense in depth, a line longer than `MAX_SCAN_LINE_CHARS` is scanned in overlapping windows, so a future pattern that regresses is bounded per window. The window size and the overlap are initial values (item 1 of the maintainer list); the sketch is 8,192 characters with an overlap of 512. The overlap must cover the longest span that matters for a match to be found across a window boundary; a `user:secret@host` with a user and credential part longer than the overlap can be missed at a boundary. That limitation is documented, and it is smaller than the alternative of truncating the line (which hides everything after the cut).

Alternatives rejected:
- *Truncate each line to 2,000 characters (the reviewer's suggestion, mirroring `MAX_LINE_CHARS`).* Simple, but it creates a new false negative: a credential at offset 50,000 of a minified JSON file is exactly where a real one hides. Kept as a maintainer option.
- *Bound the prefix to `{0,4}`.* Works, but keeps a group that adds no matches. Removing it is simpler and provably equal.
- *Only windows, no regex change.* Per-window cost is still quadratic: the cost of an 8,192-character window is about 0.3 s by extrapolation from the measured 1.1 s at 40 KB (an estimate), repeated for every window of a 1 MiB line.
- *Run the scanner in a worker with a time limit, as `absence` does.* Adds a thread and a timeout failure code, and a timeout means "unknown", which for a secret scan must fail closed. Linear patterns avoid the problem; revisit only if a pattern cannot be made linear.
- *An engine other than `RegExp` (a linear-time engine such as RE2).* Needs a native or WebAssembly dependency; rejected by the no-dependency rule.

### Decision 3: a tag, anchor or alias is ignored only when it stands alone or precedes a reference

The old rule excluded a value that starts with a tag or anchor, then dropped the line. The new rule is about what follows.

Ignored (not flagged):
- a tag, anchor or alias that is the whole value (nothing but optional spaces or a `#` comment after it), because the value is on the next lines (an Ansible vault block, a multi-line scalar) or is an alias of an anchor defined elsewhere;
- a block indicator alone at the end of the line (unchanged);
- a function tag followed by a reference operand: `!Ref` and `!ImportValue` followed by one identifier; `!GetAtt` followed by a dotted identifier; `!Sub` whose operand holds at least one `${...}` interpolation; and any tag, anchor or alias followed by an operand that is itself a Terraform reference or an interpolation;
- the other CloudFormation function tags (`!Join`, `!Select`, `!If` and so on) when the operand is a flow sequence or mapping (`[`...`]`, `{`...`}`), because their operands are expressions, not literals. This is a documented false negative: a literal inside the expression is not scanned (same family as "a value that is a call to a function").

Flagged: a type tag (`!!str` and the other core types), an anchor (`&name`), an alias (`*name`), a custom tag (`!vault`, `!secret`, `!encrypted`) or a function tag followed by a literal operand on the same line. The tag token is then the start of the value and the existing value rule applies to it, so the line is flagged, with no value printed.

This is the reviewer's suggested correction (alone at the end of the line, or followed by a reference; literal after `!!tipo`, `&x`, `*x` flagged). The honest cost is a possible false positive on a legitimate `!!str` followed by a non-secret literal assigned to a secret-like name (for example a test fixture). The maintainer decides in item 3 of the decision list.

Alternatives rejected:
- *Keep the exclusion and document the false negative (the reviewer's minimal alternative).* Cheapest, and zero regression risk, but it documents a known leak of real credentials that the current patterns could catch. It stays available as the fallback if the corpus test shows too many false positives.
- *Parse the YAML properly.* A parser is a dependency (or a large in-house piece), and the scanner also runs over HCL, JSON, shell and prose, where YAML rules do not apply.
- *Flag every tag and anchor, including a lone one.* Would flag `!vault |` blocks and plain aliases, which are common and legitimate, and would re-open the false positive that R-1 removed.

### Decision 4: tests assemble credential-shaped values at run time, from parts

The repository is public and scanned by a secret-scanning service that has already flagged two incidents caused by password examples written out in full, and a commit that reintroduced one. So no file of this change, and no test it adds, may contain an assignment with a credential-shaped literal, a credential in a URL, a bearer value or a signed-URL signature. Test lines are built in code from parts that are not credential-shaped on their own. The existing mechanism is reused: `test/helpers.mjs` has `fakeSecret` (for example `generic()`, built from four short parts joined at run time) and `evals/fake-secret.mjs` builds fixtures from a marker. The implementation adds one helper to `fakeSecret` for a short value of eight characters made of two parts, and builds each case from `[secret-like name, separator, tag or anchor part, value part]`.

The cases are therefore described abstractly in the specs ("a type tag followed by a space and an eight-character literal"), and the test names say the same.

### Decision 5: a scaling test as the primary time check, an absolute bound as a safety net

An absolute millisecond bound is machine-dependent, and a CI runner (a Windows one in particular) is slower and noisier than a laptop. So the property test asserts two things: (1) the time for a 2x longer pathological input is below a ratio (initial value 3x) of the time for the shorter one, which detects quadratic growth on any machine; (2) the 1 MiB single line finishes within `SCAN_TIME_BOUND_MS`, an initial value of 500 ms that must be calibrated against the first CI runs (the prototype took at most 58 ms on a Linux machine, so 500 ms is about 8 times that, a margin for slower runners). Both numbers are labeled "initial, to calibrate" in the spec and in the test. Inputs are generated from a fixed seed so a failure reproduces.

Alternatives rejected: *absolute bounds only* (flaky across OS and runner load); *no time test, only a regex review* (the quadratic prefix passed review once); *a fuzzing dependency* (non-goal: no dependency).

### Decision 6: one CI job, Ubuntu and Windows, Node 20 and 24, no path filter

Add a job named `assessment-report` to `validate.yml` (and only add; no existing job or line changes; `publish.yml` untouched). It runs the skill's tests in the skill folder with `docs-generator` dependencies installed, so the contract test runs.

- **Matrix:** `os: [ubuntu-latest, windows-latest]`, `node: [20, 24]`, `fail-fast: false`. This follows `docs-generator` (Node 20 and 24) and adds Windows, where CRLF broke tests three times. macOS is left out: the repository's own `test` job already covers three operating systems for the CLI, the skill's engine has no macOS-specific code path known to us, and a macOS runner costs more. Maintainer item 4.
- **Steps (style of the existing jobs):** `actions/checkout@v4`, `actions/setup-node@v4` with the matrix Node, `npm ci` in `plugins/docs-generator/skills/docs-generator` (its `package-lock.json` exists), then `npm test` in `plugins/assessment-report/skills/assessment-report` with the environment variable that turns a skipped contract test into a failure. Both `working-directory` values are literals in the file.
- **Permissions:** the workflow already declares `permissions: contents: read` at the top; the job adds no `permissions` block that widens it. No `pull_request_target`; the job runs on the existing `pull_request` and `push` triggers. No `${{ github.* }}` expression in any `run:` line (the matrix values `matrix.os` and `matrix.node` are used only in `runs-on` and `with`, as in the existing jobs). Third-party actions are not added.
- **Time:** `timeout-minutes: 10` (initial; the engine tests took 7.8 s locally with the contract tests skipped; the contract DOCX build and `npm ci` were not timed here).
- **Path filter:** none. A required check with a path filter blocks pull requests that do not touch the path, so the job runs on every pull request, like the other jobs.
- **Check names the ruleset would list**, exactly as GitHub reports a matrix job: `assessment-report (ubuntu-latest, 20)`, `assessment-report (ubuntu-latest, 24)`, `assessment-report (windows-latest, 20)`, `assessment-report (windows-latest, 24)`. The implementation confirms the names on the first run of the job and corrects this list if they differ.
- **Relation to the ruleset:** `main-protection` requires 15 checks by name. A new job is not required until the maintainer adds its names, which is a repository setting that this change cannot make. Until then the job reports but does not block. The implementation records the four names in `docs/aep/repository-protection.md` as a decision for the maintainer.

Alternatives rejected: *add the tests to the existing `test` job* (that job is the CLI's and runs a 3 by 3 matrix; mixing makes the check names ambiguous); *Ubuntu only* (leaves the Windows line-ending class of failure uncovered); *three operating systems by three Node versions* (9 jobs for a one-second engine suite, no known macOS-only risk); *a reusable workflow* (a new moving part for one job).

### Decision 7: tests that read versioned files must not depend on line endings

Some skill tests read `SKILL.md`, references and locales and count lines or compare text. `.gitattributes` forces LF only for `test/fixtures`, `test/golden` and `templates` of the skill. On a Windows checkout those other files can be CRLF. The implementation either extends `.gitattributes` to LF for the skill's text files (and the plugin) or normalizes line endings in each reading test; the Windows matrix entries prove it. Preferred: both, normalizing in the helper that reads files, and `.gitattributes` for the skill folder, so a new test cannot reintroduce the failure by reading a file raw. This is an implementation choice; the requirement is the outcome (the tests pass on Windows).

## Measured and estimated

Everything here was run on one Linux machine with Node 22 during the writing of this change, on the code of `main` at 41c9d1d, unless the reviewer is named.

| Fact | Status |
|---|---|
| A real-looking credential preceded by `!!str`, `&a`, `*a`, `!vault` or `!secret` is reported clean; with `!Passw0rd` (digits) or no tag it is flagged | Measured here and by the reviewer |
| Several `!Sub`, `!Ref` cases clean | Measured by the reviewer; not re-run for every tag here |
| 20,000 repetitions of a short token and a separator (60 KB): `generic-credential` 1.1 s, `url-credential` 0.74 s | Measured here (the reviewer: 1.1 s for 40 KB, 4.3 s for 80 KB, 18 s for 160 KB) |
| 50,000 repetitions of a letter and a dot (100 KB): `generic-credential` 5.4 s, `url-credential` 3.0 s | Measured here |
| `url-credential` is quadratic too | Measured here; not in the review |
| 1 MiB line: about 12 minutes | Extrapolated by the reviewer from quadratic growth; not measured |
| Prototype patterns on 1 MiB lines: 1 to 58 ms; 0 differences in 200,000 random strings | Measured here on a scratch prototype, not committed |
| Windows, macOS and CI runner timings | Not measured |
| Test suite: 194 tests, 188 pass, 6 skipped (the contract tests, without `npm ci`), 7.8 s | Measured here |
| The scanner flags nothing in about 200 fixture, golden and reference files | Stated in the reference from the earlier change; the corpus test of this change makes it reproducible |
| Effort of about 3 days | Estimate |

## Risks / Trade-offs

- **[New false positive in legitimate Terraform or YAML]** → The tag, anchor and alias rule flags more than before. Mitigation: the corpus test over the repository's own fixtures, goldens, references and the other skills' goldens must flag nothing before and after; references and the forms in Decision 3 stay ignored; the false positives that remain are listed in the reference, accepted on purpose.
- **[Regression of what R-1 fixed]** → R-1 removed false positives for Terraform references and YAML forms. The change must not reintroduce them. Mitigation: the differential and corpus tests, and the N-1 cases (a bare reference prefix is flagged, a resource-type-shaped value of at least two segments is ignored).
- **[Windowing creates a join artifact or hides a match across a boundary]** → Overlap, documented limit for very long `user:credential@host` spans, a test that plants a secret at the start, middle, end and across a boundary of a 1 MiB line.
- **[Absolute time bound is flaky on slow runners]** → Scaling ratio first, absolute bound as safety net, both labeled initial, one calibration pass after the first CI runs.
- **[A new required check blocks the maintainer if the job is flaky]** → The job is not required until the maintainer adds it; recommended after two weeks of green runs.
- **[A test literal looks like a secret and triggers the secret-scanning service]** → Run-time assembly, a corpus test that scans the test folder with the scanner itself, and a grep of the change folder before every commit.
- **[Heuristic stays heuristic]** → The reference says a clean scan means "nothing obvious", never "no secrets"; the tag rule leaves one documented gap (a literal inside a function expression).
- **[Contract test depends on `docs-generator` dependencies]** → `npm ci` in the job; the skip becomes a failure in CI only.

## Decisions for the maintainer

Each item has a recommendation. The numbers are initial values to calibrate, not measured optima.

1. **Line handling (Decision 2).** Recommended: linear patterns plus windows of 8,192 characters with an overlap of 512. Pro: no hidden content, cost bounded even if a pattern regresses. Con: one more mechanism and a documented boundary limit. Alternative: truncate each line to 2,000 characters (simplest, mirrors `MAX_LINE_CHARS`, but a credential late in a minified line is missed). Alternative: linear patterns only (smallest code, no guard against a future regression except the test).
2. **Time bound (Decision 5).** Recommended: a 1 MiB single line in at most 500 ms in the property test, plus a scaling ratio of at most 3 for a doubled input, both initial values. Pro: tolerant of a slow runner, still far from minutes. Con: absolute values are guesses until the first CI runs. Alternatives: 250 ms (tighter, more flaky) or 1,000 ms (safer, weaker as a guard).
3. **Flag a literal after `!!str`, `&a`, `*a` and custom tags (Decision 3).** Recommended: yes. Pro: closes a measured leak of real credentials. Con: a legitimate non-secret literal in the same position becomes a false positive. Fallback if the corpus shows noise: keep the exclusion and only document the gap.
4. **CI matrix (Decision 6).** Recommended: Ubuntu and Windows, Node 20 and 24 (4 entries). Alternatives: 3 operating systems and 3 Node versions (9 entries, no known benefit), Ubuntu only (misses CRLF).
5. **Tighten `todo` and `tbd` with a word boundary (N-2).** Recommended: document only in this change, since a prefix with no boundary is accepted today and tightening is a behavior change with its own false-positive risk; open a follow-up if the corpus shows it matters. Alternative: tighten now (closes the "todo plus letters and digits passes clean" gap).
6. **Name of the capability (Decision 1).** Recommended: two new capabilities, `assessment-secret-scan` and `assessment-report-ci`. Alternative: one capability for both (less to review, mixes a scanner and a pipeline).
7. **Require the job in the ruleset.** Recommended: yes, after the job has been green for about two weeks, adding the four check names (the ruleset count goes from 15 to 19). Pro: the engine tests and the Windows line-ending class of failure block a merge. Con: a flaky job blocks every pull request, and each Node or OS change in the matrix changes the required names.
8. **Corpus test over the repository's own files.** Recommended: include, limited to the skill's folder and the other skills' goldens. Pro: makes "flags nothing in about 200 files" reproducible. Con: a future legitimate fixture that the scanner flags needs an explicit allowlist entry.

## Effort and schedule

Estimates, not measurements; one implementer, one reviewer pass.

| Part | Days |
|---|---|
| Linear patterns, window guard, differential and corpus tests | 1.0 |
| Tag, anchor and alias rule, N-1 test cases, mutation checks | 0.75 |
| Property test (pathological inputs, scaling, fixed seed) | 0.5 |
| Reference text (R-2, N-2, N-3, measured versus estimated) | 0.25 |
| CI job, line-ending fix, Windows debugging, calibration of the bounds | 0.5 |
| Review cycle and margin | 0.25 |
| **Total** | **about 3.25, call it 3 to 4** |

## Open Questions

1. The eight items in "Decisions for the maintainer".
2. Should the windowed scan also run for the `absence` evidence matches that call `scanString` (`verify.mjs` line 176)? Today those calls are on at most five matches of at most 2,000 characters; no change is proposed.
3. Does a fixed seed in the property test hide a failure that another seed would find? A second, random seed could run only when an environment variable is set, for the maintainer's local fuzzing; not part of CI.

## Not verified in this proposal

- Timings on Windows, macOS and CI runners; timings of `npm ci` and the DOCX build in CI.
- That every CloudFormation function tag behaves as Decision 3 lists; only the cases above were reasoned from the pattern source and a few runs.
- That the removal of the prefix group is equal to the old pattern on inputs beyond the random strings tried; the permanent differential test is the evidence the implementation must produce.
- The exact names GitHub gives the matrix checks (taken from the existing `docs-generator (20)` style in `docs/aep/repository-protection.md`).
- The false-positive rate of Decision 3 on client repositories; only this repository's files can be measured.
