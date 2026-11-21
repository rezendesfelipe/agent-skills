## 1. Setup

- [ ] 1.1 Add `templates/agent/agent-name.md`: a valid agent with placeholder name, description and prompt
- [ ] 1.2 Add agent fixtures under `test/fixtures/repo/plugins/demo/agents/` (unrestricted, read-only `tools: Read, Grep`, `model: haiku` with a Claude-only field, one with `skills: [alpha]`, one with an MCP tool, one with `permissionMode: plan`)
- [ ] 1.3 Add `plugins/*/agents/**` to the `files` whitelist in `package.json`

## 2. Parsing and catalog

- [ ] 2.1 Extend `src/lib/frontmatter.mjs` to read block and flow lists, comma-separated strings and the set of top-level keys, and to return the raw frontmatter text and the body
- [ ] 2.2 Add agent discovery to `src/lib/catalog.mjs` (`plugins/*/agents/*.md`) and return skills and agents as items with a `kind`

## 3. Validation

- [ ] 3.1 Agent rules in `src/lib/validate.mjs`: location and file name equal to `name`, no nested folders, `name` and `description` limits, non-empty body of at most 30,000 characters, `skills` entries exist
- [ ] 3.2 Names unique across skills and agents; validate the agent template against its placeholder name
- [ ] 3.3 Tests for every scenario in `specs/agent-catalog/spec.md` and the modified `skill-catalog` requirement

## 4. Conversion

- [ ] 4.1 Add agents folders, file extensions and `alsoReadsAgents` to `src/lib/tools.mjs`, each with a documentation link
- [ ] 4.2 `src/lib/agents/convert.mjs`: build the file for each tool from the parsed agent (Claude: source text; Codex: TOML; Gemini, Cursor, Copilot: rebuilt frontmatter plus the unchanged body)
- [ ] 4.3 Restriction logic and the tool translation table; verify every Gemini tool name against Gemini CLI's tool reference and leave unverified names unmapped
- [ ] 4.4 Dropped-field and note reporting (`model`, Claude-only fields, Cursor read-only note)
- [ ] 4.5 TOML basic multi-line string serializer; tests with prompts containing quotes, backslashes, `"""` and control characters
- [ ] 4.6 Marker line with the SHA-256 of the preceding content, and its verification
- [ ] 4.7 Golden-file tests per tool and one test per scenario in `specs/agent-conversion/spec.md`

## 5. Install and remove

- [ ] 5.1 Install an agent: write, skip when present, replace with `--force`, `refused` status and `--allow-broader-access`
- [ ] 5.2 Install the skills an agent depends on first, leaving existing skill folders alone
- [ ] 5.3 Remove an agent: marker and hash check, `--force`, idempotent when absent

## 6. CLI

- [ ] 6.1 `list` prints and returns `kind`; "no agents yet" handling
- [ ] 6.2 `add` and `remove` accept skills and agents by name; error text for unknown names
- [ ] 6.3 Interactive selection shows the kind on each item; `remove` lists installed skills and agents
- [ ] 6.4 `--allow-broader-access`, `refused` status, `kind` and dropped fields in the results and `--json`; update `--help`
- [ ] 6.5 Overlap note for agents (Cursor reads `.claude/agents` and `.codex/agents`)
- [ ] 6.6 Tests for every modified scenario in `specs/cli-installer/spec.md`, including the interactive flow with mixed items

## 7. Documentation

- [ ] 7.1 README: agents in the install section (CLI, by hand for Claude Code), agents folder per tool, refusal behavior and `--allow-broader-access`, catalog entries for agents
- [ ] 7.2 CONTRIBUTING: how to add an agent (template, format, what converts and what is dropped), how to add a tool's agents folder

## 8. Verification

- [ ] 8.1 Run `npm test`, `node scripts/validate-skills.mjs` and `openspec validate add-custom-agents --strict`
- [ ] 8.2 Check `npm pack --dry-run` contents with an agent fixture present

## 9. Release

- [ ] 9.1 Bump the package to 0.4.0
- [ ] 9.2 Smoke test with a real agent installed through the CLI in each tool that is available on the maintainer's machine (at least Claude Code: `/agents` lists it and a delegated task runs; confirm the trailing marker comment is accepted, see design "Open Questions"); record which tools were checked in the pull request
