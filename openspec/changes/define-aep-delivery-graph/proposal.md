## Why

The maintainer wants this repository to evolve into an **Agentic Engineering Platform (AEP)** and said that AEP "is not something defined by the project, but we can think of something built for consultancies". This change therefore keeps AEP as a **working definition**, now anchored in two sources and adapted for a consultancy. It does not claim an industry standard.

### What the two sources actually define

- **Weave Intelligence**, ["What is an Agentic Engineering Platform?"](https://weaveintelligence.io/blog/what-is-an-agentic-engineering-platform) (Kaspar von Grünberg, 2026). An AEP is built and run by a platform engineering team so that engineers and AI agents can develop software together; it is the evolved form of the internal developer platform (IDP) and supplies paths, interfaces and guardrails so that humans and agents work reliably at the autonomy level the organization sets. It has three layers: **Tooling** (the IDP planes, with observability and security strips), **Path specifications** (user-achievable outcomes along a value stream, of three kinds: *probabilistic*, agent-driven and checked by evals and humans; *deterministic*, pipeline-driven; *hybrid*, a probabilistic step that produces a candidate followed by a deterministic gate that can route a failure back to the agent) and **Agent Infrastructure** (a **harness** with execution, context, capability and evaluation; **governance** with identity, agent security and agent observability; and a **models** strip). It describes four autonomy levels (human in the loop, on the loop, as orchestrator, outside the loop). Its stated audience is enterprises with a meaningful estate ("typically 50+ developers"), and it says a team without a good IDP should not build an AEP.
- **CNCF blog**, ["Platform engineering for the agentic enterprise: managing applications, resources, and AI agents"](https://www.cncf.io/blog/2026/07/21/platform-engineering-for-the-agentic-enterprise-managing-applications-resources-and-ai-agents/) (Lakmal Warusawithana, WSO2, 2026-07-21). It argues that IDPs assumed a human consumer and that agents are now consumers too, so one platform should manage **applications, resources and AI agents** as first-class entities under one governance model, with each actor (human or agent) having a distinct identity, scoped permissions and an audit trail. It treats **context** as a first-class platform capability, offers reusable **skills** and built-in agents for domains such as site reliability, security, compliance and FinOps, and uses OpenChoreo as its example. It is conceptual: it gives no implementation detail for identity, audit or policy. As read, it does not itself define the term "AEP".

Everything above is attributed to those articles; the rest of this section is **our adaptation**, not something either source says.

### Working definition for a consultancy (our adaptation)

For a consultancy that delivers assessments, architectures and platforms to third parties, an AEP is **the set of reusable, versioned and verifiable capabilities (skills, agents, specs, checks) together with the paths and guardrails through which people and agents deliver engagements, leaving evidence and an audit trail per engagement**. In consultancy terms:

| Concern | What it means for a consultancy | Where it lives here |
|---|---|---|
| Reusable capabilities | A catalog of skills and agents reused across engagements | The repository and its marketplace under `plugins/` |
| Contract | The scope and acceptance of an engagement written as a spec before work starts | OpenSpec changes and specs, human gate 1 |
| Verifiable evidence | A finding is only a finding if it points to evidence; the rest is "not verified" | The level 2 verifier node and the evidence rule |
| Governance | Who may write where, when an agent must stop and ask, who decides | Roles, read-only defaults, the two human gates |
| Audit trail | Who did what, which verdict, how many cycles, per engagement | Pull requests, labels, commits, tasks |
| Multi-client isolation | Client context and data stay inside one engagement | **Not provided by this repository** (see gaps) |
| Deliverables | Reports and artifacts handed to the client | `assessment-report` (approved, merged, change `add-assessment-report-skill`) |

The repository is public (MIT). Client data, client context and engagement outputs therefore **do not belong in it**; the repository holds the reusable catalog and the delivery process, and engagement workspaces are separate.

### Mapping of the sources' layers to this repository

| Source layer or concept | In this repository |
|---|---|
| Tooling (IDP planes, CI, as-code configuration) | GitHub, GitHub Actions, the OpenSpec CLI, `scripts/`, `.github/workflows/` |
| Path specifications, deterministic | CI checks, `openspec validate`, the scope and evidence helper |
| Path specifications, probabilistic and hybrid | The delivery graph of this change: agent nodes `propose`, `apply`, `review` followed by deterministic gates |
| Harness, capability (skills, tools, registries) | The marketplace, skills, and custom agents (change `add-custom-agents`, approved and merged) |
| Harness, evaluation | CI, the independent reviewer, the verifier node with the evidence rule |
| Harness, execution (orchestration) | Claude Code sessions and subagents, OpenSpec CLI, scripts, CI; **no graph runtime** (Decision 11) |
| Governance, agent security | Read-only defaults, tool allowlists, the CLI's `refused` status, human gates |
| CNCF skills and built-in agents | Skills and agents in `plugins/` |
| Distribution (our own layer, not in the sources) | The `agent-skills` CLI and the Claude Code marketplace |
| Autonomy levels | Our reading: agents open pull requests in parallel and humans gate them, which resembles the sources' level 2 (human on the loop); this is a self-assessment, not a claim of conformance |

### Honest gaps against the sources

The sources describe things this repository does **not** have, and this change does not promise to build them: distinct agent identities with scoped, short-lived credentials, budgets and egress control (agents and the maintainer share one GitHub account today); sandboxed agent runtimes; agent observability (traces, token and cost attribution); evaluation with goldens, rubrics and replay; a context layer (service graph, ontology, searchable memory); a tool gateway and registry; a models plane (routing, hosting, cost attribution); output guardrails and data-loss prevention; and per-engagement isolation of context and data. The sources' own caveats also apply: Weave's audience is large organizations, and this is a one-maintainer public repository. Some gaps may become future changes; none is committed here.

### Why a graph, and why no runtime

Today the delivery flow exists only as prose in `CONTRIBUTING.md` (propose, validate, implement, check, open a PR, archive) and as the maintainer's habits. Agents already do much of that work, but nothing says **who may write where, when an agent may stop and when it must ask, how many times it may retry, where the state of a change lives, or what only the maintainer can decide**. Without that, more agents mean more risk, not more throughput.

The framing that fits is **graph engineering** (Runkle and Chase, ["3 years of graph engineering with LangGraph"](https://www.langchain.com/blog/3-years-of-graph-engineering-with-langgraph), 2026-07-22): an agentic system is a state machine whose **nodes** are fixed code, one model call, a tool call or a whole agent, and whose **edges** are deterministic or conditional; agents are rarely DAGs, because cycles (retry, ask for information, revise after validation, pause for a human and resume) are normal; the article recommends a graph when the flow is predictable and an agent harness for open-ended tasks. Delivering a change to this repository is predictable, so it is a graph.

**We use graph engineering as a design discipline, not as a tool.** There is no LangGraph or LangChain runtime, dependency or service in this change or in the repository. The graph is a specification that is executed by Claude Code subagents, the OpenSpec CLI, deterministic scripts and CI. The decision, the alternatives and the criteria for revisiting it are in `design.md` (Decision 11).

## What Changes

- **New capability `aep-delivery-graph`**, with a working definition of AEP grounded in two cited sources and adapted for consultancies, an explicit decision that there is no graph runtime, and two levels:
  - **Level 1, the delivery graph of this repository:** `explore → propose* → validate --strict → human gate 1 → apply* → tests and validate → independent review* → PR and green CI → merge → archive → release queue → human gate 2`. `*` marks an agent node; every other node is deterministic. Cycles: a validation failure returns to `propose`; a test or validation failure and review reservations return to `apply`, at most 3 times, then escalate to the maintainer.
  - **Level 2, the per-agent graph convention:** every new agent or skill change carries, in its `design.md`, a graph with node types (fixed, model, agent), edges, state, cycles and human interruptions, plus a **deterministic verifier node** whenever the agent produces findings. Findings need evidence (`file:line`); output without evidence is dropped or marked "not verified".
- **Decisions already taken by the maintainer, recorded as requirements:** (a) an independent read-only reviewer plus green CI lets the integrator merge and archive alone; reservations go back to the implementer (3 cycles at most), then to the maintainer; (b) "published" means merged to `main` (plugins are then available in the marketplace), while the version bump, the `v*` tag and the npm publish are a **batch release** that happens only with the maintainer's explicit OK; (c) one branch per change, prefixed `claude/`, draft pull request, never a push to `main`; (d) implementation starts only after human gate 1.
- **Roles and permissions:** proposal author (writes only under `openspec/changes/<name>/`), implementer (the change's own worktree), reviewer (read-only, fresh context), integrator (acts only on an approved verdict and green CI).
- **Graph state** lives in three places that already exist: `tasks.md` checkboxes, the pull request (draft state, labels, review verdict) and `.openspec.yaml`.
- **Parallelism:** one worktree per change, rebase before merge, and a rule for the shared files (`README.md`, `.claude-plugin/marketplace.json`, `package.json`); the version bump happens only at release.
- **Documentation and a diagram:** the graph is documented for contributors (`CONTRIBUTING.md` and a page under `docs/`), with a Mermaid diagram in this change's `design.md` and an editable draw.io source in the design system's palette (a task of this change; the `.drawio` file is not generated now). A small deterministic helper checks the parts of the graph that can be checked from the repository alone.

## Capabilities

### New Capabilities
- `aep-delivery-graph`: the working definition of AEP, the level 1 delivery graph (nodes, edges, gates, cycle limits), roles and permissions, state, parallelism, the release gate, and the level 2 convention with the verifier node and the evidence rule.

### Modified Capabilities
- None. `contribution-workflow` stays as it is: its "Spec-first changes" requirement is compatible with this graph. `CONTRIBUTING.md` (not a spec) is updated at apply, notably the step that says the maintainer runs the archive, which decision (a) replaces.

## Decisions that need the maintainer's approval at gate 1

Decisions (a) to (d) above were taken by the maintainer and are written down as requirements. The following are **proposals of this change**, not decided yet (see `design.md`, Open Questions):

Defaults already approved by the maintainer and written into the spec and design: (1) the same bound of 3 cycles for `propose`/`validate`; (2) the review verdict carried as a pull request label plus a verdict comment; (4) the deterministic helper `delivery-check` runs in `validate.yml`, as an implementation task (no workflow is edited now); (5) documentation-only fixes do not skip `propose`.

Still without a maintainer decision, recorded as **recommendations and prerequisites**:

3. **Integrator identity and protection of `main` and of the `v*` tags.** Recommendation: a separate integrator identity, branch protection on `main` (required checks `validate` and `test`, no direct pushes) and tag protection for `v*`, all in place **before any release automation**. These are repository settings that only the maintainer can change.
6. **Release queue.** Recommendation: derive it from `git log` since the last tag and the archived changes, with no extra file; revisit if it proves too coarse.
7. **Roles as installable subagents.** Recommendation: a later, separate change; out of scope here.

## Non-goals

- Implementing anything. This change writes the spec; code, scripts, docs and workflows come at `apply`, after gate 1.
- Building or adopting a graph runtime (LangGraph, LangChain or any other), including checkpointing or durable interrupts. The graph is a **process specification** executed by agents and CI that exist today; graph engineering is a design discipline here, not a dependency. This change does not promise to adopt one; it only sets objective criteria for reconsidering (Decision 11).
- Defining AEP as an industry standard, or claiming that other organizations use the term this way. The definition is a working one, grounded in two cited articles and adapted by us.
- Building the capabilities the sources describe that this repository lacks (agent identity, sandboxing, agent observability, goldens-based evaluation, a context layer, a tool gateway, a models plane, per-engagement isolation). They are listed as gaps, not promised.
- Storing client data, client context or engagement outputs in this public repository.
- Autonomous release. Tags, version bumps and npm publication always need the maintainer's explicit OK.
- Replacing the maintainer's judgment at gate 1 or gate 2, or letting an agent approve its own work.
- Turning the roles into installable subagents or plugins. Role instructions are documented; packaging them is a later change.
- Evals for individual skills, the CLI's `refused` semantics, or a registry of agent outputs. Those are other parts of the AEP programme.
- Changing `publish.yml`, `validate.yml`, `package.json` or `.claude-plugin/marketplace.json` in this change.
- Content in Portuguese: spec text is in English per repository rules.

## Impact

- New in this change: only `openspec/changes/define-aep-delivery-graph/` (proposal, design, tasks, one spec, `.openspec.yaml`).
- At apply (not now): `CONTRIBUTING.md` (delivery graph section, archive step), a page under `docs/aep/` with the diagram and the role instructions, `docs/aep/delivery-graph.drawio`, a helper script and its tests, and a pull request template. Labels and branch protection are GitHub settings that the maintainer sets or confirms.
- No new runtime dependency and no change to the published npm package.
- Related changes already approved and merged to `main`, referenced and not duplicated: `add-assessment-report-skill` (a deliverable skill) and `add-custom-agents` (revised; custom agents as catalog capabilities).
- Spec effect at archive: a new `openspec/specs/aep-delivery-graph/spec.md`.
