# azure-waf-review engine (incubating)

Catalog and deterministic collector of the future `azure-waf-review` skill. OpenSpec change `add-azure-waf-review-agent`, **PR 1a**.

This folder is **not a plugin and not a skill yet**, on purpose: `scripts/validate-skills.mjs` requires a `SKILL.md` in every `plugins/*/skills/*` folder and a marketplace entry for every `plugins/*` folder, and `test/prompt-examples.test.mjs` discovers skills by their `SKILL.md`. A skill without its example prompts (PR 3) or a marketplace entry for an unfinished plugin would either fail the checks or expose an incomplete plugin to installs. The layout mirrors the future skill folder (`scripts/`, `catalog/`, `test/`), so PR 3 moves it with `git mv` and adds `SKILL.md`, `references/` and the plugin manifest.

What is here: the check catalog (`catalog/`), `scripts/waf.mjs` (`plan`, `collect`, `seal-check`, `coverage`, `questionnaire`, `map`, `status`), the synthetic tenant "Contoso Exemplo" (`test/fixtures/contoso-exemplo/`) and the tests (`npm test`, Node 20 or later, no dependencies).

What is not here (PR 1b): `consent`, the stage and identity checks, `cap-check`, `render`, `reverify`, `purge`. Without them `plan` and `collect` run only with `--fixtures`: nothing in this folder reads a real tenant, and no run on one happens before PR 1b is merged.
