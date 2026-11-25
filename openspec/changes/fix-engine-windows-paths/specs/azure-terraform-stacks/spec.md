## ADDED Requirements

### Requirement: Cross-platform file generation
The engine's commands that generate files (`scaffold`, `add-stack`, `plan`, `diagram`, `bridge`) SHALL locate the skill's own files (the Terraform module templates, the schemas and the icon set) through paths derived from the module's URL with `fileURLToPath` (or a `URL` object handed to `fs`), never from the `pathname` of a `file:` URL, so that they work on Windows as on POSIX. The generated files, their relative paths (always written with `/`) and their content SHALL be the same on every platform.

#### Scenario: Templates folder of a Windows install
- **WHEN** the templates folder is resolved for a module at `file:///D:/a/repo/plugins/azure-terraform-stacks/skills/azure-terraform-stacks/scripts/lib/gen-terraform.mjs` with Windows path semantics
- **THEN** the result is `D:\a\repo\plugins\azure-terraform-stacks\skills\azure-terraform-stacks\templates\`, with no leading slash and no doubled drive letter

#### Scenario: A path with a space
- **WHEN** the module lives under a folder whose name contains a space (`file:///C:/Users/Ana%20Silva/...`)
- **THEN** the resolved folder contains the space, not `%20`

#### Scenario: Scaffold on Windows
- **WHEN** `node scripts/stacks.mjs scaffold --root <repo>` runs on Windows with Node 20 or later
- **THEN** it exits 0 and writes the same files, byte for byte, as on Linux (the golden trees)

### Requirement: Engine suite runs on Windows
The continuous integration SHALL run the engine's full test suite on Windows (Node 24) in a job that is not a required check of `main`, and any test that cannot run there SHALL be skipped with a message that names the reason; no test is skipped only to make the job pass.

#### Scenario: A test that needs a bash executable
- **WHEN** a test needs a bash script to stand in for a command-line program, or the real bash, on Windows
- **THEN** it is skipped on `win32` with a message that says so, and it still runs on Linux and macOS
