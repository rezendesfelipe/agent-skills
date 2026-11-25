## Status

**Gate 1 approved** by the maintainer on 2026-11-25 (relayed in the session; recorded in a comment on the pull request): the recommendations Q1 to Q10 of `design.md` as written, plus two amendments in the maintainer's words: "Os exemplos devem mostrar o que é produzido pela skill e como conseguir bons resultados. Também todas novas skills e agentes que vierem deverão ter esses exemplos." Implemented in this same pull request after the approval (the proposal commit is 1d9ef20). Manual smoke S1 to S7 and the independent review stay open (see `tasks.md`).

## Why

The maintainer asked: "in the skills and agents, put example prompts that can be used to get the most out of the tools". Scope: the three skills (`docs-generator`, `azure-terraform-stacks`, `assessment-report`) and the agent `stacks-auditor`.

What exists today, checked in the files (full inventory in `design.md`):

- Each `SKILL.md` already says when to use the skill (`## When to use`) and two of them end with an `## Examples` block of one-line inputs and outputs (`plugins/azure-terraform-stacks/skills/azure-terraform-stacks/SKILL.md:124-130`, `plugins/docs-generator/skills/docs-generator/SKILL.md:76-82`). `assessment-report` has no examples section. The agent file has none.
- Those examples show what the skill produces, not how a user should ask to get a good result: nothing says which facts to give up front (CI platform, environments, language, theme, scope), what to ask for in the output (evidence as `file:line`, "not evaluated" list), or what not to ask (apply, destroy, paste secrets, approve the review for me).
- The README documents installation in detail and has no usage section (`README.md`, sections Install, Catalog, Layout).

Two constraints make this less trivial than adding text:

1. **Context budget.** `SKILL.md` of `azure-terraform-stacks` is 13,947 bytes, about 3,487 of the 3,500 estimated tokens that `plugins/azure-terraform-stacks/skills/azure-terraform-stacks/test/budget.test.mjs:23` allows, which is 53 bytes of room. The same file is preloaded into `stacks-auditor` (`plugins/azure-terraform-stacks/agents/stacks-auditor.md:5-6`), so every byte is paid on every audit. Even the one-line pointer to a new file barely fits (see `design.md`, "Budget arithmetic").
2. **Who reads examples.** Example prompts are written for the person typing (or for the main agent that delegates). The auditor's own prompt is its system prompt; examples addressed to a human would load into its context on every run and could be read as instructions.

## What Changes

Amendment 1 (what is produced and how to get good results) and amendment 2 (a permanent rule for new skills and agents, enforced by a test) are part of the change; see `design.md`, sections 14 and 15.

- **A `references/prompts.md` in each of the three skills**, loaded on demand (progressive disclosure): 3 to 4 positive examples (beginner, advanced, consultancy) and one anti-example under "What not to ask". Each example has the prompt (English canonical, pt-BR twin), **what you get** with an output excerpt (a real run on fictitious data, labeled `Real output (command: ...)`, or labeled `Illustrative excerpt, not a captured run`), and 2 to 4 **tips** on how to get a good result, in both languages. Each file states plainly that the prompts are starting examples and what was and was not tested.
- **The examples for `stacks-auditor` live in `azure-terraform-stacks/references/prompts.md`**, in a section for the auditor, not in the agent file. The agent file does not change in size. The skill reaches every installation path of the agent (marketplace plugin, and `agent-skills add stacks-auditor`, which installs the skill with it).
- **One line in each `SKILL.md`** that points to the file, at the step or list where it is useful. For `azure-terraform-stacks` the line must fit in 53 bytes or be paid for by shortening the existing `## Examples` block (Q4). `BUDGET` and the declared budgets are not raised.
- **A short "Example prompts" section in `README.md`**: one starter prompt per capability and a link to the full file (discovery for people who have not installed anything yet).
- **A permanent rule with a machine check.** Every new skill or agent must ship such examples. `test/prompt-examples.test.mjs` discovers `plugins/*/skills/*` and `plugins/*/agents/*` (no list to maintain) and fails for any without them. An agent that lists `skills` has its examples in a section `## Agent: <name>` of one of those skills' files; an agent that lists none has them in the README. New: `templates/prompts/prompts.md`, the `CONTRIBUTING.md` section "Example prompts", a checklist item in `.github/pull_request_template.md`. Spec: ADDED requirements on `contribution-workflow`.
- **A structural test** (`test/prompt-examples.test.mjs`, in the root `npm test`) for the existence of the files, the single link from `SKILL.md`, marked blocks, en and pt-BR parity, no secret-shaped literal, no unsafe verb in the auditor's positive examples, valid relative links, and unchanged agent size. Plus a manual **smoke checklist** (to be run by the maintainer, because it needs a model session) recorded under `evidence/`.
- **`CONTRIBUTING.md`**: the skill checklist line "Content is in English" (line 100) gets an exception for the pt-BR twin of prompt examples; the new maintenance rule is written down.
- **`CHANGELOG.md`** gets an `## [Unreleased]` section (none exists today).

