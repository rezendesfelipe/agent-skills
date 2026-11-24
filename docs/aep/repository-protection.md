# Repository protection (checklist for the maintainer)

Part of the [delivery graph](delivery-graph.md) documentation. Spec requirement: `Repository protection as a release prerequisite`.

This page is a **recommended configuration** and a record of what was read. It is a prerequisite for any release automation. Changes to the repository ruleset, to CodeQL and to the tag rules are **applied by the maintainer, not by an agent**, and are not part of any change's diff. An agent asked to edit the ruleset does not do it and refers the maintainer to this checklist.

## State read on 2026-11-24 at 00:32 UTC (a dated snapshot)

Read-only, with `gh api` on `repos/rezendesfelipe/agent-skills/rulesets`, on each ruleset, on `code-scanning/default-setup`, on `labels` and on `tags`. Nothing was written. This is a snapshot: re-read it before relying on it, because settings change.

**Ruleset `main-protection` (id 27931984, branch, enforcement `active`, target `~DEFAULT_BRANCH`, last updated 2026-11-23T20:16:39Z):**

- Rules: `deletion`; `non_fast_forward`; `required_status_checks` with `strict` true and 15 checks (`validate`; `test (ubuntu-latest|macos-latest|windows-latest, 20|22|24)`; `docs-generator (20)` and `(24)`; `azure-terraform-stacks (20)` and `(24)`; `azure-terraform-stacks-deep`); `pull_request` with 0 required approving reviews. There is no `code_scanning` rule any more.
- Bypass: one actor, an **Integration** (id 1236702) in mode **`always`**. The maintainer confirmed that this integration is Claude (the API read shows only the id and type, so that is the maintainer's statement, not something the read verifies). The bypass is not given to the administrator role.
- The `delivery-check` job added by this change is **not** among the 15 required checks.

**Ruleset `release-tags-protection` (id 27933425, tag, enforcement `active`, pattern `refs/tags/v*`, last updated 2026-11-23T20:15:27Z):** rules `creation`, `update` and `deletion`. Bypass: the same Integration (id 1236702), mode `always`.

**Other:**

- CodeQL default setup: `not-configured` (available languages: actions, javascript, javascript-typescript, typescript).
- Labels: only GitHub's defaults (`bug`, `documentation`, `duplicate`, `enhancement`, `good first issue`, `help wanted`, `invalid`, `question`, `wontfix`, `accessibility`). The labels `node:*`, `cycle:1` to `cycle:3`, `review:*` and `needs:maintainer` **do not exist**.
- Tags present: `v0.2.0`, `v0.2.1`, `v0.3.0`, `v0.4.0`, `v0.5.0`.

## The checklist

Status is as read on the date above.

- [x] **1. Required status checks.** In place: the 15 Actions jobs, with `strict`. Decision left to the maintainer: whether to require the `delivery-check` job too (it runs only on `claude/*` pull requests and is skipped otherwise, which counts as passing).
- [ ] **2. CodeQL.** Not configured. The `code_scanning` rule was removed from `main-protection`, so a missing CodeQL setup no longer blocks pull requests. Enabling the default setup (languages `actions` and `javascript-typescript`) stays a **future layer**, not a prerequisite of this change.
- [ ] **3. Bypass of the `main` ruleset limited to `pull_request`.** Not in place as recommended. The bypass exists for the Integration, in mode `always` (not for the administrator role). Recommended: mode `pull_request`, so the actor can still act through a pull request but cannot push straight to `main`.
- [ ] **4. Tag ruleset.** The ruleset on `refs/tags/v*` is in place with `creation`, `update` and `deletion`. What remains is the bypass: the Integration can bypass it always. Recommended: **remove the Integration from the tag ruleset's bypass**, so that creating or deleting a `v*` tag needs the maintainer.
- [ ] **5. Labels.** `node:*`, `cycle:1`, `cycle:2`, `cycle:3`, `review:approved`, `review:changes-requested` and `needs:maintainer` do not exist yet. The maintainer creates them.

## What the current bypass allows (and why this page does not call "green CI" enforced)

Because the Integration bypasses `main-protection` in mode `always`, and the Integration is the identity that Claude acts with:

- Claude **can merge without green checks**, and **can push directly to `main`**. The required checks and the pull request rule bind other actors, not this one.
- Claude **can create, move or delete `v*` tags**, and a `v*` tag triggers the npm publish workflow (a published npm version cannot be reused).

So the repository does **not** enforce "green CI before merge", "no push to `main`" or "no tag without the maintainer" against Claude today. Those remain instructions in the [roles](roles.md) plus human gate 2. Release automation is not built.

## Recommended changes (maintainer actions, not in any diff)

1. Set the Integration's bypass on `main-protection` to `pull_request` instead of `always`.
2. Remove the Integration from the bypass of `release-tags-protection`.
3. Create the labels of item 5.
4. Decide whether `delivery-check` is a required check.

## The honest limit

Even with these changes, rules that an actor can bypass or edit do not stop a hostile or compromised agent. They prevent accidents and shortcuts (a direct push, a retagged release, a merge with a red check) for actors that are not allowed to bypass them. Nothing on this page claims enforcement against an agent that acts with an identity that has bypass or administrator rights. Until an identity of the agents' own exists, release stays behind human gate 2 and manual.

## Recommended future items (future changes, not tasks of this change)

- **A separate identity for the agents:** a GitHub App or a bot account without administrator permission, without bypass of the rulesets and without the right to create tags. This is the condition under which release automation could be considered.
- **A protected publish environment:** a GitHub environment with a required reviewer on the npm publish job, as a second human check before an irreversible publish. It needs edits to `.github/workflows/publish.yml` and to the trusted publisher configuration, so it is a separate workflow change.
- **CodeQL** default setup for `actions` and `javascript-typescript`, as an additional layer.
