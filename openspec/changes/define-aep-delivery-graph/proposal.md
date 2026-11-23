## Why

The maintainer wants this repository to evolve into an **Agentic Engineering Platform (AEP)**. In this project, "AEP" is a **working definition**, not an established market term (no reliable source defines it that way, and this change does not claim one): an evolution of an internal developer platform (IDP) in which agents are first-class **consumers and producers** of the platform. Mapped onto what the repository already has:

| IDP idea | In this repository |
|---|---|
| Capability catalog | The repository and its marketplace: skills and agents under `plugins/` |
| Contract / control plane | OpenSpec specs (`openspec/specs/`, `openspec/changes/`) |
| Orchestration | Graphs (this change) |
| Guardrails | Read-only by default, the CLI's `refused` status, human gates |
| Quality | Evals, CI and the evidence verifier |
| Distribution | The `agent-skills` CLI and the Claude Code marketplace |

Today the delivery flow exists only as prose in `CONTRIBUTING.md` (propose, validate, implement, check, open a PR, archive) and as the maintainer's habits. Agents already do much of that work, but nothing says **who may write where, when an agent may stop and when it must ask, how many times it may retry, where the state of a change lives, or what only the maintainer can decide**. Without that, more agents mean more risk, not more throughput.

The framing that fits is **graph engineering** (Runkle and Chase, ["3 years of graph engineering with LangGraph"](https://www.langchain.com/blog/3-years-of-graph-engineering-with-langgraph), 2026-07-22, the only source read for this change): an agentic system is a state machine whose **nodes** are fixed code, one model call, a tool call or a whole agent, and whose **edges** are deterministic or conditional. Agents are rarely DAGs: cycles (retry, ask for information, review, pause for a human and resume) are normal, and a loop is the simplest cyclic graph. Dynamic fan-out (the article's `Send`: map-reduce with a number of workers known only at runtime) expresses parallel work. The article also says to use a graph when the flow is predictable and an agent harness for open-ended tasks. Delivering a change to this repository is predictable, so it is a graph.

## What Changes

- **New capability `aep-delivery-graph`** with two levels:
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

1. The same bound of 3 cycles for the `propose ↔ validate` loop (the maintainer set 3 only for the apply loop).
2. The review verdict carried as a pull request label (`review:approved`, `review:changes-requested`) plus a verdict comment, because GitHub does not let the author's account approve its own pull request.
3. Which GitHub identity the integrator uses, and whether branch protection on `main` (a repository setting, outside this change's files) is turned on.
4. Whether the deterministic helper also runs in CI.

## Non-goals

- Implementing anything. This change writes the spec; code, scripts, docs and workflows come at `apply`, after gate 1.
- Building or adopting a graph runtime (LangGraph or any other). The graph is a **process specification** executed by agents and CI that exist today; the article is the framing, not a dependency.
- Defining AEP as an industry standard, or claiming that other organizations use the term this way.
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
- Spec effect at archive: a new `openspec/specs/aep-delivery-graph/spec.md`.
