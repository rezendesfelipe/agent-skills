# Example prompts for docs-generator

Status: starting examples, written from this skill's documentation. The blocks marked "Real output" are what the one command shown printed on fictitious data (Node 22, 2026-11-25; a path is shortened to `...`, a cut is a line `...`); a block marked "Derived" is read from a generated file, not printed by a command; the prompts themselves were not run against a model yet (see the smoke checklist of the OpenSpec change `add-prompt-examples`). Adapt the words in angle brackets.

Where not to paste: passwords, keys, tokens, personal data or confidential client text in a prompt or in the notes. The notes you paste become the document and the file is saved on disk.
Onde não colar: senhas, chaves, tokens, dados pessoais ou texto confidencial de cliente no prompt ou nas notas. As notas que você colar viram o documento, e o arquivo fica salvo em disco.

## Contents

- Beginner: a first document
- Advanced: your design system, with a visual check
- Consultancy: a client report built from another skill's output
- What not to ask: formats the engine does not build

## Beginner

### `docs-new-doc`: a first document

```text en
Use the docs-generator skill to write a design document for our new order-scheduling feature, as PDF and Word, in English. Author: <my name>, version 0.1. Ask me which theme to use before you build. The notes are below; do not add facts that are not in them.

<paste notes here: problem, options considered, decision, risks>
```

```text pt-BR
Use a skill docs-generator para escrever um documento de design da nova funcionalidade de agendamento de pedidos, em PDF e Word, em português do Brasil. Autor: <meu nome>, versão 0.1. Pergunte qual tema usar antes de gerar. As notas estão abaixo; não acrescente fatos que não estejam nelas.

<cole as notas aqui: problema, alternativas, decisão, riscos>
```

What you get: a Markdown source, then a PDF and a DOCX with cover, table of contents, executive summary, your sections, sources and change log.
O que você recebe: um texto-fonte em Markdown e, a partir dele, um PDF e um DOCX com capa, sumário, resumo executivo, suas seções, fontes e histórico de alterações.
Real output (command: `node scripts/docs.mjs check agendamento.md`):

```text output
✓ source is valid
```

Real output (command: `node scripts/docs.mjs build agendamento.md --theme clean-modern --format docx`):

```text output
theme: clean-modern (.../themes/clean-modern.json; from --theme)
✓ .../agendamento.docx
```

Derived from the generated file (not command output):

```text output
(paragraph style and text, read from word/document.xml of the DOCX; "..." marks the table of contents entries left out)
Title      Agendamento de pedidos
Subtitle   Documento de design da primeira versão
TOCHeading Sumário
...
Heading1   Resumo executivo
Heading1   Contexto
Heading1   Decisão
Heading1   Riscos
Heading1   Fontes
Heading1   Histórico de alterações
```

Tips (en):
- Give the facts: problem, options, the decision and the risks. The skill writes the structure, not the content.
- Say the author and version, or it will ask; it never invents them.
- Answer the theme question; the engine refuses to build without a chosen theme.
Dicas (pt-BR):
- Dê os fatos: problema, alternativas, a decisão e os riscos. A skill escreve a estrutura, não o conteúdo.
- Diga autor e versão, ou ela vai perguntar; ela nunca inventa.
- Responda à pergunta do tema; o motor se recusa a gerar sem um tema escolhido.

## Advanced

### `docs-brand`: your design system, with a visual check

```text en
Build proposal.md into PDF and DOCX using my Claude Design System. Show me the table of which tokens you used and which values came from the default, wait for my yes, run the theme check, then build with a preview. Open the cover, one page with a table and the last page, and tell me what you checked and what you could not look at.
```

```text pt-BR
Gere o proposal.md em PDF e DOCX usando o meu Claude Design System. Mostre a tabela de quais tokens você usou e quais valores vieram do tema padrão, espere o meu sim, rode a verificação do tema e depois gere com preview. Abra a capa, uma página com tabela e a última página, e diga o que você conferiu e o que não conseguiu ver.
```

What you get: a token table to approve, a `docs-theme.json`, the two files and one PNG per PDF page, and a short note of what was looked at.
O que você recebe: uma tabela de tokens para aprovar, um `docs-theme.json`, os dois arquivos e um PNG por página do PDF, e uma nota curta do que foi conferido.
Illustrative excerpt, not a captured run:

```text output
Tokens used                      Value
color.brand.primary              <hex from your tokens>   (from your design system)
typography.body.family           Public Sans (default: clean-modern)
...
Theme check: passed (a contrast failure would print the nearest color that passes).
Checked: cover, page 4 (table), last page. Not checked: fonts on your machine.
```

