## Purpose

Gives users of the skills and of the `stacks-auditor` agent example prompts to start from, without growing the context that a skill or an agent loads when it triggers, in English with a pt-BR twin, without any secret-shaped value, and with an honest statement of what was tested.

## ADDED Requirements

### Requirement: Prompt examples file per skill
Each of the skills `docs-generator`, `azure-terraform-stacks` and `assessment-report` SHALL have a file `references/prompts.md` inside its skill folder. The file SHALL start with a one-line status that says what was tested, by whom, with which model and tool version and on which date, or that no model run was done; SHALL have a contents list; and SHALL describe its examples as starting examples, never as optimal prompts. Each example SHALL have an id that is unique in the file, a one-sentence statement of why it works, and a prompt block. Examples SHALL be grouped by level: beginner, advanced, consultancy, and a section "What not to ask" whose entries each give the reason and a safe alternative.

#### Scenario: File present for each skill
- **WHEN** the repository tests run
- **THEN** each of the three skill folders has `references/prompts.md` with a status line, a contents list and at least one example in each of the levels beginner, advanced and consultancy, plus one entry under "What not to ask", and the tests fail and name the skill when one is missing

#### Scenario: No claim of effectiveness
- **WHEN** a `prompts.md` is read
- **THEN** it calls its prompts starting examples and its status line says what was not run, and it does not say that a prompt maximizes, guarantees or optimizes a result

### Requirement: Progressive disclosure and context budget
The examples SHALL NOT be placed in a `SKILL.md`, in an agent file or in a `description`. Each `SKILL.md` SHALL point to its `references/prompts.md` with one line, once, one level deep. The file SHALL NOT be listed under `loadedWith` in `docs/aep/context-budgets.json`. The change SHALL NOT raise any declared budget or the `BUDGET` constant of `azure-terraform-stacks` and SHALL leave `node scripts/context-budget.mjs` and every existing budget test passing. The `SKILL.md` of `assessment-report` SHALL stay at or under 150 lines.

#### Scenario: Single pointer
- **WHEN** a `SKILL.md` of the three skills is read after the change
- **THEN** the text `references/prompts.md` occurs in it exactly once

#### Scenario: Azure budget holds
- **WHEN** `node --test` runs the `budget.test.mjs` of `azure-terraform-stacks` after the change
- **THEN** it passes with `BUDGET` equal to 3500, and `git diff` shows no change to that constant

#### Scenario: Reference not counted as always loaded
- **WHEN** `docs/aep/context-budgets.json` is read after the change
- **THEN** no `loadedWith` entry names a `prompts.md`

#### Scenario: Agent unchanged in kind
- **WHEN** `plugins/azure-terraform-stacks/agents/stacks-auditor.md` is read after the change
- **THEN** it contains no example-prompt block and no mention of `prompts.md`

### Requirement: Language
Every example SHALL be written in English, which is canonical, and have a twin in Brazilian Portuguese with the same id in the same file. The twin SHALL keep product words (the names of skills, agents, files, commands and flags) in English. A test SHALL fail when an id or a block exists in only one language. A change to an English prompt SHALL change its twin in the same pull request.

#### Scenario: Twin missing
- **WHEN** an example has an English block and no pt-BR block
- **THEN** the repository tests fail and name the file and the id

#### Scenario: Ids differ
- **WHEN** the set of ids of the pt-BR blocks differs from the set of ids of the English blocks
- **THEN** the repository tests fail and list the difference

### Requirement: No credential in examples
No example, status line or explanation SHALL contain a credential or a literal in the format of one. The project's secret scanner (`scanString` of `assessment-report`) SHALL report nothing for any text of a `prompts.md`, and the only GUID allowed SHALL be all zeros. Each file SHALL tell the reader where not to paste a secret (a prompt, a pasted source, a quoted line) and what to give instead. Names of people, clients and subscriptions SHALL be fictitious or placeholders in angle brackets.

