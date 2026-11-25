# Example prompts for azure-terraform-stacks and stacks-auditor

Status: starting examples, written from this skill's and agent's documentation. The blocks marked "Real output" are what the one command shown printed on fictitious data (Node 22, 2026-11-25, this engine, no Azure access; a cut is a line `...`); the text of an agent's report is model-written, so its excerpts are marked illustrative. The prompts were not run against a model yet (see the smoke checklist of the OpenSpec change `add-prompt-examples`). Adapt the words in angle brackets.

Where not to paste: subscription secrets, client secrets, storage account keys, SAS tokens, Terraform state files or `.tfvars` with secrets. The stacks use federated identity and Entra ID, so no key is needed; for IDs you do not have yet, ask for obviously fake placeholders (`00000000-...`).
Onde não colar: segredos de assinatura, client secrets, chaves de storage account, tokens SAS, arquivos de state do Terraform ou `.tfvars` com segredos. As stacks usam identidade federada e Entra ID, então nenhuma chave é necessária; para IDs que você ainda não tem, peça placeholders claramente falsos (`00000000-...`).

## Contents

- Beginner: a first setup, and adding a stack to an existing repository
- Advanced: a Landing Zone with GitHub Actions
- Consultancy: a manifest drafted from an audit
- Agent: stacks-auditor (read-only audit of an existing repository)
- What not to ask: apply, destroy, secrets, and asking the auditor to fix

## Beginner

### `azure-first-setup`: a first setup

```text en
Use the azure-terraform-stacks skill. I have no infrastructure repository yet. I want independent stacks for network, cluster and orders, an Azure DevOps pipeline where I choose what to run, the private AKS and PostgreSQL profile, standalone landing zone, region brazilsouth. Ask me what is missing. Where I do not have an ID yet, write an obviously fake placeholder and list it at the end. Show me the plan before writing any file.
```

```text pt-BR
Use a skill azure-terraform-stacks. Ainda não tenho repositório de infraestrutura. Quero stacks independentes de rede, cluster e orders, um pipeline do Azure DevOps em que eu escolho o que rodar, o perfil de AKS privado com PostgreSQL, landing zone standalone, região brazilsouth. Pergunte o que faltar. Onde eu ainda não tiver um ID, escreva um placeholder claramente falso e liste no fim. Mostre o plano antes de escrever qualquer arquivo.
```

What you get: `infra/stacks.yaml`, the plan, about 50 generated files (stacks, pipeline, Argo CD apps, scripts), the check result and the list of manual prerequisites.
O que você recebe: `infra/stacks.yaml`, o plano, cerca de 50 arquivos gerados (stacks, pipeline, apps do Argo CD, scripts), o resultado da verificação e a lista de pré-requisitos manuais.
Real output (command: `node scripts/stacks.mjs check-manifest`):

```text output
✓ infra/stacks.yaml is valid
```

Real output (command: `node scripts/stacks.mjs plan`):

```text output
create    infra/argocd/apps/dev-brs-01/orders.yaml
create    infra/argocd/apps/prod-brs-01/orders.yaml
create    infra/argocd/bootstrap/root-dev-brs-01.yaml
...
54 create
```

Real output (command: `node scripts/stacks.mjs scaffold`):

```text output
54 file(s) written
```

Real output (command: `node scripts/stacks.mjs check`):

```text output
✓ no findings
pending:
  - infra/argocd/manifests/orders/overlays/dev-brs-01/kustomization.yaml: waiting for the outputs of app-orders: run "stacks.mjs bridge --stack app-orders --env dev --instance brs-01 --outputs <terraform output -json file>" after apply
  - infra/argocd/manifests/orders/overlays/prod-brs-01/kustomization.yaml: waiting for the outputs of app-orders: run "stacks.mjs bridge --stack app-orders --env prod --instance brs-01 --outputs <terraform output -json file>" after apply
```

Tips (en):
- List the stacks, the CI platform, the environments and the region up front; the skill asks only for what is missing.
- Ask for fake placeholders and a list of them; it never invents subscription, hub or zone IDs.
- Ask to see the plan first; nothing is written, and `--force` is never used, without your yes.
Dicas (pt-BR):
- Liste as stacks, a plataforma de CI, os ambientes e a região logo de início; a skill pergunta só o que faltar.
- Peça placeholders falsos e a lista deles; ela nunca inventa IDs de assinatura, hub ou zonas.
- Peça para ver o plano antes; nada é escrito, e `--force` nunca é usado, sem o seu sim.

