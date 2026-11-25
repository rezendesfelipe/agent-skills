## Purpose

Defines the deterministic collector of the `azure-waf-review` skill: a fixed catalog of read-only checks, how each is executed against Azure Resource Graph and read-only endpoints, limits, errors, redaction and sealing, so that a whole tenant can be read without free commands and without the data entering the model's context raw.

## ADDED Requirements

### Requirement: Collector engine
The engine SHALL be `scripts/waf.mjs` in the skill folder, Node.js 20 or later, with no runtime dependency and no `npm ci` step, with the subcommands `consent`, `plan`, `collect`, `coverage`, `questionnaire`, `map`, `seal-check`, `cap-check`, `render`, `topology`, `status`, `reverify` and `purge`, and `--help`. It SHALL exit 0 on success, 1 when a check or gate fails, and 2 on a usage error or a missing login. It SHALL write only inside the run folder `waf-review/<run-id>/` of the working directory, except `reverify` and `purge`, which act on an existing run folder.

#### Scenario: No dependency
- **WHEN** the skill is copied alone to a clean folder
- **THEN** `node scripts/waf.mjs --help` runs without installing anything

#### Scenario: Output confined
- **WHEN** any subcommand runs with a before and after snapshot of the working directory and the home folder
- **THEN** nothing outside `waf-review/<run-id>/` changed

### Requirement: Plan flags
`plan` SHALL take its scope, stage, redaction level and query budget from `consent.json` and SHALL accept from the agent only `--pillars <list>` (a comma-separated subset of `security`, `reliability`, `cost`, `operations`, `performance`; default all), `--run` for the current run and `--json`.

#### Scenario: Pillars
- **WHEN** `plan --pillars security,reliability` runs
- **THEN** `run.json` lists those two pillars and `collect` runs only their checks

#### Scenario: Unknown pillar
- **WHEN** `plan --pillars bogus` runs
- **THEN** it exits 2 and lists the valid names

### Requirement: Fixed catalog
The engine SHALL execute only checks of the shipped catalog (`catalog/*.json`), each validated by `catalog/check.schema.json`: stable `id`, `pillar`, `waf` mapping (IDs with doc dates, or `[]` with a reason), `chain`, per-source definitions, `proves`, `doesNotProve`, a closed `outputFields` list, `redact`, `limits` (`maxRows`, `maxPages`, `timeoutSec`) and `requires`. The engine SHALL reject a check whose `kind` is not `arg`, `rest-get` or `az-read`, record the catalog version and SHA-256 in `run.json`, and accept no query, URL or argument from the agent or the user.

#### Scenario: Unknown check
- **WHEN** `collect --check NOPE-001` runs
- **THEN** it exits 2 and lists the valid IDs

#### Scenario: Schema failure
- **WHEN** a catalog entry lacks `doesNotProve`
- **THEN** the catalog test fails and names the entry

### Requirement: Query allowlist
A Resource Graph query SHALL start with a documented table name and use only read operators (`where`, `project`, `extend`, `summarize`, `join`, `mv-expand`, `order by`, `count`); it SHALL NOT contain `take`, `limit`, `sample`, `externaldata`, `evaluate`, a batch separator, or a management command. A `rest-get` check SHALL be a fixed URL template on the host `management.azure.com` with an `api-version` and the method GET. An `az-read` check SHALL be an **exact argument vector from a closed list** shipped with the catalog (initially `az --version`, `az account show` and `az account list --all`), never a rule such as "a read verb": a vector with `get-access-token`, `keyvault secret show`, `config appsettings list`, `storage account keys list` or `acr credential show` is forbidden. The engine SHALL start `az` with `execFile` and constant arguments, add `--only-show-errors`, never pass `--debug` or `--verbose`, set `AZURE_CORE_COLLECT_TELEMETRY=false`, and start the process with an environment allowlist (`PATH`, `HOME`, `AZURE_CONFIG_DIR`, `LANG`, `LC_ALL`, `TERM`, `TMPDIR` and, only if already set, the proxy and certificate variables), never inheriting other variables. Where the platform requires a shell to start the `az` launcher, constant arguments only.

#### Scenario: Forbidden operator
- **WHEN** a catalog query contains `take`, `evaluate` or `externaldata`
- **THEN** the catalog test fails and `collect` refuses the check

#### Scenario: Closed argument list
- **WHEN** a test supplies the vector `az account get-access-token` or any vector outside the list
- **THEN** the engine refuses it and the test fails if it is accepted

#### Scenario: Environment allowlist
- **WHEN** the parent environment holds a provider API key variable
- **THEN** the child process environment does not contain it

