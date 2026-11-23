# Índice de evidencias

| ID | Tipo | Ubicación | Resultado | Código | Citada por |
|---|---|---|---|---|---|
| E-001 | file | `infra/main.tf:11-11` | Verificada por script | - | F-001 |
| E-002 | file | `infra/main.tf:12-12` | Verificada por script | - | F-001 |
| E-003 | absence | `infra/**/*.tf` | Verificada por script | - | F-002 |
| E-004 | statement | `CTO` | Sin verificación automática | - | F-003 |
| E-005 | statement | `SRE lead` | Sin verificación automática | - | F-003 |
| E-006 | statement | `Head of security` | Sin verificación automática | - | F-004 |
| E-007 | file | `infra/variables.tf:1-1` | Falló | quote-mismatch | F-005 |
| E-008 | file | `infra/key.pem:1-2` | Verificada por script | - | F-006 |
| E-009 | document | `docs/runbook.md:5-5` | Verificada por script | - | F-007 |
| E-010 | file | `docs/snippet.md:1-1` | Verificada por script | - | F-008 |

# Fallos de verificación

- E-007 \[quote-mismatch\] infra/variables.tf:1-1: lines 1-1 of infra/variables.tf read: "variable \\"resource\_group\_name\\" {". The quote does not appear in the file.
