## Status

Proposal only, written on 2026-11-25 from `main` at 4a72778 (plugin `azure-terraform-stacks` 0.3.0, npm package 0.6.0, both published). Nothing is implemented, nothing is vendored in this pull request, and no version is chosen. It waits for gate 1 (the maintainer's answers to Q1 to Q8 in `design.md`). The maintainer approved the idea on 2026-11-23 as the follow-up named in Decision 6 of `fix-stacks-auditor-agent`; this document is the proposal that decision asked for.

## Why

The engine of the `azure-terraform-stacks` skill (`scripts/stacks.mjs` and `scripts/lib/*`) imports one third-party package, `yaml` 2.9.1 (ISC, no dependencies; measurements in `design.md`, "Survey"). Because `node_modules/` is not shipped (not by the plugin, not by the CLI), the engine runs only after `npm ci --omit=dev`. That has four costs, all measured in the repository:

1. **A package-manager run in the user's environment.** `SKILL.md` step 1 tells the agent to run `npm ci --omit=dev` in the skill folder. That is a network fetch and, without `--ignore-scripts`, a script run, outside the audited repository but inside the user's machine.
2. **The one write of the read-only auditor.** `agents/stacks-auditor.md` step 3 and the guard (`hooks/stacks-auditor-guard.mjs`, case `npm`) allow `npm ci --prefix <skill folder> --omit=dev --ignore-scripts`. It is the only shape of the allowlist that writes, needs the network and reads the user's npm configuration; it needs the guard's `isEngineDir` and the "not inside `cwd`" machinery, and the `npm` tests of `test/guard.test.mjs` (29 lines mention it) and one assertion of `test/agent.test.mjs` pin it.
3. **A failure mode.** On a first run without the install, the engine stops with `Cannot find package 'yaml'` (reproduced by the tests of a checkout without `node_modules/`), and a sandbox without network cannot recover.
4. **CI that must install before it can test.** Jobs `azure-terraform-stacks` (Node 20 and 24) and `azure-terraform-stacks-deep` run `npm ci` first.

The goal is to remove the need for `npm ci` (and so for network and for npm in the user's environment) without losing traceability: anyone must be able to prove which bytes of `yaml` the skill runs, that they are the bytes the registry publishes for that version, and when a newer or vulnerable version exists.

## What Changes

- **Vendor `yaml` 2.9.1 as a byte-for-byte copy of its published `dist/**/*.js`** (74 files, 293,089 bytes), with the package's `package.json` and `LICENSE`, under `plugins/azure-terraform-stacks/skills/azure-terraform-stacks/scripts/vendor/yaml/` (recommended alternative A; the others and the reasons are in `design.md`, "Alternatives"). The engine reaches it through one facade, `scripts/lib/yaml.mjs`; the five engine files and the two test files that `import YAML from "yaml"` use it instead.
- **Provenance and integrity.** `scripts/vendor/yaml/PROVENANCE.json` records version, tarball URL, tarball SHA-256, `sha512` integrity (equal to the one already in the lockfile), licence, selection rule and the SHA-256 of every vendored file. `scripts/vendor-yaml.mjs` has `verify` (offline), `verify --registry` (compares with a fresh download, without running it) and `update <version>` (the only writer). `.gitattributes` marks the folder `-text`.
- **Compensation for leaving `npm audit` and Dependabot's sight.** `yaml` stays as a `devDependency` with its lockfile entry (the oracle of the parity tests), so Dependabot, GitHub's dependency graph and `npm audit` still see the version; a parity test fails when the oracle and the vendored copy differ in version, so a Dependabot pull request cannot merge without a vendor update. A scheduled workflow runs `verify --registry` and an advisory lookup for the vendored version.
- **Behavior proof.** The existing 164 engine tests pass with no `npm ci`; a committed golden corpus (alias bomb, tags, merge key, duplicate keys, several documents, CRLF, BOM, tabs, deep nesting, large scalar) runs without `node_modules/`; a differential test compares the vendored copy with the package where the oracle is installed; a mutation test flips one byte of a copy of the vendor and expects the check to fail.
- **Remove the install step and its exceptions**: `SKILL.md` step 1 (without growing the file), `agents/stacks-auditor.md` step 3 and the `npm ci` line of its command list, the guard's `npm` case, `isEngineDir`, the `--prefix` branch of `pathsOf`, their tests, the `npm ci` steps of the two CI jobs. `references/traps.md` gains a short note for copies of the skill that predate the change.
- **CI.** The engine job no longer installs; a Windows run covers the vendor check and the golden corpus (CRLF checkout is the risk); the scheduled workflow is new.
- **Specs.** `azure-terraform-stacks`: ADDED "Vendored YAML parser", "Vendor provenance and integrity", "Parser behavior parity". `stacks-auditor`: MODIFIED "Auditor subagent" and "Command guard" (the `npm ci` exception removed). The two MODIFIED requirements live only in the not yet archived change `fix-stacks-auditor-agent` (its code is in `main`, its spec is not in `openspec/specs/`); they are written against that text, so this change SHALL be archived after it (`design.md`, "Spec deltas and archive order").
- CHANGELOG `[Unreleased]`.

## Capabilities

### New Capabilities
None.

### Modified Capabilities
- `azure-terraform-stacks`: the engine has no installation step; the parser is vendored with provenance, an integrity check and a parity proof.
- `stacks-auditor`: the auditor no longer writes anything (not even the dependency install); the guard's allowlist shrinks by one shape.

## Non-goals

- Implementing anything in this pull request, or vendoring any file: it only proposes.
- A version bump, a tag or a publish. Plugin version and npm package version are listed as options in `design.md` ("Release") for the maintainer to choose.
- Changing what the engine does, its findings, its output or its golden files. A parser upgrade is a separate, later `update` run.
- Upgrading `yaml` while vendoring it: the copy is of 2.9.1, the version the lockfile and the tests already pin.
- Writing a YAML parser (alternative C), publishing a separate package (E), or changing how `docs-generator` gets `yaml` (it has seven other runtime dependencies and keeps `npm ci`).
- Changing the guard's other rules, or `docs/aep/context-budgets.json`.
- A guarantee that the vendored bytes are free of defects: the copy proves identity with the published package, not absence of vulnerabilities in it.

## Impact

- New: `scripts/vendor/yaml/**` (76 files plus the record, about 300 KB), `scripts/lib/yaml.mjs`, `scripts/vendor-yaml.mjs`, tests (`test/vendor.test.mjs`, `test/yaml-parity.test.mjs`, corpus and golden), `.github/workflows/vendor-watch.yml`, possibly `.github/dependabot.yml` (Q4).
- Changed: five engine and two test imports, `package.json` and `package-lock.json` of the skill (`dependencies` becomes `devDependencies`), `.gitattributes`, `.github/workflows/validate.yml`, `SKILL.md` (one line, not larger), `references/traps.md`, `agents/stacks-auditor.md`, `hooks/stacks-auditor-guard.mjs`, `test/guard.test.mjs`, `test/agent.test.mjs`, `CONTRIBUTING.md` (how to test), `CHANGELOG.md`.
- Size: skill folder without `node_modules`, `test`: 226,656 bytes now, about 534,000 after. The npm package of the CLI (`files` includes `plugins/*/skills/**`): 498.8 kB packed, 1.6 MB unpacked, 130 files now; about +67 kB packed and +0.3 MB unpacked, +76 files (estimates from a tarball of the same selection; re-measure with `npm pack --dry-run` in task 9.2).
- Behavior for users: the first run no longer needs a network; an old copy of the skill (before this change) installed next to a new agent file fails with `Cannot find package 'yaml'` and the auditor can no longer install it (`design.md`, "Risks").
- `SKILL.md` stays at or below 13,947 bytes (3,487 of 3,500 estimated tokens in `test/budget.test.mjs`).
