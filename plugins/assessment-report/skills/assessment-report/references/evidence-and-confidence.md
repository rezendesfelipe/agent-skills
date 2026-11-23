# Evidence, verification and confidence

Read this at the investigate, verify and repair nodes.

## The rule

Every finding lists at least one evidence ID. A finding with none is rejected by `verify` and, after demotion, appears only under Not verified. IDs are `E-001` (evidence), `F-001` (findings) and `A-001` (actions), unique within the assessment.

## Evidence kinds

| Kind | Required fields | What `verify` checks (offline) |
|------|-----------------|--------------------------------|
| `file` | `path`, `startLine`, `endLine`, `quote` | The path is relative and, after symlinks, inside the assessed root and outside `.git`; the file is text and under 1 MiB; the lines exist; the quote equals the cited lines (line endings, trailing spaces and Unicode form are normalized); at most 20 lines; the file has not changed since `inventory` |
| `file` with `redacted: true` | `path`, `startLine`, `endLine`, `secretKind` (no quote) | The lines exist and a secret of that kind matches there |
| `absence` | `scope` (globs: `*`, `**`, `?`), `pattern` (regex), optional `flags` (`i`) | The scope matches at least one file and the pattern has zero matches in it. Worded in the report as "not found in <scope>", never "does not exist" |
| `output` | `path` (under `evidence/`), `command`, `capturedAt`, `quote` | Run `capture --file evidence/<name> --command "<cmd>"` first; the file's SHA-256 must still match the capture and contain the quote. The command is never re-run |
| `document` | `path`, `startLine`, `endLine`, `quote`, `source` | As `file`. PDF, DOCX and images are not read: ask the user for a text extraction |
| `url` | `url`, `accessed`, `quote`, optional `snapshot` (+ `startLine`, `endLine`) | Only with a snapshot saved under `evidence/`, then as a file. The URL is never fetched |
| `statement` | `source` (a role or name), `date`, `text` | Nothing; recorded with who said it and when. Interviews, tickets, chat |

Two items with different `source` values are independent; two with the same `source` count once. An evidence item no finding cites is a warning.

## Failure codes

`path-escape`, `not-found`, `not-text`, `too-large`, `range-invalid`, `quote-mismatch`, `drift`, `scope-empty`, `absence-violated`, `pattern-too-costly`, `secret-in-quote`. Each failure shows the location and, for `quote-mismatch`, what the cited lines say and where the quote really is, so line-number drift is quick to fix. `absence-violated` shows the first matches. An invalid regular expression is reported as `pattern-too-costly`.

## Repair

At most two attempts. For each failure: fix the line range, re-copy the quote from the file, narrow or correct the scope or pattern, or cite a different excerpt. If the fix needs a file you were not given, stop and ask the user for it, then verify again. Do not edit a quote to match a wrong claim, and do not delete the failing evidence to get a clean run: failures stay in the verification log. After the second repair, `verify` demotes by code.

## What the verifier proves, and what it does not

It proves provenance: the excerpt exists where the report says, at the inventoried revision. It does not prove that the excerpt supports your claim, that an absence search covers every place a control could be, or that a statement or document is true. So write a one-sentence `rationale` that says why the excerpt implies the statement, and expect the reader to judge from the quote.

## Confidence (computed, never set by you)

| Level | Rule | Severity allowed |
|-------|------|------------------|
| `verified` | At least one machine-checked item passes | Any |
| `corroborated` | None passes; at least two independent non-machine sources | Up to Medium |
| `reported` | None passes; exactly one non-machine source | Up to Medium |
| `unverified` | No evidence, or every cited item failed | `n/a`; shown only under Not verified |

A failed item never counts as a source. These thresholds are this skill's conventions.

## Potential severity

If an unverified, reported or corroborated finding would be Critical or High if true, set `potentialSeverity` to `High` or `Critical`. The report lists it under Verify first. Do not use it to inflate a finding.

## Secrets

Never copy a secret value. For a committed secret use `redacted: true`, the file and lines, and a `secretKind` (`private-key`, `aws-access-key`, `github-token`, `slack-token`, `google-api-key`, `stripe-key`, `jwt`, `generic-credential`). `verify` and `render` scan every string for secret patterns. The scan is heuristic: a person must still look before the report leaves the team.
