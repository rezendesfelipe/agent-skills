## Context

Motivation and scope: see `proposal.md`. Required behavior: `specs/agent-catalog`, `specs/agent-conversion` and the modified `cli-installer` requirements. Today the CLI (`src/`) installs skill folders into per-tool folders from one path map (`src/lib/tools.mjs`) and tracks its installs with a marker file inside the folder.

Formats were read from each tool's official documentation on 2026-11-21 (details and sources: project memory `custom-agents-research`; the Codex page was only partly readable and is re-checked in the tasks):

| Tool | Format | Required | Tool restriction | Skills |
|------|--------|----------|------------------|--------|
| Claude Code | `.md` + YAML | `name`, `description` | `tools`, `disallowedTools`, `permissionMode` | `skills:` preload |
| Codex | `.toml` | `name`, `description`, `developer_instructions` | none per agent (inherits the parent's sandbox) | inherits parent's |
| Gemini CLI | `.md` + YAML | `name`, `description` | `tools` list (its own tool names) | none |
| Cursor | `.md` + YAML | none | `readonly` only | none |
| Copilot | `.md` or `.agent.md` + YAML | `description` | `tools` (accepts Claude's tool names as aliases) | none |

Cursor also reads `.claude/agents` and `.codex/agents`; a Gemini documentation page says Gemini CLI "was replaced by Antigravity CLI on June 18th, 2026".

## Goals / Non-Goals

**Goals:**
- One file per agent that works as is in Claude Code's marketplace and converts predictably for the other four tools.
- Conversion that is honest: what is carried, dropped or refused is visible to the user, and an agent never gets more access than its author gave it.
- No new runtime dependencies.

**Non-Goals:**
- A general agent framework or schema language. Conversion covers the fields in the specs and nothing more.

## Decisions

**1. The source format is Claude Code's subagent format.** An agent is `plugins/<plugin>/agents/<name>.md`. A plugin's `agents/` folder is where Claude Code's marketplace looks, so the same file is installed natively by `/plugin install` and converted by the CLI for the others.
*Alternatives:* (a) a neutral format with a `tools` block of per-tool overrides: more expressive, but a new schema to document and maintain, and the marketplace would need a build step to emit Claude files; (b) one hand-written file per tool: no conversion code, but five files to keep in sync per agent. Authors already know Claude's format, and a lossy conversion toward simpler formats is easier to explain than an invented format. Per-tool tuning (for example a Gemini model id) is a possible later extension, not part of this change.

**2. Frontmatter is read, not re-serialized, for Claude Code.** The Claude output is the source text with the marker appended, so nested fields (`mcpServers`, `hooks`) and comments survive. The existing zero-dependency parser is extended only to read what conversion needs: top-level scalars, block and flow lists (`tools: [Read, Grep]`, `tools:\n  - Read`) and comma-separated strings, plus the set of top-level keys (to report dropped fields). Outputs for the other tools are built from `name`, `description`, the translated restriction and the unchanged body.

**3. Tool restrictions are mapped by a table, and anything unmapped is refused.** Claude's tool names `Read`, `Grep`, `Glob`, `Edit`, `Write`, `Bash`, `WebFetch`, `WebSearch` are the vocabulary.
- Copilot: the names pass through unchanged, because Copilot accepts them as aliases.
- Gemini: translated with a table (`Read` → `read_file`, `Grep` → `grep_search`, and so on). Only the first two are confirmed by Gemini's page; the rest are verified against Gemini CLI's tool reference in task 4.3, and a name left unverified stays unmapped (so it is refused).
- Cursor: a read-only list becomes `readonly: true`; anything that can write is not expressible.
- Codex: nothing is expressible.

*Alternative:* drop the restriction with a warning. Rejected: a read-only reviewer that silently becomes able to edit files and run commands is the one failure that matters here. `--allow-broader-access` makes the user say so.

**4. Marker line with a content hash, instead of a marker file.** An agent is a single file in a folder tools scan (Cursor and Claude Code scan recursively, Cursor treats stray Markdown there as agents), so a sidecar marker file is out. A manifest outside the tool folders would be state that gets out of sync when folders are copied or removed by hand. The last line of the file records the package, its version and the SHA-256 of everything before it: `<!-- agent-skills: sha256=… version=… -->` (Markdown) or `# agent-skills: …` (TOML). `remove` deletes only files whose hash still matches, so a user's edits are never deleted. The comment is part of the prompt text Markdown tools send, which is harmless.

**5. Dependencies on skills reuse the skill installer.** For each `skills:` entry the CLI runs the same install it runs for a chosen skill, for the same tool and scope, before writing the agent. A skill folder that already exists is left alone and reported, because it may be the user's own. `remove` leaves skills in place: another agent or the user may use them.

**6. Names.** Agent names are kebab-case and at most 64 characters, which satisfies the strictest rules among the tools (Cursor: lowercase and hyphens; Gemini: slug). Names are unique across skills and agents, so `add <name>` needs no `--kind` flag. Validation (`src/lib/validate.mjs`) checks the file name, frontmatter, body length (30,000 characters, Copilot's limit), skill references and uniqueness.

**7. Codex output is written with a small TOML serializer.** `developer_instructions` is a TOML basic multi-line string with backslashes, double quotes and control characters escaped, so any prompt round-trips. Without a TOML library in the runtime, the tests decode the subset the serializer emits and compare against golden files; the real-tool smoke test (task 9.2) checks that Codex accepts the file.

**8. One catalog, two kinds.** `src/lib/catalog.mjs` returns items with a `kind`; `list`, the interactive prompts and `add`/`remove` work on items. Results gain a `kind` field and a `refused` status; `--json` entries keep their existing fields. The tool map in `src/lib/tools.mjs` gains the agents folder, file extension and an `alsoReadsAgents` list per tool (Cursor reads `.claude/agents` and `.codex/agents`), which feeds the same duplicate-listing note skills already have.

**9. Package contents.** The `files` whitelist adds `plugins/*/agents/**`, and the packaging test checks it.

## Risks / Trade-offs

- [Tool formats change; Codex warns its format may change, and Gemini CLI is being replaced by Antigravity CLI] → Folders, extensions and field names live in one module with a documentation link per tool, so a fix is one place plus a patch release. A new Antigravity tool id is a separate change.
- [A lossy conversion surprises authors or users] → Dropped fields and notes are always reported, in the text output and in `--json`.
- [The refusal default blocks agents for Codex and Cursor often] → Intended: most agents that restrict tools cannot be installed there faithfully. The message names the field and the flag; authors who want wide support can write unrestricted agents.
- [The Gemini tool names are partly unverified] → They are checked against Gemini's documentation before release (task 4.3), and unverified names are refused.
- [The same agent installed for Claude Code and Cursor appears twice in Cursor, because Cursor reads `.claude/agents`] → The overlap note, as for skills.
- [Marker comment ends up in the prompt] → One short comment line; the sha256 lets `remove` tell edited files from pristine ones.

## Migration Plan

Additive. Existing `list --json` consumers keep their fields and gain `kind`. No agents are published by this change; the CLI reports "no agents yet" until a plugin ships one. Rollback is a patch release that restores the previous behavior.

## Open Questions

- Whether Claude Code loads an agent file whose last line is an HTML comment without complaint (expected: yes, it is Markdown). Confirmed during the smoke test in task 9.2; if not, the marker moves into a frontmatter comment line.
