## Purpose

Defines the deterministic collector of the `azure-waf-review` skill: a fixed catalog of read-only checks, how each is executed against Azure Resource Graph and read-only endpoints, limits, errors, redaction and sealing, so that a whole tenant can be read without free commands and without the data entering the model's context raw.

## ADDED Requirements

### Requirement: Collector engine
The engine SHALL be `scripts/waf.mjs` in the skill folder, Node.js 20 or later, with no runtime dependency and no `npm ci` step, with the subcommands `plan`, `collect`, `coverage`, `questionnaire`, `map`, `seal-check`, `topology`, `status`, `reverify` and `purge`, and `--help`. It SHALL exit 0 on success, 1 when a check or gate fails, and 2 on a usage error or a missing login. It SHALL write only inside the run folder `waf-review/<run-id>/` of the working directory, except `reverify` and `purge`, which act on an existing run folder.

#### Scenario: No dependency
- **WHEN** the skill is copied alone to a clean folder
- **THEN** `node scripts/waf.mjs --help` runs without installing anything

#### Scenario: Output confined
- **WHEN** any subcommand runs with a before and after snapshot of the working directory and the home folder
- **THEN** nothing outside `waf-review/<run-id>/` changed

### Requirement: Fixed catalog
The engine SHALL execute only checks of the shipped catalog (`catalog/*.json`), each validated by `catalog/check.schema.json`: stable `id`, `pillar`, `waf` mapping (IDs with doc dates, or `[]` with a reason), `chain`, per-source definitions, `proves`, `doesNotProve`, a closed `outputFields` list, `redact`, `limits` (`maxRows`, `maxPages`, `timeoutSec`) and `requires`. The engine SHALL reject a check whose `kind` is not `arg`, `rest-get` or `az-read`, record the catalog version and SHA-256 in `run.json`, and accept no query, URL or argument from the agent or the user.

#### Scenario: Unknown check
- **WHEN** `collect --check NOPE-001` runs
- **THEN** it exits 2 and lists the valid IDs

#### Scenario: Schema failure
- **WHEN** a catalog entry lacks `doesNotProve`
- **THEN** the catalog test fails and names the entry

### Requirement: Query allowlist
A Resource Graph query SHALL start with a documented table name and use only read operators (`where`, `project`, `extend`, `summarize`, `join`, `mv-expand`, `order by`, `take`, `count`); it SHALL NOT contain `externaldata`, `evaluate`, a batch separator, or a management command. A `rest-get` check SHALL be a fixed URL template on the host `management.azure.com` with an `api-version` and the method GET. An `az-read` check SHALL be a constant argument vector for a read verb. The engine SHALL start `az` with `execFile` and constant arguments, never through a shell with data from a check, except where the platform requires a shell to start the `az` launcher, and then with constant arguments only.

#### Scenario: Forbidden operator
- **WHEN** a catalog query contains `evaluate` or `externaldata`
- **THEN** the catalog test fails and `collect` refuses the check

#### Scenario: Host allowlist
- **WHEN** a `rest-get` template names a host other than `management.azure.com`
- **THEN** the catalog test fails

### Requirement: Tenant-scale paging and limits
For an `arg` check at tenant scope the engine SHALL query by management group or by the list of subscriptions chosen in `plan`, request pages of at most 1,000 records, follow `$skipToken` until the end or until `maxPages` or `maxRows`, enforce `timeoutSec`, and mark `truncated` when a limit stops it. On a timeout it SHALL retry once with the scope split by subscription. It SHALL honor throttling headers (`x-ms-user-quota-remaining`, `x-ms-user-quota-resets-after`) by waiting, with a total wait bound, and never fail open into `pass`.

#### Scenario: Paging
- **WHEN** a fixture response has three pages with `$skipToken`
- **THEN** all rows are written to the check's JSONL and the manifest records three pages

#### Scenario: Truncation
- **WHEN** `maxRows` is reached
- **THEN** the check state is `not-verified:truncated`, the offenders are a labeled sample, and the pillar coverage says so

#### Scenario: Timeout
- **WHEN** the first query times out and the split query succeeds
- **THEN** the check completes and the manifest records the retry

### Requirement: Scope visibility
Resource Graph returns no rows for subscriptions the identity cannot read. `plan` SHALL list the subscriptions visible to the identity, `collect` SHALL record the count in every manifest entry, and a count lower than the number the user confirmed SHALL end the affected checks as `not-verified:scope-incomplete`.

