# agent-skills

[![validate](https://github.com/rezendesfelipe/agent-skills/actions/workflows/validate.yml/badge.svg)](https://github.com/rezendesfelipe/agent-skills/actions/workflows/validate.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

A public collection of [Agent Skills](https://docs.claude.com/en/docs/claude-code/skills) for Claude Code and other agents that read `SKILL.md` files. Every skill here is designed spec-first with [OpenSpec](https://github.com/Fission-AI/OpenSpec).

## Install

### As a Claude Code plugin marketplace (recommended)

```text
/plugin marketplace add rezendesfelipe/agent-skills
/plugin install <plugin-name>@rezendesfelipe-agent-skills
```

Run `/plugin` to browse the plugins this marketplace offers.

### Copy a single skill by hand

```bash
git clone https://github.com/rezendesfelipe/agent-skills.git
# personal (all projects)
cp -r agent-skills/plugins/<plugin>/skills/<skill> ~/.claude/skills/
# or only for one project
cp -r agent-skills/plugins/<plugin>/skills/<skill> <your-project>/.claude/skills/
```

## Catalog

| Plugin | Skills | Description |
|--------|--------|-------------|
| _none yet_ | | The first skills are coming soon. |

## Layout

```text
.claude-plugin/marketplace.json   # marketplace manifest: lists every plugin
plugins/<plugin>/skills/<skill>/SKILL.md
templates/skill/SKILL.md          # starting point for new skills
openspec/specs/                   # current specs of this repository
openspec/changes/                 # proposed changes being worked on
scripts/validate-skills.mjs       # format and manifest checks (also run in CI)
```

## Contributing

Every skill starts as an OpenSpec change. See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE)
