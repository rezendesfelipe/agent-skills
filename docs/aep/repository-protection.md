# Repository protection (checklist for the maintainer)

Part of the [delivery graph](delivery-graph.md) documentation. Spec requirement: `Repository protection as a release prerequisite`.

This page is a **recommended configuration** and a record of what was read. It is a prerequisite for any release automation. Changes to the repository ruleset, to CodeQL and to the tag rules are **applied by the maintainer, not by an agent**, and are not part of any change's diff. An agent asked to edit the ruleset does not do it and refers the maintainer to this checklist.

## State read on 2026-11-25 (a dated snapshot)

Read-only, with `gh api` on `repos/rezendesfelipe/agent-skills/rulesets/27931984` and `/27933425`, on `rulesets`, on `git/ref/tags/v0.6.0`, on `tags`, on `code-scanning/default-setup` and on `labels`. Nothing was written. This is a snapshot: re-read it before relying on it, because settings change. It replaces the snapshot of 2026-11-24, which is no longer true for the bypass of either ruleset.

**Ruleset `main-protection` (id 27931984, branch, enforcement `active`, target `~DEFAULT_BRANCH`, last updated 2026-11-24T12:58:15Z):**

- Rules: `deletion`; `non_fast_forward`; `required_status_checks` with `strict_required_status_checks_policy` true and 15 required checks, listed below; `pull_request` with 0 required approving reviews. There is no `code_scanning` rule.
- The 15 required checks, as the API returns them: `validate`; `test (ubuntu-latest, 20)`, `test (ubuntu-latest, 22)`, `test (ubuntu-latest, 24)`, `test (macos-latest, 20)`, `test (macos-latest, 22)`, `test (macos-latest, 24)`, `test (windows-latest, 20)`, `test (windows-latest, 22)`, `test (windows-latest, 24)`; `docs-generator (20)` and `docs-generator (24)`; `azure-terraform-stacks (20)` and `azure-terraform-stacks (24)`; `azure-terraform-stacks-deep`.
- Not required: the job `assessment-report` (four legs: ubuntu-latest and windows-latest, each on Node 20 and 24) and the job `delivery-check`. None of their names is in the list above. Requiring the four `assessment-report` legs is a maintainer action, planned after about two weeks of green runs (see below).
- Bypass: one actor, an **Integration** (actor id 1236702), in mode **`pull_request`** (the API read returns `actor_type` `Integration` and `bypass_mode` `pull_request`). The maintainer has said that this integration is Claude; the API read shows only the id and the type, so that is the maintainer's statement, not something the read verifies. `current_user_can_bypass` read `never` for the identity that made the read. No bypass is given to a repository role.