#### Scenario: Host allowlist
- **WHEN** a `rest-get` template names a host other than `management.azure.com`
- **THEN** the catalog test fails

### Requirement: Tenant-scale paging and limits
For an `arg` check at tenant scope the engine SHALL query by management group or by the list of subscriptions chosen at consent, request pages of at most 1,000 records, follow `$skipToken` until the end or until `maxPages`, `maxRows` or `maxParts`, and enforce `timeoutSec`. A response with `resultTruncated` true and no `$skipToken` SHALL end the check as `not-verified:truncated`. On a timeout it SHALL retry once with the scope split by subscription. It SHALL back off with bounded retries and a total wait cap on HTTP 429 or a transient error; it SHALL NOT depend on throttling headers, because whether `az rest` prints them is not verified.

#### Scenario: Paging
- **WHEN** a fixture response has three pages with `$skipToken`
- **THEN** all rows are written to the check's parts and the manifest records three pages

#### Scenario: Truncation
- **WHEN** a response has `resultTruncated` true and no `$skipToken`
- **THEN** the check state is `not-verified:truncated` and the pillar coverage says so

#### Scenario: Timeout
- **WHEN** the first query times out and the split query succeeds
- **THEN** the check completes and the manifest records the retry

#### Scenario: Throttled
- **WHEN** a fixture returns 429 twice and then succeeds
- **THEN** the engine waits with backoff and completes without reading a header

### Requirement: Scope visibility
Resource Graph returns no rows for subscriptions the identity cannot read. `consent` SHALL list the subscriptions visible to the identity, and SHALL compare them independently with the subscriptions found in `resourcecontainers` under the chosen management group and with the states of `az account list --all`, reporting Disabled, Warned and PastDue subscriptions and any subscription present in one list and absent from the other; the typed expected count SHALL NOT be the only protection. `collect` SHALL record the visible count in every manifest entry, and a mismatch SHALL end the affected checks as `not-verified:scope-incomplete`.

#### Scenario: Invisible subscription
- **WHEN** the fixture has three subscriptions and the identity can read two
- **THEN** the check reports `scope-incomplete` and no check is reported as `pass` for the missing one, even when the user typed the number read

#### Scenario: Disabled subscription
- **WHEN** `az account list --all` shows a subscription in state Disabled
- **THEN** `consent` names it and the run does not count it as covered

### Requirement: All-or-nothing check and query budget
A check SHALL run its `evaluated` and `violations` queries on the same scope, and a failure at any page of either (429, timeout or error, for example at page 3) SHALL end the check as `not-verified:error` or `not-verified:timeout` with no partial `pass` or `fail`, deleting its partial parts. The engine SHALL cap the number of queries of a run (initial value 6,000, a premise to be measured) and stop with a partial result and the list of checks not done when the cap is reached.

#### Scenario: Failure at page 3
- **WHEN** a fixture fails at the third page of `violations`
- **THEN** the check is `not-verified:error`, no part of it remains and the manifest has no `pass` or `fail` for it

#### Scenario: Budget reached
- **WHEN** the query cap is reached in a fixture run
- **THEN** the run stops and lists the checks not done

### Requirement: Result states
Each check SHALL end in exactly one state: `fail`, `pass` (evaluated count above zero and no violation), `not-applicable` (evaluated count zero), `answered` (questionnaire), `needs-questionnaire`, or `not-verified` with one reason from `no-permission`, `scope-incomplete`, `no-api`, `timeout`, `truncated`, `error`, `unanswered`. An error SHALL be recorded as a class and a message with no response body.

#### Scenario: Error class only
- **WHEN** the API returns an error body that contains a resource name
- **THEN** the manifest stores the error class and the HTTP status, not the body

### Requirement: Redaction before write
Before any value is written the engine SHALL apply the check's `outputFields` projection, in which every field is a typed scalar (`string`, `bool`, `number` or `enum`); a projection that yields an object, an array, `properties`, `tags` or a whole resource, or uses `tostring(properties.<object>)`, SHALL be rejected by the catalog test, and the catalog SHALL list resource types that are never projected (Container Instances and Container Apps `env[].value`, Logic Apps definitions, VM extension settings, deployment parameters and outputs, app and function settings, connection strings, API Management named values, Key Vault and App Configuration values). The engine SHALL drop known secret-bearing properties, hash tag values outside an allowlist of keys, strip control characters, cap strings at 256 characters, and replace values that match the secret scanner with `[redacted:<kind>]`; the scanner SHALL run on values and not on field names. The scan SHALL also run over the manifest, the summaries and `topology.json`. With `--redact strict` the engine SHALL replace names with stable aliases and write the alias map to the user's state directory, outside the run folder (requirement "Alias file outside the run folder").

