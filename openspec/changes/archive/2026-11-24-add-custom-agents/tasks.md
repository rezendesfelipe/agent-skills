Each group ends with how to verify it. Paths refer to the repository at 0.5.0.

## 0. Before apply

- [ ] 0.1 Maintainer answers the decisions listed in the pull request of this revision (design, "Open Questions"), and the specs are adjusted if any answer differs. **Verify:** the answers are recorded in the pull request, `npx --yes @fission-ai/openspec@1.7.0 validate add-custom-agents --strict --no-interactive` still passes. _Status (release preparation): the implementation of #18 follows the recommended answers of the Open Questions (Codex needs the flag, `--force` backs up, the four fields are rejected), but I found no pull request comment that records the maintainer's answers, so this stays open and is not verified._
- [x] 0.2 Decide where the `stacks-auditor` `disallowedTools` finding is fixed (design, "Worked example"); if in its own change, merge that change first. **Verify:** the `stacks-auditor` change or decision is linked from this change's pull request. _Status (release preparation): the finding is fixed in its own change, `fix-stacks-auditor-agent` (proposal #17, implementation #21, both merged)._

## 1. Setup

- [x] 1.1 Add `templates/agent/agent-name.md`: a valid, read-only agent (`tools: Read, Grep, Glob`, `model: inherit`) whose body has the "Rules you never break", "Findings" (each with `file:line`) and "Not verified" sections. **Verify:** `validateRepo` accepts the template under its placeholder name and a test fails if its effective tools contain `Edit`, `Write`, `Bash` or `NotebookEdit`.
- [x] 1.2 Add agent fixtures under `test/fixtures/repo/plugins/demo/agents/` (unrestricted, read-only `tools: Read, Grep`, `model: haiku` with a Claude-only field, one with `skills: [alpha]`, one with an MCP tool, one with a `Bash(...)` entry in `disallowedTools`, and bad ones for `hooks`, `mcpServers`, `permissionMode` and `initialPrompt`, a reserved name, a newline in the description). **Verify:** each fixture is used by at least one test named in tasks 3 to 6. *Implementation note: the bad fixtures live in `test/fixtures/bad-agents/` (not under `repo/plugins/demo/agents/`) so they do not appear in the fixture catalog that the CLI tests list and navigate; the reserved-name case is also tested without a file named `aux.md`, which Windows cannot check out.*
- [x] 1.3 Add `plugins/*/agents/**` to the `files` whitelist in `package.json`, and add every new test file to the explicit file list of the `test` script. **Verify:** `npm test` runs the new files (the count of test files in the output grows), and `npm pack --dry-run` lists `plugins/azure-terraform-stacks/agents/stacks-auditor.md`.
- [x] 1.4 Add `.gitattributes` with `test/fixtures/** text eol=lf` (and the golden files' folder). **Verify:** on the Windows job of the `test` matrix the golden-file tests pass.

## 2. Parsing and catalog

- [x] 2.1 Extend `src/lib/frontmatter.mjs` to read block and flow lists, comma-separated strings and the set of top-level keys, and to return the raw frontmatter text and the body; normalize CRLF to LF. **Verify:** unit tests for each list form and for a CRLF file give the same result as the LF file.
- [x] 2.2 Add agent discovery to `src/lib/catalog.mjs` (`plugins/*/agents/*.md`); the name comes from the file name, and a mismatching frontmatter `name` leaves the agent out; return skills and agents as items with a `kind`. **Verify:** a test with `stacks-auditor` and a skill lists both with their kinds.

## 3. Validation

- [x] 3.1 Extend the existing `validateAgent` in `src/lib/validate.mjs` (it already checks name, description and `tools`): nested folders, name reserved on Windows, one-line `description` without control or separator characters, bidirectional control characters anywhere, effective tools non-empty (a specifier removes the whole tool), non-empty body of at most 30,000 characters, `skills` entries exist, `hooks`, `mcpServers`, `permissionMode` and `initialPrompt` rejected. **Verify:** one test per scenario of `specs/agent-catalog/spec.md`, plus `the repository itself is valid` still passing with `stacks-auditor`.
- [x] 3.2 Names unique across skills and agents; validate the agent template against its placeholder name. **Verify:** tests for "Agent and skill with the same name" in both specs.
- [x] 3.3 Update `validate-skills.mjs` output if needed so each error names the file. **Verify:** `node scripts/validate-skills.mjs` on a bad fixture prints the path and the rule.

## 4. Conversion

- [x] 4.1 Add agents folders, file extensions and `alsoReadsAgents` to `src/lib/tools.mjs`, each with a documentation link (use the URLs in the design's verification table). **Verify:** a path test per tool and scope, like the existing skills path tests.
- [x] 4.2 `src/lib/agents/convert.mjs`: build the file for each tool from the parsed agent (Claude: source text; Codex: TOML; Gemini, Cursor, Copilot: rebuilt frontmatter plus the unchanged body). **Verify:** golden files per tool, with a fixed version injected into the marker.
- [x] 4.3 Effective tool set, restriction logic and the tool translation table (design, Decision 3), including the empty-list guard for Copilot and the report of `Name(...)` entries that removed a whole tool. **Verify:** one test per permission scenario in `specs/agent-conversion/spec.md`.
- [x] 4.4 Dropped-field and note reporting (`model`, Claude-only fields, Cursor read-only note, overlap warning). **Verify:** tests on the text output and on `--json`.
- [x] 4.5 One serializer for YAML scalars (JSON-style quoting, escaping U+0085, U+2028, U+2029) and TOML basic and multi-line strings, and a test-side decoder for the emitted subset. **Verify:** hostile-value tests from the "Values are escaped" requirement for every tool, and prompts with quotes, backslashes, `"""`, control characters and a trailing backslash round-trip exactly.
- [x] 4.6 Marker line with the SHA-256 of the LF-normalized preceding content, optional `broadened=tools`, strict parsing. **Verify:** tests for valid, malformed, CRLF-only change, edited and forged-hash cases.
- [x] 4.7 Golden-file tests per tool and one test per scenario in `specs/agent-conversion/spec.md`. **Verify:** `npm test` on Ubuntu, macOS and Windows runners.

## 5. Install and remove

- [x] 5.1 Safe install: name re-check, resolved path inside the agents folder, `lstat` symlink refusal, exclusive create, temporary file plus rename with retry on Windows, `refused` status and `--allow-broader-access`. **Verify:** tests for hostile names (`../x`, `aux`), a symlink and a dangling symlink at the target (skipped when the OS denies link creation), and a file created between check and write (inject the race with a hook).
- [x] 5.2 Plan before writing: compute conversion and refusals first, then install skills only for pairs that will be written. **Verify:** a test that a refused agent installs none of its skills; `--dry-run` prints refusals.
- [x] 5.3 `--force` semantics: replace a pristine installed file; back up any other file first and report the path. **Verify:** the "Existing agent files" scenarios.
- [x] 5.4 Remove an agent: marker and hash check, `--force`, idempotent when absent. **Verify:** the "Install marker" scenarios.

## 6. CLI

- [x] 6.1 `list` prints and returns `kind`; "no agents yet" handling. **Verify:** tests with and without agents.
- [x] 6.2 `add` and `remove` accept skills and agents by name; error text for unknown names. **Verify:** the "Unknown name" scenario.
- [x] 6.3 Interactive selection shows the kind on each item; `remove` lists installed skills and agents; the summary lists agents installed with broader access. **Verify:** the interactive tests of `test/prompt.test.mjs` extended with mixed items.
- [x] 6.4 `--allow-broader-access` (never implied by `--yes`), `refused` status, `kind`, `name`, `skill`, `dropped`, `notes` and `broader` in the results and `--json`; update `--help`. **Verify:** JSON test that the old `skill` field is still there.
- [x] 6.5 Overlap note for agents (Cursor reads `.claude/agents` and `.codex/agents`), worded as a permissions warning for restricted agents. **Verify:** the "Cursor and Claude Code together" scenario.
- [x] 6.6 Tests for every modified scenario in `specs/cli-installer/spec.md`, including the interactive flow with mixed items and the packaging test. **Verify:** `npm test`.

## 7. Documentation

- [x] 7.1 README: agents in the install section (CLI, by hand for Claude Code), agents folder per tool, which tools enforce tool restrictions, refusal behavior and `--allow-broader-access`, the marker (integrity, not authenticity), `COPILOT_HOME` not followed, catalog entries for agents, and the sentence on `stacks-auditor` ("installed by the plugin marketplace, not by the CLI") updated. **Verify:** the README paths match `src/lib/tools.mjs` (a test already compares skill paths; extend it to agent paths).
- [x] 7.2 CONTRIBUTING: how to add an agent (template, read-only by default, what converts and what is dropped, fields not allowed, do not hard-code `.claude` paths in prompts), the "Agent graph" checklist (design, "Agent graph convention"), how to add a tool's agents folder. **Verify:** a reviewer follows the guide from the template to a passing `validate-skills`.
- [x] 7.3 Link the `define-aep-delivery-graph` level 2 convention from CONTRIBUTING once that change is merged. **Verify:** the link resolves. _Status (release preparation): `CONTRIBUTING.md` links `docs/aep/delivery-graph.md#level-2-the-graph-of-each-agent-or-skill` (the link resolves in the repository)._

## 8. Verification

- [x] 8.1 Run `npm test`, `node scripts/validate-skills.mjs` and `npx --yes @fission-ai/openspec@1.7.0 validate --all --strict --no-interactive`. **Verify:** all pass locally and in the `validate` workflow, including Windows and Node 20, 22 and 24.
- [x] 8.2 Check `npm pack --dry-run` contents with an agent fixture present, and confirm the marketplace manifest still lists every plugin (no new plugin is added by this change). **Verify:** the agent files are in the list; `validate-skills` passes.

## 9. Release

- [ ] 9.1 *(left open on purpose: the release is a separate batch behind the maintainer's gate; the version stays 0.5.0 and no tag is created.)* Bump the package to 0.6.0 only when the maintainer releases the batch (the AEP delivery graph change proposes that bumps happen at release); do not edit `.github/workflows/`. **Verify:** the tag `v0.6.0` equals `package.json`, which the publish workflow checks. _Status (release preparation): the bump to 0.6.0 is proposed in the release pull request (draft); it is not ticked until the maintainer approves the version, the tag `v0.6.0` exists and the publish workflow has passed._
- [ ] 9.2 Smoke test with a real agent installed through the CLI in each tool available on the maintainer's machine, before the tag. At least Claude Code (`/agents` lists it, a delegated task runs, and the trailing marker comment is accepted; if not, move the marker, design Open Question 5). Also, where possible: Copilot CLI (`/agent` lists it and a read-only agent cannot edit; check whether `tools` alone is enough or `strict-tools-list` is needed), Cursor (whether a restricted agent in `.claude/agents` is loaded without its restriction), Gemini CLI (accepts the file; unknown keys). **Verify:** the pull request records which tools were checked and the result for each. _Status (release preparation): pending, on purpose. It needs the maintainer's real tools; the commands are in the release pull request. Archived with this task open because it is a release gate, not a requirement of the specs; a failed smoke test is handled by a new change._
