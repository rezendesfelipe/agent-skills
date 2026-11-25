<!-- Open this pull request as a draft. It leaves draft only after the checks pass. -->

## Change

- OpenSpec change name: `<name>`
- Branch: `claude/<name>`
- Delivery graph node: `node:<node>` (see docs/aep/delivery-graph.md)

## Gates

- [ ] **Gate 1** (before implementation): the maintainer's approval of the proposal is linked here: <link to the approval comment or review>
- [ ] `tasks.md` is complete: `node scripts/delivery-check.mjs tasks <name>` passes, or each open task says why it stays open
- [ ] Checks run and pass: `node scripts/validate-skills.mjs`, `npm test`, `npx --yes @fission-ai/openspec@1.7.0 validate --all --strict --no-interactive`
- [ ] Independent review verdict (a fresh context, read-only): `review:approved` or `review:changes-requested`, with its comment linked: <link>
- [ ] Cycle count: `cycle:<n>` of 3 (after 3, label `needs:maintainer` and stop)
- [ ] Rebased on the current `main`
- [ ] **No version bump**, no tag and no change to `publish.yml`, unless this is a release change with the maintainer's explicit OK for the version (gate 2): <link>
- [ ] Conventional Commits; no client data, secrets or personal data
- [ ] New or changed skill or agent: its example prompts (prompt, what it produces, how to get good results) are added or updated, in English and pt-BR (`test/prompt-examples.test.mjs` passes; see CONTRIBUTING.md, "Example prompts"): <link, or `not applicable`>

## Summary

<!-- What changed and why. Evidence as `path/to/file:line` or a command and its output. Anything not verified goes under "Not verified". -->
