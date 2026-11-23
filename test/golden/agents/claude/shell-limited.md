---
name: shell-limited
description: Fixture agent whose disallowedTools entry has a specifier. Use in tests.
tools: Read, Grep, Bash
disallowedTools:
  - Bash(rm *)
---

Read and search. Do not delete anything.
<!-- agent-skills: sha256=96f986e085affaae62c9cec029429a973bb69a7276b158cdbb40dfade75ce1d3 version=1.2.3 -->
