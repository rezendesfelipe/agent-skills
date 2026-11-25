# Example prompts for assessment-report

Status: starting examples written from this skill's documentation. "Real output" blocks are what the one command shown printed on fictitious data (Node 22, 2026-11-25; a path is shortened to `...`); the prompts were not run against a model yet (see the smoke checklist of the OpenSpec change `add-prompt-examples`).

Where not to paste: passwords, keys, tokens or personal data in a prompt, a note or a quote. For a committed secret, ask for the place to be cited as redacted.
Onde não colar: senhas, chaves, tokens ou dados pessoais em um prompt, nota ou citação. Para um segredo versionado, peça que o local seja citado como redigido.

## Contents

- Beginner: the scope answered in one message
- Advanced: evidence quality, and a framework mapping
- Consultancy: review, approval and rendering
- What not to ask: shortcuts the gates refuse

## Beginner

### `assess-scope-answer`: the scope in one message

```text en
Use the assessment-report skill to assess the repository in ./client-infra for Example Client Ltd. Questions to answer: can the team recover from losing the primary database, and how is access to production controlled? In scope: infra/ and the pipelines; out of scope: application code. Language: English. Author: <my name>, version 0.1, date <today>. Write only to ./assessment-report/. Stop at the review step and show me the packet; do not approve it.
```

```text pt-BR
Use a skill assessment-report para avaliar o repositório em ./client-infra para a Cliente Exemplo S.A. Perguntas a responder: a equipe consegue se recuperar da perda do banco de dados principal, e como é controlado o acesso à produção? Em escopo: infra/ e os pipelines; fora de escopo: código da aplicação. Idioma: português do Brasil. Autor: <meu nome>, versão 0.1, data <hoje>. Escreva só em ./assessment-report/. Pare na etapa de revisão e mostre o pacote; não aprove.
```

What you get: `assessment.json` created from your answers (the title, client, author, version, date and language in the scope), the inventory of files in scope, and the next step.
O que você recebe: um `assessment.json` criado a partir das suas respostas (título, cliente, autor, versão, data e idioma do escopo), o inventário dos arquivos no escopo e o próximo passo.
Real output (command: `node scripts/assess.mjs inventory --out ./assessment-report`):

```text output
Inventory: 1 file(s) in scope, revision inventory:750ad78e46d7372b (inventory-hash).
Next: investigate (read-only), write evidence and findings in assessment.json, then run verify.
```

Tips (en):
- Answer the whole scope at once: client, questions, in and out of scope, language, author, version, date.
- Say where output may be written and that it stops at review; the approval is yours.
Dicas (pt-BR):
- Responda o escopo inteiro de uma vez: cliente, perguntas, dentro e fora do escopo, idioma, autor, versão, data.
- Diga onde a saída pode ser escrita e que ela para na revisão; a aprovação é sua.

## Advanced

### `assess-evidence`: evidence you can check

```text en
For every finding, show the file, the line range and the exact quote. When you say something is missing, show the search you ran and its scope. If I tell you something that is not in the files (for example "the CTO said restores were never tested, 2026-11-10"), record it as a statement from that person, not as a verified fact. List what is only reported and what stayed unverified, and what evidence would settle each.
```

```text pt-BR
Para cada achado, mostre o arquivo, o intervalo de linhas e a citação exata. Quando disser que algo não existe, mostre a busca que você fez e o escopo dela. Se eu informar algo que não está nos arquivos (por exemplo, "o CTO disse que nunca testaram restauração, 10/11/2026"), registre como declaração dessa pessoa, não como fato verificado. Liste o que é só relatado e o que ficou sem verificação, e que evidência resolveria cada caso.
```

What you get: every finding backed by evidence that a script checked, a confidence per finding, and a severity computed from impact and likelihood.
O que você recebe: cada achado apoiado em evidência que um script conferiu, uma confiança por achado e uma severidade calculada a partir de impacto e probabilidade.
Real output (command: `node scripts/assess.mjs verify --out ./assessment-report`):

```text output
Verified: 2 pass, 0 fail, 1 not machine-checked.
All machine-checkable evidence passes. Next: classify
```

