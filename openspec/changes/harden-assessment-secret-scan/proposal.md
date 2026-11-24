## Why

The `assessment-report` skill (pull request #19, merged) ships a heuristic secret scanner, `scripts/lib/secrets.mjs`. The independent review of its final head (639ca8c, approved with reservations) left open findings that the maintainer chose to fix in a follow-up. This change specifies that follow-up. It writes no code.

- **R-2 (important), a real secret reported as clean.** The scanner ignores an unquoted value that starts with a YAML tag or anchor (`!!str`, `!vault`, `!Ref`, `!Sub`, `&name`, `*name`), but the exclusion drops the whole line, so the literal text that comes after the tag or anchor is never scanned. The reviewer measured several real-looking credentials as clean when preceded by `!!str`, `&a`, `*a`, `!vault`, `!Sub` or `!secret`. `!!str` is used in practice to force a numeric credential to a string. The reference `references/read-only-and-untrusted-input.md` says only "a value that is exactly a tag or alias" and does not say that the text after it is ignored, so it is inaccurate. We re-measured this on `main` (see `design.md`, "Measured and estimated").
- **I-2 (important, pre-existing), a hostile file can hang `verify`.** The optional prefix `(?:[A-Za-z0-9]+[_.-])*` of the secret-name pattern takes quadratic time. The reviewer measured 1.1 s for a 40 KB line, 4.3 s for 80 KB and 18 s for 160 KB; extrapolated, a 1 MB line (the file size cap) takes about 12 minutes. `verify` scans the cited lines of client files, `MAX_EXCERPT_LINES` is 20 and there is no line-length cap, so one minified line in a client file stalls the engine (a local denial of service, no leak). The time limit that protects `absence` evidence does not cover the scanner. While preparing this change we found that the `url-credential` pattern has the same quadratic shape (its scheme part), which the review did not report: a line of 50,000 repetitions of a letter and a dot (100 KB) takes about 3 s in that pattern alone.
- **N-1, test gaps.** Two mutations of the scanner survive the 194 current tests: dropping the "at least one more segment" requirement after the reference prefixes (`var`, `local`, `data`, `module`, `each`, `count`, `path`, `terraform`, `self`), and allowing digits in a custom tag.
- **N-2 and N-3, documentation.** The code accepts the placeholder prefixes `my_`, `your_`, `todo`, `tbd` and others without a word boundary, but the reference names only `my-` and `your-`. The false negative "an unquoted value shaped like a resource type with `_` and two or more segments" (a real credential that looks like a resource reference) is not in the list of known false negatives.
- **CI gap (task 8.2 of the previous change, still open).** The 194 engine tests of the skill and the contract test with `docs-generator` run in no CI job, on no OS. The contract test is skipped unless `npm ci` was run in the `docs-generator` folder. This repository has seen CRLF break tests on Windows three times, so the new job must also run on Windows.

## What Changes

- **Scanner hardening** (implementation phase, in `plugins/assessment-report/skills/assessment-report/`):
  - Remove the quadratic behavior: the secret-name prefix is made non-repeating or bounded, and the `url-credential` scheme part is bounded, with a differential test proving the matched set does not change on inputs that are not pathological.
  - Scan every character of every line, in bounded windows when a line is very long, with no truncation that would hide a secret.
  - Replace the whole-line tag and anchor exclusion with a narrower rule: a tag, anchor or alias is ignored only when it stands alone at the end of the value or is followed by a reference operand. A tag, anchor or alias followed by a literal is flagged.
  - Add the missing test cases (N-1), a light property test with pathological inputs and a scaling check (R-2, I-2), and a corpus test that makes the "scanner flags nothing in our own files" measurement reproducible.
  - Correct `references/read-only-and-untrusted-input.md`: the tag and anchor rule, the full list of placeholder prefixes, the missing false negative, and a clear line between what was measured and what is estimated.
- **A CI job** added to `.github/workflows/validate.yml` (the implementation edits only that file, only by adding a job; `publish.yml` is untouched) that runs the engine tests and the `docs-generator` contract test on Ubuntu and Windows, with `npm ci` for `docs-generator`, and fails if the contract tests were skipped.
- **Line-ending safety** for the tests that read versioned files.
- **Nothing in this proposal edits a workflow.** The edit is authorized by the specs and tasks of this change and happens after gate 1.

## Capabilities

### New Capabilities
- `assessment-secret-scan`: behavior, limits, test obligations and honest documentation of the heuristic secret scanner of the `assessment-report` skill.
- `assessment-report-ci`: the CI job that runs the skill's tests and the `docs-generator` contract test, and how it relates to the `main-protection` ruleset.

### Modified Capabilities
<!-- None. The requirement "Untrusted input and secrets" lives in the `assessment-report` spec of the change `add-assessment-report-skill`, which is merged but not archived, so it is not in openspec/specs/ yet. A MODIFIED delta cannot target a requirement that is absent from the base specs. See design.md, Decision 1. -->

## Non-goals

- Adding a runtime dependency to the skill or the engine (the engine stays dependency-free; `docs-generator` keeps its own dependencies, installed with `npm ci` in CI only).
- Replacing the heuristic scanner with an external secret-scanning service or tool, or claiming the scanner proves that a text holds no secret.
- Changing the trust rules, confidence levels, severity or demotion rules of the `assessment-report` spec, or the codes `secret-in-quote` and `secret-in-output`.
- Validating the skill with working consultants (task 9 of the previous change stays open there).
- Reviewing the `pt-BR` and `es` translations.
- Resolving the confidence ceiling for `output` and `url` evidence.
- Editing any workflow other than adding one job to `validate.yml`; touching `publish.yml`; bumping the version, tagging or publishing.
- Making the new job a required check. The maintainer decides that in the repository ruleset (Decision 7).
- Changing the SKILL.md prose or its context budget (the change should not need to).

## Impact

- **Files, implementation phase:** `plugins/assessment-report/skills/assessment-report/scripts/lib/secrets.mjs`, its tests under `test/`, `test/helpers.mjs` (a new runtime-assembled fake value), `references/read-only-and-untrusted-input.md`, `.gitattributes` (line endings, if chosen), `.github/workflows/validate.yml` (one added job), `docs/aep/repository-protection.md` (the new check names, as a maintainer decision).
- **Proposal phase (this pull request):** only `openspec/changes/harden-assessment-secret-scan/`.
- **Behavior:** `verify` and `render` may flag more lines (a literal after a tag or anchor) and must never flag fewer, except through references and placeholders already documented. A new false positive in legitimate Terraform or YAML is the main risk (design.md, Risks).
- **Context budget:** SKILL.md is not touched; the declared 3,000-token budget of `skill:assessment-report` is unaffected. It is checked with `node scripts/context-budget.mjs` (an estimate of bytes divided by 4, labeled as an approximation; no official count was run).
- **CI:** one new job, 4 matrix entries, about 1 to 3 minutes each (an estimate; the engine tests took 7.8 s on a developer machine, `npm ci` time was not measured here).
- **Effort:** about 3 working days (estimate, see `design.md`).
