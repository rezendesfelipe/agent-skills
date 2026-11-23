## Purpose

Defines how a change travels from idea to published capability in this repository as an explicit graph (level 1), and the convention every agent or skill follows to describe its own graph (level 2). "AEP" (Agentic Engineering Platform) is a working definition of this project, anchored in two cited sources and adapted for consultancies, not an established standard. The graphs are specifications; no graph runtime is used.

## ADDED Requirements

### Requirement: Working definition of AEP
The repository documentation that describes the graph SHALL present "AEP" as a working definition of this project, not as an established industry standard. It SHALL cite the two sources it is anchored in, Weave Intelligence, "What is an Agentic Engineering Platform?", and the CNCF blog post "Platform engineering for the agentic enterprise: managing applications, resources, and AI agents", and SHALL distinguish what each source states from what this project adapts. It SHALL state the adaptation for a consultancy: reusable, versioned and verifiable capabilities plus the paths and guardrails through which people and agents deliver engagements to third parties, with evidence and an audit trail per engagement. It SHALL state the mapping from platform concepts to repository parts: capability catalog to the repository and marketplace, contract to OpenSpec specs, orchestration to graphs, guardrails to read-only defaults, the CLI's `refused` status and human gates, quality to evals, CI and the evidence verifier, distribution to the `agent-skills` CLI and the marketplace. It MUST NOT claim that either source endorses this project's definition or that this repository conforms to a source's architecture.

#### Scenario: Reader opens the delivery graph page
- **WHEN** a contributor reads the page that documents the delivery graph
- **THEN** it labels AEP as a working definition, cites the two sources, separates source statements from our adaptation, and lists the mapping of platform concepts to repository parts

#### Scenario: No claim of an industry definition or endorsement
- **WHEN** the documentation is reviewed
- **THEN** it contains no statement that AEP is standardized, that a source endorses this definition, or that the repository conforms to a source's layers

### Requirement: Consultancy adaptation and stated gaps
The documentation SHALL describe what an AEP means for a consultancy that delivers assessments, architectures and platforms to third parties, covering reusable capabilities across engagements, contracts as specs, verifiable evidence, governance, audit trail, multi-client isolation and deliverables, and SHALL say which of these this repository provides. It SHALL list the capabilities that the sources describe and this repository lacks, at least: distinct agent identities with scoped credentials, agent sandboxing, agent observability and cost attribution, evaluation with goldens and replay, a context layer, a tool gateway, a models plane, output guardrails and per-engagement isolation of context and data. The list SHALL NOT promise to build them. The documentation SHALL state that client data and engagement outputs do not belong in this public repository.

#### Scenario: Gaps are listed honestly
- **WHEN** a contributor reads the documentation
- **THEN** it lists the missing capabilities and does not state or imply that they are planned or committed

#### Scenario: Client data
- **WHEN** a contributor asks where engagement data should live
- **THEN** the documentation says it does not belong in this repository

### Requirement: No graph runtime
Graph engineering SHALL be used in this project as a design discipline (typed nodes, conditional edges, explicit state, bounded cycles and human interruptions), and the delivery graph and the level 2 graphs SHALL be specifications executed by Claude Code subagents, the OpenSpec CLI, deterministic scripts and CI. The repository SHALL NOT add a graph runtime (LangGraph, LangChain or any other) as a dependency or service because of this change. The design SHALL record the alternatives considered (adopting a runtime with checkpointing and durable interrupts, a single-agent harness) with their pros and cons, and SHALL state objective criteria for reevaluating the decision, including orchestration that must run durably outside an interactive session and parallelism above a stated number of changes. Meeting a criterion SHALL start a new change that evaluates a runtime; it SHALL NOT adopt one by itself.

#### Scenario: No runtime dependency
- **WHEN** the change is implemented
- **THEN** `package.json` and the repository contain no LangGraph or LangChain dependency, service or code

#### Scenario: Reevaluation criteria present
- **WHEN** a contributor reads the design
- **THEN** it lists objective criteria for reconsidering a runtime and states that meeting one starts a new change rather than adopting a runtime

#### Scenario: Criterion met
- **WHEN** a criterion is met, for example orchestration that must run unattended and survive a restart
- **THEN** the maintainer is told and a new OpenSpec change is proposed before any runtime is added

