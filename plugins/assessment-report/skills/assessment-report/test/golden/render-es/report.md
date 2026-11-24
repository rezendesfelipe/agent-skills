---
title: "Technical assessment"
subtitle: "Acme platform"
author: "Ana Souza"
date: "2026-11-20"
version: "1.0"
lang: "es"
summary: |2
  **7 findings are backed by evidence** and 1 of them are Critical.

  1 claim could not be verified and needs evidence before it is acted on.
sources:
  - title: "CIS Microsoft Azure Foundations Benchmark (2.0.0)"
    url: "https://example.com/cis"
    date: "2023-02-23"
    accessed: "2026-11-01"
annexes:
  - title: "Registro de hallazgos"
    file: "annex-findings.md"
  - title: "Índice de evidencias y registro de verificación"
    file: "annex-evidence.md"
  - title: "Mapeo de frameworks"
    file: "annex-frameworks.md"
  - title: "Método y límites"
    file: "annex-method.md"
changes:
  - version: "1.0"
    date: "2026-11-20"
    author: "Ana Souza"
    description: "Primera emisión del informe de evaluación con 7 hallazgo(s) y 1 no verificado(s)."
---

# Evaluación en resumen

Esta evaluación de Acme registra 7 hallazgo(s): 1 Crítico(s), 1 Alto(s), 3 Medio(s), 2 Bajo(s) e 0 Informativo(s). 1 afirmación(es) no se pudo(pudieron) verificar y se lista(n) aparte. 2 hallazgo(s) son ganancias rápidas.

# Hallazgos principales

| ID | Hallazgo | Severidad | Confianza | Esfuerzo |
|---|---|---|---|---|
| F-006 | A private key is committed | Crítica | Verificado | S |
| F-001 | Storage accepts TLS 1.0 and public traffic | Alta | Verificado | S |
| F-002 | No diagnostic settings are defined | Media | Verificado | M |
| F-003 | Restores are not tested | Media | Corroborado | M |
| F-004 | Admin access review is yearly | Media | Informado, verificar antes de actuar | S |
| F-007 | Rollback is manual | Baja | Verificado | S |
| F-008 | Runbook snippet pipes curl to a shell | Baja | Verificado | S |

## F-006: A private key is committed

A private key file is stored in the repository.

**Recomendación.** Rotate the key and remove the file from history.

## F-001: Storage accepts TLS 1.0 and public traffic

The log storage account allows TLS 1.0 and public network access.

**Recomendación.** Set min\_tls\_version to TLS1\_2 and disable public access.

## Verificar primero

Estos elementos no están verificados, pero serían Críticos o Altos si se confirmaran. Reúna su evidencia antes de confiar en el resto de la hoja de ruta.

| ID | Hallazgo | Severidad potencial | Confianza |
|---|---|---|---|
| F-003 | Restores are not tested | Crítica | Corroborado |

# Matriz de severidad y esfuerzo

IDs de hallazgos por severidad (filas) y esfuerzo estimado (columnas). El esfuerzo es una estimación de orden de magnitud del trabajo del equipo del cliente, en personas-día.

| Severidad / Esfuerzo | S (1-2) | M (3-10) | L (11-30) | XL (\>30) |
|---|---|---|---|---|
| Crítica | F-006 | - | - | - |
| Alta | F-001 | - | - | - |
| Media | F-004 | F-002, F-003 | - | - |
| Baja | F-007, F-008 | - | - | - |

## Ganancias rápidas

Hallazgos Altos o Críticos que requieren esfuerzo pequeño o mediano.

- F-006: A private key is committed (Crítica, Esfuerzo S)
- F-001: Storage accepts TLS 1.0 and public traffic (Alta, Esfuerzo S)

# Hoja de ruta: 30, 60 y 90 días

## Ola 1: días 0-30

| ID | Acción | Atiende | Esfuerzo | Riesgo del cambio | Depende de |
|---|---|---|---|---|---|
| A-001 | Raise the storage TLS floor and close public access | F-001 | S | Bajo | - |
| A-002 | Rotate the committed key and purge it from history | F-006 | S | Medio | - |
| A-006 | Collect evidence for F-005 | F-005 | S | Bajo | - |

Esfuerzo estimado de esta ola: 3-6 personas-día.

Aviso: wave 1 may exceed the stated capacity of 5 person-days (estimate 3-6)

## Ola 2: días 31-60

| ID | Acción | Atiende | Esfuerzo | Riesgo del cambio | Depende de |
|---|---|---|---|---|---|
| A-003 | Add diagnostic settings | F-002 | M | Bajo | A-001 |
| A-004 | Test a restore and schedule it quarterly | F-003 | M | Medio | - |

Esfuerzo estimado de esta ola: 6-20 personas-día.

## Ola 3: días 61-90

| ID | Acción | Atiende | Esfuerzo | Riesgo del cambio | Depende de |
|---|---|---|---|---|---|
| A-005 | Automate rollback | F-007 | L | Alto | A-003 |

Esfuerzo estimado de esta ola: 11-30 personas-día.

# Decisiones que necesita del cliente

- Approve a maintenance window for the key rotation. (F-006, A-002)

# Lo que no se pudo verificar

Estas afirmaciones no tienen evidencia que un script pueda comprobar. No son hallazgos: cada una tiene una acción para reunir su evidencia.

| ID | Hallazgo | Por qué falló | Acción |
|---|---|---|---|
| F-005 | A variable that does not exist | quote-mismatch | A-006 |

# Alcance y límites

**Dentro del alcance**

- infra/\*\*
- pipelines/\*\*

**Fuera del alcance**

- docs/\*\*

**Preguntas que responde esta evaluación**

- Is the platform ready for production?

**Supuestos**

- The repository is the source of truth.

Un script comprobó que cada extracto citado existe donde el informe dice que existe. No comprobó que el extracto respalde la afirmación; ese juicio corresponde al lector, y por eso los hallazgos Críticos y Altos muestran sus citas.