#### Scenario: Secret in a property
- **WHEN** a fixture resource has a property shaped like a connection string
- **THEN** no file under the run folder contains the value

#### Scenario: Object projection
- **WHEN** a catalog query projects `properties`
- **THEN** the catalog test fails

#### Scenario: Field names
- **WHEN** a fixture has fields named `keyName`, `secretsEnabled` and `publicKeyAccess` with innocent values
- **THEN** the values are not redacted, and a secret-shaped value in a field with an innocent name is

#### Scenario: Strict aliases
- **WHEN** `--redact strict` is used
- **THEN** the summaries and `topology.json` contain aliases such as `sub-01` and not the original names, and `aliases.json` is in the state directory and not under the run folder

### Requirement: Summaries for the model
`collect` SHALL write `collected/summary/<pillar>.md` with, per check, the state, the evaluated and failing counts, the top 10 offenders (ARM ID and one key attribute) with their JSONL line numbers, and the WAF IDs, each pillar summary at most 6,000 characters. The model reads summaries and drills down by line, not the raw files.

#### Scenario: Size bound
- **WHEN** a check has 5,000 violations
- **THEN** its summary lists 10 and the count, and the pillar summary stays under the limit

### Requirement: Sealing, parts and resume
The engine SHALL split each check into parts `collected/<check-id>.NNN.jsonl` of at most 1 MiB (writing at least an empty `.001.jsonl`), seal each part in `collected/manifest.json` (name, line count, SHA-256) with the catalog and query hashes and the other fields of the evidence requirement, support `collect --resume` that skips checks whose manifest entry and part hashes are valid, and `seal-check` SHALL fail when a part hash, the catalog hash or a query hash differs, or when the real path of `scope.root` in `assessment.json` is not `<run>/collected`.

#### Scenario: Resume
- **WHEN** a run is interrupted after 30 of 120 checks and `collect --resume` runs
- **THEN** the 30 finished checks are not queried again

#### Scenario: Root seal
- **WHEN** `scope.root` resolves to another folder
- **THEN** `seal-check` exits 1 and names the path

### Requirement: Cap gate and render wrapper
`cap-check` SHALL read `assessment.json` after `assess.mjs classify`, the manifest and `map.json` (written by the engine, never by the model) and SHALL, for every finding whose computed severity is Critical, derive the set of sealed checks from the **path of each `file` evidence** (`<check>.NNN.jsonl`) united with the checks recorded for the finding in `map.json`. It SHALL exit 1 and list the finding when: the derived set is empty (a Critical with no evidence mapped to a sealed check is refused); or any derived check lacks `reverify/<check>.json` with `state: match`; or the part hash recorded in that `reverify` file differs from the SHA-256 of the part cited by the evidence or from the manifest hash of that part. A `reverify` run **without `--resource`** SHALL be `match` only when every offender of the sealed check is still returned with equal projected fields; a run **with `--resource`** SHALL record the ARM IDs it covered and SHALL release a Critical only when those include every ARM ID cited by the finding's evidence lines, and is otherwise `partial`. When it passes, `cap-check` SHALL write `severity-summary.json` (counts by severity derived from `assessment.json`, with the hash of `assessment.json`). `render` SHALL run `seal-check`, then `cap-check`, then call `assess.mjs render --unreviewed` with constant arguments from a trusted engine location, and SHALL refuse when either gate fails. The pt-BR report is therefore produced by the existing renderer.

#### Scenario: Gate order
- **WHEN** `waf.mjs render` runs on a run with a forged root and a Critical without reverify
- **THEN** it exits 1 at `seal-check` and `assess.mjs render` is not called

#### Scenario: Critical with evidence but no map entry
- **WHEN** the model writes a Critical finding with `file` evidence citing `SE-001.001.jsonl` and no `map.json` entry exists for the finding
- **THEN** `cap-check` derives the check `SE-001` from the evidence path, finds no `reverify/SE-001.json` with `match`, and refuses; an empty derived set is also refused

#### Scenario: Critical with no sealed evidence
- **WHEN** a Critical finding rests only on `statement` evidence or on a part that is not in the manifest
- **THEN** `cap-check` refuses it because the set of sealed checks is empty

#### Scenario: Reverify of another version
- **WHEN** `reverify/SE-001.json` records a part hash different from the part hash cited by the evidence
- **THEN** `cap-check` refuses the finding

