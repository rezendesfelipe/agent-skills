Motivation and scope: `proposal.md`. Required behavior: `specs/stacks-auditor/spec.md`. Status: approved at gate 1 on 2026-11-23 (see "Maintainer decisions, 2026-11-23"). Builds on: `add-custom-agents` (in `main` since pull request #18: source format in `src/lib/agents/`, conversion, validation with forbidden fields, per-agent graph convention), `define-aep-delivery-graph` (pull request #14, in review: level 2, a graph per agent and a code verifier), and the archived `add-stacks-auditor-subagent`.

## Verification of the review's findings

| # | Claim | Evidence | Status |
|---|-------|----------|--------|
| 1 | A specifier in `disallowedTools` removes the whole tool, so the auditor has no `Bash` | Claude Code sub-agents documentation: "`Bash(git push *)` ... still removes the whole tool"; "`disallowedTools` is applied first, then `tools` is resolved against the remaining pool. A tool listed in both is removed". The file lists `Bash` in `tools` and fourteen `Bash(...)` entries in `disallowedTools` | confirmed (documentation read 2026-11-23, and the file read in this worktree). Not run in a live session by the author of this proposal |
| 1b | The documented way to keep `Bash` and block commands is `permissions.deny` in settings, which "applies to the main conversation and to subagents" | same page | confirmed |
| 2 | The prompt looks for the engine only under `.claude/...` | the file, step 2 (three paths) and spec "Engine location"; folders per tool in `src/lib/tools.mjs` | confirmed |
| 3 | `skills: [azure-terraform-stacks]` is missing | the file's frontmatter has no `skills` key; `add-custom-agents` "Skills an agent depends on" installs the listed skills with the agent | confirmed |
| 3b | `skills` injects the full skill content into the subagent's context; it controls what is preloaded, not what can be invoked | same documentation page | confirmed. Size: `SKILL.md` is 12,258 bytes, 115 lines, 1,809 words; the cost in tokens is an estimate until task 5.2 measures it (see "Token counting") |
| 4 | `PreToolUse` hooks from plugins run for subagent tool calls, and their input carries `agent_type` | Claude Code hooks documentation ("Hooks from settings files, managed policy settings, and plugins also run inside subagents"; `agent_id` and `agent_type` are common input fields, "present ... when the hook fires inside a subagent") | confirmed from the documentation; the `PreToolUse` section itself was not read in full. Verified in a live session by tasks 6.1 and 6.2 |
| 5 | A `Bash(<pattern>)` entry in `tools` restricts `Bash` to matching commands | the documentation never shows it; it documents specifiers in `tools` only for `Agent(type)` and MCP wildcards | not verified, and not relied on |
| 6 | `${CLAUDE_PLUGIN_ROOT}` is substituted in an agent's body | `add-stacks-auditor-subagent` task 5.2 says the maintainer did this and "reported it done without recording the results" | not verified here; task 6.1 records it |
| 7 | `${CLAUDE_PLUGIN_ROOT}` works inside a plugin's `hooks/hooks.json` | plugin documentation, from memory of the plugin reference; not read in this session | not verified; task 6.2 |
| 8 | What `main` now does with this agent | `src/lib/agents/permissions.mjs` (`effectiveTools`, `restrictionFor`), `src/lib/agents/convert.mjs`, `test/cli-agents.test.mjs` lines 392 to 427, read in this worktree after merging `origin/main` (00f2f27) | confirmed: the CLI computes effective tools `Read, Grep, Glob` for the current file and pins that in three tests; with `Bash` restored, Cursor and Codex refuse without `--allow-broader-access`, Gemini maps to `run_shell_command`, Copilot to `Bash` |

## Decisions

### Maintainer decisions, 2026-11-23 (gate 1)

These replace the former open questions 1 to 5. They are authoritative; the numbered decisions below were amended to match.

| # | Question | Decision |
|---|----------|----------|
| 1 | Keep `Bash`, in layers (option a)? | **Approved.** |
| 2 | Ship the PreToolUse guard hook in the plugin (Claude Code only)? | **Approved, conditional on live tests.** `agent_type` in the `PreToolUse` input and `${CLAUDE_PLUGIN_ROOT}` inside `hooks/hooks.json` are unverified and must be proven by tasks 6.1 and 6.2. **Plan B** if either fails: do not ship the hook; document `permissions.deny` (the snippet of task 4.1) as the only enforcement and say so in the agent, `SKILL.md` and README. "Read-only" stays layered, never guaranteed. The hook fails open if Node cannot start the script, and does not run if an administrator disables plugin hooks. |
| 3 | Cursor needs `--allow-broader-access` for this agent, like Codex? | **Accepted.** |
| 4 | `audit` verifies `file:line` evidence (`--json` gains `unverified`)? | **Accepted.** |
| 5 | Preload the skill with `skills:`? | **Approved**, with a request to measure with a tokenizer (see "Token counting"). Adds a measurement task and a budget test. Attention point recorded: the preloaded `SKILL.md` describes commands that write; only the prompt and the guard stop their use. |
| 6 | Make the engine dependency-free by vendoring `yaml@2.9.1`? | **Approved as its own future change**, after this one (Decision 6). Not part of this change. |
| 7 | Release gating | A **release prerequisite** of the agents CLI, not a merge prerequisite. No version bump, no tag, no publishing here. |


### Maintainer decisions, 2026-11-24 (review cycle 1; authoritative)

| # | Finding | Decision | Where |
|---|---------|----------|-------|
| I1 | The guard accepted any engine whose path ended in `azure-terraform-stacks/scripts/stacks.mjs`, including one inside the audited repository (code execution, reproduced by the reviewer) | **Fix now.** The guard resolves the real path of the engine and accepts only (a) the plugin's own skill folder, derived from the script's location, and (b) the user's skills folders of the five tools (one shared list, `USER_SKILL_FOLDERS`, equal to the `user` folders of `src/lib/tools.mjs` by test). It denies a path with `..`, one that does not resolve, and one that lies inside the hook input's `cwd` or the audited `--root`, both as written and once resolved. Project-scope folders are no longer an origin; the agent's lookup lists only plugin and user folders and never uses an engine inside the audited repository | guard, agent step 2, spec "Engine location" and "Command guard" |
| I2 | `npm ci` was unreachable: the subagent's `cwd` is the project and `cd` is not allowed | **Allow** `npm ci --prefix <skill folder> --omit=dev --ignore-scripts` (the only extra argument, in that order), for the same two origins, never inside `cwd`, with `scripts/stacks.mjs` and a `package.json` named `azure-terraform-stacks-engine` | guard, agent step 3, spec "Command guard" |
| B1 (cycle 2) | A tilde inside quotes bypassed the guard: its tokenizer removed the quotes, the shell does not expand a quoted `~`, so `node "~/.claude/..."` ran a hostile `./~/.claude/...` from the repository | **Fix the class**: the guard no longer models quoting. Any quote or backslash denies the command; a `~` is accepted only as the first character of an unquoted word followed by `/`; the same rules apply to the engine, `--root`, `--prefix` and the arguments of `ls -d` and `test`. A differential test runs a corpus of approved and hostile commands through the real `bash` and requires that, for every command the guard approves, the paths it resolved equal the argv the shell delivered (skipped on Windows). Also: `cwd` must be absolute and exist, `--root` with `..` is denied, and only the engine file itself is trusted (not any file under the trusted folder). A path with a space is no longer supported | guard, agent prompt, spec "Command guard" |
| I3 | `agent_type` may carry a namespace in a plugin | **No change now**: the comparison stays strict (`=== "stacks-auditor"`). Task 6.1 (live session, maintainer) confirms the real format; if it differs, the comparison changes then | tasks 6.1 |
| (merge) | Pull request #20 (context budgets) is in `main` | Merged `origin/main` (no rebase); only `docs/aep/context-budgets.json` was revised, by the documented rule, as initial values for the maintainer | below |

*What npm reads with `--prefix`.* Checked with npm 10.9.9 on Linux: with `--prefix <dir>`, npm took its project configuration from `<dir>`, not from the working directory, so a `.npmrc` in the audited repository (`registry=`, `prefix=`, ...) was not applied (`npm config get registry --prefix <dir>` printed the default registry, and `npm ci --prefix` installed from the lockfile). Without `--prefix`, the working directory's `.npmrc` is read, which is why the old form is gone. The user's own `~/.npmrc`, the global configuration and `npm_config_*` environment variables still apply: they belong to the user, not to the audited repository, and the guard cannot see them. The exact-match rule denies `--userconfig`, `--globalconfig`, `--registry`, `--foreground-scripts`, `--ignore-scripts=false` and any other argument, and `--ignore-scripts` stays. The lockfile's integrity hashes cover the downloaded packages. Not verified on Windows and macOS.

*Residual risks after I1 and I2* (these replace the earlier open risk "engine inside the audited repository"):
- A link in a user skills folder is trusted by its resolved path. A user who links `~/.claude/skills/azure-terraform-stacks` to a checkout they audit gets it denied only when that checkout is the working directory or `--root`; a link to another place is the user's choice.
- When the plugin itself is inside the working directory (for example developing it with `--plugin-dir` inside the audited repository, or running from the home folder, which contains every user folder) the engine is denied: run the audit from the repository, with the plugin installed outside it.
- A project-scope install of the skill (`agent-skills add ... --scope project`) is no longer used by the auditor; the CLI's user scope or the marketplace is needed.
- The guard compares real paths; a race (a path swapped between the check and the run) is not handled. Plugin hooks and Node are trusted code on the user's machine.
- The audited repository can still contain text that misleads the model; the guard limits what the model can then run.

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
- *(c) Remove the engine and audit with `Read`, `Grep` and `Glob`.* A real read-only tool set, installable everywhere without a flag (Cursor `readonly: true`, Codex excepted). Rejected: the archived change and the current spec require the engine ("Do not audit by reading files by hand"), the engine's findings carry deterministic `file:line` evidence that the graph convention needs, and a model reading a Terraform repository by hand is the less reliable audit. It remains the fallback if the maintainer decides that no `Bash` is acceptable (decision 1); it would then drop the `audit` step, the `npm ci` exception and most of this change.

**Chosen: (a) with layers, using (b) as the only allowed command.** The agent file loses `disallowedTools`; the plugin gains the guard; the prompt rules stay; the documentation and the agent text say that the promise is **"does not write by design and by guard", not "cannot write"**. The old spec scenario "Bash is the residual risk" is kept and strengthened.

**2. The guard is an allowlist, and it is small.** `hooks/hooks.json` registers a `PreToolUse` hook with matcher `Bash`, running `node "${CLAUDE_PLUGIN_ROOT}/hooks/stacks-auditor-guard.mjs"`. The script reads the hook input; when `agent_type` is not `stacks-auditor` it exits 0 at once (the hook also runs in the main conversation and in every other agent, and must not touch them). Otherwise it allows only these command shapes and exits 2 with a reason for anything else:

1. `ls -d <paths>`: the engine lookup (one call, see Decision 3).
2. `test -f <path>`, `test -d <path>`.
3. `node --version`.
4. `node <engine> audit [--root <path>] [--json]` (no other subcommand: `scaffold`, `add-stack`, `bridge` and `diagram` write files). **`<engine>` must be a trusted copy** (maintainer decision 2026-11-24, below): its real path is the plugin's own engine or one in a user skills folder, never inside the working directory or the audited `--root`.
5. `npm ci --prefix <skill folder> --omit=dev --ignore-scripts`, in this order and with no other argument, for the same two trusted origins (maintainer decision 2026-11-24, below); the earlier form that depended on the guard's `cwd` is removed because the subagent's `cwd` is the project, not the skill, and `cd` is not allowed.
6. ~~`git -c core.fsmonitor=false status --porcelain`~~ **Dropped by task 2.4 (2026-11-23, git 2.x on Linux).** In a repository whose `.git/config` sets `filter.<name>.clean` and whose `.gitattributes` selects it, `git -c core.fsmonitor=false status --porcelain` ran the filter's program (a file was created), so turning fsmonitor off is not enough. No `git` command is allowed; the closing line "No file in the repository was changed." rests on the allowlist and on `audit` writing nothing, and the agent says what happened instead when a command was denied. Original text: the closing "no file changed" check; `git log` and `git diff` are not allowed for the same reason.

Any command containing a newline or one of `; & | < > ` $ ( ) { }` is denied before matching, so redirects, pipes, substitutions and chaining never reach the matcher. `Read`, `Grep` and `Glob` are not hooked (the tools list already excludes `Write`, `Edit` and `NotebookEdit`). The script has no dependency beyond Node 20, which the engine needs anyway. The allowed shapes are the same list the prompt gives, and a test fails when the two differ.

*Status:* hook approved by the maintainer (2026-11-23), conditional. **Plan B**, if the live tests fail: remove `hooks/` from the plugin (tasks 2.x become documentation only), document `permissions.deny` with the snippet, and keep the prompt rules and the read-only engine command. The guard's allowed `npm ci` shape is `npm ci --omit=dev --ignore-scripts` (maintainer: `--ignore-scripts` where applicable; it applies here because `yaml@2.9.1` has no install script, `hasInstallScript` appears nowhere in the engine's `package-lock.json`; task 2.5 confirms the install still works).

*Alternatives:* a denylist hook (rejected: unbounded); only documentation (now plan B); shipping the hook to all agents of the plugin (rejected: it must stay a no-op for everything except this agent).

**3. Engine discovery: by skill name over every supported harness.** One `ls -d` call lists, in this order, every candidate and the prompt uses the first that exists: the plugin path when the variable was substituted; then `~/.claude/skills`, `~/.agents/skills`, `~/.gemini/skills`, `~/.cursor/skills`, `~/.copilot/skills`, each followed by `azure-terraform-stacks/scripts/stacks.mjs`. (Revised 2026-11-24: the project-scope folders `<repo>/.claude/skills` and the like were dropped, because they are inside the untrusted audited repository.) This is the set of `user` folders in `src/lib/tools.mjs`, kept once in the guard (`USER_SKILL_FOLDERS`); a test reads that file and fails when the guard's or the agent's list differs, so adding a tool to the CLI cannot silently break the agent. The prompt says "your shell tool" instead of naming `Bash`, since the converted agent runs in tools whose shell has another name. Not covered: relocated configuration folders (`COPILOT_HOME`), as in `add-custom-agents`; the user is told to pass the engine's path. The preloaded skill (`skills:`) does not tell the agent where its folder is (not verified either way), so the list stays.

**4. `skills: [azure-terraform-stacks]`.** Added; approved 2026-11-23. Two costs, accepted and recorded:

- *Tokens.* The full `SKILL.md` enters the subagent's context at startup. Sizes read from the repository on 2026-11-23: `SKILL.md` 12,258 bytes, 115 lines, 1,809 words; `agents/stacks-auditor.md` 6,422 bytes; `references/` 33,404 bytes, loaded on demand (not preloaded). By **bytes divided by 4** that is about 3,000 tokens for `SKILL.md` and about 1,600 for the agent file. **This is an estimate, not a measurement with a tokenizer**, and it may be low: the vendor says Claude 4.7 and later models use a tokenizer that yields about 30 percent more tokens than earlier models for the same text. The real count must be taken with the method under "Token counting" (task 5.2) and written next to the method used.
- *Writing commands in context.* The preloaded `SKILL.md` describes commands that write (`scaffold`, `add-stack`, `bridge`, `diagram`). Only the prompt's rules and the guard (Claude Code only) prevent the auditor from using them; the skill text is not trusted to do so. Attention point, repeated in Risks.

*Budget.* A test fails when the offline estimate of the preloaded `SKILL.md` exceeds a declared budget (task 5.1; requirement "Preloaded skill budget"). The first value proposed is 3,500 estimated tokens (about 14,000 bytes), about 14 percent above today's estimate; the maintainer fixes it after task 5.2 gives the real count. The estimate is the bytes-over-4 rule, rounded up, in plain Node, labeled everywhere as an approximation. It is a growth guard, not a measurement, and no dependency is added. Context budgets of `docs/aep/context-budgets.json` (pull request #20), revised 2026-11-24 by their documented rule (estimate x 1.3 x 1.10, rounded up to 500; initial values for the maintainer): `skill:azure-terraform-stacks` 4500 -> 5000 (SKILL.md about 3,472 estimated tokens) and `agent:stacks-auditor` 2500 -> 9000 (agent plus the preloaded skill, about 5,982 estimated tokens). They are separate from the 3,500 growth guard of task 5.1, which is unchanged.

**5. The verifier is code, inside the engine.** `audit` already produces `file`, `line` and `message` per finding. A last step in `audit` checks, for each finding, that the real path of `file` is inside the audited root (no `..`, no symbolic link that leaves it) and that `line`, when present, is an integer between 1 and the number of lines of that file. Findings that fail go to an `unverified` list with the reason, are not counted in the summary or the exit code, and are printed under "Not verified". The model's step 5 (re-reading the cited line to confirm the finding means what the engine says) stays as a *model* node after the code node, because it checks meaning, which code cannot. Findings have no excerpt today, so the excerpt-on-line check of the convention is not applicable; adding excerpts is not part of this change.

**6. The `npm ci` exception stays, and removing it is a separate future change.** It is the one write outside the audited repository, and the guard allows it only in the skill's folder, as `npm ci --omit=dev --ignore-scripts`. Approved by the maintainer on 2026-11-23 as a **follow-up change, suggested name `vendor-stacks-engine-yaml`**, to be proposed after this one is applied; it is **not** part of this change and this change does not touch the engine's dependency.

*Rationale for the follow-up:* it removes a write outside the audited repository (the one exception of the allowlist), removes network access at first run, and shrinks the guard's allowlist (no `npm`, no `cwd` rule). *To verify before that change is approved:* the license of `yaml` (the lockfile says ISC for 2.9.1, to be confirmed against the package's own `LICENSE` and the notice that a vendored copy must carry); the size of the embedded file (a bundled single-file build, measured, against the size of the skill today); integrity by hash (the build's source, version and a recorded SHA-256 of the file, checked by a test, so the vendored copy cannot drift from `yaml@2.9.1`); how updates are made; and that the engine's tests still pass on Node 20 on Linux, macOS and Windows.

## Token counting

Asked by the maintainer: use a tokenizer to measure the preloaded text. What was read on 2026-11-23, and what was not.

**Read in full:**
- Anthropic, "Token counting", https://platform.claude.com/docs/en/build-with-claude/token-counting. The `POST /v1/messages/count_tokens` endpoint (SDK `messages.countTokens`, CLI `ant messages count-tokens`) takes the same structured input as message creation and returns `input_tokens`. Every example sends `x-api-key: $ANTHROPIC_API_KEY`, so **an API key is needed**. It is "free to use" but subject to requests-per-minute limits by usage tier (5,000 Start, 10,000 Build, 20,000 Scale). The page says the count "is an **estimate**" that can differ "by a small amount" from the real input tokens, and may include system-added tokens that are not billed. All active models are supported. Claude 4.7 and later models "use a newer tokenizer", with "approximately 30 percent more tokens" for the same text than earlier models, and the page says to "recount prompts against the model you plan to use rather than reusing counts measured against earlier models". The endpoint counts under the tokenizer of the `model` passed.
- Anthropic, `anthropic-tokenizer-typescript` (the repository of the npm package `@anthropic-ai/tokenizer`), https://github.com/anthropics/anthropic-tokenizer-typescript. Its README says: "This package can be used to count tokens for Anthropic's older models. As of the Claude 3 models, this algorithm is no longer accurate, but can be used as a very rough approximation. We suggest that you rely on `usage` in the response body wherever possible." The repository is archived (read-only) as of 2026-09-01, per the page. So **no offline tokenizer exists for the current models**; the offline package is, in the vendor's words, a "very rough approximation" even for Claude 3.

**Not read:** the npm registry page of `@anthropic-ai/tokenizer` (the fetch returned HTTP 403; the README above is the repository's, which the package publishes, not confirmed byte for byte); the API reference page of the endpoint (`https://platform.claude.com/docs/en/api/messages/count_tokens`, linked from the page above) and the rate-limits page; no count was made in this session (no key, and this change implements nothing).

**Method adopted:**
1. *Official count* (task 5.2): `POST /v1/messages/count_tokens` with the text as the system prompt or a user message, for the model the auditor will run on, by the maintainer or in an environment that has a key. Record the model, date, method and `input_tokens` next to the estimate, and recount when the model changes. The agent file and the preloaded `SKILL.md` are counted separately and together.
2. *CI without a key* (task 5.1): the offline estimate, bytes over 4, labeled as an approximation, as a growth guard only. `@anthropic-ai/tokenizer` is not used: it is unmaintained, inaccurate for current models by the vendor's own words, and would be a new dependency, which the maintainer excluded.

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
| `no-change-check` | model | the commands it ran and any denial | the closing line, or what happened instead | none (git is not allowed: task 2.4) | end |

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
- [`git status` runs repository-configured programs] verified by task 2.4: `-c core.fsmonitor=false` did not stop a clean filter, so git is not allowed at all.
- [The skill's content is preloaded] cost in tokens (estimated, to be measured; guarded by a budget test) and text that describes writing commands; only the prompt and the guard stop their use.
- [The two unverified hook items] `agent_type` in the `PreToolUse` input and `${CLAUDE_PLUGIN_ROOT}` in `hooks/hooks.json`. If either fails in the live tests, plan B applies (documentation of `permissions.deny` only) and the agent's text, `SKILL.md` and README are written for that case.
- [Behavior change for CLI users] Cursor now refuses the agent without `--allow-broader-access`, because `Bash` is not read-only; Codex always did. Accepted by the maintainer (2026-11-23); this is the intended outcome of `add-custom-agents`' rule (`restrictionFor` in `src/lib/agents/permissions.mjs`) and is stated in the pull request and the README.
- [Documentation drift] The `Bash` specifier behavior and hook input are read from vendor pages that change; tasks 6.1 and 6.2 re-check them in a live session before release.

## Release

A prerequisite of the release of the agents CLI, not of a merge (decision 7, 2026-11-23). `add-custom-agents` is already in `main` (pull request #18, `package.json` 0.5.0). Recorded here and in the pull request. This change touches no version (`plugin.json` 0.2.0, `package.json`), creates no tag and publishes nothing; the maintainer's version gate (`define-aep-delivery-graph`, gate 2) stays as the only way to a release.

## Open questions

Questions 1 to 5 and the dependency question were resolved by the maintainer on 2026-11-23 and moved to "Decisions". One remains:

1. The `confirm-reading` bound of 30 findings: acceptable? (Proposed value, not decided.)
