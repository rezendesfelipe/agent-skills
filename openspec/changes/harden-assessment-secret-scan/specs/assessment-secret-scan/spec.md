## ADDED Requirements

### Requirement: Linear-time scanning of any line
The secret scanner of the `assessment-report` skill (`scanString`, `hasSecretKind` and `scanValue`) SHALL take time that grows linearly with the length of its input for every pattern, including `generic-credential` and `url-credential`. No pattern SHALL contain a repetition that makes the time quadratic on a line of repeated short tokens followed by a separator. A single line of 1 MiB (the file size cap) SHALL be scanned in at most `SCAN_TIME_BOUND_MS`, an initial value of 500 ms to be calibrated against the first CI runs, and doubling the length of a pathological line SHALL multiply the time by less than a ratio of 3 (also an initial value). The matched set on ordinary input SHALL NOT change: the secret-name pattern still matches a name with a prefix such as `db_` or `client.`, and still rejects a suffix such as `_name` or `_id`.

#### Scenario: Repeated short token and separator
- **WHEN** a single line is built from 20,000 repetitions of a short alphanumeric token followed by a separator (about 60 KB), and then from 40,000 repetitions
- **THEN** each scan finishes without a stall, and the second takes less than 3 times the first

#### Scenario: Repeated letter and dot
- **WHEN** a single line is built from 50,000 repetitions of a letter followed by a dot (100 KB)
- **THEN** the scan of every pattern, including the URL credential pattern, finishes in time that scales linearly with the length

#### Scenario: One line of the file size cap
- **WHEN** a single line of 1,048,576 characters made of repeated short tokens is scanned
- **THEN** the scan finishes within `SCAN_TIME_BOUND_MS` and no source file of the engine was changed to make the test pass

#### Scenario: Same matches on ordinary input
- **WHEN** the table of inputs recorded from the previous patterns (names with and without a prefix, with and without a suffix, quoted and unquoted values, each secret kind) is scanned
- **THEN** every input yields exactly the kinds recorded in the table

### Requirement: Every part of a long line is scanned
A line longer than `MAX_SCAN_LINE_CHARS` SHALL be scanned in overlapping windows and SHALL NOT be truncated or skipped. The initial values are a window of 8,192 characters and an overlap of 512, to be calibrated. A secret placed anywhere in a long line, including across a window boundary when its relevant span is not longer than the overlap, SHALL be found. The reference SHALL state the one remaining limit: a credential in a URL whose user and credential parts together are longer than the overlap can be missed at a window boundary.

#### Scenario: Secret at the end of a minified line
- **WHEN** a line of 1 MiB holds a synthetic secret-like assignment, assembled at run time, in the last 100 characters
- **THEN** the scan reports `generic-credential`

#### Scenario: Secret at the start and in the middle
- **WHEN** the same assignment is placed at the start and at the middle of the 1 MiB line
- **THEN** the scan reports `generic-credential` in both cases

#### Scenario: Secret across a window boundary
- **WHEN** the assignment is placed so that it straddles a window boundary and its length is less than the overlap
- **THEN** the scan reports `generic-credential`

#### Scenario: Short lines unchanged
- **WHEN** a text has no line longer than `MAX_SCAN_LINE_CHARS`
- **THEN** it is scanned as a whole, as before, so a pattern that spans a line break (a name, an operator and a value on separate lines) behaves as before

### Requirement: YAML tags, anchors and aliases do not hide a literal
For an unquoted value that follows a secret-like name, the scanner SHALL ignore a YAML tag, anchor or alias only when it is the whole value (followed by nothing but spaces or a comment), or when what follows is a reference operand. A reference operand is one identifier after `!Ref` or `!ImportValue`, a dotted identifier after `!GetAtt`, an operand with at least one interpolation after `!Sub`, an operand that is itself a Terraform reference or an interpolation after any tag, anchor or alias, or a flow sequence or mapping after another CloudFormation function tag. A core type tag (the double-bang forms), an anchor, an alias, a custom tag or a function tag followed by a literal on the same line SHALL be flagged as `generic-credential`. The scanner MUST NOT print or store the value.

#### Scenario: Type tag followed by a literal
- **WHEN** a secret-like name is given a value made of a double-bang type tag, a space and an eight-character literal assembled at run time
- **THEN** the scan reports `generic-credential`

#### Scenario: Anchor followed by a literal
- **WHEN** a secret-like name is given a value made of an anchor name, a space and a literal assembled at run time
- **THEN** the scan reports `generic-credential`

#### Scenario: Alias followed by a literal
- **WHEN** a secret-like name is given a value made of an alias name, a space and a literal assembled at run time
- **THEN** the scan reports `generic-credential`

#### Scenario: Custom tag followed by a literal
- **WHEN** a secret-like name is given a value made of a custom tag such as a vault or secret tag, a space and a literal assembled at run time, with and without digits in the tag
- **THEN** the scan reports `generic-credential`

#### Scenario: Function tag followed by a literal
- **WHEN** a secret-like name is given a value made of a CloudFormation substitution tag, a space and an operand with no interpolation
- **THEN** the scan reports `generic-credential`

#### Scenario: Reference operands stay ignored
- **WHEN** a secret-like name is given a reference tag with one identifier, an attribute tag with a dotted identifier, or a substitution tag whose operand has an interpolation
- **THEN** the scan reports nothing

#### Scenario: Tag, anchor or alias alone
- **WHEN** a secret-like name is given a value that is only a tag, an anchor or an alias, or a tag followed by a block indicator at the end of the line
- **THEN** the scan reports nothing

