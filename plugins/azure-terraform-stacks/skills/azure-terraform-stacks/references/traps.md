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

- The guard applies only to the plugin's subagent (`agent_type` `azure-terraform-stacks:stacks-auditor`) and to the agent installed without the plugin (`stacks-auditor`), by exact match. Any other value is not touched. Plugin 0.2.0 as published had no command guard (its restriction was the `disallowedTools` list and the prompt); the guard came with 0.3.0. On the development head of `main` for a few hours on 2026-11-24 it compared only the short name, which Claude Code does not send for a plugin subagent, so it never applied there; that is corrected. If you run 0.2.0 or installed from the head of `main` that day, update to 0.3.0 or later. If you cannot update, add the `permissions.deny` rules from `SKILL.md` to your Claude Code settings and run the auditor on a read-only checkout or a copy, or do not use it. If Claude Code ever changes the format of `agent_type`, the guard becomes inert again without any sign: re-test it live (a denied `terraform --version`, an allowed `audit`) on each Claude Code version you use.
- It denies every command of the auditor when `HOME` is defined and is empty, relative or different from the home directory Node reports, because it cannot tell where `~` points; set `HOME` to the user's home directory and start the session again.
- On Windows the guard denies a backslash and a quote, so write paths with forward slashes in a shell such as Git Bash; the guard's tests run on Windows in CI (Node 24) with forward-slash paths, but the differential test against the real `bash` is skipped there, so the guard's model of the shell is not verified on Windows.
- Not verified, Windows with Git Bash: if the `HOME` the hook receives is in POSIX form (`/c/Users/name`) while Node reports the home from `USERPROFILE`, the home check can deny every command of the auditor. That fails closed (the auditor is blocked and says why); no safe workaround is known, and the guard's behavior is not changed for it. On POSIX the "HOME differs from `os.homedir()`" branch is almost unreachable, because Node reads `HOME` first; there the check effectively catches an empty or relative `HOME`.

### The vendored `yaml` parser (no install step)

The engine's one dependency, the npm package `yaml`, is vendored in `scripts/vendor/yaml/`: the `dist/**/*.js` files of the published 2.9.1 tarball, its `package.json` and its ISC `LICENSE`, copied byte for byte. `scripts/vendor/yaml/PROVENANCE.json` records the tarball URL, its SHA-256 (`4ef6c54c...d5de`), its `sha512` integrity (the same string as `package-lock.json`) and the SHA-256 of every file. The engine reaches it only through `scripts/lib/yaml.mjs`, so nothing runs `npm`, and nothing needs the network.

- Check it: `node scripts/vendor-yaml.mjs verify` (offline) or `verify --registry` (downloads the recorded version into a new empty folder with `npm pack` and compares byte for byte; it runs nothing from the download). A changed byte, a missing or extra file, a version that differs from the lockfile, or a file saved with CRLF line endings all fail. The files are `-text` in `.gitattributes` for that reason.
- Update it: `node scripts/vendor-yaml.mjs update <version>` is the only writer (see CONTRIBUTING.md, "Updating the vendored yaml").
- The vendored copy is outside `npm audit` and Dependabot's reach, so `yaml` also stays a `devDependency` in `package.json` and `package-lock.json` (the oracle of the parity tests; nothing at run time reads it), and a weekly workflow (`vendor-watch`) checks the registry and the OSV advisory feed. A published advisory for the vendored version is a reason to run `update`.
- A copy of this skill from before the change (no `scripts/vendor/`) fails with `Cannot find package 'yaml'`. Update or reinstall the skill; the auditor never installs anything, and the guard of the release that contains this change denies `npm` for it (plugin 0.3.0 still allows `npm ci --prefix`). If you cannot update, run `npm ci --omit=dev --ignore-scripts` yourself in that copy's folder.
- `yaml` stops a flow collection nested past the call stack with a `YAMLParseError` (code `RESOURCE_EXHAUSTION`). In a scratch run on Node 22, a process that parsed such a collection 1,000 deep and then one 10,000 deep was aborted by V8 (exit status 134); whether it aborts depended on how the parser had been loaded, `audit` on a repository with both files did not abort, and the cause is not understood. The corpus tests run those inputs in child processes for that reason. This is the same with the npm package and with the vendored copy.
- Windows: the engine's full suite runs in CI on Windows with Node 24 (203 tests: 188 pass, 15 skipped with a stated reason: the `--open-pr` tests that stub `gh`/`az` with bash scripts, the differential tests against the real `bash`, and the parity tests that need `node_modules`). `scaffold` and `add-stack` failed on Windows before, because `scripts/lib/gen-terraform.mjs` turned a file URL into a path with `.pathname` (`/D:/a/...`); that is fixed (change `fix-engine-windows-paths`), in a plugin release after 0.3.0 (the version is not decided here). Not run: Windows with Node 20 or 22, and macOS, for the engine.
- Not verified, Windows: `bridge --open-pr` with Azure Repos may not work, because `az` is a `.cmd` file and `scripts/lib/bridge.mjs` calls `spawnSync` without a shell (`gh.exe` should work). Not tried and not fixed; the four `--open-pr` tests are skipped on Windows.