#### Scenario: Secret-shaped literal
- **WHEN** an example contains a private key header, an access key identifier, a token prefix, a `user:password@` URL or an assignment of a value to a name such as `password` or `token`
- **THEN** the repository tests fail and name the file and the line

#### Scenario: Real-looking identifier
- **WHEN** an example contains a GUID that is not all zeros
- **THEN** the repository tests fail

#### Scenario: Where not to paste
- **WHEN** a `prompts.md` is read
- **THEN** it has a paragraph that names where a secret must not be pasted and what to do instead

### Requirement: Examples respect what each tool can do
Examples SHALL NOT ask a tool for something its documentation forbids, except under "What not to ask", where each such prompt SHALL be marked as one the tool declines and SHALL give the reason and the alternative. In particular: an example for `azure-terraform-stacks` SHALL NOT ask to apply, destroy or change Azure, a cluster or a pipeline run; an example for `assessment-report` SHALL NOT ask the agent to approve the review, to set a severity or a confidence, or to fix the assessed system, and SHALL keep the gates (init, review, approve, render); an example for `docs-generator` SHALL NOT ask for a format other than PDF and DOCX, and SHALL describe Excel as an empty template and Office theme; and the `prompts.md` of `assessment-report` SHALL satisfy the existing documentation tests of that skill (linked from `SKILL.md`, at most 6 technology words, no checkbox list, relative links that resolve).

#### Scenario: Documentation tests of assessment-report
- **WHEN** `npm test` runs in `plugins/assessment-report/skills/assessment-report` after the change
- **THEN** every test passes, including the linking, technology-word and checkbox tests that read `references/`

#### Scenario: Anti-example marked
- **WHEN** a prompt asks a tool to do what its hard rules forbid
- **THEN** it is under "What not to ask" and the text below it says that the tool declines, why, and what to ask instead

### Requirement: Installation reaches the examples
The examples SHALL travel with the skill folder: `agent-skills add <skill>` SHALL copy `references/prompts.md`, the npm package SHALL include it, and `agent-skills add stacks-auditor` SHALL install the skill `azure-terraform-stacks` with it. No example SHALL depend on a file outside `plugins/` or outside the skill's folder.

#### Scenario: CLI install
- **WHEN** a test installs each skill with the CLI into a temporary home folder
- **THEN** `references/prompts.md` exists in the installed folder

#### Scenario: Agent install brings the skill
- **WHEN** a test installs `stacks-auditor` with the CLI for Claude Code at user scope in a temporary home folder
- **THEN** the installed `azure-terraform-stacks` folder contains `references/prompts.md`

#### Scenario: Package contents
- **WHEN** the package file list is computed with `npm pack --dry-run`
- **THEN** the three `references/prompts.md` files are in it

### Requirement: README discovery
`README.md` SHALL have a section "Example prompts" with one starter prompt for each of the four capabilities (three skills and the auditor) in English and pt-BR, a link to the full file of each, and the statement that the prompts are starting examples. Each starter prompt SHALL appear verbatim in its `prompts.md`.

#### Scenario: Starter prompt copied exactly
- **WHEN** a README starter prompt differs by one character from the text in its file
- **THEN** the repository tests fail and name the capability

### Requirement: Manual smoke is recorded, not assumed
The change SHALL list a manual smoke check (prompts and what to observe) and SHALL record its result, when the maintainer runs it, in a file under the change's `evidence/` with the model, the tool version, the plugin versions and the date. Until a result is recorded, each `prompts.md` status line SHALL say that no model run was done. The smoke SHALL NOT run in CI.

#### Scenario: Status line before the smoke
- **WHEN** no evidence file exists
- **THEN** each status line says that the examples were not run against a model

#### Scenario: Status line after the smoke
- **WHEN** an evidence file exists
- **THEN** each status line names which examples were run, with the model and the date, and which failed
