# azure-waf-review engine (incubating)

Catalog and deterministic collector of the future `azure-waf-review` skill. OpenSpec change `add-azure-waf-review-agent`, **PR 1a**.

This folder is **not a plugin and not a skill yet**, on purpose: `scripts/validate-skills.mjs` requires a `SKILL.md` in every `plugins/*/skills/*` folder and a marketplace entry for every `plugins/*` folder, and `test/prompt-examples.test.mjs` discovers skills by their `SKILL.md`. A skill without its example prompts (PR 3) or a marketplace entry for an unfinished plugin would either fail the checks or expose an incomplete plugin to installs. The layout mirrors the future skill folder (`scripts/`, `catalog/`, `test/`), so PR 3 moves it with `git mv` and adds `SKILL.md`, `references/` and the plugin manifest.

What is here: the check catalog (`catalog/`), `scripts/waf.mjs` (`plan`, `collect`, `seal-check`, `coverage`, `questionnaire`, `map`, `status`), the synthetic tenant "Contoso Exemplo" (`test/fixtures/contoso-exemplo/`) and the tests (`npm test`, Node 20 or later, no dependencies).

What is not here (PR 1b): `consent`, the stage and identity checks, `cap-check`, `render`, `reverify`, `purge`. Without them `plan` and `collect` run only with `--fixtures`: nothing in this folder reads a real tenant, and no run on one happens before PR 1b is merged.

## Limits you should know

- `kql.mjs` is an allowlist, not a KQL parser: what may be written into the evidence is the reviewed list of scalar paths in `catalog/scalar-paths.json` plus the `source` each output field declares. A `where` may read any column.
- Tag values are **pseudonymized**, not redacted: a 32-bit hash salted with the run id, which is in `run.json`. It keeps the model from reading the text; it does not keep a name secret.
- `seal-check` is tamper-evident (hash checks), not tamper-proof against someone who can rewrite the manifest and `run.json` together.
- The run folder is created `0700`/`0600` on POSIX. On Windows the ACL is not verified and nothing is promised. The production transport does not run on native Windows in this build (fails closed); WSL Ubuntu is the main platform, native Windows is manual test M-10.
- The 18 `arg` queries, and above all the three `leftouter` joins (string marker plus `isempty`, `on` with the same column name), are valid **by documentation only** and were never run against Resource Graph (manual test M-3). `isnull()` of a string is always false in Kusto; the validator refuses it.
- A `where` may read any column, so a count can still act as an oracle; the allowlist limits only what is written.
- `summary/*.md` are not sealed (only their names are checked) and there is no write guard in this build.
