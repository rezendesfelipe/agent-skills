# Dados da execução

|  |  |
|---|---|
| Versão da skill | 0.1.0 |
| Versão do motor | 0.1.0 |
| Modelo | test-model; identificador informado por: o próprio agente, que pode estar errado |
| Revisão avaliada | inventory:148fa871b3c11fb6 |
| Data | 2026-11-20 |
| Revisor | Marcos Lima, 2026-11-21 |

# O que o verificador prova e o que não prova

Prova que cada trecho citado existe nas linhas citadas dos arquivos inventariados, que uma busca de ausência não encontrou ocorrência em um escopo não vazio e que a saída salva não mudou desde a captura.

Não prova que um trecho sustenta a afirmação, que uma busca de ausência cobre todos os lugares onde um controle poderia estar, nem que uma declaração, documento ou página web seja verdadeiro.

Evidências do tipo saída de comando, e páginas web com cópia salva, contam como verificadas por máquina, mas o motor apenas prova que a citação está em um arquivo salvo pelo avaliador e que o arquivo não mudou desde a captura. Ele não executa o comando nem baixa a página; esses itens mostram consistência com um arquivo salvo, não que o comando produziu aquela saída ou que a página dizia aquilo.

Uma varredura heurística procura segredos nos dados e neste relatório. Ela não prova que não existam: uma pessoa ainda precisa olhar antes de o relatório sair da equipe.

# Convenções

Confiança, severidade e esforço seguem regras fixas calculadas por código, não pelo modelo. Os limiares são convenções desta skill, não resultados de pesquisa.

Confiança: Verificado significa que ao menos uma citação verificada por máquina passa; Corroborado, duas fontes independentes e nenhuma verificada por máquina; Relatado, uma fonte; Não verificado, nenhuma evidência ou todas as citações falharam. Somente achados Verificados podem ser Críticos ou Altos; Corroborado e Relatado ficam limitados a Média.

Esforço em pessoa-dias: S 1-2; M 3-10; L 11-30; XL \>30.

Foram usadas as escalas padrão de severidade e esforço.