Tips (en):
- Name the design system or the token file; otherwise the skill asks which theme to use (only a run with no one to answer uses the default, and says so).
- Ask for the approval step in the prompt when brand fidelity matters; a contrast failure comes with a suggested color, not a silent change.
- Ask what could not be viewed: a run without image viewing says so only if you ask for it.
Dicas (pt-BR):
- Nomeie o design system ou o arquivo de tokens; senão a skill pergunta qual tema usar (só uma execução sem ninguém para responder usa o padrão, e avisa).
- Peça a etapa de aprovação quando a fidelidade à marca importar; uma falha de contraste vem com uma cor sugerida, não com uma troca silenciosa.
- Pergunte o que não pôde ser visto: uma execução sem visualização de imagens só diz isso se você pedir.

## Consultancy

### `docs-report-from-assessment`: a client report from another skill's output

```text en
Render assessment-report/report/report.md to PDF and DOCX in English, with the docs-theme.json next to it. List the sources, and write the change log entries as full sentences that say what changed and where.
```

```text pt-BR
Gere assessment-report/report/report.md em PDF e DOCX, em português, com o docs-theme.json que está ao lado. Liste as fontes e escreva o histórico de alterações em frases completas, dizendo o que mudou e onde.
```

What you get: the report as a DOCX and PDF with the executive summary first, the roadmap by wave, the decisions the client must take, and three annexes.
O que você recebe: o relatório em DOCX e PDF com o resumo executivo primeiro, o roteiro por ondas, as decisões que o cliente precisa tomar e três anexos.
Real output (command: `node scripts/docs.mjs build report.md --theme clean-modern --format docx`):

```text output
theme: clean-modern (.../themes/clean-modern.json; from --theme)
✓ .../report.docx
```

Derived from the generated file (not command output):

```text output
(paragraph style and text, read from word/document.xml of the DOCX; "..." marks the table of contents entries left out)
Title      Avaliação técnica
Subtitle   Cliente Exemplo S.A.
TOCHeading Sumário
...
Heading1   Resumo executivo
Heading1   Avaliação em resumo
Heading1   Principais achados
Heading2   F-002: Sem backup configurado para o banco
Heading1   Matriz de severidade e esforço
Heading2   Ganhos rápidos
Heading1   Roteiro: 30, 60 e 90 dias
Heading2   Onda 1: dias 0-30
Heading2   Onda 2: dias 31-60
Heading2   Onda 3: dias 61-90
Heading1   Decisões necessárias do cliente
Heading1   O que não pôde ser verificado
Heading1   Escopo e limites
Heading1   Anexo A — Registro de achados
Heading1   Anexo B — Índice de evidências e registro de verificação
Heading1   Anexo C — Método e limites
Heading1   Histórico de alterações
```

Tips (en):
- Point to the exact source file and say the language; `lang` in the source sets the fixed labels (pt-BR is the default).
- Ask for change log entries as full sentences; a vague entry is a warning from `check`.
- Keep the theme file next to the source, or name it; the same file keeps the client's look across documents.
Dicas (pt-BR):
- Aponte o arquivo-fonte exato e diga o idioma; o `lang` do texto-fonte define os rótulos fixos (pt-BR é o padrão).
- Peça entradas do histórico em frases completas; uma entrada vaga vira aviso do `check`.
- Deixe o arquivo de tema ao lado do texto-fonte, ou nomeie-o; o mesmo arquivo mantém a identidade do cliente entre documentos.

## What not to ask

### `docs-wrong-formats`: formats the engine does not build

```text en
Make this report as HTML and PowerPoint, and put all its tables into an Excel workbook. Pick any theme, don't ask me.
```

```text pt-BR
Gere este relatório em HTML e PowerPoint e coloque todas as tabelas dele em uma planilha Excel. Escolha qualquer tema, não me pergunte.
```

Reason: the engine builds `pdf` and `docx` only; Excel output is an empty template with the theme's look, not a workbook; and the skill asks which theme to use (only a run with no one to answer uses the default, and says so).
Motivo: o motor gera apenas `pdf` e `docx`; a saída Excel é um modelo vazio com a aparência do tema, não uma planilha com dados; e a skill pergunta qual tema usar (só uma execução sem ninguém para responder usa o padrão, e avisa).
Instead: ask for PDF and DOCX, ask for the Excel template and Office theme only if you want the look, and answer the theme question.
Em vez disso: peça PDF e DOCX, peça o modelo Excel e o tema Office só se quiser a aparência, e responda à pergunta do tema.