Spec deltas: a new capability `prompt-examples` (covers the three skills and the agent), ADDED requirements on `contribution-workflow` (the permanent rule and its enforcement; `openspec/specs/contribution-workflow/spec.md` has three requirements and none says anything about examples) and one ADDED requirement on `stacks-auditor`. There is no delta on `assessment-report` or `docs-generator`: the first has no spec in `openspec/specs/` yet (its change `add-assessment-report-skill` is not archived, so a MODIFIED would fail and an ADDED would collide at archive), and the second needs nothing its own spec does not already allow.

## Non-goals

- Not a prompt-engineering course, and no claim that these prompts "maximize" anything. Final text says "starting examples". No efficacy is asserted without a recorded run.
- No change to the behavior, hard rules, flows or commands of any skill or agent, and no new tool for the auditor.
- No new `description` trigger text (it is loaded in every session; see `design.md`, alternatives).
- No Spanish twin of the prompts, even though `assessment-report` renders in `es` (Q3).
- No example that needs, shows or generates a real credential, subscription, tenant or client name.
- No version bump, tag, npm publish or change to `publish.yml`: the release is gate 2 and needs the maintainer's explicit OK naming the version.
- No change under `plugins/` in this proposal branch.
- No automatic model run in CI (it needs an API key and is not deterministic).

## Impact

Implementation files outside `openspec/changes/add-prompt-examples/` (declared because the proposal branch scope check passes with `--approved` after gate 1):

- New: `plugins/docs-generator/skills/docs-generator/references/prompts.md`, `plugins/azure-terraform-stacks/skills/azure-terraform-stacks/references/prompts.md`, `plugins/assessment-report/skills/assessment-report/references/prompts.md`, `templates/prompts/prompts.md`, `test/prompt-examples.test.mjs`.
- Changed: the three `SKILL.md` (a pointer line each; `azure-terraform-stacks` also shortens `## Examples`), `README.md` (section "Example prompts"), `CONTRIBUTING.md`, `templates/skill/SKILL.md`, `.github/pull_request_template.md` (one checklist item), `CHANGELOG.md` (`[Unreleased]`), `package.json` (`scripts.test` list only).
- Not touched: `plugins/azure-terraform-stacks/agents/stacks-auditor.md`, `docs/aep/context-budgets.json`, every `plugin.json` and version, `publish.yml` and every workflow, rulesets, the engines.
- Context cost at trigger: `azure-terraform-stacks` `SKILL.md` goes from 13,904 to 13,836 bytes (smaller; the ceilings are 14,000 in `budget.test.mjs` and 13,947 in `no-install.test.mjs`); `docs-generator` +85 bytes, `assessment-report` +76 bytes. The examples cost tokens only when a user asks for them. The auditor's preload shrinks.
- Shipping: the npm package already includes `plugins/*/skills/**` (`package.json`), and the CLI copies the whole skill folder (`src/lib/install.mjs`); a test installs each skill, and the skill an agent lists, and checks that `references/prompts.md` is there. A plugin change ships with a plugin version bump at release (gate 2, out of scope).
- Specs: `prompt-examples` is new; `contribution-workflow` and `stacks-auditor` each gain requirements.
