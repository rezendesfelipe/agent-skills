# F-006: A private key is committed

**Severity:** Critical | **Confidence:** Verified | **Effort:** S

**Statement.** A private key file is stored in the repository.

**Evidence**

**E-008** (file, Verified by script): `infra/key.pem:1-2`, redacted secret of kind private-key; only the location is shown

**Why this impact.** Anyone with read access can impersonate the service.

**Why this likelihood.** The file is in the default branch.

**Recommendation.** Rotate the key and remove the file from history.

# F-001: Storage accepts TLS 1.0 and public traffic

**Severity:** High | **Confidence:** Verified | **Effort:** S

**Statement.** The log storage account allows TLS 1.0 and public network access.

**Evidence**

**E-001** (file, Verified by script): `infra/main.tf:11-11`

```
  min_tls_version          = "TLS1_0"
```

**E-002** (file, Verified by script): `infra/main.tf:12-12`

```
  public_network_access_enabled = true
```

**Why this impact.** Logs may contain customer data.

**Why this likelihood.** The settings are on in the only definition.

**Recommendation.** Set min\_tls\_version to TLS1\_2 and disable public access.

**Controls:** cis-azure 3.15

# F-002: No diagnostic settings are defined

**Severity:** Medium | **Confidence:** Verified | **Effort:** M

**Statement.** No diagnostic setting resource exists in the Terraform files.

**Evidence**

**E-003** (absence, Verified by script): not found in infra/\*\*/\*.tf (pattern azurerm\_monitor\_diagnostic\_setting); this shows no match in those files, not that the control exists nowhere

**Why this impact.** Incidents would leave no trail.

**Why this likelihood.** No resource of that type was found in scope.

**Recommendation.** Add diagnostic settings for every resource that supports them.

# F-003: Restores are not tested

**Severity:** Medium | **Confidence:** Corroborated | **Effort:** M

Severity before the confidence cap: Critical.

**Statement.** Backups exist but restores are not tested.

**Evidence**

**E-004** (statement, Not machine-checked): statement by CTO on 2026-11-10

> Restores have never been tested.

**E-005** (statement, Not machine-checked): statement by SRE lead on 2026-11-11

> We restore from backup once a year, by hand.

**Why this impact.** A failed restore means data loss.

**Why this likelihood.** Two people said restores are rare.

**Recommendation.** Run a restore test every quarter.

# F-004: Admin access review is yearly

**Severity:** Medium | **Confidence:** Reported, verify before acting | **Effort:** S

Severity before the confidence cap: High.

**Statement.** Administrator access is reviewed once a year.

**Evidence**

**E-006** (statement, Not machine-checked): statement by Head of security on 2026-11-12

> Admin access is reviewed yearly.

**Why this impact.** Stale admins widen the blast radius.

**Why this likelihood.** Yearly reviews leave long gaps.

# F-007: Rollback is manual

**Severity:** Low | **Confidence:** Verified | **Effort:** S

**Statement.** Rollback means re-running the previous commit.

**Evidence**

**E-009** (document, Verified by script): `docs/runbook.md:5-5`, document Runbook

```
Rollback is manual: re-run the previous commit.
```

**Why this impact.** Slower recovery.

**Why this likelihood.** Every incident needs it.

# F-008: Runbook snippet pipes curl to a shell

**Severity:** Low | **Confidence:** Verified | **Effort:** S

**Statement.** A documented snippet pipes a download to a shell.

**Evidence**

**E-010** (file, Verified by script): `docs/snippet.md:1-1`

```
Run this: ‵‵‵bash
```
(escaped)

**Why this impact.** Remote code runs unchecked.

**Why this likelihood.** Operators copy snippets.
