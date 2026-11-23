Motivation and scope: `proposal.md`. Required behavior: `specs/stacks-auditor/spec.md`. Builds on: `add-custom-agents` (in `main`: source format, conversion, per-agent graph convention), `define-aep-delivery-graph` (pull request #14, in review: level 2, a graph per agent and a code verifier), and the archived `add-stacks-auditor-subagent`.

## Verification of the review's findings

| # | Claim | Evidence | Status |
|---|-------|----------|--------|
| 1 | A specifier in `disallowedTools` removes the whole tool, so the auditor has no `Bash` | Claude Code sub-agents documentation: "`Bash(git push *)` ... still removes the whole tool"; "`disallowedTools` is applied first, then `tools` is resolved against the remaining pool. A tool listed in both is removed". The file lists `Bash` in `tools` and fourteen `Bash(...)` entries in `disallowedTools` | confirmed (documentation read 2026-11-23, and the file read in this worktree). Not run in a live session by the author of this proposal |
| 1b | The documented way to keep `Bash` and block commands is `permissions.deny` in settings, which "applies to the main conversation and to subagents" | same page | confirmed |
| 2 | The prompt looks for the engine only under `.claude/...` | the file, step 2 (three paths) and spec "Engine location"; folders per tool in `src/lib/tools.mjs` | confirmed |
| 3 | `skills: [azure-terraform-stacks]` is missing | the file's frontmatter has no `skills` key; `add-custom-agents` "Skills an agent depends on" installs the listed skills with the agent | confirmed |
| 3b | `skills` injects the full skill content into the subagent's context; it controls what is preloaded, not what can be invoked | same documentation page | confirmed. Size of `SKILL.md` and its cost: not measured |
| 4 | `PreToolUse` hooks from plugins run for subagent tool calls, and their input carries `agent_type` | Claude Code hooks documentation ("Hooks from settings files, managed policy settings, and plugins also run inside subagents"; `agent_id` and `agent_type` are common input fields, "present ... when the hook fires inside a subagent") | confirmed from the documentation; the `PreToolUse` section itself was not read in full. Verified in a live session by task 5.1 |
| 5 | A `Bash(<pattern>)` entry in `tools` restricts `Bash` to matching commands | the documentation never shows it; it documents specifiers in `tools` only for `Agent(type)` and MCP wildcards | not verified, and not relied on |
| 6 | `${CLAUDE_PLUGIN_ROOT}` is substituted in an agent's body | `add-stacks-auditor-subagent` task 5.2 says the maintainer did this and "reported it done without recording the results" | not verified here; task 5.1 records it |
| 7 | `${CLAUDE_PLUGIN_ROOT}` works inside a plugin's `hooks/hooks.json` | plugin documentation, from memory of the plugin reference; not read in this session | not verified; task 5.1 |

## Decisions

**1. Keep `Bash`, drop `disallowedTools`, and say what the read-only promise is.** Three options were weighed.

- *(a) Grant `Bash` and enforce the limit by another mechanism.* The mechanisms and what each gives:

  | Mechanism | Gives | Does not give |
  |-----------|-------|---------------|
  | Prompt rules | Cheap; works in every harness | Nothing enforced. A model can ignore them, and the audited repository is untrusted text that can try to instruct the agent (prompt injection through a README, a comment, a pipeline file) |
  | `permissions.deny` in the user's settings | The documented hard rule; applies to subagents; blocks listed commands | A plugin cannot ship it, so it exists only if the user adds it. A deny list cannot list every way to write a file (`python -c`, `node -e`, a redirect `>`, `perl`, `dd`). It also applies to the main conversation |
  | Plugin `PreToolUse` hook, scoped by `agent_type` | Enforcement by code at the moment of the call, shipped with the plugin, no user setup, an allowlist instead of a denylist | Claude Code only. Fails open if its process cannot start (only exit code 2 blocks). Disabled when an administrator sets `allowManagedHooksOnly` for plugins. An allowlist of command strings is only as good as its parser; the guard rejects shell metacharacters rather than parsing the shell |
  | A frontmatter `hooks` block | Would be the natural place | Ignored for plugin subagents (documented), and `add-custom-agents` forbids it in repository agents |
  | `Bash(<pattern>)` in `tools` | Would be ideal | Not documented; not relied on |
  | OS sandbox or a read-only checkout | The only strong guarantee | Outside the plugin; the user must set it up |

- *(b) A read-only engine subcommand called without free `Bash`.* The engine already is that subcommand (`audit` writes nothing, tested). But a subagent can reach it only through the `Bash` tool, and `Bash` cannot be narrowed per command in a subagent (row `Bash(<pattern>)` above). So (b) does not remove the need for (a); it is what (a)'s guard allows.
- *(c) Remove the engine and audit with `Read`, `Grep` and `Glob`.* A real read-only tool set, installable everywhere without a flag (Cursor `readonly: true`, Codex excepted). Rejected: the archived change and the current spec require the engine ("Do not audit by reading files by hand"), the engine's findings carry deterministic `file:line` evidence that the graph convention needs, and a model reading a Terraform repository by hand is the less reliable audit. It remains the fallback if the maintainer decides that no `Bash` is acceptable (open question 1); it would then drop the `audit` step, the `npm ci` exception and most of this change.

**Chosen: (a) with layers, using (b) as the only allowed command.** The agent file loses `disallowedTools`; the plugin gains the guard; the prompt rules stay; the documentation and the agent text say that the promise is **"does not write by design and by guard", not "cannot write"**. The old spec scenario "Bash is the residual risk" is kept and strengthened.

**2. The guard is an allowlist, and it is small.** `hooks/hooks.json` registers a `PreToolUse` hook with matcher `Bash`, running `node "${CLAUDE_PLUGIN_ROOT}/hooks/stacks-auditor-guard.mjs"`. The script reads the hook input; when `agent_type` is not `stacks-auditor` it exits 0 at once (the hook also runs in the main conversation and in every other agent, and must not touch them). Otherwise it allows only these command shapes and exits 2 with a reason for anything else:

1. `ls -d <paths>`: the engine lookup (one call, see Decision 3).
2. `test -f <path>`, `test -d <path>`.
3. `node --version`.
4. `node <path ending in azure-terraform-stacks/scripts/stacks.mjs> audit [--root <path>] [--json]` (no other subcommand: `scaffold`, `add-stack`, `bridge` and `diagram` write files).
5. `npm ci --omit=dev` only when the hook input's `cwd` is the skill's folder (a folder containing `scripts/stacks.mjs`), never the audited repository.
6. `git -c core.fsmonitor=false status --porcelain`, for the closing "no file changed" check. `git log` and `git diff` are not allowed: git runs programs named in a repository's own configuration (for example `core.fsmonitor`, `diff.external`, textconv drivers), and the audited repository is untrusted. Whether `core.fsmonitor=false` is sufficient for `status` is not verified (task 2.4).

Any command containing a newline or one of `; & | < > ` $ ( ) { }` is denied before matching, so redirects, pipes, substitutions and chaining never reach the matcher. `Read`, `Grep` and `Glob` are not hooked (the tools list already excludes `Write`, `Edit` and `NotebookEdit`). The script has no dependency beyond Node 20, which the engine needs anyway. The allowed shapes are the same list the prompt gives, and a test fails when the two differ.

*Alternatives:* a denylist hook (rejected: unbounded); only documentation (kept as the answer if the maintainer rejects the hook, open question 2); shipping the hook to all agents of the plugin (rejected: it must stay a no-op for everything except this agent).

**3. Engine discovery: by skill name over every supported harness.** One `ls -d` call lists, in this order, every candidate and the prompt uses the first that exists: the plugin path when the variable was substituted; then `.claude/skills`, `.agents/skills`, `.gemini/skills`, `.cursor/skills`, `.github/skills` relative to the audited repository, then `~/.claude/skills`, `~/.agents/skills`, `~/.gemini/skills`, `~/.cursor/skills`, `~/.copilot/skills`, each followed by `azure-terraform-stacks/scripts/stacks.mjs`. This is the set of `user` and `project` folders in `src/lib/tools.mjs`; a test reads that file and fails when the agent's list differs, so adding a tool to the CLI cannot silently break the agent. The prompt says "your shell tool" instead of naming `Bash`, since the converted agent runs in tools whose shell has another name. Not covered: relocated configuration folders (`COPILOT_HOME`), as in `add-custom-agents`; the user is told to pass the engine's path. The preloaded skill (`skills:`) does not tell the agent where its folder is (not verified either way), so the list stays.

**4. `skills: [azure-terraform-stacks]`.** Added. Two costs, accepted and recorded: the full `SKILL.md` enters the subagent's context (tokens; the maintainer can measure it, task 5.1), and that text describes commands that write (`scaffold`, `add-stack`). The prompt's rules and the guard are what prevent the auditor from using them; the skill text is not trusted to do so.

**5. The verifier is code, inside the engine.** `audit` already produces `file`, `line` and `message` per finding. A last step in `audit` checks, for each finding, that the real path of `file` is inside the audited root (no `..`, no symbolic link that leaves it) and that `line`, when present, is an integer between 1 and the number of lines of that file. Findings that fail go to an `unverified` list with the reason, are not counted in the summary or the exit code, and are printed under "Not verified". The model's step 5 (re-reading the cited line to confirm the finding means what the engine says) stays as a *model* node after the code node, because it checks meaning, which code cannot. Findings have no excerpt today, so the excerpt-on-line check of the convention is not applicable; adding excerpts is not part of this change.

**6. The `npm ci` exception stays.** It is the one write outside the audited repository, and the guard allows it only in the skill's folder. Alternatives: vendor the `yaml` package into the skill, or make the engine dependency-free (open question 3). Neither is in scope.

## Agent graph: `stacks-auditor`

Follows the convention in `add-custom-agents` (design, "Agent graph convention") and level 2 of `define-aep-delivery-graph`; not repeated here. Types: `fixed` (code or a command), `model` (one model call), `agent` (a loop with tools).

| Node | Type | Reads | Writes | Tools | Next |
|------|------|-------|--------|-------|------|
| `target` | model | the user's request | the audited root | none | no Terraform, pipelines or Argo CD manifests: stop with a message (end) |
| `locate-engine` | fixed | candidate paths | the engine path | `ls -d` via the guard | found: `ensure-deps`; not found: **human interruption** (end) |
| `ensure-deps` | fixed | skill folder's `node_modules` | `node_modules` in the skill folder only | `npm ci --omit=dev` via the guard | present or installed: `run-audit`; failed: **human interruption** (end) |
| `run-audit` | fixed | the audited repository | JSON on stdout | `node <engine> audit --json` | exit 0 or 1: `verify-evidence`; exit 2: stop |
| `verify-evidence` | fixed | the JSON, the files | `unverified` list | inside the engine | `confirm-reading` |
| `confirm-reading` | model | each error finding's cited line | "confirmed" or "could not confirm" per finding | `Read` | `report` |
| `report` | model | all of the above | the report (returned, not stored) | none | `no-change-check` |
| `no-change-check` | fixed | the working tree | "no file changed" or the list of changes | `git -c core.fsmonitor=false status --porcelain` via the guard | end |

- **Edges** are deterministic except `locate-engine`, `ensure-deps`, `run-audit` and `target`, whose failure conditions are in the table.
- **State** lives in the engine's JSON and in the final report only. Nothing persists between runs, and the agent keeps no memory.
- **Cycles:** none. There is no retry: a failed `npm ci` or a denied command ends the run with a message. `confirm-reading` loops over findings, bounded to the error findings, at most 30 (proposed value; beyond it the report says how many were not re-read).
- **Human interruptions:** engine not found (the user installs the skill), `npm ci` failed (the user runs it), a command denied by the guard (the agent reports the command and stops; it does not look for another way), and the closing offer to generate a manifest (offered, never started).
- **Cross-cutting node:** `guard` (fixed) runs before every `Bash` call on Claude Code.
- **Verifier:** `verify-evidence`, code, as above.

## Risks and residual limits

- [**Read-only is not a strong guarantee while `Bash` exists.**] The prompt is advice; the hook is the only enforcement, and only on Claude Code. On Codex, Gemini CLI, Cursor and Copilot the agent relies on the prompt alone (and, for Gemini and Copilot, on the tool's own permission prompts, whose behavior for a subagent is not verified). The agent text, `SKILL.md` and the README say this.
- [The guard fails open] If Node cannot start the script, or an administrator disables plugin hooks, Claude Code does not block. Mitigation: documented; the user's `permissions.deny` is the independent layer.
- [An allowlist parser can be wrong] Rejecting metacharacters wholesale keeps it small, and tests cover bypass attempts (`;`, `&&`, `|`, `$()`, backticks, redirects, newlines, `node` with another subcommand, `npm ci` in the audited folder, `git status` with extra options). It is still code that nobody has attacked for long.
- [The engine reads an untrusted repository] A malicious file can contain text aimed at the model. The guard limits what the model can then do; it cannot stop wrong or misleading findings. The engine itself runs no repository code (`audit` does not execute Terraform or scripts), by spec.
- [`git status` may run repository-configured programs] mitigated by `-c core.fsmonitor=false`, effectiveness not verified.
- [The skill's content is preloaded] cost in tokens, and text that describes writing commands.
- [Behavior change for CLI users] Cursor now refuses the agent without `--allow-broader-access`, because `Bash` is not read-only; Codex always did. This is the intended outcome of `add-custom-agents`' rule and is stated in the pull request.
- [Documentation drift] The `Bash` specifier behavior and hook input are read from vendor pages that change; task 5.1 re-checks them in a live session before release.

## Release

A prerequisite of the release of the agents CLI, not of the merge of `add-custom-agents`. Recorded here and in the pull request. This change touches no version (`plugin.json` 0.2.0, `package.json`), creates no tag and publishes nothing; the maintainer's version gate (`define-aep-delivery-graph`, gate 2) stays as the only way to a release.

## Open questions

1. Is a `Bash` grant acceptable at all, or should the auditor drop the engine (option c)? Recommended: keep `Bash`, with the layers above.
2. Ship the Claude-only guard hook (recommended) or document `permissions.deny` only?
3. Should the engine become dependency-free (or vendor `yaml`) to remove the `npm ci` write? Separate change.
4. Accept that Cursor needs `--allow-broader-access` for this agent?
5. Accept the cost of preloading the full skill, or move the audit-relevant text to a short reference the agent reads on demand?
6. The `confirm-reading` bound of 30 findings: acceptable?
