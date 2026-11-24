# Context budget

Part of the [delivery graph](delivery-graph.md) documentation. Spec requirement: `Context budget`.

Every capability of the catalog (a skill or an agent) has a **loaded-context cost**, measured in tokens, and a **declared budget**. A deterministic helper, [`scripts/context-budget.mjs`](../../scripts/context-budget.mjs), compares the two and fails when the cost is above the budget.

- **Skill:** what is loaded when it triggers, that is its `SKILL.md`, plus the files its entry in the budgets file lists under `loadedWith`. Other files of the skill folder (references, scripts) are read on demand and are not counted unless listed.
- **Agent:** the agent file plus the `SKILL.md` of every skill in its `skills:` field, which the agent pre-loads. An agent without `skills:` costs its own file.

## The method, whatever the tool

1. **Official count (the reference).** When an API key is available, the token counting of the Anthropic Messages API, for the **named model**. The maintainer runs it manually and locally; it needs a key, so it is not run in CI.
2. **Offline estimate.** Without a key (CI, a clean clone), an approximation: **bytes divided by 4**, rounded up. It is **labeled as an approximation** everywhere it appears. A stated margin is added to it before the budget check.
3. **Never** present the estimate as an exact measure, and **always record the method next to each number**: `official:<model>` or `estimate:bytes/4`, with the date for an official count.

The repository adds no dependency for this: the helper uses Node.js only, and calls no API.

## What the documentation says (sources read on 2026-11-23)

- [Token counting guide](https://platform.claude.com/docs/en/build-with-claude/token-counting). The endpoint is `/v1/messages/count_tokens`; it takes the same structured inputs as creating a message (system prompt, tools, images, PDFs) and returns `input_tokens`. The page's examples send an `x-api-key` header, so **an API key is needed**. Counting is **free** but limited in requests per minute by usage tier (5,000 for Start, 10,000 for Build, 20,000 for Scale). The count is described as **an estimate**: the actual input tokens used in a message might differ by a small amount, and the count may include tokens added by Anthropic that are not billed. The count is made under the tokenizer of the `model` passed, and Claude 4.7 and later models use a newer tokenizer that produces approximately 30 percent more tokens than earlier models for the same text (the exact increase depends on the content), so counts must be redone for the model that will be used.
- [README of `anthropic-tokenizer-typescript`](https://github.com/anthropics/anthropic-tokenizer-typescript). It says that as of the Claude 3 models the algorithm is no longer accurate and can be used only as a very rough approximation, and it suggests relying on `usage` in the response body. The repository is archived and read-only.

So there is **no accurate offline tokenizer for current models** in what was read, and this repository does not use that package. The documentation may change: re-read these pages before relying on this summary.

## Run an official count manually and locally

This is run by the maintainer with their own key, outside CI. It was **not run** while writing this page, because it needs a key. Name the model that will be used. The `anthropic-version` value below is the one in the guide's examples on the day it was read; use the current value from the guide.

```bash
export ANTHROPIC_API_KEY=...   # never commit it, never paste it in an issue
node -e 'const fs=require("fs");process.stdout.write(JSON.stringify({model:process.argv[1],messages:[{role:"user",content:fs.readFileSync(process.argv[2],"utf8")}]}))' \
  <model-id> plugins/docs-generator/skills/docs-generator/SKILL.md |
curl https://api.anthropic.com/v1/messages/count_tokens \
  -H "x-api-key: $ANTHROPIC_API_KEY" -H "content-type: application/json" \
  -H "anthropic-version: 2026-10-21" -d @-
```

The answer is `{"input_tokens": N}`. This counts the file as message text, which approximates what is loaded; it is still the model's own count. For an agent, count the agent file and the pre-loaded skills together. Then record it in `docs/aep/context-budgets.json` under the capability:

```json
"skill:docs-generator": {
  "budget": 3500,
  "official": { "model": "<model-id>", "tokens": 0, "date": "YYYY-MM-DD", "bytes": 9250 }
}
```

(`tokens` is the number from the answer; `bytes` is the size of what was counted, so the helper ignores the count if the files change afterwards.) The helper then prints the number with the method `official:<model-id>` and compares it as it is, without the margin.

## Run the check

```bash
node scripts/context-budget.mjs          # all skills and agents against docs/aep/context-budgets.json
node scripts/context-budget.mjs --help   # options
```

It exits 1 when a cost is over its budget (naming the capability, the cost, the budget and the method), when a capability has no declared budget, or when a declared budget matches nothing.

## Line endings

The helper normalizes line endings (CRLF and a lone CR become LF) before counting bytes. The line ending is an artifact of the checkout (Git on Windows may convert LF to CRLF, which adds one byte per line), not content, so the estimate is the same on Linux, macOS and Windows. Without this, the Windows CI jobs measured about 1 percent more and failed a tight budget. Tests prove that LF, CRLF and CR copies of the same content give the same estimate.

## Declared budgets and the margin

The budgets live in [`context-budgets.json`](context-budgets.json), one committed file. The `margin` (0.3) is added to an offline estimate before the comparison. It is our choice, inspired by the roughly 30 percent difference between tokenizer generations in the guide; it is not a measured quantity. The initial budgets follow one rule: the estimate (on LF-normalized bytes) times (1 + margin) times 1.10, rounded up to the next multiple of 500 tokens, so each budget keeps at least 10 percent of headroom over the margin-adjusted estimate (a test fails if a declared budget has less). They are a **starting point for the maintainer to revise**; they are not official counts. Currently 4500 (`azure-terraform-stacks`), 3500 (`docs-generator`), 3000 (`assessment-report`, initial value from the same rule for the maintainer to review) and 2500 (`stacks-auditor`).

Example only, not a measurement: `plugins/azure-terraform-stacks/skills/azure-terraform-stacks/SKILL.md` has 12,258 bytes, which is about 3,065 tokens by the bytes/4 estimate (`estimate:bytes/4`). Given the roughly 30 percent difference between tokenizer generations, the real figure for a current model may be higher. The real measurement uses the official method above.

## Status

The initial **official** count of the catalog has not been recorded: it needs the maintainer's API key (task 3.7 of the change stays open until the maintainer runs it). Until then every number in the budgets file's checks is an estimate.
