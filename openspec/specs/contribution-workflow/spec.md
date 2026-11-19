# contribution-workflow Specification

## Purpose
Describes how skills and structural changes enter the repository: spec-first through OpenSpec, then checked automatically before merge.
## Requirements
### Requirement: Spec-first changes
Every new skill and every structural change SHALL start as an OpenSpec change under `openspec/changes/` and SHALL be archived into `openspec/specs/` once merged.

#### Scenario: Proposing a new skill
- **WHEN** a contributor wants to add a skill
- **THEN** CONTRIBUTING.md directs them to create an OpenSpec change (proposal, specs, tasks) before writing the skill

### Requirement: Automated validation
The repository SHALL run automated validation on every push and pull request. The validation MUST check skill format, manifest consistency and OpenSpec artifacts in strict mode, and MUST fail the run when any check fails.

#### Scenario: Pull request with invalid skill
- **WHEN** a pull request adds a `SKILL.md` without a `description`
- **THEN** the validation workflow fails and reports the problem

#### Scenario: Pull request with invalid OpenSpec change
- **WHEN** a pull request adds an OpenSpec change whose requirement has no scenario
- **THEN** the validation workflow fails

### Requirement: Open license
The repository SHALL be licensed under the MIT license, stated in a `LICENSE` file at the root.

#### Scenario: License present
- **WHEN** anyone views the repository root
- **THEN** a `LICENSE` file with the MIT license text is present

