# Evidence index

| ID | Kind | Location | Result | Code | Cited by |
|---|---|---|---|---|---|
| E-001 | file | `infra/main.tf:11-11` | Verified by script | - | F-001 |
| E-002 | file | `infra/main.tf:12-12` | Verified by script | - | F-001 |
| E-003 | absence | `infra/**/*.tf` | Verified by script | - | F-002 |
| E-004 | statement | `CTO` | Not machine-checked | - | F-003 |
| E-005 | statement | `SRE lead` | Not machine-checked | - | F-003 |
| E-006 | statement | `Head of security` | Not machine-checked | - | F-004 |
| E-007 | file | `infra/variables.tf:1-1` | Failed | quote-mismatch | F-005 |
| E-008 | file | `infra/key.pem:1-2` | Verified by script | - | F-006 |
| E-009 | document | `docs/runbook.md:5-5` | Verified by script | - | F-007 |
| E-010 | file | `docs/snippet.md:1-1` | Verified by script | - | F-008 |

# Verification failures

- E-007 \[quote-mismatch\] infra/variables.tf:1-1: lines 1-1 of infra/variables.tf read: "variable \\"resource\_group\_name\\" {". The quote does not appear in the file.
