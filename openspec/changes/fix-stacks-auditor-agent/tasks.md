## 1. Frontmatter and instructions

- [ ] 1.1 Edit `plugins/azure-terraform-stacks/agents/stacks-auditor.md`: `tools: Read, Grep, Glob, Bash`, remove `disallowedTools`, add `skills: [azure-terraform-stacks]`; replace the "Find the engine" step with the single `ls -d` lookup over the plugin path and the skills folders of all supported tools; say "your shell tool"; list the allowed command shapes; state the read-only limits honestly; add the "Not verified" report section. **How to verify:** `node scripts/validate-skills.mjs` passes (name, description, `tools`, `skills` resolves to an existing skill); read the file against the spec scenarios.
- [ ] 1.2 Update `test/agent.test.mjs` (it currently pins the defect): tools include `Bash` and exclude write tools, no `disallowedTools` entry has a specifier, effective tools include `Bash`, `skills` contains the skill, the engine paths list equals the folders in `src/lib/tools.mjs`, the plugin variable still appears once. **How to verify:** `npm test` in the skill folder passes, and fails when `Bash(rm *)` is added back to `disallowedTools` or a folder is removed from the agent's list (try both by hand once).
- [ ] 1.3 Check `add-custom-agents`' validation and conversion on the new file: effective tools `Read, Grep, Glob, Bash`; `agent-skills add stacks-auditor --tool gemini` and `--tool copilot` write the agent and the skill; `--tool cursor` and `--tool codex` are refused without `--allow-broader-access`. **How to verify:** run the CLI against a temporary home folder (`HOME=$(mktemp -d)`); record the output in the pull request.

## 2. Command guard

- [ ] 2.1 Add `plugins/azure-terraform-stacks/hooks/hooks.json` and `hooks/stacks-auditor-guard.mjs` per the spec. **How to verify:** `node scripts/validate-skills.mjs` still passes (confirm it does not reject a `hooks` folder in a plugin).
- [ ] 2.2 Guard tests, one per scenario of "Command guard", fed with hook-input JSON on stdin and asserting the exit code, plus bypass attempts (`;`, `&&`, `||`, `|`, `>`, `>>`, `<`, `$(`, backtick, newline, `node -e`, `node` with another subcommand, quoted metacharacters, `git status --porcelain` with extra options). **How to verify:** the tests are in the skill's test list and fail when a check in the script is removed.
- [ ] 2.3 Test that the shapes listed in the agent's instructions equal the shapes the guard allows. **How to verify:** change one side and see the test fail.
- [ ] 2.4 Determine whether `git -c core.fsmonitor=false status --porcelain` runs no program named in the audited repository's configuration (try a repository with `core.fsmonitor`, `diff.external` and a textconv driver set to a script that creates a file). **How to verify:** the result is recorded in the pull request; if the file is created, drop `git status` from the guard and the closing check uses the engine instead.

## 3. Engine evidence check

- [ ] 3.1 Add the check to `scripts/lib/audit.mjs` and print and return `unverified` (`--json` and text) in `scripts/stacks.mjs`. **How to verify:** existing `audit` tests and golden files still pass unchanged for repositories whose findings are all valid.
- [ ] 3.2 Tests for the scenarios of "Evidence verified by code" (line beyond the file, `..`, symbolic link out of the root, normal finding); the symlink test skips itself when creating the link fails with `EPERM` on Windows. **How to verify:** `npm test` in the skill folder on Linux and, through CI, on Windows and macOS.

## 4. Documentation

- [ ] 4.1 `SKILL.md` "Auditing an existing repository": remove the claim that `disallowedTools` filters commands and that the CLI installs skills only; describe the four layers, their limits, and the `permissions.deny` snippet (`Bash(terraform *)`, `Bash(kubectl *)`, `Bash(az *)`, `Bash(gh *)`, `Bash(git push *)`, `Bash(git commit *)`, `Bash(rm *)`, `Bash(mv *)`, `Bash(cp *)`, `Bash(tee *)`, `Bash(sed -i *)`), noting it also applies to the main conversation. **How to verify:** the text matches the "Bash is the residual risk" scenario.
- [ ] 4.2 `README.md` catalog row for `azure-terraform-stacks`: the subagent is installed by the marketplace or by the CLI, needs `--allow-broader-access` for Cursor and Codex, and the guard exists on Claude Code only. **How to verify:** the row is consistent with the CLI output from task 1.3.
- [ ] 4.3 `references/traps.md` (or equivalent): mention that findings failing the evidence check are listed as not verified. **How to verify:** grep for the word in the file.

## 5. Verification and release hand-off (no release here)

- [ ] 5.1 In a real Claude Code session, install the plugin from this branch and record in the pull request: (a) the agent's effective tools include `Bash`; (b) `${CLAUDE_PLUGIN_ROOT}` is substituted in the agent body and works in `hooks/hooks.json`; (c) the guard receives `agent_type: "stacks-auditor"` for the subagent's calls and not for the main conversation, blocks `terraform --version` and allows the audit; (d) the size of the preloaded skill text. **How to verify:** results written in the pull request; anything that does not hold changes the design (Decisions 2 and 3) before approval.
- [ ] 5.2 Run the auditor through the CLI install for Gemini CLI or Copilot (at least one) and confirm that it finds the engine in that tool's skills folder. **How to verify:** the result is recorded in the pull request; if it cannot be run, say so there.
- [ ] 5.3 Record in the pull request that this change must be applied before the release of the agents CLI, and add it to the maintainer's release queue. No version bump, tag or publish is part of this change. **How to verify:** `git diff origin/main --stat` shows no change to `package.json`, `plugin.json` or workflows.
- [ ] 5.4 `openspec validate fix-stacks-auditor-agent --strict --no-interactive` and `openspec validate --all --strict --no-interactive` pass. **How to verify:** both commands exit 0 on the final commit.