### `azure-add-stack`: add a stack to an existing repository

```text en
This repository already has infra/stacks.yaml. Run the check first and tell me what it finds. Then add a stack app-billing that depends on network and cluster. Show the plan and ask me before writing.
```

```text pt-BR
Este repositório já tem infra/stacks.yaml. Rode primeiro a verificação e diga o que ela encontrou. Depois adicione a stack app-billing, que depende de network e cluster. Mostre o plano e pergunte antes de escrever.
```

What you get: the check findings first, then the manifest updated and only the new files written (plus the pipelines and scripts that list the stacks).
O que você recebe: primeiro os achados da verificação, depois o manifesto atualizado e só os arquivos novos escritos (mais os pipelines e scripts que listam as stacks).
Real output (command: `node scripts/stacks.mjs add-stack --name app-billing --type app --owner billing --depends-on vnet-core,aks-core`):

```text output
added app-billing to infra/stacks.yaml; 8 file(s) written
```

Tips (en):
- Name the stack as `<type>-<owner>` and its dependencies; the check after it reports any rule that now fails.
- Say "check first" when the repository may have drifted from the manifest; `drift` is reported there.
- Ask for the file list before writing when the repository is shared.
Dicas (pt-BR):
- Dê à stack o nome `<tipo>-<dono>` e suas dependências; a verificação depois dela mostra qualquer regra que passe a falhar.
- Diga "verifique primeiro" quando o repositório puder ter se afastado do manifesto; o `drift` aparece ali.
- Peça a lista de arquivos antes de escrever quando o repositório for compartilhado.

## Advanced

### `azure-alz-github`: Azure Landing Zone with GitHub Actions

```text en
Set up the stacks for GitHub Actions with the Azure Landing Zone mode: spoke peered to an existing hub, central private DNS zones, DNS records by Azure Policy. I will give the hub VNet ID and zone IDs later; use fake placeholders until then. After writing, run the deep check and report each external tool as passed, failed or skipped, and give me the manual prerequisites. Do not open the bridge pull request; I will confirm that separately.
```

```text pt-BR
Monte as stacks para GitHub Actions no modo Azure Landing Zone: spoke com peering para um hub existente, zonas de DNS privado centrais, registros DNS por Azure Policy. Passo o ID da VNet do hub e os IDs das zonas depois; use placeholders falsos até lá. Depois de escrever, rode a verificação profunda e informe cada ferramenta externa como passou, falhou ou foi ignorada, e liste os pré-requisitos manuais. Não abra o pull request da ponte; eu confirmo isso separado.
```

What you get: a manifest with `landingZone.mode: alz`. The manifest check refuses to continue until the four zone IDs exist, even as placeholders; then the deep check reports each external tool.
O que você recebe: um manifesto com `landingZone.mode: alz`. A verificação do manifesto se recusa a continuar até que os quatro IDs de zona existam, mesmo como placeholders; depois a verificação profunda informa cada ferramenta externa.
Real output (command: `node scripts/stacks.mjs check-manifest`):

```text output
infra/stacks.yaml has 4 problem(s):
  ✗ landingZone.privateDnsZoneIds.acr: required resource ID of the central Private DNS zone
  ✗ landingZone.privateDnsZoneIds.keyVault: required resource ID of the central Private DNS zone
  ✗ landingZone.privateDnsZoneIds.aks: required resource ID of the central Private DNS zone
  ✗ landingZone.privateDnsZoneIds.postgres: required resource ID of the central Private DNS zone
```

Tips (en):
- Say which landing zone mode and who creates the peering; with `alz` the skill needs the hub VNet ID, the zone IDs and the hub's DNS servers.
- Tell it to use placeholders for what you do not have, and to list them; the real values go in before any apply.
- Ask for passed, failed and skipped separately: a skipped tool is not a pass.
Dicas (pt-BR):
- Diga o modo de landing zone e quem cria o peering; com `alz` a skill precisa do ID da VNet do hub, dos IDs das zonas e dos servidores DNS do hub.
- Mande usar placeholders no que você não tem e listá-los; os valores reais entram antes de qualquer apply.
- Peça passou, falhou e ignorado separados: uma ferramenta ignorada não é uma aprovação.

## Consultancy

### `azure-from-audit`: a manifest drafted from an audit