#### Scenario: Value never printed
- **WHEN** the scan flags a literal after a tag, an anchor or an alias and the evidence fails with `secret-in-quote`
- **THEN** the failure message and the verification log contain the kind and the location but not the literal

### Requirement: References and placeholders stay narrow
The scanner SHALL keep the narrow exclusions that fixed the earlier false positives and SHALL NOT widen them. A value that is only a reference prefix with no further segment (`var`, `local`, `data`, `module`, `each`, `count`, `path`, `terraform` or `self`) SHALL be flagged. A value that starts with an exclamation mark and is followed by text, and a custom tag containing digits followed by text, SHALL be flagged. A value shaped like a resource type that contains an underscore and has at least two further identifier segments SHALL be ignored, and with only one further segment SHALL be flagged.

#### Scenario: Reference prefix alone
- **WHEN** a secret-like name is given a value that is exactly one of the reference prefixes, one case per prefix including `path` and `self`
- **THEN** the scan reports `generic-credential` for each

#### Scenario: Reference prefix with a segment
- **WHEN** a secret-like name is given a reference prefix followed by a dot and one identifier segment, with and without an index
- **THEN** the scan reports nothing

#### Scenario: Exclamation mark followed by text
- **WHEN** a secret-like name is given a value that starts with an exclamation mark followed by letters and digits
- **THEN** the scan reports `generic-credential`

#### Scenario: Resource-type shape with two segments
- **WHEN** a secret-like name is given a value shaped like a resource type with an underscore followed by two identifier segments
- **THEN** the scan reports nothing, and the reference lists this form as a known false negative

#### Scenario: Resource-type shape with one segment
- **WHEN** the same shape has only one identifier segment after the type
- **THEN** the scan reports `generic-credential`

#### Scenario: Each exclusion has a test that fails without it
- **WHEN** a mutation removes the "at least one more segment" requirement after the reference prefixes, or allows digits in a custom tag
- **THEN** at least one test fails for each mutation

### Requirement: Property test of the scanner
The skill SHALL have a light property test of the scanner that uses a fixed seed. It SHALL feed generated pathological inputs (repeated tokens and separators, repeated dots, long runs of one character, deeply repeated reference prefixes, a scheme-like prefix repeated, mixed line endings) and assert that (1) no scan throws, (2) no scan takes longer than the bounds above, (3) the time scales linearly (the ratio check) and (4) the matched kinds equal those of the same input split into short lines, where the planted secret stays in one piece. The test SHALL run in the standard test command and take at most 5 seconds on a developer machine (an initial value). It MUST NOT add a dependency.

#### Scenario: Pathological inputs
- **WHEN** the property test runs with its fixed seed
- **THEN** every generated input is scanned within the bounds and without an exception

#### Scenario: Reproducible failure
- **WHEN** a generated input fails
- **THEN** the failure message names the seed and the case index, and not the input if it holds a planted value

### Requirement: Corpus regression without literals
A test SHALL scan the versioned text files of the skill folder (references, locales, golden files, fixtures after the marker is replaced, and the test sources) and the golden files of the other skills, and SHALL expect no flagged kind, apart from an explicit allowlist that names each file, kind and reason. Test sources and fixtures SHALL assemble every credential-shaped value at run time from parts that are not credential-shaped on their own, using the existing helpers (`fakeSecret` in `test/helpers.mjs` and the marker mechanism of `evals/fake-secret.mjs`). No file of this change or of its tests SHALL contain an assignment of a literal credential-shaped value, a credential in a URL, a bearer value or a signed-URL signature, whether as an example or as a test case.

#### Scenario: Scanner over the repository's own files
- **WHEN** the corpus test runs
- **THEN** it reports the number of files scanned and flags none outside the allowlist

#### Scenario: A literal is added to a test
- **WHEN** a test source contains an assignment of a credential-shaped literal to a secret-like name
- **THEN** the corpus test fails and names the file and the kind, not the value

### Requirement: Honest reference for the secret scan
`references/read-only-and-untrusted-input.md` SHALL describe the scanner as it behaves. It MUST state the tag, anchor and alias rule of this change (including what is ignored and what is flagged), list every placeholder prefix the code accepts, say which of them are accepted without a word boundary, list the false negative of an unquoted value shaped like a resource type with an underscore and two or more segments, and keep the lists of remaining false positives and false negatives. It SHALL separate what was measured (with the file count, the date and the method) from what is an estimate or an extrapolation, and SHALL say that a clean scan means "nothing obvious", never "no secrets". A test SHALL fail when the code accepts a placeholder prefix that the reference does not name.

#### Scenario: Placeholder prefixes are all listed
- **WHEN** the code accepts a placeholder prefix and the reference does not name it
- **THEN** the documentation test fails and names the prefix

#### Scenario: Measured versus estimated
- **WHEN** a reader looks for the timing of the scanner on a large line
- **THEN** the reference gives the measured sizes and times with their method, and labels any larger figure as an extrapolation

#### Scenario: Resource-shaped false negative documented
- **WHEN** a reader looks at the false negatives
- **THEN** the list includes the unquoted resource-type-shaped value with two or more segments

#### Scenario: Context budget unchanged
- **WHEN** `node scripts/context-budget.mjs` runs after the change
- **THEN** `skill:assessment-report` stays within its declared budget, and the output labels the figures as an approximation by bytes divided by 4
