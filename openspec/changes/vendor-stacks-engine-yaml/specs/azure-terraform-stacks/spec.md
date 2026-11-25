## ADDED Requirements

### Requirement: Vendored YAML parser
The engine of the `azure-terraform-stacks` skill SHALL run with no installation step: no `npm ci`, no `node_modules/` and no network access. Its one runtime dependency, the `yaml` package, SHALL be carried inside the skill folder as a byte-for-byte copy of the files that the npm registry publishes for one exact version, under `scripts/vendor/yaml/`, with that package's `LICENSE` and `package.json` next to its `dist/` files. Every engine module and test SHALL reach the parser through one facade module (`scripts/lib/yaml.mjs`); no file of the skill, tests included, SHALL import the bare specifier `yaml`. The skill's `package.json` SHALL declare no runtime `dependencies`; the same package and version MAY be a `devDependency`, used only as the oracle of the parity tests and as the manifest that dependency scanners read, and SHALL never be required to run the engine or the engine's tests other than the parity tests. The vendored files SHALL be marked `-text` in `.gitattributes`, so that no checkout rewrites their line endings. The folder SHALL NOT be named `node_modules`, because the CLI, the plugin packaging and `.gitignore` skip that name.

#### Scenario: Engine runs from a clean copy
- **WHEN** the skill folder is copied to an empty directory outside the repository (no `node_modules/` anywhere on the path) and `node scripts/stacks.mjs check-manifest` runs on a valid manifest
- **THEN** it exits 0 and prints the validation result, with no `Cannot find package` error

#### Scenario: Existing tests need no installation
- **WHEN** `node --test test/*.test.mjs` runs in a checkout where `npm ci` was never run
- **THEN** every test that passed before this change passes, and none is skipped for a missing package, except the parity tests, which say that the oracle is not installed

#### Scenario: No bare import of the package
- **WHEN** the tests scan every `.mjs` file of the skill, tests included, outside `scripts/vendor/`
- **THEN** they fail if one contains `from "yaml"`, `import("yaml")` or `require("yaml")`

#### Scenario: Installed by every channel
- **WHEN** the skill is installed through the Claude Code marketplace, through `npx @frcloudsolutions/agent-skills add azure-terraform-stacks` for each supported tool, or from `npm pack`
- **THEN** `scripts/vendor/yaml/` is present with the same bytes as in the repository, and the engine runs without a further step

### Requirement: Vendor provenance and integrity
The folder `scripts/vendor/yaml/` SHALL carry a provenance record, `PROVENANCE.json`, that states: the package name and exact version; the registry URL of the tarball; the SHA-256 of the tarball and its `sha512` integrity string (equal to the one in the skill's lockfile); the licence identifier and the path of the licence file; the selection rule (which files of the tarball were kept); and, for every vendored file, its path and SHA-256. A script, `scripts/vendor-yaml.mjs` (Node 20, no dependency), SHALL provide `verify` (offline: recompute the SHA-256 of every file under `scripts/vendor/yaml/` and compare the set and the hashes with the record, failing on any changed, missing or extra file, on a version that differs from the lockfile, and on a line-ending change), `verify --registry` (online: download the tarball of the recorded version into a new empty directory, compare its hashes with the record, and compare every kept file byte for byte with the vendored copy, without running any code from it) and `update <version>` (the only way the vendored copy is written: it downloads, verifies the registry's integrity string, applies the selection rule, writes the files and the record, and prints a diff summary). The check SHALL run in CI on every pull request as part of the engine's tests, on Linux and Windows, and a scheduled workflow SHALL run `verify --registry` and a lookup of known advisories for the vendored version. A pull request that changes any file under `scripts/vendor/yaml/` without a matching change of `PROVENANCE.json` SHALL fail the check.

#### Scenario: One changed byte
- **WHEN** one byte of any file under `scripts/vendor/yaml/dist/` is changed, a file is added, a file is removed, or a file is saved with CRLF line endings
- **THEN** `verify` exits 1 and names the file; the engine's tests fail with the same message

#### Scenario: Provenance record out of step
- **WHEN** the hash of a file in `PROVENANCE.json` is edited without changing the file, or the version in the record differs from the lockfile or from the vendored `package.json`
- **THEN** `verify` exits 1 and says which of the three disagree

#### Scenario: Copy equals the published package
- **WHEN** `verify --registry` runs in CI with network access
- **THEN** the tarball hash of the recorded version equals the record, every kept file equals the vendored copy byte for byte, and the command exits 0; if the registry's tarball differs, it exits 1

#### Scenario: Update is one command
- **WHEN** a maintainer runs `node scripts/vendor-yaml.mjs update <version>`
- **THEN** the vendored files, `PROVENANCE.json` and the lockfile change together, the parity and golden tests run against the new version, and any change of behavior appears as a diff of a committed golden file in the same pull request

### Requirement: Parser behavior parity
Replacing the installed package by the vendored copy SHALL NOT change what the engine does. A committed corpus of YAML inputs, including hostile ones, SHALL be parsed through the facade by `parse`, `parseDocument(...).toString()` and `parseAllDocuments(...).map(toJS)`, and the results, including each error's `name`, `code` and `linePos` and each warning's code, SHALL equal a committed golden file; where the oracle package is installed, they SHALL also equal what the package returns, compared as serialized values. The corpus SHALL include at least: an alias expansion bomb (the parser's own refusal, "Excessive alias count", is the expected result); an anchor and alias reused without growth; custom and unresolved tags; the YAML 1.1 merge key `<<` (kept as a plain key under the 1.2 core schema); duplicate keys; several documents passed to `parse`; documents separated by `---` and `...`; CRLF, lone CR and a byte-order mark; tabs as indentation; an unknown alias; a flow collection nested past the call stack; a 1 MiB scalar. Inputs that may exhaust memory SHALL run in a child process with a time limit and a heap limit, and the expectation is the child's exit status and the error name, not an in-process result.

#### Scenario: Golden corpus
- **WHEN** the corpus test runs without `node_modules/`
- **THEN** every result equals the committed golden file

#### Scenario: Differential against the package
- **WHEN** the parity job runs with the oracle installed from the lockfile
- **THEN** the vendored copy and the package return equal serialized results for every corpus input and for every YAML file under `test/fixtures/` and `test/golden/`, and the job fails if the oracle's version differs from the vendored version

#### Scenario: Engine outputs unchanged
- **WHEN** the existing golden tests for `scaffold`, `check` and `audit` run on the vendored copy
- **THEN** their committed golden files are byte-for-byte unchanged by this change

#### Scenario: Hostile repository
- **WHEN** `audit` runs on a repository that contains a YAML file of an alias bomb, of deep nesting, or with a byte-order mark and CRLF
- **THEN** it exits as it did before the change (the same code and the same findings), and no input makes it write a file
