# azure-waf-review engine (incubating)

Catalog and deterministic collector of the future `azure-waf-review` skill. OpenSpec change `add-azure-waf-review-agent`, **PR 1a and PR 1b** (the production controls).

This folder is **not a plugin and not a skill yet**, on purpose: `scripts/validate-skills.mjs` requires a `SKILL.md` in every `plugins/*/skills/*` folder and a marketplace entry for every `plugins/*` folder, and `test/prompt-examples.test.mjs` discovers skills by their `SKILL.md`. A skill without its example prompts (PR 3) or a marketplace entry for an unfinished plugin would either fail the checks or expose an incomplete plugin to installs. The layout mirrors the future skill folder (`scripts/`, `catalog/`, `test/`), so PR 3 moves it with `git mv` and adds `SKILL.md`, `references/` and the plugin manifest.

What is here: the check catalog (`catalog/`), `scripts/waf.mjs` (`consent`, `plan`, `collect`, `seal-check`, `coverage`, `questionnaire`, `map`, `cap-check`, `render`, `status`, `reverify`, `purge`), the synthetic tenant "Contoso Exemplo" (`test/fixtures/contoso-exemplo/`) and the tests (`npm test`, Node 20 or later, no dependencies).

## Who runs what

- **The user, in their own terminal** (stdin and stdout must be a TTY; piped answers are refused): `consent`, `reverify`, `purge`. `consent` reads the identity and the subscriptions, shows a screen, and writes `waf-review/<id>/consent.json` only after typed confirmations. Nothing else sets the stage, the scope, the redaction level or the query budget.
- **The agent**: `plan --run-id <id> [--pillars ...]`, `collect --run <id>`, `seal-check`, `map`, `coverage`, `questionnaire`, `cap-check`, `render`, `status --json`. Without `--fixtures`, `plan` and `collect` need a valid `consent.json` (hash of the shown text, derivable from its own fields, tied to `run.json` and to the manifest). `--fixtures` is for tests and documentation (synthetic tenant); a run folder with a `consent.json` is a production run and refuses it.
- `render` is the only render the guard of PR 4 will allow: `seal-check`, `cap-check`, `assess.mjs render --unreviewed` with constant arguments on a private snapshot of `assessment.json`, `seal-check` again, and only then the report is installed. A Critical finding is refused unless the user ran `reverify` for every sealed check it rests on.

Nothing in this folder starts `az` against a real tenant in CI or in the tests: the production transport is exercised only against a stub `az` (a Node script) and fixtures. No run on a real tenant happens before the user's smoke test (PR 5).

## Limits you should know

- `kql.mjs` is an allowlist, not a KQL parser: what may be written into the evidence is the reviewed list of scalar paths in `catalog/scalar-paths.json` plus the `source` each output field declares. A `where` may read any column.
- Tag values are **pseudonymized**, not redacted: a 32-bit hash salted with the run id, which is in `run.json`. It keeps the model from reading the text; it does not keep a name secret.
- `seal-check` is tamper-evident (hash checks), not tamper-proof against someone who can rewrite the manifest and `run.json` together.
- The run folder is created `0700`/`0600` on POSIX. On Windows the ACL is not verified and nothing is promised. The production transport does not run on native Windows in this build (fails closed); WSL Ubuntu is the main platform, native Windows is manual test M-10.
- The 18 `arg` queries, and above all the three `leftouter` joins (string marker plus `isempty`, `on` with the same column name), are valid **by documentation only** and were never run against Resource Graph (manual test M-3). `isnull()` of a string is always false in Kusto; the validator refuses it.
- A `where` may read any column, so a count can still act as an oracle; the allowlist limits only what is written.
- `summary/*.md` are sealed (hash in the manifest) and must equal what `collect` writes from the sealed data. There is still no write guard in this build: `collected/`, `consent.json`, `map.json` and `reverify/*.json` are tamper-evident, not tamper-proof, until the guard of PR 4 keeps the model from writing them.
- `consent.json` holds a hash of the text shown and the fields the text is built from; whoever can rewrite the whole file consistently can forge it. The manifest seals its hash after `collect`, so a later edit is seen.
- Role assignments that reach the identity through a group are not seen by the consent (it filters by the principal id): the identity is then reported as unverifiable and needs a typed acknowledgment, never "read-only".
- The three joins (`SE-GOV-001`, `RE-BKP-001`, `PE-ASP-001`) depend on a join whose right side has no documented size limit; the risk is marked (`joinRisk`) and not mitigated (task 1.14, manual test M-3).
- Native Windows is refused by `consent` (the production transport fails closed there); the `az` of Windows seen from WSL is refused too, with no acknowledgment. Manual test M-10.
