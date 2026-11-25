## ADDED Requirements

### Requirement: Auditor examples live in the skill
Example prompts for the auditor SHALL be in `plugins/azure-terraform-stacks/skills/azure-terraform-stacks/references/prompts.md`, in a section for the auditor, and SHALL NOT be added to `plugins/azure-terraform-stacks/agents/stacks-auditor.md`. Each positive example SHALL name a path to audit and the language of the report, and SHALL ask only for the report and for work in the main conversation that follows from it. A positive example SHALL NOT ask the auditor to edit a file, apply or fix a finding, commit, push, open a pull request, run `terraform`, `kubectl`, `az`, `gh` or `git`, run `validate` or another external tool, or use an engine inside the audited repository. Prompts that do are allowed only under "What not to ask", each with the reason taken from the agent's rules and a safe alternative.

#### Scenario: Auditor example asks only for the report
- **WHEN** the positive auditor examples of `prompts.md` are read
- **THEN** none asks for a change to the audited repository or for a command outside the agent's allowlist, and each names a path and a language

#### Scenario: Agent file stays a system prompt
- **WHEN** the agent file is read after the change
- **THEN** it has no example prompt block and its estimated size is not larger than before the change

#### Scenario: Examples reach every installation of the agent
- **WHEN** the agent is installed through the Claude Code marketplace or with `agent-skills add stacks-auditor`
- **THEN** the skill folder that the agent preloads is installed with `references/prompts.md`

#### Scenario: Anti-example for fixing
- **WHEN** the section "What not to ask" is read
- **THEN** it has a prompt that asks the auditor to fix findings and open a pull request, says that the auditor never does it, and points to the main conversation for fixes after the report
