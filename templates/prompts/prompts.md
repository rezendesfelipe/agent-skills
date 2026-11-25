# Example prompts for <skill-name>

<!-- Starting point for `plugins/<plugin>/skills/<skill>/references/prompts.md`, and for the examples of an agent that has no skill (put those under "### <agent-name>" in the README section "Example prompts"). Rules: CONTRIBUTING.md, "Example prompts". Delete this comment. -->

Status: starting examples, written from this skill's documentation. <Say which "Real output" blocks were produced by running a command on fictitious data, with the date, and that the prompts were not run against a model unless a smoke result is recorded.>

Where not to paste: <what must never go into a prompt for this skill: passwords, keys, tokens, personal data, and the specific secrets of this domain>.
Onde não colar: <o que nunca deve ir em um prompt desta skill, em português>.

## Contents

- Beginner: <title>
- Advanced: <title>
- Consultancy: <title>
- What not to ask: <title>

## Beginner

### `<skill>-first-use`: <title>

```text en
<A prompt a first-time user can copy: context, goal, constraints, output format, how you will know it is done. Use angle brackets for what the user must replace.>
```

```text pt-BR
<The same prompt in Brazilian Portuguese. Keep names of skills, files, commands and flags in English.>
```

What you get: <the files, sections or format the skill produces>.
O que você recebe: <o mesmo, em português>.
Real output (command: `<the command you ran>`):

```text output
<A real excerpt, at most 30 lines, from running the command on fictitious data. No credentials, no personal or temporary paths. For model-written text use the label "Illustrative excerpt, not a captured run:" instead of "Real output (...)" and say so.>
```

Tips (en):
- <context to give>
- <a constraint or scope that improves the result>
Dicas (pt-BR):
- <o mesmo, em português>
- <o mesmo, em português>

## Advanced

### `<skill>-advanced`: <title>

```text en
<prompt>
```

```text pt-BR
<prompt>
```

What you get: <...>
O que você recebe: <...>
Illustrative excerpt, not a captured run:

```text output
<excerpt>
```

Tips (en):
- <tip>
- <tip>
Dicas (pt-BR):
- <dica>
- <dica>

## Consultancy

### `<skill>-consultancy`: <title>

```text en
<prompt>
```

```text pt-BR
<prompt>
```

What you get: <...>
O que você recebe: <...>
Illustrative excerpt, not a captured run:

```text output
<excerpt>
```

Tips (en):
- <tip>
- <tip>
Dicas (pt-BR):
- <dica>
- <dica>

## What not to ask

### `<skill>-do-not`: <title>

```text en
<A prompt the skill declines, for example asking it to change what it must not change, or pasting a secret (describe the secret, never show one).>
```

```text pt-BR
<prompt>
```

Reason: <the hard rule that makes the skill decline>.
Motivo: <a regra, em português>.
Instead: <what to ask>.
Em vez disso: <o que pedir>.