#### Scenario: Invisible subscription
- **WHEN** the fixture has three subscriptions and the identity can read two
- **THEN** `plan` shows two, the user's stated three triggers `scope-incomplete`, and no check is reported as `pass` for the missing one

### Requirement: Result states
Each check SHALL end in exactly one state: `fail`, `pass` (evaluated count above zero and no violation), `not-applicable` (evaluated count zero), `answered` (questionnaire), `needs-questionnaire`, or `not-verified` with one reason from `no-permission`, `scope-incomplete`, `no-api`, `timeout`, `truncated`, `error`, `unanswered`. An error SHALL be recorded as a class and a message with no response body.

#### Scenario: Error class only
- **WHEN** the API returns an error body that contains a resource name
- **THEN** the manifest stores the error class and the HTTP status, not the body

### Requirement: Redaction before write
Before any value is written the engine SHALL apply the check's `outputFields` projection, drop known secret-bearing properties, hash tag values outside an allowlist of keys, strip control characters, cap strings at 256 characters, and replace values that match the secret scanner with `[redacted:<kind>]`. The scan SHALL also run over the manifest, the summaries and `topology.json`. With `--redact strict` the engine SHALL replace names with stable aliases and write the alias map to a local `aliases.json` that no later step reads into the model.

#### Scenario: Secret in a property
- **WHEN** a fixture resource has a property shaped like a connection string
- **THEN** no file under the run folder contains the value

#### Scenario: Strict aliases
- **WHEN** `--redact strict` is used
- **THEN** the summaries and `topology.json` contain aliases such as `sub-01` and not the original names

### Requirement: Summaries for the model
`collect` SHALL write `collected/summary/<pillar>.md` with, per check, the state, the evaluated and failing counts, the top 10 offenders (ARM ID and one key attribute) with their JSONL line numbers, and the WAF IDs, each pillar summary at most 6,000 characters. The model reads summaries and drills down by line, not the raw files.

#### Scenario: Size bound
- **WHEN** a check has 5,000 violations
- **THEN** its summary lists 10 and the count, and the pillar summary stays under the limit

### Requirement: Sealing and resume
The engine SHALL write `collected/manifest.json` per the evidence requirement of `azure-waf-review`, SHALL support `collect --resume` that skips checks whose manifest entry and file hash are valid, and `seal-check` SHALL fail when a file hash, the catalog hash or a query hash differs from the manifest.

#### Scenario: Resume
- **WHEN** a run is interrupted after 30 of 120 checks and `collect --resume` runs
- **THEN** the 30 finished checks are not queried again

### Requirement: Guarded commands
`reverify` and `purge` SHALL run only for a user, never for the agent; `purge` SHALL require typing the run ID. The engine SHALL create `waf-review/.gitignore` with the single line `*` when it creates the folder.

#### Scenario: Self-ignoring folder
- **WHEN** `plan` creates `waf-review/` inside a git repository
- **THEN** `git status` shows no untracked file under it

### Requirement: Fixtures mode
The engine SHALL accept `--fixtures <dir>` to read check results from files instead of calling Azure, used by tests and documentation examples only. The agent file and the guard SHALL NOT allow the flag.

#### Scenario: Fixture run
- **WHEN** `collect --fixtures test/fixtures/contoso-exemplo/arg` runs with the network disabled
- **THEN** it produces the same manifest content on every run, apart from timestamps

### Requirement: Platforms
The engine SHALL be developed and tested first on Ubuntu running under WSL, where `az` is a Linux binary started with `execFile` and constant arguments, and SHALL also run on native Windows (secondary), where the launcher may need a shell and then only with constant arguments. Inside WSL `plan` SHALL print the resolved `az` path and refuse a Windows executable (a path under `/mnt/` or ending in `.exe` or `.cmd`) unless the user types an acknowledgment. The skill's documentation SHALL describe an audit distro with `[interop] enabled=false`, `appendWindowsPath=false` and `[automount] enabled=false`, the Azure CLI installed inside the distro and, preferably, a separate distro, and SHALL mark the commands to create it as "check the documentation".

#### Scenario: Windows az inside WSL
- **WHEN** a test supplies a resolved path `/mnt/c/Program Files/Microsoft SDKs/Azure/CLI2/wbin/az.cmd` with the WSL flag on
- **THEN** `plan` refuses it

#### Scenario: Linux az
- **WHEN** the resolved path is `/usr/bin/az`
- **THEN** `plan` accepts it and prints it in the consent text