#### Scenario: Partial reverify
- **WHEN** a finding cites 5 offender ARM IDs of check `SE-001` and `reverify --resource` covered one of them
- **THEN** the state is `partial` and the Critical is refused until all 5 are covered or a `reverify` without `--resource` returns `match`

#### Scenario: Full reverify
- **WHEN** `reverify` without `--resource` returns `match` for `SE-001` and the recorded part hash equals the cited part
- **THEN** `cap-check` passes and writes `severity-summary.json`

### Requirement: Consent argument vectors and screen
`consent` SHALL use only the closed lists of the catalog: the `az-read` vectors `az --version`, `az account show --output json`, `az account list --all --output json`, `az ad signed-in-user show --query id --output tsv` and `az ad sp show --id {guid} --query id --output tsv` (the placeholder validated as a GUID), and the catalog `arg` checks `CONSENT-SUBS` and `CONSENT-ROLES` through the fixed Resource Graph template with the principal ID in the request body. A test SHALL fail for any vector outside the list. `consent` SHALL strip or escape control characters, ESC, ANSI CSI and OSC sequences and bidirectional controls in every string it displays (subscription names, display names). `consent.json` SHALL be described in the documentation as tamper-evident only (a hash of the shown text), and, like the alias file, as a residual risk when the guard is inactive. The query budget (initial 6,000, a premise to be measured) SHALL be set by the user at `consent` and denied to the agent.

#### Scenario: Vector outside the list
- **WHEN** a test makes `consent` call `az account get-access-token`
- **THEN** the test fails

#### Scenario: ESC in a subscription name
- **WHEN** a fixture subscription is named with an ESC sequence that clears the screen
- **THEN** the screen shows the escaped text and no control sequence reaches the terminal

#### Scenario: Identity cannot be verified
- **WHEN** the Graph read of the principal's object ID fails
- **THEN** `consent` refuses unless the user types an acknowledgment, which is recorded

### Requirement: Alias file outside the run folder
With `--redact strict` the engine SHALL write the alias map to `${XDG_STATE_HOME:-~/.local/state}/waf-review/<run-id>/aliases.json` (`%LOCALAPPDATA%` on Windows) with directory mode 0700 and file mode 0600, never inside `waf-review/<run-id>/`, and no later step SHALL read it into the model.

#### Scenario: Not under the run folder
- **WHEN** a run with `--redact strict` finishes and a recursive search runs over `waf-review/<run-id>/`
- **THEN** no alias file is found there

### Requirement: User-only commands
`consent`, `reverify` and `purge` SHALL run only for a user, never for the agent; `purge` SHALL require typing the run ID. The engine SHALL create `waf-review/.gitignore` with the single line `*` when it creates the folder, and SHALL refuse a `waf-review/` folder that resolves under `/mnt/` or into a known synced folder (OneDrive) unless the user types an acknowledgment.

#### Scenario: Self-ignoring folder
- **WHEN** `plan` creates `waf-review/` inside a git repository
- **THEN** `git status` shows no untracked file under it

#### Scenario: Synced folder
- **WHEN** the run folder resolves under `/mnt/c`
- **THEN** the engine refuses it without the typed acknowledgment

### Requirement: Fixtures mode
The engine SHALL accept `--fixtures <dir>` to read check results from files instead of calling Azure, used by tests and documentation examples only. The agent file and the guard SHALL NOT allow the flag.

#### Scenario: Fixture run
- **WHEN** `collect --fixtures test/fixtures/contoso-exemplo/arg` runs with the network disabled
- **THEN** it produces the same manifest content on every run, apart from timestamps

### Requirement: Platforms
The engine SHALL be developed and tested first on Ubuntu running under WSL, where `az` is a Linux binary started with `execFile` and constant arguments, and SHALL also run on native Windows (secondary), where the launcher may need a shell and then only with constant arguments. Inside WSL `consent` SHALL print the resolved `az` path and refuse a Windows executable (a path under `/mnt/` or ending in `.exe` or `.cmd`) unless the user types an acknowledgment. The skill's documentation SHALL describe an audit distro with `[interop] enabled=false`, `appendWindowsPath=false` and `[automount] enabled=false`, the Azure CLI installed inside the distro and, preferably, a separate distro, and SHALL mark the commands to create it as "check the documentation".

#### Scenario: Windows az inside WSL
- **WHEN** a test supplies a resolved path `/mnt/c/Program Files/Microsoft SDKs/Azure/CLI2/wbin/az.cmd` with the WSL flag on
- **THEN** `consent` refuses it

#### Scenario: Linux az
- **WHEN** the resolved path is `/usr/bin/az`
- **THEN** `consent` accepts it and prints it in the consent text