Tips (en):
- Give statements with a role and a date; they count as reported, and two independent sources corroborate.
- Never ask for a severity: it is computed; ask for the reasons behind impact and likelihood instead.
Dicas (pt-BR):
- Informe declarações com cargo e data; elas contam como relatadas, e duas fontes independentes corroboram.
- Nunca peça uma severidade: ela é calculada; peça as razões de impacto e probabilidade.

### `assess-framework`: a framework mapping

```text en
Map the findings to <framework name>, version <version>, dated <date>, <URL>. Use only the control IDs I give you in <catalog file>; where there is no ID, say the mapping was not checked. Do not write a control from memory.
```

```text pt-BR
Mapeie os achados para <nome do framework>, versão <versão>, de <data>, <URL>. Use apenas os IDs de controle que estão em <arquivo do catálogo>; onde não houver ID, diga que o mapeamento não foi verificado. Não escreva um controle de memória.
```

What you get: each mapping names the framework, its version and date; mappings without a given ID are listed as unchecked.
O que você recebe: cada mapeamento nomeia o framework, sua versão e data; mapeamentos sem ID informado ficam listados como não verificados.
Illustrative excerpt, not a captured run:

```text output
F-001  <framework name> <version> (<date>): control <ID from your catalog>   [checked against the catalog]
F-002  <framework name> <version> (<date>): no control ID given              [mapping not checked]
```

Tips (en):
- Always give name, version, date and URL; the skill never invents a control.
- Pass the catalog file, so IDs can be checked.
Dicas (pt-BR):
- Informe sempre nome, versão, data e URL; a skill nunca inventa um controle.
- Passe o arquivo do catálogo, para que os IDs possam ser conferidos.

## Consultancy

### `assess-approve-render`: review, approval and rendering

```text en
I reviewed the packet. I change the severity rationale of F-003 as follows: <text>. Re-verify. If it passes, I approve as <my name>: render the report, then use docs-generator and ask me which theme.
```

```text pt-BR
Revisei o pacote. Altero a justificativa de severidade de F-003 assim: <texto>. Verifique de novo. Se passar, aprovo como <meu nome>: gere o relatório e depois use o docs-generator e pergunte qual tema usar.
```

What you get: the review packet (High and Critical first, with quotes), your approval recorded with your name, then a report and three annexes.
O que você recebe: o pacote de revisão (Altos e Críticos primeiro, com as citações), a sua aprovação registrada com o seu nome e, depois, um relatório e três anexos.
Real output (command: `node scripts/assess.mjs review --approve --by "Ana Exemplo" --date 2026-11-25 --out ./assessment-report`):

```text output
Approved by Ana Exemplo on 2026-11-25. Next: render
```

Real output (command: `node scripts/assess.mjs render --out ./assessment-report`):

```text output
Wrote 5 file(s) in .../report: report.md, annex-findings.md, annex-evidence.md, annex-method.md, report.json
Next: hand report/report.md to the docs-generator skill (it asks which theme to use), then run finish. Without docs-generator, deliver report.md and report.json and say PDF and DOCX need that plugin.
```

Tips (en):
- Edit only what you disagree with; any edit sends the flow back to verify, by design.
- Approve in your own words with your name; the skill never approves for you.
Dicas (pt-BR):
- Edite só o que você contesta; qualquer edição volta o fluxo para a verificação, por desenho.
- Aprove com as suas palavras e o seu nome; a skill nunca aprova por você.

## What not to ask

### `assess-shortcuts`: shortcuts the gates refuse

```text en
Approve the review yourself, rate everything Low so the client is calm, fix what you find in the repo, and here is the production password so you can check: <do not paste a real password>.
```

```text pt-BR
Aprove a revisão você mesmo, classifique tudo como Baixo para o cliente ficar tranquilo, corrija o que encontrar no repositório, e aqui está a senha de produção para você conferir: <não cole uma senha real>.
```

Reason: the skill never approves for you, never sets severity or confidence (code computes them), is read-only, and never copies a secret value into any field.
Motivo: a skill nunca aprova por você, nunca define severidade ou confiança (o código calcula), é somente leitura e nunca copia um segredo para nenhum campo.
Instead: give the evidence you want weighed; a committed secret is cited as redacted; fixes are a separate engagement.
Em vez disso: forneça a evidência que quer ver considerada; um segredo versionado é citado como redigido; correções são outro trabalho.
