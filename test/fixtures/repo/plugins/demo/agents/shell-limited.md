---
name: shell-limited
description: Fixture agent whose disallowedTools entry has a specifier. Use in tests.
tools: Read, Grep, Bash
disallowedTools:
  - Bash(rm *)
---

Read and search. Do not delete anything.