### Requirement: Delivery graph of the repository
Every change to this repository SHALL travel through the level 1 delivery graph. Its nodes, in order, are: `explore`, `propose`, `validate`, `human-gate-1`, `apply`, `test-and-validate`, `review`, `pr-and-ci`, `merge`, `archive`, `release-queue` and `human-gate-2`. `propose`, `apply` and `review` SHALL be agent nodes; every other node SHALL be deterministic code, a command or a human decision. The documentation SHALL state the edges, including the conditional ones: `validate` fails then back to `propose`; `test-and-validate` fails then back to `apply`; `review` with reservations then back to `apply`; a change that exhausts its cycle limit goes to the maintainer.

#### Scenario: Every node has a type
- **WHEN** the documented graph is checked
- **THEN** each of the twelve nodes is labeled as agent, deterministic or human, and exactly `propose`, `apply` and `review` are agent nodes

#### Scenario: Failed validation returns to propose
- **WHEN** `openspec validate <change> --strict --no-interactive` fails after `propose`
- **THEN** the graph returns to `propose` with the validator output, and the change does not reach `human-gate-1`

#### Scenario: Reservations return to apply
- **WHEN** the reviewer returns reservations
- **THEN** the graph returns to `apply` with the reservations listed, and the change does not reach `pr-and-ci` approval

