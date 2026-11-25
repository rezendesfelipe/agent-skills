## Status

Proposal for review at gate 1. Nothing is implemented: this branch changes only `openspec/changes/add-prompt-examples/`. The sample prompts in `design.md` ("Sample prompts") are sketches for the maintainer to judge tone and level; they are not the final text and have not been run against a model. Questions Q1 to Q10 in `design.md` need an answer before implementation.

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

- **A `references/prompts.md` in each of the three skills**, loaded on demand (progressive disclosure), with 4 to 6 example prompts each, grouped by level (beginner, advanced, consultancy/audit) and a short "What not to ask" part with anti-examples. Each example has an English canonical prompt and a pt-BR twin. Each file states plainly that the prompts are starting points and what was and was not tested.
- **The examples for `stacks-auditor` live in `azure-terraform-stacks/references/prompts.md`**, in a section for the auditor, not in the agent file. The agent file does not change in size. The skill reaches every installation path of the agent (marketplace plugin, and `agent-skills add stacks-auditor`, which installs the skill with it).
- **One line in each `SKILL.md`** that points to the file, at the step or list where it is useful. For `azure-terraform-stacks` the line must fit in 53 bytes or be paid for by shortening the existing `## Examples` block (Q4). `BUDGET` and the declared budgets are not raised.
- **A short "Example prompts" section in `README.md`**: one starter prompt per capability and a link to the full file (discovery for people who have not installed anything yet).
- **A structural test** (`test/prompt-examples.test.mjs`, in the root `npm test`) for the existence of the files, the single link from `SKILL.md`, marked blocks, en and pt-BR parity, no secret-shaped literal, no unsafe verb in the auditor's positive examples, valid relative links, and unchanged agent size. Plus a manual **smoke checklist** (to be run by the maintainer, because it needs a model session) recorded under `evidence/`.
- **`CONTRIBUTING.md`**: the skill checklist line "Content is in English" (line 100) gets an exception for the pt-BR twin of prompt examples; the new maintenance rule is written down.
- **`CHANGELOG.md`** gets an `## [Unreleased]` section (none exists today).

Spec deltas: a new capability `prompt-examples` (covers the three skills and the agent) and one ADDED requirement on `stacks-auditor`. There is no delta on `assessment-report` or `docs-generator`: the first has no spec in `openspec/specs/` yet (its change `add-assessment-report-skill` is not archived, so a MODIFIED would fail and an ADDED would collide at archive), and the second needs nothing its own spec does not already allow.

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

- Files touched at implementation: `plugins/*/skills/*/references/prompts.md` (3 new), `plugins/*/skills/*/SKILL.md` (3, one line each; azure also shortens `## Examples`), `README.md`, `CONTRIBUTING.md`, `CHANGELOG.md`, `test/prompt-examples.test.mjs` (new), `package.json` (`scripts.test` list only). The agent file `plugins/azure-terraform-stacks/agents/stacks-auditor.md` is not touched.
- Context cost at trigger: about +12 to +45 bytes per `SKILL.md` (a pointer line); the examples themselves cost tokens only when a user asks for them (the model reads the reference). The auditor's preload grows by the azure pointer line only, or shrinks if Q4 option B is chosen.
- Shipping: the npm package already includes `plugins/*/skills/**` and excludes only `node_modules`, `test` and `evals` (`package.json:9-17`), and the CLI copies the whole skill folder (`src/lib/install.mjs:41-44`), so `references/prompts.md` is installed. The plugin marketplace installs the plugin folder (the existing `references/` of all three skills already depend on that; plugin caching was not read, see `design.md`, "Sources"). A user-visible change in a plugin ships with a plugin version bump at release (gate 2, out of scope here).
- Specs: `prompt-examples` is new; `stacks-auditor` gains one requirement.
