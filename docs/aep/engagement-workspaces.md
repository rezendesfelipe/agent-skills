# Engagement workspaces

Part of the [delivery graph](delivery-graph.md) documentation. Spec requirement: `Engagement workspaces` in `openspec/changes/define-aep-delivery-graph/specs/aep-delivery-graph/spec.md`.

## Terms

- **Engagement:** a client project (an assessment, a design, a delivery).
- **Workspace:** the isolated area that holds everything of one engagement: the client's artifacts, the state of the runs, the reports, credentials scoped to that client only, an audit log, and a retention and disposal policy.

## Decision

Each engagement gets its **own private repository**, created from a template. The skills and agents of this public repository are **installed into that repository by the `agent-skills` CLI**. The CLI installs this repository's skills and agents and nothing else; **nothing of the client enters this repository**, which is public (MIT). Client artifacts, credentials and reports belong in the engagement's own private repository.

## Alternatives

| Option | Pros | Cons |
|---|---|---|
| A. One private repository per engagement, from a template (**chosen**) | Access, credentials, audit log and disposal are per client. The repository can be archived or deleted when the engagement ends. The catalog stays public and generic | A template to maintain (a future change). Several repositories to administer. Catalog updates are pulled by the CLI, not shared by git |
| B. One private monorepo with a folder per engagement (rejected) | One place to administer | Risk of leaking one client's data to another (a wrong path, a shared search or context, an agent that sees the whole tree). Access is all or nothing. Disposal of one client means rewriting history |
| C. Engagement data inside this public repository (rejected) | Simplest | Violates confidentiality; the repository is public |

## What does not exist yet

The template is **not created** by this change and **is not stored in this repository**. It is a future change, listed in the [graph page](delivery-graph.md#future-changes-not-tasks-of-this-change). No engagement workspace exists here, and no date is promised. Per-engagement isolation of context and data stays listed as a gap of this repository: this decision says where it will be closed, not that it is.
