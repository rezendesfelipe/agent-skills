---
title: "Technical assessment"
subtitle: "Acme platform"
author: "Ana Souza"
date: "2026-11-20"
version: "1.0"
lang: "pt-BR"
summary: |2
  **7 findings are backed by evidence** and 1 of them are Critical.

  1 claim could not be verified and needs evidence before it is acted on.
sources:
  - title: "CIS Microsoft Azure Foundations Benchmark (2.0.0)"
    url: "https://example.com/cis"
    date: "2023-02-23"
    accessed: "2026-11-01"
annexes:
  - title: "Registro de achados"
    file: "annex-findings.md"
  - title: "Índice de evidências e registro de verificação"
    file: "annex-evidence.md"
  - title: "Mapeamento de frameworks"
    file: "annex-frameworks.md"
  - title: "Método e limites"
    file: "annex-method.md"
changes:
  - version: "1.0"
    date: "2026-11-20"
    author: "Ana Souza"
    description: "Primeira emissão do relatório de avaliação com 7 achado(s) e 1 não verificado(s)."
---

# Avaliação em resumo

Esta avaliação de Acme registra 7 achado(s): 1 Crítico(s), 1 Alto(s), 3 Médio(s), 2 Baixo(s) e 0 Informativo(s). 1 afirmação(ões) não pôde(puderam) ser verificada(s) e aparece(m) separadamente. 2 achado(s) são ganhos rápidos.

# Principais achados

| ID | Achado | Severidade | Confiança | Esforço |
|---|---|---|---|---|
| F-006 | A private key is committed | Crítica | Verificado | S |
| F-001 | Storage accepts TLS 1.0 and public traffic | Alta | Verificado | S |
| F-002 | No diagnostic settings are defined | Média | Verificado | M |
| F-003 | Restores are not tested | Média | Corroborado | M |
| F-004 | Admin access review is yearly | Média | Relatado, verificar antes de agir | S |
| F-007 | Rollback is manual | Baixa | Verificado | S |
| F-008 | Runbook snippet pipes curl to a shell | Baixa | Verificado | S |

## F-006: A private key is committed

A private key file is stored in the repository.

**Recomendação.** Rotate the key and remove the file from history.

## F-001: Storage accepts TLS 1.0 and public traffic

The log storage account allows TLS 1.0 and public network access.

**Recomendação.** Set min\_tls\_version to TLS1\_2 and disable public access.

## Verificar primeiro

Estes itens não estão verificados, mas seriam Críticos ou Altos se confirmados. Reúna as evidências antes de confiar no restante do roteiro.

| ID | Achado | Severidade potencial | Confiança |
|---|---|---|---|
| F-003 | Restores are not tested | Crítica | Corroborado |

# Matriz de severidade e esforço

IDs dos achados por severidade (linhas) e esforço estimado (colunas). O esforço é uma estimativa de ordem de grandeza do trabalho da equipe do cliente, em pessoa-dias.

| Severidade / Esforço | S (1-2) | M (3-10) | L (11-30) | XL (\>30) |
|---|---|---|---|---|
| Crítica | F-006 | - | - | - |
| Alta | F-001 | - | - | - |
| Média | F-004 | F-002, F-003 | - | - |
| Baixa | F-007, F-008 | - | - | - |

## Ganhos rápidos

Achados Altos ou Críticos que exigem esforço pequeno ou médio.

- F-006: A private key is committed (Crítica, Esforço S)
- F-001: Storage accepts TLS 1.0 and public traffic (Alta, Esforço S)

# Roteiro: 30, 60 e 90 dias

## Onda 1: dias 0-30

| ID | Ação | Trata de | Esforço | Risco da mudança | Depende de |
|---|---|---|---|---|---|
| A-001 | Raise the storage TLS floor and close public access | F-001 | S | Baixo | - |
| A-002 | Rotate the committed key and purge it from history | F-006 | S | Médio | - |
| A-006 | Collect evidence for F-005 | F-005 | S | Baixo | - |

Esforço estimado desta onda: 3-6 pessoa-dias.

Atenção: wave 1 may exceed the stated capacity of 5 person-days (estimate 3-6)

## Onda 2: dias 31-60

| ID | Ação | Trata de | Esforço | Risco da mudança | Depende de |
|---|---|---|---|---|---|
| A-003 | Add diagnostic settings | F-002 | M | Baixo | A-001 |
| A-004 | Test a restore and schedule it quarterly | F-003 | M | Médio | - |

Esforço estimado desta onda: 6-20 pessoa-dias.

## Onda 3: dias 61-90

| ID | Ação | Trata de | Esforço | Risco da mudança | Depende de |
|---|---|---|---|---|---|
| A-005 | Automate rollback | F-007 | L | Alto | A-003 |

Esforço estimado desta onda: 11-30 pessoa-dias.

# Decisões necessárias do cliente

- Approve a maintenance window for the key rotation. (F-006, A-002)

# O que não pôde ser verificado

Estas afirmações não têm evidência que um script possa conferir. Não são achados: cada uma tem uma ação para reunir a evidência.

| ID | Achado | Por que falhou | Ação |
|---|---|---|---|
| F-005 | A variable that does not exist | quote-mismatch | A-006 |

# Escopo e limites

**Dentro do escopo**

- infra/\*\*
- pipelines/\*\*

**Fora do escopo**

- docs/\*\*

**Perguntas que esta avaliação responde**

- Is the platform ready for production?

**Premissas**

- The repository is the source of truth.

Um script conferiu que cada trecho citado existe onde o relatório diz que existe. Ele não conferiu se o trecho sustenta a afirmação; esse julgamento é do leitor, e por isso os achados Críticos e Altos mostram as citações.