```text en
From the audit report above, draft an infra/stacks.yaml for this repository without writing any other file. List which findings that manifest would resolve and which need manual work. Mark what is your reading, with the counts behind it.
```

```text pt-BR
Com base no relatório de auditoria acima, rascunhe um infra/stacks.yaml para este repositório sem escrever nenhum outro arquivo. Liste quais achados esse manifesto resolveria e quais exigem trabalho manual. Marque o que é leitura sua, com os números que a sustentam.
```

What you get: a draft manifest in the conversation and a table of findings against it; the files are generated only after you confirm.
O que você recebe: um rascunho de manifesto na conversa e uma tabela de achados em relação a ele; os arquivos só são gerados depois da sua confirmação.
Illustrative excerpt, not a captured run:

```text output
Draft infra/stacks.yaml (placeholders marked): stacks vnet-core, app-legacy; state storage <to fill>
Resolved by the manifest:  versions (required_version, azurerm >= 4.65), state-local, manual-trigger
Needs manual work:         the state storage account and its identity; the first apply of the new backend
My reading: 1 root holds network and other resources together (2 resource blocks): splitting is optional.
```

Tips (en):
- Paste or point to the audit report; the draft is only as good as the findings it starts from.
- Ask it to separate what the manifest fixes from what needs a person; and to label its own reading.
- Keep "do not scaffold yet" in the prompt until you have read the draft.
Dicas (pt-BR):
- Cole ou aponte o relatório de auditoria; o rascunho é tão bom quanto os achados de que parte.
- Peça para separar o que o manifesto resolve do que exige uma pessoa, e para rotular a leitura própria.
- Mantenha "não gere os arquivos ainda" no prompt até ler o rascunho.

## Agent: stacks-auditor

Examples for the person typing, or for the main agent that writes the delegation. The auditor starts with an empty context, so put the path and the language in the request. It runs only `ls -d`, `test`, `node --version` and `node <engine> audit`, installs nothing, and never edits, commits, opens a pull request or runs `terraform`.

### `stacks-auditor-basic`: audit the current folder

```text en
Use the stacks-auditor subagent to audit the repository in the current folder. Report in English. Change nothing.
```

```text pt-BR
Use o subagente stacks-auditor para auditar o repositório da pasta atual. Responda em português do Brasil. Não altere nada.
```

