---
title: "Technical assessment"
subtitle: "Acme platform"
author: "Ana Souza"
date: "2026-11-20"
version: "1.0"
lang: "en"
summary: |2
  **7 findings are backed by evidence** and 1 of them are Critical.

  1 claim could not be verified and needs evidence before it is acted on.
sources:
  - title: "CIS Microsoft Azure Foundations Benchmark (2.0.0)"
    url: "https://example.com/cis"
    date: "2023-02-23"
    accessed: "2026-11-01"
annexes:
  - title: "Finding register"
    file: "annex-findings.md"
  - title: "Evidence index and verification log"
    file: "annex-evidence.md"
  - title: "Framework mapping"
    file: "annex-frameworks.md"
  - title: "Method and limits"
    file: "annex-method.md"
changes:
  - version: "1.0"
    date: "2026-11-20"
    author: "Ana Souza"
    description: "First issue of the assessment report with 7 finding(s) and 1 not verified."
---

# Headline assessment

This assessment of Acme reports 7 finding(s): 1 Critical, 1 High, 3 Medium, 2 Low and 0 Info. 1 claim(s) could not be verified and are listed separately. 2 finding(s) are quick wins.

# Main findings

| ID | Finding | Severity | Confidence | Effort |
|---|---|---|---|---|
| F-006 | A private key is committed | Critical | Verified | S |
| F-001 | Storage accepts TLS 1.0 and public traffic | High | Verified | S |
| F-002 | No diagnostic settings are defined | Medium | Verified | M |
| F-003 | Restores are not tested | Medium | Corroborated | M |
| F-004 | Admin access review is yearly | Medium | Reported, verify before acting | S |
| F-007 | Rollback is manual | Low | Verified | S |
| F-008 | Runbook snippet pipes curl to a shell | Low | Verified | S |

## F-006: A private key is committed

A private key file is stored in the repository.

**Recommendation.** Rotate the key and remove the file from history.

## F-001: Storage accepts TLS 1.0 and public traffic

The log storage account allows TLS 1.0 and public network access.

**Recommendation.** Set min\_tls\_version to TLS1\_2 and disable public access.

## Verify first

These items are not verified, yet they would be Critical or High if confirmed. Collect their evidence before relying on the rest of the roadmap.

| ID | Finding | Potential severity | Confidence |
|---|---|---|---|
| F-003 | Restores are not tested | Critical | Corroborated |

# Severity and effort matrix

Finding IDs by severity (rows) and estimated effort (columns). Effort is an order-of-magnitude estimate of the client team's work, in person-days.

| Severity / Effort | S (1-2) | M (3-10) | L (11-30) | XL (\>30) |
|---|---|---|---|---|
| Critical | F-006 | - | - | - |
| High | F-001 | - | - | - |
| Medium | F-004 | F-002, F-003 | - | - |
| Low | F-007, F-008 | - | - | - |

## Quick wins

High or Critical findings that need small or medium effort.

- F-006: A private key is committed (Critical, Effort S)
- F-001: Storage accepts TLS 1.0 and public traffic (High, Effort S)

# Roadmap: 30, 60 and 90 days

## Wave 1: days 0-30

| ID | Action | Addresses | Effort | Change risk | Depends on |
|---|---|---|---|---|---|
| A-001 | Raise the storage TLS floor and close public access | F-001 | S | Low | - |
| A-002 | Rotate the committed key and purge it from history | F-006 | S | Medium | - |
| A-006 | Collect evidence for F-005 | F-005 | S | Low | - |

Estimated effort of this wave: 3-6 person-days.

Warning: wave 1 may exceed the stated capacity of 5 person-days (estimate 3-6)

## Wave 2: days 31-60

| ID | Action | Addresses | Effort | Change risk | Depends on |
|---|---|---|---|---|---|
| A-003 | Add diagnostic settings | F-002 | M | Low | A-001 |
| A-004 | Test a restore and schedule it quarterly | F-003 | M | Medium | - |

Estimated effort of this wave: 6-20 person-days.

## Wave 3: days 61-90

| ID | Action | Addresses | Effort | Change risk | Depends on |
|---|---|---|---|---|---|
| A-005 | Automate rollback | F-007 | L | High | A-003 |

Estimated effort of this wave: 11-30 person-days.

# Decisions needed from the client

- Approve a maintenance window for the key rotation. (F-006, A-002)

# What could not be verified

These claims have no evidence that a script could check. They are not findings: each one has an action to collect its evidence.

| ID | Finding | Why it failed | Action |
|---|---|---|---|
| F-005 | A variable that does not exist | quote-mismatch | A-006 |

# Scope and limits

**In scope**

- infra/\*\*
- pipelines/\*\*

**Out of scope**

- docs/\*\*

**Questions this assessment answers**

- Is the platform ready for production?

**Assumptions**

- The repository is the source of truth.

A script checked that each cited excerpt exists where the report says it does. It did not check that the excerpt supports the claim; that judgement is for the reader, and Critical and High findings show their quotes for that reason.
