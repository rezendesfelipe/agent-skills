## 1. Repository basics

- [x] 1.1 Add MIT `LICENSE`
- [x] 1.2 Add `.gitignore`
- [x] 1.3 Write `README.md` with marketplace and manual installation instructions

## 2. Catalog structure

- [x] 2.1 Create `plugins/` with a `.gitkeep`
- [x] 2.2 Add `.claude-plugin/marketplace.json` with owner metadata and an empty plugin list
- [x] 2.3 Add `templates/skill/SKILL.md` that passes validation once renamed

## 3. Validation

- [x] 3.1 Implement `scripts/validate-skills.mjs` (frontmatter and manifest consistency checks)
- [x] 3.2 Add `.github/workflows/validate.yml` running the validator and `openspec validate --all --strict`
- [x] 3.3 Run the validator and OpenSpec validation locally and confirm both pass

## 4. Contribution docs

- [x] 4.1 Write `CONTRIBUTING.md` describing the OpenSpec-first workflow and skill checklist