What you get: one report (summary, findings by severity with file and line, not verified, inventory, not evaluated, not covered, the agent's own reading, next step) ending with "No file in the repository was changed."; the excerpt is the engine's own output on a fictitious repository, which the agent re-reads before reporting.
O que você recebe: um relatório (resumo, achados por severidade com arquivo e linha, não verificado, inventário, não avaliado, não coberto, leitura do próprio agente, próximo passo) que termina com "No file in the repository was changed."; o trecho é a saída do próprio motor num repositório fictício, que o agente relê antes de reportar.
Real output (command: `node scripts/stacks.mjs audit --root ./legacy-infra`):

```text output
1 Terraform root(s), 1 pipeline(s) that run Terraform, 0 Argo CD Application(s); findings: 3 error, 1 warning, 0 info

Terraform roots (resource blocks, modules expanded once; groups are a heuristic):
  terraform: 2 resource blocks (network 1, other 1); no backend
  pipeline .github/workflows/infra.yml (github-actions): triggers push

Findings:
  ✗ [manual-trigger] .github/workflows/infra.yml:2: only workflow_dispatch is allowed, found push
      see references/traps.md#who-can-click-run
  ✗ [versions] terraform: no required_version: Terraform must be >= 1.12 (backend OIDC on Azure DevOps)
      see references/stacks-and-state.md#versions
  ✗ [versions] terraform/main.tf:3: azurerm must be >= 4.65 (rbac_authorization_enabled, user_assigned_identity_id)
      see references/stacks-and-state.md#versions
  ! [state-local] terraform: no backend block: this root uses local state, which is lost with the machine and cannot be locked
      see references/stacks-and-state.md#backend

...
No file in the repository was changed.
```

Tips (en):
- Say the path if it is not the current folder, and the language of the report.
- State "change nothing" anyway; it matches the agent's own rule and keeps a delegation prompt honest.
- Read "Not evaluated" and "Not covered": "no findings" means no findings in what was evaluated, never compliant.
Dicas (pt-BR):
- Diga o caminho se não for a pasta atual, e o idioma do relatório.
- Escreva "não altere nada" mesmo assim; combina com a regra do próprio agente e mantém o prompt de delegação honesto.
- Leia "Não avaliado" e "Não coberto": "sem achados" quer dizer sem achados no que foi avaliado, nunca em conformidade.

### `stacks-auditor-scoped`: one folder, and the sections you want

```text en
Delegate to stacks-auditor: audit only <one folder>. Language: English. One folder is one audit root, so pipelines outside it are not read: if the pipelines are elsewhere, I will ask for a second audit. I want findings by severity with file and line, the "Not verified" list kept separate, the "Not evaluated" list with reasons, and the inventory of roots with how each state key was determined.
```

```text pt-BR
Delegue ao stacks-auditor: audite apenas <uma pasta>. Idioma: português do Brasil. Uma pasta é uma raiz de auditoria, então pipelines fora dela não são lidos: se os pipelines estiverem em outro lugar, vou pedir uma segunda auditoria. Quero os achados por severidade com arquivo e linha, a lista "Não verificado" separada, a lista "Não avaliado" com os motivos, e o inventário das raízes com a forma como cada chave de state foi determinada.
```

What you get: the report for that one folder, with the sections you listed. `audit` takes one root (with two `--root` options the last one wins) and reads GitHub workflows only under `<root>/.github/workflows`, so a second folder is a second audit and a second report, with no aggregation between them.
O que você recebe: o relatório dessa única pasta, com as seções que você listou. O `audit` aceita uma raiz (com duas opções `--root` vale a última) e lê workflows do GitHub só em `<raiz>/.github/workflows`, então uma segunda pasta é uma segunda auditoria e um segundo relatório, sem agregação entre eles.
Real output (command: `node scripts/stacks.mjs audit --root ./legacy-infra/terraform`):

```text output
1 Terraform root(s), 0 pipeline(s) that run Terraform, 0 Argo CD Application(s); findings: 2 error, 1 warning, 0 info

Terraform roots (resource blocks, modules expanded once; groups are a heuristic):
  .: 2 resource blocks (network 1, other 1); no backend

Findings:
  ✗ [versions] .: no required_version: Terraform must be >= 1.12 (backend OIDC on Azure DevOps)
      see references/stacks-and-state.md#versions
  ✗ [versions] main.tf:3: azurerm must be >= 4.65 (rbac_authorization_enabled, user_assigned_identity_id)
      see references/stacks-and-state.md#versions
  ! [state-local] .: no backend block: this root uses local state, which is lost with the machine and cannot be locked
      see references/stacks-and-state.md#backend


...
```

Tips (en):
- Name one folder; the subagent does not see your conversation, so restate the path, the language and the sections in the delegation.
- To cover pipelines and Terraform together, name the folder that holds both (often the repository root), or ask for one audit per folder and read the reports separately.
- Ask for the inventory when you want to see how each state key was found: literal or inferred.
Dicas (pt-BR):
- Nomeie uma pasta; o subagente não vê a sua conversa, então repita o caminho, o idioma e as seções na delegação.
- Para cobrir pipelines e infraestrutura juntos, nomeie a pasta que tem os dois (em geral a raiz do repositório), ou peça uma auditoria por pasta e leia os relatórios separadamente.
- Peça o inventário quando quiser ver como cada chave de state foi obtida: literal ou inferida.

### `stacks-auditor-briefing`: a table for a client meeting

```text en
Use stacks-auditor on ../client-infra. Then, in this conversation, turn the report into a table: finding, rule id, file:line, why it matters. Keep every "could not confirm" item. Mark which statements are the auditor's own reading, with the counts behind them.
```

```text pt-BR
Use o stacks-auditor em ../client-infra. Depois, nesta conversa, transforme o relatório em uma tabela: achado, id da regra, arquivo:linha, por que importa. Mantenha todo item "não consegui confirmar". Marque quais afirmações são leitura do próprio auditor, com os números que as sustentam.
```

What you get: the auditor's report, then a table made by the main conversation; the auditor's own reading stays labeled as reading.
O que você recebe: o relatório do auditor e, depois, uma tabela feita pela conversa principal; a leitura do próprio auditor continua rotulada como leitura.
Illustrative excerpt, not a captured run:

```text output
| Finding                 | Rule          | File:line                      | Why it matters                      |
|-------------------------|---------------|--------------------------------|-------------------------------------|
| Pipeline runs on push   | manual-trigger| .github/workflows/infra.yml:2  | Apply starts without a person       |
| No backend              | state-local   | terraform                      | Local state is lost, cannot be locked |
Reading (auditor): 1 root with network and other resources together.
```

Tips (en):
- Do the formatting in the main conversation, after the report; the auditor only reports.
- Keep "could not confirm" items: dropping them hides what the check could not support.
- Never paste the report to a client before you read the cited lines.
Dicas (pt-BR):
- Faça a formatação na conversa principal, depois do relatório; o auditor só reporta.
- Mantenha os itens "não consegui confirmar": descartá-los esconde o que a verificação não sustentou.
- Nunca mande o relatório ao cliente antes de ler as linhas citadas.

### `stacks-auditor-next-step`: after the report, in the main conversation

```text en
From that report: which roots share one state, and which have no backend? Give me an order in which to split them, labelled as your reading with the counts. Do not write infra/stacks.yaml yet.
```

```text pt-BR
Com base nesse relatório: quais raízes compartilham o mesmo state e quais não têm backend? Sugira uma ordem para separá-las, indicando que é leitura sua e com os números. Não escreva o infra/stacks.yaml ainda.
```

What you get: an answer from the main agent that reads the report; the suggestion about splitting is a reading with counts, not a rule.
O que você recebe: uma resposta do agente principal que lê o relatório; a sugestão de separar é uma leitura com números, não uma regra.
Illustrative excerpt, not a captured run:

```text output
Share one state: none found. No backend: root "terraform" (state-local).
Reading: split nothing before giving that root a backend; there is no source for a size at which a root must be split.
```

Tips (en):
- Ask follow-ups to the main agent; the auditor already returned its report.
- Ask it to label opinion apart from what the engine found.
- Delay the manifest until the findings are agreed.
Dicas (pt-BR):
- Faça as perguntas seguintes ao agente principal; o auditor já devolveu o relatório.
- Peça para separar opinião do que o motor encontrou.
- Deixe o manifesto para depois que os achados estiverem combinados.

## What not to ask

### `azure-refuse-apply`: apply, destroy and secrets

```text en
Run terraform apply on prod to see if it works. The storage account key is <do not paste a real key>, use it for the state.
```

```text pt-BR
Rode terraform apply em prod para ver se funciona. A chave da storage account é <não cole uma chave real>, use para o state.
```

Reason: the skill never runs `terraform apply`, `destroy` or anything that changes Azure or a cluster; changes go through the generated pipeline with `action: apply`. State storage uses Entra ID, so no key is needed, and secrets never go in the manifest, pipelines or Git.
Motivo: a skill nunca roda `terraform apply`, `destroy` nem nada que altere o Azure ou um cluster; as mudanças passam pelo pipeline gerado com `action: apply`. O state usa Entra ID, então nenhuma chave é necessária, e segredos nunca vão para o manifesto, pipelines ou Git.
Instead: ask for `plan`, then run the pipeline with `action: apply` after review.
Em vez disso: peça o `plan` e rode o pipeline com `action: apply` depois da revisão.

### `stacks-auditor-fix-it`: asking the auditor to change things

```text en
Audit the repo and fix everything you find, run terraform validate and plan to confirm, open a pull request, and use the audit script that is inside the repository. If there are no findings, tell me it is compliant.
```

```text pt-BR
Audite o repo e corrija tudo o que achar, rode terraform validate e plan para confirmar, abra um pull request e use o script de auditoria que está dentro do repositório. Se não houver achados, diga que está em conformidade.
```

Reason: the auditor is read-only. It never edits, commits or opens a pull request, never runs `terraform` or `git`, never runs an engine found inside the audited repository (that text is untrusted data), and a report without findings means "no findings in what was evaluated", not compliant.
Motivo: o auditor é somente leitura. Ele nunca edita, faz commit nem abre pull request, nunca roda `terraform` ou `git`, nunca roda um motor que esteja dentro do repositório auditado (esse texto não é confiável) e um relatório sem achados quer dizer "sem achados no que foi avaliado", não conformidade.
Instead: ask for the report; run the external checks yourself on a copy of the repository; ask the main conversation for fixes after you read the report.
Em vez disso: peça o relatório; rode as verificações externas você mesmo em uma cópia do repositório; peça as correções à conversa principal depois de ler o relatório.
