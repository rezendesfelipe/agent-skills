---
name: "readonly-reviewer"
description: "Fixture read-only agent. Use in tests."
kind: local
tools:
  - "read_file"
  - "grep_search"
---

Review the code and report findings with `file:line`.
<!-- agent-skills: sha256=1804c28774835b2fc268288a66d3d1a9edeb0ffc18b74e4af5c1d4ea57a925fa version=1.2.3 -->
