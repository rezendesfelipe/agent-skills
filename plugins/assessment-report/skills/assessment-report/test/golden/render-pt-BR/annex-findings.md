# F-006: A private key is committed

**Severidade:** Crítica | **Confiança:** Verificado | **Esforço:** S

**Afirmação.** A private key file is stored in the repository.

**Evidência**

**E-008** (file, Verificada por script): `infra/key.pem:1-2`, segredo omitido do tipo private-key; apenas o local é mostrado

**Por que este impacto.** Anyone with read access can impersonate the service.

**Por que esta probabilidade.** The file is in the default branch.

**Recomendação.** Rotate the key and remove the file from history.

# F-001: Storage accepts TLS 1.0 and public traffic

**Severidade:** Alta | **Confiança:** Verificado | **Esforço:** S

**Afirmação.** The log storage account allows TLS 1.0 and public network access.

**Evidência**

**E-001** (file, Verificada por script): `infra/main.tf:11-11`

```
  min_tls_version          = "TLS1_0"
```

**E-002** (file, Verificada por script): `infra/main.tf:12-12`

```
  public_network_access_enabled = true
```

**Por que este impacto.** Logs may contain customer data.

**Por que esta probabilidade.** The settings are on in the only definition.

**Recomendação.** Set min\_tls\_version to TLS1\_2 and disable public access.

**Controles:** cis-azure 3.15

# F-002: No diagnostic settings are defined

**Severidade:** Média | **Confiança:** Verificado | **Esforço:** M

**Afirmação.** No diagnostic setting resource exists in the Terraform files.

**Evidência**

**E-003** (absence, Verificada por script): não encontrado em infra/\*\*/\*.tf (padrão azurerm\_monitor\_diagnostic\_setting); isso mostra ausência de ocorrência nesses arquivos, não que o controle não exista em outro lugar

**Por que este impacto.** Incidents would leave no trail.

**Por que esta probabilidade.** No resource of that type was found in scope.

**Recomendação.** Add diagnostic settings for every resource that supports them.

# F-003: Restores are not tested

**Severidade:** Média | **Confiança:** Corroborado | **Esforço:** M

Severidade antes do limite de confiança: Crítica.

**Afirmação.** Backups exist but restores are not tested.

**Evidência**

**E-004** (statement, Sem verificação por máquina): declaração de CTO em 2026-11-10

> Restores have never been tested.

**E-005** (statement, Sem verificação por máquina): declaração de SRE lead em 2026-11-11

> We restore from backup once a year, by hand.

**Por que este impacto.** A failed restore means data loss.

**Por que esta probabilidade.** Two people said restores are rare.

**Recomendação.** Run a restore test every quarter.

# F-004: Admin access review is yearly

**Severidade:** Média | **Confiança:** Relatado, verificar antes de agir | **Esforço:** S

Severidade antes do limite de confiança: Alta.

**Afirmação.** Administrator access is reviewed once a year.

**Evidência**

**E-006** (statement, Sem verificação por máquina): declaração de Head of security em 2026-11-12

> Admin access is reviewed yearly.

**Por que este impacto.** Stale admins widen the blast radius.

**Por que esta probabilidade.** Yearly reviews leave long gaps.

# F-007: Rollback is manual

**Severidade:** Baixa | **Confiança:** Verificado | **Esforço:** S

**Afirmação.** Rollback means re-running the previous commit.

**Evidência**

**E-009** (document, Verificada por script): `docs/runbook.md:5-5`, documento Runbook

```
Rollback is manual: re-run the previous commit.
```

**Por que este impacto.** Slower recovery.

**Por que esta probabilidade.** Every incident needs it.

# F-008: Runbook snippet pipes curl to a shell

**Severidade:** Baixa | **Confiança:** Verificado | **Esforço:** S

**Afirmação.** A documented snippet pipes a download to a shell.

**Evidência**

**E-010** (file, Verificada por script): `docs/snippet.md:1-1`

```
Run this: ‵‵‵bash
```
(escapado)

**Por que este impacto.** Remote code runs unchecked.

**Por que esta probabilidade.** Operators copy snippets.
