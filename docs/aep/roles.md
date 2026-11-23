# Roles of the delivery graph

Instructions for the four roles of the [delivery graph](delivery-graph.md). They apply to any agent or person acting in a role. **These are instructions, not guarantees**: they are enforced only as far as tool allowlists, CI and repository settings enforce them (see the enforcement table in the graph page). Packaging the roles as installable subagents is a future change, with a trigger, recorded in the graph page.

Rules for every role:

- Work only on a branch named `claude/<change-name>` and push only such a branch. Never push to `main` and never force-push it.
- Open the pull request as a **draft**. A pull request leaves draft only after `test-and-validate` passes, and marking it ready does not authorize merge.
- Use Conventional Commits.
- Make a claim only with evidence (`file:line`, or a command and its output). A claim without evidence is dropped or listed as "not verified" and does not count toward a verdict, a merge or a release.
- Never edit the repository ruleset, the CodeQL setup or `.github/workflows/publish.yml` to get around a gate. If a task needs a permission the role does not have, stop and escalate.
- Never bump the version, create a tag or publish without the maintainer's explicit OK that names the version (human gate 2).

## Proposal author (node `propose`)

- **Inputs:** the maintainer's request and the output of `explore`, if any.
- **May write:** only `openspec/changes/<name>/` (proposal, design, specs, tasks, `.openspec.yaml`).
- **Must not:** edit code, `README.md`, `.claude-plugin/marketplace.json` or `package.json`; start `apply` before gate 1 is recorded.
- **Output:** a change that passes `openspec validate <name> --strict --no-interactive` and `node scripts/delivery-check.mjs scope <name>`, on a draft pull request. If validation fails, go back and fix it (at most 3 cycles for this loop), then escalate.
- If the change adds or modifies an agent or a skill, `design.md` includes the level 2 graph section.

## Implementer (node `apply`)

- **Inputs:** the approved proposal (gate 1 is recorded on its pull request), `tasks.md`, and the reviewer's reservations if this is a repeated cycle.
- **May write:** the worktree of its own change, on `claude/<name>`, after gate 1.
- **Must not:** merge, tag, publish, bump the version, or push to `main`.
- **Steps:** implement the tasks in order, tick a task in `tasks.md` only when it is done and verified, run `node scripts/validate-skills.mjs`, `npm test` and `npx --yes @fission-ai/openspec@1.7.0 validate --all --strict --no-interactive`, and fix failures. Each failed run or reserved review increases the single cycle counter (`cycle:1` to `cycle:3`).
- After the third failed or reserved cycle, stop and escalate. Do not start a fourth cycle without the maintainer's recorded instruction.
- **Asked to bump or tag:** refuse and point to human gate 2.
- **Rebase:** rebase on the current `main` before merge. Resolve a mechanical conflict in a shared file (two catalog rows, two plugin entries) and re-run the checks. If the conflict changes the meaning of the file, escalate instead of choosing a side.

## Reviewer (node `review`)

- **Inputs:** the diff, the change's specs, `tasks.md` and the checks' output. Nothing else is needed.
- **Independence:** a fresh context, with no part in `propose` or `apply` for this change. It never reviews its own work.
- **Must not:** edit, create or delete files, commit, push, merge or change labels' meaning.
- **Verdict format.** Exactly one of `approved` or `changes-requested`, as a pull request label (`review:approved` or `review:changes-requested`) and a comment with this shape:

  ```
  Verdict: changes-requested
  Cycle: 2 of 3
  Reservations (each with evidence):
  1. <what is wrong> - <path/to/file>:<line>
  2. <what is wrong> - command `<command>` -> <relevant output>
  Not verified (do not block):
  - <claim without evidence> - missing: <what evidence>
  ```

  Every reservation cites `file:line` or a command and its output. A reservation without evidence is discarded or listed under "Not verified" and does not block the change by itself. Check the output with `node scripts/delivery-check.mjs evidence <file>` when the report is a file.
- **Always a reservation:** a task ticked as done with no matching change; a feature or fix change that edits the `version` field of `package.json`; a proposal for an agent or skill without the level 2 graph section (cite the `design.md` path); a file changed outside the change's scope.
- A human `Request changes` review always wins over the label.

### Tool allowlist and deny list for the reviewer

Following the `stacks-auditor` precedent (`plugins/azure-terraform-stacks/agents/stacks-auditor.md`): the allowlist has read and search tools plus read-only shell, and a deny list removes what must not run.

Allowlist:

- `Read`
- `Grep`
- `Glob`
- `Bash` restricted to read-only commands: `git diff`, `git log`, `git show`, `git status`, `node scripts/delivery-check.mjs`, `node scripts/validate-skills.mjs`, `npm test` and `openspec validate`

Deny list:

- `Edit`, `Write`, `NotebookEdit`
- `Bash(git add *)`, `Bash(git commit *)`, `Bash(git push *)`, `Bash(git merge *)`, `Bash(git checkout *)`, `Bash(git reset *)`, `Bash(git rebase *)`
- `Bash(gh *)`, `Bash(rm *)`, `Bash(mv *)`, `Bash(openspec archive *)`

The allowlist contains no tool that writes files, commits, pushes or merges. **A deny list is not a hard guarantee.** An allowlist without `Write` or `Edit` does not stop `Bash` from changing files (a redirection, an editor, a script), and in Claude Code a `disallowedTools` entry with a specifier removes the whole tool. "Read-only" for the reviewer is therefore an allowlist, a deny list and an instruction, backed by the scope check and CI, and only repository settings give a hard guarantee.

## Integrator (nodes `merge`, `archive`, `release-queue`)

- **Merges only when all of these hold:**
  1. the reviewer's verdict is `approved`;
  2. every required CI check is green;
  3. the cycle limit has not been exhausted (no `needs:maintainer`);
  4. the pull request has no unresolved human request for changes;
  5. the branch is rebased on the current `main`.
- **Then:** merge, and run `openspec archive <name>` so the delta moves into `openspec/specs/`, without further approval. Add the change to the release queue (the list of merged changes since the last tag, from `git log` and the archived changes).
- **If any condition fails:** do not merge, and report which condition failed. CI red sends the change back to `apply`. A human request for changes blocks the merge whatever the verdict says.
- **Must not:** write code, bump the version, create a tag, or trigger the publish workflow.
- The verdict is read from the label and the comment together, and the integrator checks who wrote the comment, because anyone with write access can set a label.

## Escalation message

Stop agent work and tell the maintainer when: a cycle limit is exhausted; a rebase conflict is not mechanical; CI is red for a reason outside the change; a role would need a permission it does not have; or evidence for a claim cannot be produced. Set the label `needs:maintainer` on the pull request and post:

```
Escalation
Node: <node>
Cycle: <n> of 3
Unresolved items:
1. <item> - evidence: <path/to/file>:<line> or `<command>` -> <output>
Options:
- another cycle (maintainer instructs, recorded here)
- narrow the scope
- abandon the change
```

If the maintainer asks for another cycle, the graph resumes at `apply` and the instruction stays on the pull request as the record.

## GitHub identity of the roles (state today)

At the time of writing the agents act under the maintainer's GitHub identity, which is an administrator. That is why the verdict is a label and a comment (a pull request author cannot approve it with a native review), and why the repository rules prevent accidents and shortcuts but not a hostile agent. Which identity the integrator uses, and whether it can push a tag, is the maintainer's decision and is **not recorded yet**: see [repository protection](repository-protection.md). A separate identity for the agents is a recommended future change and a condition for any release automation.