**Ruleset `release-tags-protection` (id 27933425, tag, enforcement `active`, pattern `refs/tags/v*`, last updated 2026-11-25T01:08:29Z):** rules `creation`, `update` and `deletion`. `bypass_actors` is empty: **no bypass**. The tag `v0.6.0` exists (the ref `refs/tags/v0.6.0` is an annotated tag object). It was created by relaxing this ruleset temporarily and then enforcing it again (the maintainer's account of the release); the API read does not show the relaxation, only that the enforcement is `active` now and that the ruleset was last updated at the time above. The ruleset list shows both rulesets `active`.

**Other:**

- CodeQL default setup: `not-configured`.
- Labels: only GitHub's defaults (`accessibility`, `bug`, `documentation`, `duplicate`, `enhancement`, `good first issue`, `help wanted`, `invalid`, `question`, `wontfix`). The labels `node:*`, `cycle:1` to `cycle:3`, `review:*` and `needs:maintainer` **do not exist**.
- Tags present: `v0.2.0`, `v0.2.1`, `v0.3.0`, `v0.4.0`, `v0.5.0`, `v0.6.0`.

## The checklist

Status is as read on 2026-11-25.

- [x] **1. Required status checks.** In place: the 15 Actions jobs listed above, with `strict`. Decision left to the maintainer: whether to require the `delivery-check` job too (it runs only on `claude/*` pull requests and is skipped otherwise, which counts as passing).
- [ ] **2. CodeQL.** Not configured. The `code_scanning` rule was removed from `main-protection`, so a missing CodeQL setup no longer blocks pull requests. Enabling the default setup (languages `actions` and `javascript-typescript`) stays a **future layer**, not a prerequisite of this change.
- [x] **3. Bypass of the `main` ruleset limited to `pull_request`.** Done: the Integration's bypass is in mode `pull_request`, as read on 2026-11-25. It can act through a pull request but not push straight to `main`.
- [x] **4. Tag ruleset.** Done: the ruleset on `refs/tags/v*` has `creation`, `update` and `deletion`, enforcement `active`, and an empty bypass list, as read on 2026-11-25. Creating or deleting a `v*` tag needs the maintainer.
- [ ] **5. Labels.** `node:*`, `cycle:1`, `cycle:2`, `cycle:3`, `review:approved`, `review:changes-requested` and `needs:maintainer` do not exist yet. The maintainer creates them.

## The `assessment-report` job (decision for the maintainer)

The change `harden-assessment-secret-scan` adds the job `assessment-report` to `validate.yml`. It runs the engine tests of the `assessment-report` skill and its contract test with `docs-generator` on Linux and Windows. It reports on every pull request (no path filter) but is **not a required check**: until the maintainer edits the ruleset, a failure of this job does not block a merge. Only the maintainer edits the ruleset (a repository setting, not part of any diff).

Exact names of the four checks, as the matrix produces them:

- `assessment-report (ubuntu-latest, 20)`
- `assessment-report (ubuntu-latest, 24)`
- `assessment-report (windows-latest, 20)`
- `assessment-report (windows-latest, 24)`

Recommendation: require them after the job has been green for about two weeks. The required count then goes from 15 to 19. Trade-off: a flaky job would block every pull request, and each change of the matrix (an OS or a Node version) changes the required names.

## What the current bypass allows (and why this page does not call "green CI" enforced)

The Integration (the identity that Claude acts with, per the maintainer) bypasses `main-protection` in mode `pull_request`, and `release-tags-protection` has no bypass. What the rulesets say, as read on 2026-11-25:

- A direct push to `main` is not allowed for the Integration (the mode is `pull_request`, not `always`). Through a pull request, a bypass actor can merge without the required checks being green, as the bypass mode is meant to allow; this page did not test it, so it does not claim what happens on a red check.
- Creating, moving or deleting a `v*` tag is blocked for every actor, because the bypass list is empty, until the maintainer relaxes the ruleset. A `v*` tag triggers the npm publish workflow (a published npm version cannot be reused).

Rules that an actor can edit do not stop that actor, so "no tag without the maintainer" holds while only the maintainer can edit the ruleset. That is a property of the repository settings, not something this page can verify. Release automation is not built.

## Recommended changes (maintainer actions, not in any diff)

Done (see the checklist): the bypass of `main-protection` is `pull_request` (item 3) and `release-tags-protection` has no bypass (item 4). Still open:

1. Create the labels of item 5.
2. Decide whether `delivery-check` is a required check.
3. Decide whether to require the four `assessment-report (...)` checks (15 to 19 required checks), after about two weeks of green runs. Not required today.

## The honest limit

Even with these changes, rules that an actor can bypass or edit do not stop a hostile or compromised agent. They prevent accidents and shortcuts (a direct push, a retagged release, a merge with a red check) for actors that are not allowed to bypass them. Nothing on this page claims enforcement against an agent that acts with an identity that has bypass or administrator rights. Until an identity of the agents' own exists, release stays behind human gate 2 and manual.

## Recommended future items (future changes, not tasks of this change)

- **A separate identity for the agents:** a GitHub App or a bot account without administrator permission, without bypass of the rulesets and without the right to create tags. This is the condition under which release automation could be considered.
- **A protected publish environment:** a GitHub environment with a required reviewer on the npm publish job, as a second human check before an irreversible publish. It needs edits to `.github/workflows/publish.yml` and to the trusted publisher configuration, so it is a separate workflow change.
- **CodeQL** default setup for `actions` and `javascript-typescript`, as an additional layer.
