## Context

The repo has no `package.json` yet. Skills live in `plugins/<plugin>/skills/<skill>/`, the Claude Code marketplace is `.claude-plugin/marketplace.json`, and `scripts/validate-skills.mjs` (no dependencies) checks skill format in CI. Motivation and scope: see `proposal.md`. Required behavior: see `specs/cli-installer/spec.md`.

Skills folders per agent were checked against each vendor's docs on 2026-11-19:
- Codex reads `.agents/skills` (repo) and `~/.agents/skills` (user); older docs also mention `~/.codex/skills`.
- Gemini CLI reads `.gemini/skills` / `~/.gemini/skills`, with `.agents/skills` as an alias. Skills may need to be enabled in its settings.
- Cursor reads `.cursor/skills` / `~/.cursor/skills`, and also `.claude/skills` and `.codex/skills`.
- Copilot reads `.github/skills` / `~/.copilot/skills`, and also `.claude/skills` and `.agents/skills`.

## Goals / Non-Goals

**Goals:**
- One small, dependency-free CLI that works through `npx`.
- The per-agent path map lives in one data module, so adding an agent or fixing a path is a one-line change plus a test.

**Non-Goals:**
- A plugin system, config file or registry beyond what is bundled in the package.

## Decisions

**1. The repo root is the npm package.** `package.json` at the root, with `files` limited to `bin/`, `src/`, `plugins/*/skills/**`, `README.md` and `LICENSE`. This way the published package bundles exactly the skills in the tagged commit, with no copy step.
*Alternative:* a separate `packages/cli` workspace with a build step that copies skills in. Rejected because it adds a second source of truth and a build for no benefit at this size.

**2. No runtime dependencies, with a small built-in checkbox prompt.** Use `node:util` `parseArgs` for flags and `node:fs` `cpSync`/`rmSync` for copying and removing. The selection lists (spec "Interactive selection") are a small module `src/cli/prompt.mjs` built on `node:readline` `emitKeypressEvents` and raw mode: arrow keys move, space toggles, `a` toggles all, enter confirms, Ctrl+C cancels, and long lists scroll inside the terminal height. It is about 150 lines and is tested by feeding keypress sequences to a fake stdin. This matches `validate-skills.mjs`, keeps `npx` fast, and removes supply-chain risk.
*Alternative:* `@inquirer/prompts` (`checkbox`, `select`, `confirm`). Better tested and handles more terminals, but adds a dependency tree to every `npx` run. If the built-in prompt turns out fragile on some terminal (for example Windows `cmd`), switching to it only touches `prompt.mjs`.

**2b. Order of questions.** Skills, then agents, then scope, then a confirmation summary (`Install 2 skills for claude, cursor at user scope: <paths>. Continue?`). Each question is skipped when its flag is given. Picking skills first matches the user's intent ("I want this skill"). For `remove`, the agents and scope come first and the skills list comes last, because it only shows skills installed in those folders.

**3. Each agent installs into its own native folder.** Even though Cursor and Copilot also read `.claude/skills`, and Gemini reads `.agents/skills`, the CLI writes to each agent's own folder (the table in the spec). Writing to a shared folder would make `remove --agent cursor` affect Claude Code too. If two selected agents map to the same folder (not the case today), the copy happens once.
*Trade-off:* a user who installs for both `claude` and `copilot` gets two copies, and Copilot may list the skill twice. The CLI prints a note when it detects an overlap like this, and the README explains it.

**4. Install marker.** `add` writes `.agent-skills.json` (`{ "package": "@frcloudsolutions/agent-skills", "version": "<x.y.z>", "skill": "<name>", "installedAt": "<ISO date>" }`) inside the installed folder. `remove` deletes only folders that contain it. Agents ignore files other than `SKILL.md` and the files it references, so the marker is harmless.

**5. Skill lookup by name.** At startup the CLI scans `plugins/*/skills/*/SKILL.md` relative to its own package root and reads the frontmatter with the same parser as the validator. To share it, the parser moves to `src/lib/frontmatter.mjs`, imported by both. Uniqueness is guaranteed by validation (spec `skill-catalog`), so the lookup is a plain map.

**6. Output and exit codes.** Human-readable output goes to stdout by default. With `--json`, stdout holds one JSON object (`{ ok, results: [{ agent, path, status: "installed"|"skipped"|"removed"|"would-install"|..., message? }] }`) and all messages go to stderr. Exit code 0 means everything succeeded, 1 means an operation failed or was skipped, 2 means a usage error (unknown flag, agent or skill).

**7. Release.** Tag `vX.Y.Z` triggers `.github/workflows/publish.yml`: run validation and tests, check that the tag matches `package.json` `version`, then `npm publish --provenance --access public`. Use npm trusted publishing (OIDC) when available, otherwise an `NPM_TOKEN` secret.

**8. Tests.** `node --test` (built in). Tests run the CLI with `HOME` and the working directory pointed at temporary folders, and cover every scenario in `specs/cli-installer/spec.md`.

## Risks / Trade-offs

- [Agent vendors change their skills folders] → The path map is one module with a source link per entry, so a fix is one line plus a patch release.
- [Gemini CLI needs skills enabled in settings] → The CLI prints a one-line note after installing for `gemini`, and the README says so.
- [The `@frcloudsolutions` npm scope is not registered yet] → Task 1 checks it before any code is written. If the scope is unavailable, the package name is the only thing that changes.
- [Duplicate listing when the same skill is installed for agents that read each other's folders] → Overlap note (Decision 3) and README guidance.

## Migration Plan

Additive. The Claude Code marketplace keeps working unchanged. First release is `0.1.0`; rollback is `npm deprecate` on the bad version plus a patch release.
