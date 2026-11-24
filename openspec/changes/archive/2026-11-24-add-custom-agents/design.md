## Context

Motivation and scope: see `proposal.md`. Required behavior: `specs/agent-catalog`, `specs/agent-conversion` and the modified `cli-installer`, `skill-catalog` and `marketplace-distribution` requirements. Today the CLI (`src/`) installs skill folders into per-tool folders from one path map (`src/lib/tools.mjs`) and tracks its installs with a marker file inside the folder. Since 0.5.0 the repository also ships one agent (`plugins/azure-terraform-stacks/agents/stacks-auditor.md`), already validated by `validateAgent` in `src/lib/validate.mjs` and by the "Plugin subagents" requirement of `skill-catalog` (which requires `tools`). This change builds on that, it does not start from zero.

Formats were read from each tool's official documentation on 2026-11-21 and re-checked on 2026-11-23 (the review that revised this change). Status is **confirmed**, **corrected** (the first version of this design was wrong or outdated) or **not verified** (with the URL that was tried).

### Verification table (2026-11-23)

| Tool | Claim | Source | Result |
|------|-------|--------|--------|
| Claude Code | Folders: project `.claude/agents`, user `~/.claude/agents`, plugin `agents/`, all scanned recursively | https://code.claude.com/docs/en/sub-agents | confirmed |
| Claude Code | Only `name` and `description` required; `name` up to 256 characters, no `:`, not starting with `-`; unknown fields ignored without error | same | confirmed (the repository's 64-character limit is stricter on purpose) |
| Claude Code | `tools` omitted means "inherits every tool available to subagents" | same | confirmed |
| Claude Code | `disallowedTools: Bash(git push *)` blocks only matching commands | same | **corrected**: "An entry with a specifier ... still removes the whole tool"; to keep Bash and block commands use `permissions.deny` in settings |
| Claude Code | `hooks`, `mcpServers`, `permissionMode` ignored for plugin subagents | same | confirmed, and `initialPrompt` is ignored too. The same fields are honored in `.claude/agents` and `~/.claude/agents` |
| Claude Code | Model values `sonnet`, `opus`, `haiku`, `fable`, a model id, `inherit` | same | confirmed |
| Claude Code | A trailing HTML comment line in the file is accepted | no source | not verified; smoke test (task 9.2) |
| Claude Code | Effect of `memory` on a subagent's tools | same page (not found in the part read) | not verified |
| Codex | Folders `~/.codex/agents` and `.codex/agents`, one TOML file per agent, required `name`, `description`, `developer_instructions`; `name` is the source of truth and the file name need not match | https://learn.chatgpt.com/docs/agent-configuration/subagents (the old URL https://developers.openai.com/codex/subagents answers 308 to it) | confirmed; the "partly readable page" caveat of the first version is resolved |
| Codex | No per-agent tool allowlist; `features.shell_tool`, `features.apps`, `features.plugins`, `features.memories`, `features.request_permissions_tool` can be set to `false`; `sandbox_mode`, `approval_policy`, `model_provider`, `mcp_servers` do not override the parent; subagents inherit the parent's sandbox | same | confirmed. No feature key replaces a tool allowlist (disabling `shell_tool` also removes file reading), so Codex still cannot express `tools` |
| Codex | "Codex warns its format may change" | same | not verified: no such warning was found on the page |
| Gemini CLI | Folders `.gemini/agents/*.md` and `~/.gemini/agents/*.md`; YAML frontmatter; `name` slug (lowercase letters, digits, hyphens, underscores), `description`, optional `kind` (`local` default), `tools` (omitted: inherits all), `model`, `temperature`, `max_turns`, `timeout_mins`, `mcpServers`; subagents enabled by default | https://geminicli.com/docs/core/subagents/ | confirmed |
| Gemini CLI | Built-in tool names `read_file`, `grep_search` (legacy alias `search_file_content`), `glob`, `list_directory`, `read_many_files`, `replace`, `write_file`, `run_shell_command`, `web_fetch`, `google_web_search` | https://geminicli.com/docs/reference/tools/ | confirmed; this closes task 4.3 of the first version |
| Gemini CLI | A `tools` entry can restrict `run_shell_command` to some commands | same | not verified (the page was read for names only) |
| Gemini CLI | "Replaced by Antigravity CLI on June 18th, 2026" | both pages above | confirmed, but only "for unpaid tier and Google One users" |
| Antigravity CLI | Own subagent format: `.agents/agents/<name>.md` or `<name>/agent.md`, user `~/.gemini/config/agents/<name>.md`; fields `name`, `description`, `tools`, `mainAgent`, `subagent`, `model` (`inherit`, `flash`, `pro`), `commandExecutionPolicy`, `mcpServers`, `skills`; tool names such as `view_file`, `replace_file_content`, `grep_search`, `run_command`; a misspelled tool name "may cause the subagent process to hang" | https://antigravity.google/docs/subagents.md | confirmed as documented; the complete tool list is not verified. Out of scope (see Non-goals) |
| Cursor | Project `.cursor/agents`, `.claude/agents`, `.codex/agents`; user `~/.cursor/agents`, `~/.claude/agents`, `~/.codex/agents`; `.cursor/` wins on name conflicts | https://cursor.com/docs/subagents | confirmed |
| Cursor | Fields `name`, `description`, `model`, `readonly`, `is_background`; `readonly: true` means "no file edits, no state-changing shell commands"; names use lowercase letters and hyphens | same | confirmed |
| Cursor | Cursor applies a Claude `tools` or `disallowedTools` list found in `.claude/agents` | same | not verified. If it does not, installing an agent for `claude` hands Cursor an unrestricted copy (see Decision 11) |
| Cursor | Recursive scan of the agents folders | same | not verified |
| Copilot | `.agent.md` or `.md`; repository folder `.github/agents`; file name may only contain `.`, `-`, `_`, letters and digits; prompt at most 30,000 characters | https://docs.github.com/en/copilot/reference/custom-agents-configuration, https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/customize-cloud-agent/create-custom-agents | confirmed |
| Copilot CLI | User folder `~/.copilot/agents`, `.agent.md`; a user agent beats a repository agent with the same id; `COPILOT_HOME` replaces the whole `~/.copilot` path | https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/create-custom-agents-for-cli, https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-config-dir-reference | confirmed |
| Copilot | Tool aliases (case insensitive): `execute` = `shell`, `Bash`, `powershell`; `read` = `Read`, `NotebookRead`; `edit` = `Edit`, `MultiEdit`, `Write`, `NotebookEdit`; `search` = `Grep`, `Glob`; `agent` = `custom-agent`, `Task`; `web` = `WebSearch`, `WebFetch`; `todo` = `TodoWrite`; omitted `tools` or `["*"]` means all tools | custom-agents-configuration page above | confirmed |
| Copilot | Unrecognized tool names are ignored; `tools: []` disables all tools | search summary of the same page (not re-read in full), and a reported CLI bug where `--agent` ignored `[]` (https://github.com/github/copilot-cli/issues/556) | not verified; the CLI therefore never writes an empty `tools` list and refuses unmapped names (Decision 3) |
| Copilot CLI | A `strict-tools-list: true` key limits an agent to the listed tool groups "without adding default tools" | the create-custom-agents-for-cli page above | not verified (a single mention, no second source). If real, `tools` alone may leave default tools enabled, which would make Copilot a silent-widening case; checked in the smoke test (task 9.2) |
| Copilot CLI | Whether Copilot CLI also reads `.claude/agents` | no source | not verified |

## Goals / Non-Goals

**Goals:**
- One file per agent that works as is in Claude Code's marketplace and converts predictably for the other four tools.
- Conversion that is honest: what is carried, dropped or refused is visible to the user, and an agent never gets more access than its author gave it, in the marketplace or through the CLI.
- Writes that cannot escape the agents folder, clobber a user's file or turn a description into new configuration.
- No new runtime dependencies.

**Non-Goals:**
- A general agent framework or schema language. Conversion covers the fields in the specs and nothing more.

## Decisions

**1. The source format is Claude Code's subagent format.** An agent is `plugins/<plugin>/agents/<name>.md`. A plugin's `agents/` folder is where Claude Code's marketplace looks, so the same file is installed natively by `/plugin install` and converted by the CLI for the others.
*Alternatives:* (a) a neutral format with a `tools` block of per-tool overrides: more expressive, but a new schema to document and maintain, and the marketplace would need a build step to emit Claude files; (b) one hand-written file per tool: no conversion code, but five files to keep in sync per agent. Authors already know Claude's format, and a lossy conversion toward simpler formats is easier to explain than an invented format. Per-tool tuning (for example a Gemini model id) is a possible later extension, not part of this change.
*Revised:* `tools` stays **required** (as in the existing `skill-catalog` requirement and `validateAgent`), not optional as the first version said: an omitted list inherits every tool, which no converter can reproduce faithfully. As a consequence there is no "unrestricted by omission" agent; an agent is unrestricted only if it lists the whole vocabulary of Decision 3.

**2. Frontmatter is read, not re-serialized, for Claude Code.** The Claude output is the source text with the marker appended, so nested fields and comments survive. The existing zero-dependency parser is extended only to read what conversion needs: top-level scalars, block and flow lists (`tools: [Read, Grep]`, `tools:\n  - Read`) and comma-separated strings, plus the set of top-level keys (to report dropped fields). Outputs for the other tools are built from `name`, `description`, the translated restriction and the unchanged body. Line endings are normalized to LF before anything is hashed or written (Windows checkouts may be CRLF).

**3. Tool restrictions are mapped by a table over the effective tool set, and anything unmapped is refused.**
- *Effective tool set.* Claude Code removes a `disallowedTools` entry's whole tool, specifier or not (corrected in the table). The CLI computes the same: effective = `tools` minus the base name of every `disallowedTools` entry (`Bash(terraform *)` removes `Bash`). The result reports which entries removed a whole tool, so nobody is surprised when `Bash(...)` entries that looked like command filters took Bash away. An effective set that is empty is a validation error.
- *Vocabulary.* Claude's tool names `Read`, `Grep`, `Glob`, `Edit`, `Write`, `Bash`, `WebFetch`, `WebSearch`. Any other entry (an MCP tool, `NotebookEdit`, an entry with a specifier in `tools`) is unmapped for every tool except `claude`. An agent is **unrestricted** when its effective set contains the whole vocabulary.
- Copilot: the names pass through unchanged, because Copilot accepts them as case-insensitive aliases. Never write an empty list, and refuse unmapped names, because Copilot reportedly ignores unrecognized names (not verified).
- Gemini: translated with a table, now fully confirmed against the tools reference: `Read` → `read_file`, `Grep` → `grep_search`, `Glob` → `glob`, `Edit` → `replace`, `Write` → `write_file`, `Bash` → `run_shell_command`, `WebFetch` → `web_fetch`, `WebSearch` → `google_web_search`. The table is deliberately narrow (no `read_many_files` or `list_directory`): a narrower agent is safe, a wider one is not.
- Cursor: a read-only effective set (`Read`, `Grep`, `Glob`, `WebFetch`, `WebSearch`) becomes `readonly: true`; anything that can write is not expressible.
- Codex: nothing is expressible, so every agent that is not unrestricted needs `--allow-broader-access`. Because `tools` is required, that is nearly every agent. This is the intended outcome and a decision for the maintainer (Open Questions).

*Alternative:* drop the restriction with a warning. Rejected: a read-only reviewer that silently becomes able to edit files and run commands is the one failure that matters here. `--allow-broader-access` makes the user say so. The flag applies to the whole command, is never implied by `--yes`, is listed by name in the interactive confirmation summary, and is recorded in the marker (Decision 4), so a later `remove` or review can see the file was installed with broader access.

**4. Marker line with a content hash, instead of a marker file.** An agent is a single file in a folder tools scan (Cursor and Claude Code scan recursively, Cursor treats stray Markdown there as agents), so a sidecar marker file is out. A manifest outside the tool folders would be state that gets out of sync when folders are copied or removed by hand. The last line of the file records the package, its version and the SHA-256 of everything before it: `<!-- agent-skills: sha256=… version=… [broadened=tools] -->` (Markdown) or `# agent-skills: …` (TOML). `remove` deletes only files whose hash still matches, so a user's edits are never deleted.
- The hash covers the UTF-8 bytes of the content with CRLF normalized to LF, so an editor or Git that only changes line endings does not make an untouched file look edited. Files are written as UTF-8 without BOM, LF, ending with a newline after the marker.
- The marker is parsed strictly from the last non-empty line (64 hexadecimal digits, a version made of `[0-9A-Za-z.+-]`, optional `broadened=` from a fixed vocabulary). Anything else is "no marker".
- **It is an integrity check, not authentication.** Anyone who can write the file can forge a valid marker. The worst a forged marker can do is make `remove` delete a file whose name matches a catalog agent in the agents folder of a tool the user named, which is the same file the user asked to remove. The spec says so, so nobody treats the marker as a security boundary.
- The comment is part of the prompt text Markdown tools send. The prompt before the marker is unaltered; the marker is the only addition. Placement is a maintainer decision (Open Questions).

**5. Dependencies on skills reuse the skill installer.** For each `skills:` entry the CLI runs the same install it runs for a chosen skill, for the same tool and scope, before writing the agent. A skill folder that already exists is left alone and reported, because it may be the user's own. `remove` leaves skills in place: another agent or the user may use them. **Refusals are decided first** (Decision 13): skills are installed only for (agent, tool) pairs that are going to be written, so a refused agent leaves nothing behind.

**6. Names.** Agent names are kebab-case and at most 64 characters, which satisfies the strictest rules among the tools (Cursor: lowercase and hyphens; Gemini: slug; Copilot file names: letters, digits, `.-_`). Names are unique across skills and agents, so `add <name>` needs no `--kind` flag. Validation checks the file name, frontmatter, body length (30,000 characters, Copilot's limit), skill references, uniqueness, nested folders and Windows reserved names (Decision 10).

**7. Codex output is written with a small TOML serializer.** `description` is a TOML basic string and `developer_instructions` a basic multi-line string, both with backslashes, double quotes and control characters escaped, so any prompt round-trips. Without a TOML library in the runtime, the tests decode the subset the serializer emits and compare against golden files; the real-tool smoke test (task 9.2) checks that Codex accepts the file. A lone surrogate cannot be represented in TOML and is refused.

**8. One catalog, two kinds.** `src/lib/catalog.mjs` returns items with a `kind`; `list`, the interactive prompts and `add`/`remove` work on items. Agent items take their name from the file name, and an agent whose frontmatter `name` differs is left out of the catalog (validation reports it), unlike `findSkills`, which falls back to the folder name. Results gain a `kind` field and a `refused` status; `--json` result entries keep their existing fields, including `skill` (now the item's name, kept for compatibility), and gain `name` and `kind`. The tool map in `src/lib/tools.mjs` gains the agents folder, file extension and an `alsoReadsAgents` list per tool (Cursor reads `.claude/agents` and `.codex/agents`), which feeds the overlap note.

**9. Package contents.** The `files` whitelist adds `plugins/*/agents/**`, and the packaging test checks it. `npm test` lists its test files explicitly in `package.json`; new test files are added there, otherwise neither the `test` job nor the publish workflow would run them.

**10. Safe writes.** Validation runs in this repository's CI, but the CLI runs on strangers' machines and must not trust the data it is handed.
- *Names.* Before building a path, the CLI re-checks the name against the kebab-case pattern, the 64-character limit and the Windows reserved device names (`con`, `prn`, `aux`, `nul`, `com1`–`com9`, `lpt1`–`lpt9`; `aux.md` is reserved on Windows too). Validation rejects these names in the repository for the same reason. After joining, the resolved target must be a direct child of the resolved agents folder.
- *Symbolic links.* The target is inspected with `lstat`. A symbolic link at the target path (including a dangling one) is never written through, even with `--force`; the result says so. The agents folder itself may be a symbolic link (people keep dotfiles that way).
- *Creation.* A new file is created with the exclusive flag (`wx`), so a file that appears between the check and the write is not overwritten. Replacing uses a temporary sibling file (`<file>.tmp-<pid>`, which no tool reads as an agent) and a rename, retried a few times on Windows `EPERM`/`EBUSY` and then reported as a failure.
- *Overwriting.* Without `--force`, an existing file is left alone (as the spec says). With `--force`, a file that carries a valid marker with a matching hash is replaced; any other existing file (no marker, or edited) is first copied to a uniquely named backup next to it (`<file>.bak`, then `<file>.bak.1`, and so on) and the result reports the backup path. Whether to back up is a decision for the maintainer (Open Questions); skills keep their current `--force` behavior.
- *Characters.* Validation rejects control characters and Unicode line separators (U+0085, U+2028, U+2029) in `name` and `description`, and bidirectional control characters (U+202A–U+202E, U+2066–U+2069) anywhere in the file, because a description is loaded into every session's routing context once the agent is installed at user scope and hidden direction changes make a reviewed file read differently from what the model sees.

**11. Fields the repository does not allow in agents.** `hooks`, `mcpServers`, `permissionMode` and `initialPrompt` are ignored by Claude Code when the file is loaded by a plugin ("for security reasons"), but honored when the same file sits in `~/.claude/agents` or `.claude/agents`, which is exactly what the CLI's `claude` output does. An agent that looks safe in the marketplace would gain hook commands, MCP server processes or `bypassPermissions` once installed with the CLI. Validation therefore rejects these four fields (this also keeps the existing `stacks-auditor` requirement that the file does not rely on them). Conversion repeats the check as defense in depth and refuses such a file for every tool, `claude` included. Other Claude-only fields (`maxTurns`, `memory`, `background`, `effort`, `isolation`, `color`, ...) stay allowed and are written only for `claude`; the effect of `memory` on tool access is not verified and is on the review list.
A related cross-tool case: Cursor reads `.claude/agents`, and it is not verified whether it applies Claude's `tools` there. The overlap note for agents is therefore a **permissions warning** when the reader cannot express the source restriction ("Cursor also reads `.claude/agents` and may load this agent without its tool restriction; install it for cursor only, or for claude only"), not just a duplicate-listing note.

**12. Values are serialized through one escaping function.** `name`, `description` and tool names reach YAML and TOML only through the serializer: YAML scalars are written as JSON-style double-quoted strings (with U+0085, U+2028, U+2029 escaped as `\uXXXX`), TOML strings as escaped basic strings. Keys are fixed by the converter, never copied from the source. A description such as `x\ntools: ["*"]` must come out as one quoted scalar and must not add a key. Tests cover newlines, `: `, `#`, `---`, a leading `-`, `&`, `*`, `!!`, quotes, backslashes, `"""`, YAML words (`true`, `null`, `1e3`), Unicode separators and control characters, and decode every output with the test-side parser. The prompt body is carried unchanged for Markdown tools and escaped for TOML.

**13. Plan first, then write.** For each (agent, tool) pair the CLI computes the conversion, the dropped fields and any refusal before touching the disk. A refused pair writes nothing and installs none of its skills. In `--dry-run` the same plan is printed, including the refusals. Partial failure semantics are those of the existing "Partial failure" scenario: what succeeded is kept and the exit code is non-zero.

**14. Windows and line endings.** The CI matrix already runs the tests on `windows-latest` (Node 20, 22, 24). The agent work adds three hazards: (a) Git for Windows checks out CRLF unless told otherwise, so golden files and fixtures need a `.gitattributes` (`test/fixtures/** text eol=lf`) and the converter normalizes to LF; (b) symbolic-link tests need privileges on Windows and skip themselves when creating the link fails with `EPERM`; (c) printed paths in test assertions use `/` as `validate.mjs` does. Reserved names are in Decision 10. `COPILOT_HOME` (confirmed to relocate `~/.copilot`) and any similar variable for other tools are not followed (Non-goals).

## Agent graph convention (AEP programme)

The AEP programme (see the open change `define-aep-delivery-graph`, whose level 2 sets the same rule) asks that every agent be designed as a graph, not as a prompt. For agents published through this mechanism, the change that introduces an agent or skill with agent behavior SHALL carry in its `design.md` an "Agent graph" section with:
- **Nodes**, each typed `fixed` (deterministic code or a command), `model` (one model call) or `agent` (a loop with tools), with what it reads, what it writes and which tools it holds.
- **Edges**, deterministic or conditional, with the condition written down.
- **State**: where it lives between nodes (a report file, the pull request, a returned JSON), never in hidden memory.
- **Cycles** and their bound (for example a retry limit) and what happens when the bound is hit.
- **Human interruptions**: every point where the agent stops and asks (for example before any write), and what it needs to resume.
- **A deterministic verifier node** after any node that produces findings. Findings carry evidence as `file:line` plus an optional excerpt. The verifier is code: it checks that the path resolves inside the audited root, that the line exists, and that the excerpt, when given, occurs on that line. Findings that fail the check go to a "not verified" list and do not count.

What this change does about it: the agent template carries the report skeleton (a "Findings" section whose items must give `file:line`, and a "Not verified" section), the contributor guide gets the checklist, and the design of each new agent is reviewed against it. What it does **not** do: implement the verifier (a follow-up change; the AEP change lists the verifier as part of its programme) or add a rule that the CLI enforces. The CLI installs files; it does not know whether an agent's graph is good. The existing `stacks-auditor` is the reference case: its step 5 re-reads cited lines with a model, which is not deterministic, while the engine's `--json` already provides the file and line a verifier needs.

**Read-only by default.** The template's front matter is the standard for new agents:

```yaml
---
name: agent-name
description: <third person: what it does, when to use it, what it never does>
tools: Read, Grep, Glob
model: inherit
---
```

`Edit`, `Write` and `Bash` are added only when the agent's graph has a node that needs them, and the "Agent graph" section says which node and why. The CLI preserves this as follows: `Read, Grep, Glob` converts without any flag for Claude Code, Gemini CLI, Cursor (`readonly: true`) and Copilot; Codex refuses it unless `--allow-broader-access` is given (confirmed in the first version's design and re-checked: nothing is expressible there). Validation checks that `tools` exists, not that the list is minimal; minimality is a review item.

## Worked example: `stacks-auditor` through this CLI

The only agent in the repository today has `tools: Read, Grep, Glob, Bash` and fourteen `disallowedTools` entries such as `Bash(terraform *)`. Under Decision 3:
- Effective tool set: `Read`, `Grep`, `Glob` (every `Bash(...)` entry removes the whole `Bash` tool). Conversion therefore yields `read_file`, `grep_search`, `glob` for Gemini, the same names for Copilot, `readonly: true` for Cursor, and a refusal for Codex without the flag. It would install everywhere the restriction is expressible.
- **Finding for the maintainer, outside this change:** by the current Claude Code documentation, the auditor as written has no `Bash`, yet its instructions require running the engine's `audit` command with `Bash`. Its spec (`stacks-auditor`) assumes the entries filter commands. The fix (keep `Bash` and deny commands with `permissions.deny` in the user's settings, which the spec already lists as the hard guarantee, or drop `disallowedTools` and rely on the instructions) belongs in its own change. It should land before this change is applied, because the first real conversion would otherwise carry the defect to five tools.
- Its prompt looks for the engine under `${CLAUDE_PLUGIN_ROOT}`, `.claude/skills` and `~/.claude/skills`. After a Gemini or Cursor install the skill sits in another folder, so the prompt cannot find it. Prompts of agents meant for several tools should locate their skills by name or through the tool's own skill mechanism, not by Claude-specific paths; the contributor guide says so (task 7.2). It also has no `skills:` entry for `azure-terraform-stacks`, which the CLI would use to install the skill together with the agent.

## Release pipeline

`publish.yml` publishes to npm on a pushed `v*` tag after checking that the tag equals `package.json`'s version, then runs `node scripts/validate-skills.mjs` and `npm test`. `validate.yml` runs the same plus `openspec validate --all --strict` (pinned 1.7.0) and the tests on Ubuntu, macOS and Windows. This change needs no workflow edit, but depends on the pipeline in these ways:
1. **Test wiring.** `npm test` names its files. New test files not added to the script are never run by CI or by the release.
2. **Package contents.** Without `plugins/*/agents/**` in `files`, a published package lists no agents and `add` finds none. The packaging test must fail in that case.
3. **Validation blocks the release.** `validate-skills.mjs` runs on the tag. Any new agent rule that the existing `stacks-auditor` breaks would block a release; the rules in this change do not (it uses none of the forbidden fields), but a later fix of the auditor must keep passing them.
4. **Irreversible publish.** An npm version cannot be reused. The smoke test with real tools (task 9.2) happens before the tag, by hand, and the tag is the maintainer's explicit step. CI cannot run Claude Code, Codex, Gemini CLI, Cursor or Copilot.
5. **Version.** 0.5.0 is released (tag exists), so this change targets 0.6.0, set when the batch is released, as the AEP delivery graph also proposes (version bump only at release).
6. **Fixtures on Windows.** `.gitattributes` for fixtures and golden files (Decision 14).

## Risks / Trade-offs

- [Tool formats change and Gemini CLI is being replaced by Antigravity CLI for part of its users] → Folders, extensions and field names live in one module with a documentation link per tool, so a fix is one place plus a patch release. A new Antigravity tool id is a separate change; its documented format is in the table.
- [A lossy conversion surprises authors or users] → Dropped fields and notes are always reported, in the text output and in `--json`.
- [The refusal default blocks agents for Codex always, and for Cursor often] → Intended: an agent that restricts tools cannot be installed there faithfully. The message names the field and the flag. The cost is that `--allow-broader-access` becomes routine for Codex; the marker records it and the summary lists it.
- [Gemini's per-command shell restrictions and Copilot's `strict-tools-list` are not verified] → The CLI never writes command-level restrictions, and the Copilot semantics are in the smoke test.
- [The same agent installed for Claude Code and Cursor appears twice in Cursor, and Cursor may load the Claude copy without its restrictions] → The overlap note is a permissions warning for agents (Decision 11).
- [Marker comment ends up in the prompt] → One short comment line; the sha256 lets `remove` tell edited files from pristine ones.
- [A forged marker] → Integrity only; documented, with limited effect (Decision 4).
- [Hash mismatch from line-ending changes] → The hash is computed over LF-normalized content.
- [Backups clutter the agents folder] → Only when `--force` replaces a file the CLI cannot prove it wrote, and the path is reported.

## Migration Plan

Additive. Existing `list --json` consumers keep their fields and gain `kind`; `add`/`remove` results keep `skill` and gain `name` and `kind`. Existing validation of `stacks-auditor` keeps passing. No agents are added by this change; the CLI reports "no agents yet" until a plugin that the package bundles ships one — note that `stacks-auditor` already exists in the repository, so after the package contents change it appears in `list` as the first agent. Rollback is a patch release that restores the previous behavior.

## Open Questions

Closed by the 2026-11-23 verification: the Codex format (confirmed), the Gemini tool names (confirmed), whether `tools` is required (it is; Decision 1).

Need the maintainer's decision (listed in the pull request):
1. **Codex always needs `--allow-broader-access`** (Decision 3). Accept, or prefer a documented Codex-only convention (for example a read-only parent sandbox) over the flag?
2. **`--force` backs up a file it did not write** (Decision 10). Accept, or keep the skills behavior (replace silently)?
3. **Reject `hooks`, `mcpServers`, `permissionMode` and `initialPrompt` in repository agents** (Decision 11). Accept, or allow them and have the CLI strip them for `claude` (which changes the file the marketplace and the CLI deliver)?
4. **`stacks-auditor` and `disallowedTools` specifiers.** Fix in a separate change before this one is applied (recommended), or accept and document?
5. **Marker placement.** Trailing comment (default, it is part of the prompt) or a YAML comment line as the last line of the frontmatter (not part of the prompt; for TOML a leading comment)? Both are unverified in Claude Code; the smoke test tries the default and falls back.
6. **Antigravity CLI** as a sixth tool in a follow-up change, now that its subagent format is documented.

Verified by hand before the release (task 9.2), not by tests: Claude Code accepts the trailing marker comment; Copilot CLI's `tools` semantics and `strict-tools-list`; whether Cursor honors `tools` from `.claude/agents`; whether Gemini CLI rejects unknown frontmatter keys.