### Requirement: Human gate 1 before implementation
Implementation SHALL NOT start before the maintainer approves the proposal at human gate 1. The `apply` node MUST NOT run, and no file outside `openspec/changes/<name>/` MUST change, until the approval is recorded. The approval SHALL be explicit (a pull request approval, a review comment, or a written reply from the maintainer on the proposal's pull request) and SHALL be recorded on the proposal's pull request.

#### Scenario: Proposal without approval
- **WHEN** a proposal has passed `validate` and the maintainer has not approved it
- **THEN** the change stays at `human-gate-1` and no implementation work starts

#### Scenario: Changes outside the proposal folder before approval
- **WHEN** a proposal branch that has no recorded gate 1 approval changes a file outside `openspec/changes/<name>/`
- **THEN** the deterministic scope check fails and the branch is not eligible for `apply`

#### Scenario: Approval recorded
- **WHEN** the maintainer approves the proposal on its pull request
- **THEN** the change moves to `apply` and the approval is the record that authorizes it

### Requirement: Apply loop is bounded
After `apply`, the `test-and-validate` node SHALL run the repository's checks (`node scripts/validate-skills.mjs`, `npm test` and `openspec validate --all --strict --no-interactive`). On failure the graph SHALL return to `apply`. The loop between `apply`, `test-and-validate` and `review` SHALL run at most 3 cycles per change. After the third failed or reserved cycle the graph SHALL stop and escalate to the maintainer with the open failures and reservations; it MUST NOT start a fourth cycle without the maintainer's instruction.

#### Scenario: Checks fail once
- **WHEN** `npm test` fails after `apply`
- **THEN** the graph returns to `apply` and the cycle counter increases by one

#### Scenario: Third cycle fails
- **WHEN** the third cycle ends with a failing check or a review with reservations
- **THEN** the change is labeled as needing the maintainer, the agents stop, and the escalation message lists the unresolved items

#### Scenario: Maintainer extends the limit
- **WHEN** the maintainer explicitly asks for another cycle on an escalated change
- **THEN** the graph resumes at `apply` and the maintainer's instruction is recorded on the pull request

### Requirement: Independent review
Before merge, every change SHALL be reviewed by an independent reviewer: an agent running in a fresh context, with read-only tools, that did not take part in `propose` or `apply` for that change. The reviewer SHALL read the diff, the change's specs and `tasks.md`, and SHALL return one verdict: `approved` or `changes-requested`. Every reservation SHALL cite evidence as `file:line` (or a command and its output). A reservation without evidence SHALL be discarded or marked "not verified" and MUST NOT block the change by itself.

#### Scenario: Reviewer has no write tools
- **WHEN** the reviewer role is defined
- **THEN** its tool allowlist contains no tool that writes files, commits, pushes or merges

#### Scenario: Reservation with evidence
- **WHEN** the reviewer finds that a task marked done has no matching change
- **THEN** the verdict is `changes-requested` and the reservation names the task and the `file:line` that shows the gap

#### Scenario: Reservation without evidence
- **WHEN** a reservation cites no file, line or command output
- **THEN** it is discarded or marked "not verified" and is not counted as a blocking reservation

### Requirement: Integrator acts only on an approved verdict and green CI
The integrator SHALL merge a pull request only when all of these hold: the reviewer's verdict is `approved`, every required CI check is green, the cycle limit has not been exhausted, the pull request has no unresolved human request for changes, and the branch has been rebased on the current `main`. When they hold, the integrator SHALL merge and then archive the change (`openspec archive <name>` so the delta moves into `openspec/specs/`) without further approval. If any condition fails, the integrator MUST NOT merge and SHALL report which condition failed.

#### Scenario: Approved and green
- **WHEN** the verdict is `approved`, CI is green and the branch is rebased on `main`
- **THEN** the integrator merges, runs the archive and the specs move into `openspec/specs/`

#### Scenario: CI red
- **WHEN** the verdict is `approved` and a required check fails
- **THEN** the integrator does not merge and the change returns to `apply`

#### Scenario: Human request for changes
- **WHEN** the maintainer has requested changes on the pull request
- **THEN** the integrator does not merge, regardless of the reviewer's verdict

### Requirement: Published means merged, release is a separate gate
A capability SHALL count as published when its pull request is merged to `main`, because plugins are then available through the marketplace. The version bump in `package.json`, the `v*` tag and the npm publish performed by `.github/workflows/publish.yml` SHALL be a release in batch, gathered in a release queue, and SHALL happen only after human gate 2: an explicit OK from the maintainer naming the version. No agent role SHALL bump the version, create a tag or trigger the publish workflow without that OK.

#### Scenario: Change merged
- **WHEN** a change is merged and archived
- **THEN** it is added to the release queue, `package.json` keeps its version, and no tag is created

#### Scenario: Release without OK
- **WHEN** an agent is asked to release and no explicit OK from the maintainer for that version is on record
- **THEN** it does not bump the version, tag or publish, and asks the maintainer

#### Scenario: Release with OK
- **WHEN** the maintainer explicitly approves a version for release
- **THEN** one release change bumps the version and the maintainer's OK allows the `v<version>` tag that the publish workflow validates against `package.json`

### Requirement: Repository protection as a release prerequisite
The documentation SHALL record, as a checklist and as a prerequisite for any release automation, the recommended protection of the repository: required status checks that list every GitHub Actions job (`validate`; `test` on ubuntu, macos and windows with Node 20, 22 and 24; `docs-generator` on Node 20 and 24; `azure-terraform-stacks` on Node 20 and 24; `azure-terraform-stacks-deep`), CodeQL enabled through the default setup for the languages `actions` and `javascript-typescript` so that a `code_scanning` rule can be satisfied, administrator bypass of the `main` ruleset limited to the mode `pull_request` and not `always`, and a tag ruleset on `refs/tags/v*` that restricts creation, update and deletion. The documentation SHALL state the measured state at the time of writing, SHALL state that these rules prevent accidents and shortcuts but not a hostile agent while agents act under the maintainer's administrator identity, SHALL recommend a separate identity for the agents (a GitHub App or a bot account without administrator permission and without the right to create tags) as a future change, and SHALL recommend a protected GitHub environment with a required reviewer on the npm publish job as an extra gate that needs a separate workflow change. Changes to the repository ruleset SHALL be applied by the maintainer and SHALL NOT be part of this change's diff.

#### Scenario: Checklist without claims of enforcement
- **WHEN** a contributor reads the protection section
- **THEN** it lists the five recommended items and the honest limit, and it does not claim that the rules stop an agent acting with administrator rights

#### Scenario: Empty required checks
- **WHEN** the ruleset's required status checks list is empty
- **THEN** the documentation does not treat "green CI" as enforced by the repository, and release automation is not built

#### Scenario: Tags immutable
- **WHEN** the tag ruleset on `refs/tags/v*` is in place
- **THEN** a published tag cannot be moved or deleted and a new `v*` tag cannot be created without the maintainer

#### Scenario: Agents change the ruleset
- **WHEN** an agent is asked to edit the repository ruleset
- **THEN** it does not do it and refers the maintainer to the checklist

### Requirement: Engagement workspaces
The documentation SHALL define **engagement** as a client project and **workspace** as the isolated area that holds the client's artifacts, the state of the runs, the reports, credentials scoped to that client only, an audit log and a retention and disposal policy. It SHALL record the decision that each engagement uses its own private repository created from a template, the alternative that was rejected (a private monorepo with a folder per engagement, because of the risk of leaking between clients and all-or-nothing access), and that the skills and agents of this public repository are installed into an engagement repository by the CLI while nothing of the client enters this repository. Creating the template SHALL NOT be part of this change; it SHALL be recorded as a future change.

#### Scenario: Where client material goes
- **WHEN** a contributor asks where a client's artifacts, credentials or reports belong
- **THEN** the documentation points to the engagement's own private repository and says that nothing of the client enters this repository

#### Scenario: Template not created
- **WHEN** this change is implemented
- **THEN** no engagement template or workspace exists in this repository, and the documentation lists the template as a future change

### Requirement: Context budget
Every capability of the catalog (a skill or an agent) SHALL have a loaded-context cost measured in tokens and a declared budget: for a skill, what is loaded when it triggers; for an agent, the size of the agent file plus what it pre-loads through `skills:`. A deterministic helper SHALL compare the measured cost with the declared budget and fail when the cost exceeds it. The requirement is tool-agnostic: when an API key is available, the official token counting of the Anthropic Messages API for the named model is the reference (run manually and locally); in CI without a key, an offline estimate MAY be used and SHALL be labeled as an approximation. An estimate SHALL NOT be presented as an exact measure, and the method used (including the model for an official count) SHALL be recorded next to every number. The repository SHALL NOT add a runtime dependency for this purpose.

#### Scenario: Method recorded
- **WHEN** the helper reports a cost
- **THEN** the number is shown together with its method, for example `official:<model>` or `estimate:bytes/4`

#### Scenario: Estimate never exact
- **WHEN** the cost comes from the offline estimate
- **THEN** the report labels it as an approximation and the budget check applies the declared margin

#### Scenario: Over budget
- **WHEN** a capability's measured cost is above its declared budget
- **THEN** the helper exits with a failure and names the capability, the cost, the budget and the method

#### Scenario: No key in CI
- **WHEN** CI runs without an API key
- **THEN** the helper uses the labeled estimate and does not call the API

#### Scenario: No new dependency
- **WHEN** the helper is implemented
- **THEN** `package.json` gains no runtime dependency for tokenizing

### Requirement: Branch and pull request discipline
Every change SHALL use its own branch named `claude/<change-name>` and a pull request opened as a draft. Agents MUST NOT push to `main`, force-push to `main`, or push to a branch whose name does not start with `claude/`. A pull request SHALL leave draft state only after `test-and-validate` passes; marking it ready for review does not authorize merge. Commits SHALL follow Conventional Commits.

#### Scenario: Proposal pull request
- **WHEN** an agent proposes a change named `add-x`
- **THEN** it works on `claude/add-x`, pushes that branch only, and opens a draft pull request against `main`

#### Scenario: Push to main attempted
- **WHEN** an agent's plan includes a push to `main`
- **THEN** the role rules forbid it and the agent stops and reports

### Requirement: Roles and permissions
The delivery graph SHALL define four roles with these permissions. The proposal author MAY write only under `openspec/changes/<name>/` and MUST NOT edit code, `README.md`, `.claude-plugin/marketplace.json` or `package.json`. The implementer MAY write in the worktree of its own change, after gate 1, and MUST NOT merge, tag or publish. The reviewer SHALL be read-only. The integrator SHALL act only on an approved verdict and green CI, as in the integrator requirement, and MUST NOT write code. The documentation SHALL state that these permissions are instructions to agents and are enforced only as far as tool allowlists, CI and repository settings enforce them.

#### Scenario: Author writes outside its folder
- **WHEN** a proposal author's diff touches a file outside `openspec/changes/<name>/`
- **THEN** the scope check fails and the proposal is not eligible for gate 1

#### Scenario: Implementer tries to release
- **WHEN** an implementer is asked to bump the version or create a tag
- **THEN** it refuses and points to human gate 2

#### Scenario: Limits of enforcement are stated
- **WHEN** a contributor reads the roles page
- **THEN** it says which permissions are enforced by tools or CI and which rest on instructions

### Requirement: Graph state lives in existing artifacts
The state of a change in the graph SHALL be derivable from existing artifacts only: the checkboxes of `tasks.md` (work done), the pull request (draft or ready, labels for the node, cycle count and verdict, the recorded gate decisions) and `.openspec.yaml` of the change. The repository MUST NOT require a separate database or state file to know where a change is. The documentation SHALL state which artifact holds which part of the state and the label names used.

#### Scenario: Resuming after interruption
- **WHEN** an agent session ends at a gate and a new session starts later
- **THEN** the new session finds the node, cycle count and last verdict from `tasks.md`, the pull request labels and comments, without relying on the earlier session's memory

#### Scenario: Cycle count visible
- **WHEN** a change has gone through two apply cycles
- **THEN** the pull request shows the count, so the next role can see how many cycles remain

### Requirement: Parallel changes
Several changes MAY be in flight at once. Each SHALL have its own git worktree and branch, and SHALL be rebased onto the current `main` before merge. The shared files `README.md`, `.claude-plugin/marketplace.json` and `package.json` SHALL be edited by a change only for its own entry (a catalog row, a plugin entry); the `package.json` version SHALL change only in a release change, after human gate 2. When a rebase conflicts in a shared file, the implementer SHALL resolve it and re-run `test-and-validate`; if the conflict is not mechanical it SHALL escalate.

#### Scenario: Two changes edit the README catalog
- **WHEN** two branches each add a row to the README catalog and the second is rebased after the first merges
- **THEN** the second keeps both rows, re-runs the checks, and only then goes to review or merge

#### Scenario: Version bump in a feature change
- **WHEN** a feature or fix change modifies the `version` field of `package.json`
- **THEN** the review records a reservation and the integrator does not merge

#### Scenario: Non-mechanical conflict
- **WHEN** a rebase conflict changes the meaning of a shared file
- **THEN** the implementer escalates to the maintainer instead of choosing a side

### Requirement: Escalation to the maintainer
The graph SHALL escalate to the maintainer, stopping agent work, when: a cycle limit is exhausted; a rebase conflict is not mechanical; CI is red for a reason outside the change; a role would need a permission it does not have; or evidence for a claim cannot be produced. An escalation message SHALL state the node, the cycle count, the unresolved items with evidence, and the options.

#### Scenario: Escalation content
- **WHEN** a change escalates after the third cycle
- **THEN** the message names the node and cycle count, lists each unresolved item with its evidence, and offers the maintainer options (another cycle, narrow the scope, abandon)

#### Scenario: Missing permission
- **WHEN** an agent needs to change a file outside its role's scope
- **THEN** it does not do it and escalates

### Requirement: Level 2, the graph of each agent
Every change that adds or modifies an agent or a skill SHALL include in its `design.md` a graph for that agent. The graph SHALL name each node and its type (fixed code, model call, or agent), the edges (deterministic or conditional), the state the agent carries, the cycles with their limits, and the points where a human interrupts or approves. If the agent is a fixed, linear procedure, the graph MAY be a short sequence but SHALL still state node types. The design SHOULD say, in one line, why a graph fits (a predictable flow) or why an agent harness fits (an open-ended task).

#### Scenario: New skill proposal
- **WHEN** a proposal adds a skill
- **THEN** its `design.md` has a graph section with node types, edges, state, cycles and human interruptions

#### Scenario: Missing graph section
- **WHEN** the reviewer finds a proposal for an agent or skill without that section
- **THEN** it records a reservation citing the `design.md` path

### Requirement: Verifier node for findings
When an agent produces findings (an audit, a review, a scan), its graph SHALL include a deterministic verifier node after the node that produces them. The verifier SHALL check each finding for evidence as `file:line` (or a command and its output) and SHALL confirm that the cited location exists and supports the claim as far as a deterministic check can. The verifier MUST be code or a command, not another model call.

#### Scenario: Finding with valid evidence
- **WHEN** an auditor reports a finding citing `infra/main.tf:42` and that file has at least 42 lines
- **THEN** the verifier passes the finding on

#### Scenario: Finding with a nonexistent location
- **WHEN** a finding cites `infra/main.tf:900` and the file has 120 lines
- **THEN** the verifier rejects it and it is not reported as a finding

### Requirement: Output without evidence
Agent output that makes a factual claim without evidence SHALL be dropped or marked "not verified". A "not verified" item SHALL be visibly separated from verified findings, MUST NOT count toward a verdict, a merge decision or a release decision, and SHALL say what evidence is missing.

#### Scenario: Claim without a location
- **WHEN** an agent states that a rule is violated and gives no file or line
- **THEN** the report lists the claim under "not verified" with the missing evidence, and it does not affect the verdict

#### Scenario: Dropped claim
- **WHEN** a claim cannot be tied to evidence and the workflow allows dropping it
- **THEN** it does not appear in the report as a finding

### Requirement: Diagram sources
The delivery graph SHALL be documented with a Mermaid diagram in the change's `design.md` while it is a proposal, and with an editable draw.io source in the repository after implementation. The draw.io source SHALL stay editable (a `.drawio` file, not only an exported image) and SHALL use the project's design system: background `#0b1326`, surfaces `#171f33` and `#222a3d`, borders `#45464d`, text `#dae2fd`, accents `#2fd9f4`, `#7bd0ff`, `#5bbfae` and `#8dc63f`, fonts Space Grotesk and Manrope with Geist Sans as fallback.

#### Scenario: Editable source present
- **WHEN** the change is implemented
- **THEN** a `.drawio` file with the twelve nodes of the delivery graph exists in the repository and opens in draw.io

#### Scenario: Palette respected
- **WHEN** the `.drawio` file is checked
- **THEN** its fill, stroke and font colors come from the palette above
