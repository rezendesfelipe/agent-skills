# Repository protection (checklist for the maintainer)

Part of the [delivery graph](delivery-graph.md) documentation. Spec requirement: `Repository protection as a release prerequisite`.

This page is a **recommended configuration**, a checklist the maintainer applies. It is a prerequisite for any release automation. The changes to the repository ruleset, to CodeQL and to the tag rules are **applied by the maintainer, not by an agent**, and they are not part of any change's diff. An agent asked to edit the ruleset does not do it and refers the maintainer to this checklist.

## Measured state on 2026-11-23

Measured by the maintainer's session and recorded in the change's `design.md` (Decision 12), not re-measured by this page:

- Ruleset `main-protection` (branch) has: `deletion`; `non_fast_forward`; `required_status_checks` with an **empty** list and strict `true`; `code_scanning` (CodeQL, `high_or_higher`) while the CodeQL default setup is `not-configured`, so the rule would block any pull request that has no bypass; `pull_request` with 0 required approvals; and an administrator bypass in mode `always`.
- There is **no ruleset for tags**, and the tags `v0.2.0` to `v0.5.0` exist.
- Consequence: because the required checks list is empty, the protection does not yet stop a red pull request, and the `always` bypass lets an administrator push to `main` directly. Until the checklist is applied, "green CI" in the graph is **not enforced by the repository**, and release automation is not built.

## The checklist

- [ ] **1. Required status checks.** List every GitHub Actions job: `validate`; `test` on ubuntu, macos and windows with Node 20, 22 and 24 (9 jobs); `docs-generator` on Node 20 and 24; `azure-terraform-stacks` on Node 20 and 24; `azure-terraform-stacks-deep`. That is 15 jobs. The names as the Actions run shows them (read from a recent `validate` run) are:
  - `validate`
  - `test (ubuntu-latest, 20)`, `test (ubuntu-latest, 22)`, `test (ubuntu-latest, 24)`
  - `test (macos-latest, 20)`, `test (macos-latest, 22)`, `test (macos-latest, 24)`
  - `test (windows-latest, 20)`, `test (windows-latest, 22)`, `test (windows-latest, 24)`
  - `docs-generator (20)`, `docs-generator (24)`
  - `azure-terraform-stacks (20)`, `azure-terraform-stacks (24)`
  - `azure-terraform-stacks-deep`

  Confirm the names from a recent run before saving the ruleset. Note: the change `define-aep-delivery-graph` adds one more job to `.github/workflows/validate.yml`, `delivery-check` (task 3.3). It is not in the 15 above; the maintainer decides whether to require it too.
- [ ] **2. CodeQL.** Enable the default setup with the languages `actions` and `javascript-typescript`, so that the `code_scanning` rule can be satisfied and does not block every pull request.
- [ ] **3. Administrator bypass.** Limit the bypass of the `main` ruleset to the mode `pull_request`, not `always`: an administrator may bypass through a pull request but cannot push straight to `main`.
- [ ] **4. Tag ruleset.** A ruleset on `refs/tags/v*` that restricts creation, update and deletion, so that a published tag cannot be moved or deleted and a new `v*` tag (which triggers `publish.yml`) cannot be created by accident or without the maintainer.
- [ ] **5. Labels and the decision on `main`.** Create the labels `node:*`, `cycle:1`, `cycle:2`, `cycle:3`, `review:approved`, `review:changes-requested` and `needs:maintainer`, and record the decision on branch protection for `main`.

Each item is confirmed by the maintainer on the pull request when it is in place.

## The honest limit

The agents act under the maintainer's identity, who is an administrator. The rules above prevent **accidents and shortcuts** (a direct push, a retagged release, a merge with a red check). They do **not** stop a hostile or compromised agent, because the same identity can edit the ruleset. Nothing on this page claims enforcement against an agent that acts with administrator rights. Until an identity of the agents' own exists, release stays behind human gate 2 and manual.

## Recommended future items (future changes, not tasks of this change)

- **A separate identity for the agents:** a GitHub App or a bot account without administrator permission and without the right to create tags. This is the condition under which release automation could be considered.
- **A protected publish environment:** a GitHub environment with a required reviewer on the npm publish job, as a second human check before an irreversible publish. It needs edits to `.github/workflows/publish.yml` and to the trusted publisher configuration, so it is a separate workflow change.
