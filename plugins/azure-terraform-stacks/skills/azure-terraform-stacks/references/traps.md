# Traps and the rules that catch them

From the two articles' "traps" sections and the 2026-11-22 code review (design Decision 15 of the OpenSpec change).

| Trap | What happens | Rule or guardrail |
|---|---|---|
| State key drifts from the naming | Two stacks share a blob, or nobody knows what a blob holds | `state-key` |
| Backend values inline | Different environments write the same state | `backend-partial` |
| Conditional `dependsOn` missing | Validation fails, or a stack runs before its dependency | `pipeline-deps` |
| <a id="destroy-in-production"></a>`destroy` offered with prod | One click removes the database | `no-prod-destroy`; never generated |
| <a id="who-can-click-run"></a>Triggered runs | A push runs with the defaults | `manual-trigger` (`trigger: none`, only `workflow_dispatch`) |
| <a id="partial-selection"></a>Partial selection on a stale base | Plan runs on an outdated dependency | `plan-default` (plan by default, booleans false); schedule a `plan` of everything to detect drift |
| Stored credentials | Secrets leak through logs and Git | `oidc` |
| Subject mismatch | The pod cannot read Key Vault | `wi-subject` |
| Auto-sync in prod | Merges deploy without the manual sync step | `argocd-prod-sync` |
| No finalizer, or one you did not decide on | Deleting an Application leaves or removes resources unexpectedly | `argocd-finalizer` |
| Unpinned Argo CD | A run installs a different version | `argocd-pinned` |
| Bootstrap on a plan run | A "plan" changes the cluster | `argocd-apply-only` |
| Terraform outputs never reach Git | Pods start without a database host or client ID | `bridge-placeholders` (pending) and `bridge` |
| Too many inputs | The GitHub workflow is rejected | `gha-inputs`, `check-manifest` |
| <a id="resource-groups"></a>Data sources read a resource group no stack creates | `plan` fails on a missing resource group | `rg-owned` |
| Old Terraform or provider | Backend OIDC on Azure DevOps or new attributes missing | `versions` |
| ALZ: Terraform fights Azure Policy over DNS | Endless diff on the zone group | `lz-dns-zone-group` |
| ALZ: local privatelink zones in a spoke | Split-brain DNS | `lz-no-local-privatelink-zone` |
| Hand edits to generated files | The next regeneration loses them | `drift` (warning) |
| Private network closes the pipeline's door | Microsoft-hosted agents cannot reach ACR, the API or the state | Self-hosted agents in the VNet (prerequisite) |
| Splitting too much | Twenty states, twenty dependencies | Split by lifecycle and owner (manifest review) |
| Parameters are not a vault | Values expand in logs | No secrets in parameters; Key Vault and OIDC |

## Which rules `audit` evaluates

`audit` (no manifest) runs the rules that need none and lists the others as not evaluated.

| Rule | `check` | `audit` |
|---|---|---|
| `backend-partial`, `versions`, `rg-owned`, `oidc` | yes | yes |
| `no-prod-destroy`, `manual-trigger`, `plan-default`, `gha-inputs`, `argocd-apply-only` | yes | yes, on pipelines that run Terraform; a boolean input is inferred to be a stack selector only when the pipeline also has a plan/apply input, and then only a warning |
| `argocd-finalizer`, `argocd-prod-sync`, `argocd-pinned` | yes | yes (an app of apps is not flagged for automated sync: what must wait in production are the Applications it creates) |
| `wi-subject` | yes | best effort, as a warning, from literals |
| `state-key`, `pipeline-params`, `pipeline-deps`, `lz-dns-zone-group`, `lz-no-local-privatelink-zone`, `drift`, `bridge-placeholders` | yes | **not evaluated**: need `infra/stacks.yaml` |
| `state-shared`, `state-local`, `state-unknown` | n/a | audit only |

`state-shared` is an error when two roots name the same key in the same storage account and container, all literal; it is a warning when the account or container is not stated or the key was inferred from a script.

### Not verified findings

Before `audit` reports a finding it checks its evidence in code: the cited file must resolve inside the audited root (a `..` segment or a symbolic link that leaves the root fails, and the file is not read) and the cited line must exist. A finding that fails is not counted and is listed apart, under "Not verified" (text) or `unverified` (`--json`), with the reason. It is not a finding; nothing was confirmed about it. The auditor's own re-reading of the cited lines is a model check that comes after this code check.

### Never run the audited repository's own engine

The auditor runs `scripts/stacks.mjs` only from the plugin or from the user's skills folders (`~/.claude/skills`, `~/.agents/skills`, `~/.gemini/skills`, `~/.cursor/skills`, `~/.copilot/skills`). A copy of the skill inside the repository being audited (`.claude/skills/...`, `./azure-terraform-stacks/...`) is untrusted code: the auditor does not run it and reports that it exists, and on Claude Code the guard denies it. Install the skill at user scope for the auditor.

### What the auditor's guard does and does not do

- The guard applies only to the plugin's subagent (`agent_type` `azure-terraform-stacks:stacks-auditor`) and to the agent installed without the plugin (`stacks-auditor`), by exact match. Any other value is not touched. Plugin 0.2.0 compared only the short name, which Claude Code does not send for a plugin subagent, so on 0.2.0 the guard never applied. Until you have a release that contains the fix, add the `permissions.deny` rules from `SKILL.md` to your Claude Code settings and run the auditor on a read-only checkout or a copy, or do not use it. If Claude Code ever changes the format of `agent_type`, the guard becomes inert again without any sign: re-test it live (a denied `terraform --version`, an allowed `audit`) on each Claude Code version you use.
- It denies every command of the auditor when `HOME` is defined and is empty, relative or different from the home directory Node reports, because it cannot tell where `~` points; set `HOME` to the user's home directory and start the session again.
- On Windows the guard denies a backslash and a quote, so write paths with forward slashes in a shell such as Git Bash; the differential test against the real `bash` is skipped on Windows and the guard is not verified there.
- Not verified, Windows with Git Bash: if the `HOME` the hook receives is in POSIX form (`/c/Users/name`) while Node reports the home from `USERPROFILE`, the home check can deny every command of the auditor. That fails closed (the auditor is blocked and says why); no safe workaround is known, and the guard's behavior is not changed for it. On POSIX the "HOME differs from `os.homedir()`" branch is almost unreachable, because Node reads `HOME` first; there the check effectively catches an empty or relative `HOME`.
