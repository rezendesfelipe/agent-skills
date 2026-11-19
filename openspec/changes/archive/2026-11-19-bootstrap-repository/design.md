## Context

The repository is new and public (see proposal.md - Why). Skills must work in Claude Code, which loads skills from plugins installed through a marketplace or from `~/.claude/skills/` and `.claude/skills/`.

## Goals / Non-Goals

**Goals:**
- A layout that works as-is as a Claude Code plugin marketplace.
- Validation that runs locally and in CI with no install step beyond Node.js.

**Non-Goals:**
- A website or generated catalog page.

## Decisions

- **Marketplace with plugins grouping skills** instead of a flat `skills/` folder. This lets users install related skills together with one command and still allows manual copying. Alternative: flat `skills/` only. It is simpler, but users have no install path other than copying by hand.
- **Plugins start empty.** The manifest ships with `"plugins": []`. The first skill change adds both the plugin and its manifest entry.
- **Validator as a single Node script with no dependencies** (`scripts/validate-skills.mjs`), parsing the small frontmatter subset we need. Alternative: a YAML library, which would require `npm install` and a lockfile for one check.
- **`openspec validate --all --strict` in CI** via `npx @fission-ai/openspec`, so specs cannot rot.
- **Agent-specific OpenSpec tooling is not committed.** `.claude/commands/opsx/` and `.claude/skills/openspec-*` are generated per contributor with `openspec init --tools <tool>` and ignored by git. Alternative: commit them so Claude Code users get `/opsx:*` right after cloning. Rejected because the files are tied to one OpenSpec version and one agent, and maintainer tooling under `.claude/skills/` could be mistaken for published skills.

## Risks / Trade-offs

- [Hand-rolled frontmatter parser misses edge cases such as multi-line YAML] → Support plain and quoted scalars plus `>`/`|` blocks; document that frontmatter should stay simple.
- [Marketplace schema changes upstream] → Keep the manifest minimal (`name`, `owner`, `plugins[].name/source/description`).
