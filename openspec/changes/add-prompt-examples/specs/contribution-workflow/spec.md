## ADDED Requirements

### Requirement: Every skill and agent ships example prompts
Every skill and every agent of the catalog SHALL ship example prompts: the prompt, what it produces and how to get a good result, in English with a pt-BR twin. A skill SHALL have `references/prompts.md`, linked once from its `SKILL.md`. An agent that lists `skills` SHALL have its examples in a section `## Agent: <name>` of the `prompts.md` of one of those skills. An agent that lists no skill SHALL have the full examples under `### <name>` in the section "Example prompts" of `README.md`. Every skill and agent SHALL also have a starter prompt in that README section, equal to the first example of its file. The agent file SHALL NOT hold example prompts or point to them. A new skill or agent SHALL NOT be merged without them.

#### Scenario: New skill without examples
- **WHEN** a skill folder with a `SKILL.md` is added under `plugins/*/skills/` and has no `references/prompts.md`
- **THEN** `npm test` fails and the message names the skill

#### Scenario: New agent without a place for examples
- **WHEN** an agent file is added under `plugins/*/agents/` that lists no skill and has no `### <name>` section in the README
- **THEN** `npm test` fails and the message names the agent

#### Scenario: Agent that lists a skill
- **WHEN** an agent lists a skill whose `prompts.md` has no section `## Agent: <name>`
- **THEN** `npm test` fails and the message names the agent and the skill

#### Scenario: Examples in the agent file
- **WHEN** an agent file contains an example prompt block or mentions `prompts.md`
- **THEN** `npm test` fails

### Requirement: The rule is enforced by a test that discovers the catalog
`test/prompt-examples.test.mjs` SHALL be part of `scripts.test` in `package.json` and SHALL find the skills and agents by reading `plugins/*/skills/*` and `plugins/*/agents/*`; it SHALL NOT contain a list of their names. It SHALL check, for each: the file and the single pointer; the level sections and "What not to ask"; unique ids; one English and one pt-BR block per example; the labeled output; the tips; a status line and "Where not to paste" in both languages; the absence of secret-shaped text (with the scanner of `assessment-report`), of GUIDs other than zeros and of personal paths; and the README starter prompts. It SHALL include tests that copy the relevant files to a scratch folder and plant one mistake each (a skill without examples, an agent without examples, a missing twin, a missing label, a secret-shaped line, a GUID, a path, a second pointer, an unsafe auditor example, a block in the agent file, a README difference), and each SHALL fail the check with an error that names the mistake. It SHALL NOT add a workflow: it runs in the existing `npm test`.

#### Scenario: Mutation of a fictitious skill
- **WHEN** a fictitious skill without examples is planted in a scratch copy
- **THEN** the checks report an error that names it, and the same check passes on the copy without it

#### Scenario: No list to update
- **WHEN** a skill with complete examples is added and no file of the test is edited
- **THEN** the test passes and covers the new skill

#### Scenario: No new required check
- **WHEN** the change is applied
- **THEN** `.github/workflows/` is unchanged and the names of the checks of the ruleset are unchanged

### Requirement: Contributors are told, and the template starts them
`CONTRIBUTING.md` SHALL have a section "Example prompts" that states the rule, where the examples live, the language policy (English canonical, pt-BR twin in the same pull request, product words in English), the honesty rule for outputs, the budget rule (examples never go in `SKILL.md`, an agent file or a `description`, and no budget is raised for them) and the safety rule (no credential, fictitious data). The skill and agent checklists SHALL have an item for the examples, and the line "Content is in English" SHALL state its one exception, the pt-BR twin of example prompts. `templates/prompts/prompts.md` SHALL exist as the starting point and pass the checks when copied into a skill; `templates/skill/SKILL.md` SHALL point to it; `.github/pull_request_template.md` SHALL have a checklist item for it.

#### Scenario: Template passes
- **WHEN** the template is copied into a scratch skill with a pointer in its `SKILL.md` and a README starter prompt
- **THEN** the checks report no error for that skill

#### Scenario: Language exception written
- **WHEN** `CONTRIBUTING.md` is read
- **THEN** the skill checklist's language line names the pt-BR twin of example prompts as the exception
