## Why

We want a single public place where people can discover and install reusable Agent Skills. The repository is empty, so before adding any skill we need to agree on its layout, how users install skills, and how contributions are checked. Otherwise every new skill would invent its own conventions.

## What Changes

- Define the repository layout: plugins in `plugins/<plugin>/`, skills in `plugins/<plugin>/skills/<skill>/SKILL.md`.
- Add a Claude Code plugin marketplace manifest (`.claude-plugin/marketplace.json`) so users can run `/plugin marketplace add rezendesfelipe/agent-skills`.
- Add a skill template, `README.md`, `CONTRIBUTING.md` and an MIT `LICENSE`.
- Add a dependency-free validation script for skill frontmatter and manifest consistency.
- Add a GitHub Actions workflow that runs the skill validator and `openspec validate --all --strict` on every push and pull request.
- Document that each new skill or structural change starts as an OpenSpec change.

## Capabilities

### New Capabilities
- `skill-catalog`: the layout and the required format of every skill published in the repository.
- `marketplace-distribution`: how end users discover and install skills from the repository.
- `contribution-workflow`: how new skills and changes are proposed, validated and accepted.

### Modified Capabilities
<!-- none: no existing specs -->

## Non-goals

- Publishing actual skills. Each skill arrives in its own OpenSpec change.
- Supporting distribution channels other than the Claude Code plugin marketplace and plain copy of `SKILL.md` folders (npm packages, registries, etc.).
- Automated release versioning or changelog generation.

## Impact

- New files at the repository root, `.claude-plugin/`, `plugins/`, `templates/`, `scripts/` and `.github/workflows/`.
- CI depends on Node.js (LTS) and the `@fission-ai/openspec` CLI. The validator itself has no npm dependencies.
