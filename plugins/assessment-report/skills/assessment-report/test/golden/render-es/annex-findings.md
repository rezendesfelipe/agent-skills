# F-006: A private key is committed

**Severidad:** Crítica | **Confianza:** Verificado | **Esfuerzo:** S

**Afirmación.** A private key file is stored in the repository.

**Evidencia**

**E-008** (file, Verificada por script): `infra/key.pem:1-2`, secreto omitido de tipo private-key; solo se muestra la ubicación

**Por qué este impacto.** Anyone with read access can impersonate the service.

**Por qué esta probabilidad.** The file is in the default branch.

**Recomendación.** Rotate the key and remove the file from history.

# F-001: Storage accepts TLS 1.0 and public traffic

**Severidad:** Alta | **Confianza:** Verificado | **Esfuerzo:** S

**Afirmación.** The log storage account allows TLS 1.0 and public network access.

**Evidencia**

**E-001** (file, Verificada por script): `infra/main.tf:11-11`

```
  min_tls_version          = "TLS1_0"
```

**E-002** (file, Verificada por script): `infra/main.tf:12-12`

```
  public_network_access_enabled = true
```

**Por qué este impacto.** Logs may contain customer data.

**Por qué esta probabilidad.** The settings are on in the only definition.

**Recomendación.** Set min\_tls\_version to TLS1\_2 and disable public access.

**Controles:** cis-azure 3.15

# F-002: No diagnostic settings are defined

**Severidad:** Media | **Confianza:** Verificado | **Esfuerzo:** M

**Afirmación.** No diagnostic setting resource exists in the Terraform files.

**Evidencia**

**E-003** (absence, Verificada por script): no encontrado en infra/\*\*/\*.tf (patrón azurerm\_monitor\_diagnostic\_setting); esto muestra que no hay coincidencias en esos archivos, no que el control no exista en otro lugar

**Por qué este impacto.** Incidents would leave no trail.

**Por qué esta probabilidad.** No resource of that type was found in scope.

**Recomendación.** Add diagnostic settings for every resource that supports them.

# F-003: Restores are not tested

**Severidad:** Media | **Confianza:** Corroborado | **Esfuerzo:** M

Severidad antes del límite de confianza: Crítica.

**Afirmación.** Backups exist but restores are not tested.

**Evidencia**

**E-004** (statement, Sin verificación automática): declaración de CTO el 2026-11-10

> Restores have never been tested.

**E-005** (statement, Sin verificación automática): declaración de SRE lead el 2026-11-11

> We restore from backup once a year, by hand.

**Por qué este impacto.** A failed restore means data loss.

**Por qué esta probabilidad.** Two people said restores are rare.

**Recomendación.** Run a restore test every quarter.

# F-004: Admin access review is yearly

**Severidad:** Media | **Confianza:** Informado, verificar antes de actuar | **Esfuerzo:** S

Severidad antes del límite de confianza: Alta.

**Afirmación.** Administrator access is reviewed once a year.

**Evidencia**

**E-006** (statement, Sin verificación automática): declaración de Head of security el 2026-11-12

> Admin access is reviewed yearly.

**Por qué este impacto.** Stale admins widen the blast radius.

**Por qué esta probabilidad.** Yearly reviews leave long gaps.

# F-007: Rollback is manual

**Severidad:** Baja | **Confianza:** Verificado | **Esfuerzo:** S

**Afirmación.** Rollback means re-running the previous commit.

**Evidencia**

**E-009** (document, Verificada por script): `docs/runbook.md:5-5`, documento Runbook

```
Rollback is manual: re-run the previous commit.
```

**Por qué este impacto.** Slower recovery.

**Por qué esta probabilidad.** Every incident needs it.

# F-008: Runbook snippet pipes curl to a shell

**Severidad:** Baja | **Confianza:** Verificado | **Esfuerzo:** S

**Afirmación.** A documented snippet pipes a download to a shell.

**Evidencia**

**E-010** (file, Verificada por script): `docs/snippet.md:1-1`

```
Run this: ‵‵‵bash
```
(escapado)

**Por qué este impacto.** Remote code runs unchecked.

**Por qué esta probabilidad.** Operators copy snippets.
