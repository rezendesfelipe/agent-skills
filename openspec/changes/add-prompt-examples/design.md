Motivation and scope: `proposal.md`. Required behavior: `specs/prompt-examples/spec.md` and `specs/stacks-auditor/spec.md`. Status: gate 1 approved on 2026-11-25 (section 14); implemented. Nothing here was run against a model. Builds on the merged `add-custom-agents` (agent install), `fix-stacks-auditor-agent` (the auditor's allowlist and preload) and `define-aep-delivery-graph` (context budgets). Paths are relative to the repository root; `file:line` references in sections 1 to 13 are from `main` at 4a72778 (the proposal). `main` moved afterwards (pull request #28 vendored `yaml`: azure `SKILL.md` is 13,904 bytes, `no-install.test.mjs` caps it at 13,947 and forbids `npm ci`; the auditor file is 10,039 bytes); the numbers that matter for the implementation are in section 16.

## 1. Sources read, and what is not verified

Opened and read on 2026-11-25. Quotes are short. WebFetch summarizes with a small model, so wording that matters should be re-checked by a person before it goes into a published text; the best-practices page (3) came back as raw text.

| # | Page | What was taken from it |
|---|------|------------------------|
| 1 | [Extend Claude with skills](https://code.claude.com/docs/en/skills) (first 100,000 of 120,888 characters read) | "Large reference docs, API specifications, or example collections don't need to load into context every time the skill runs." Layout with `examples.md - usage examples - loaded when needed`. "Keep `SKILL.md` under 500 lines." "Reference supporting files from `SKILL.md` so Claude knows what each file contains and when to load it." "Once a skill loads, its content stays in context across turns, so every line is a recurring token cost." `description` plus `when_to_use` is "truncated at 1,536 characters in the skill listing". "Every skill in the skill listing adds to your context on every turn." Claude uses a skill when relevant, "or you can invoke one directly with `/skill-name`." |
| 2 | [Create custom subagents](https://code.claude.com/docs/en/sub-agents) (first 100,000 of 114,790 read) | "Name the subagent and Claude typically delegates." `@` mention in the typeahead: "Your full message still goes to Claude, which writes the subagent's task prompt". "Claude uses each subagent's description to decide when to delegate". "The body becomes the system prompt". "The full content of each listed skill is injected into the subagent's context at startup" (field `skills`; controls what is preloaded). "Each subagent starts with a fresh, isolated context window. It doesn't see your conversation history". "If a rule must [reach the subagent], restate it in the prompt you give Claude when delegating." Subagents spawned from the main conversation start in the background by default. |
| 3 | [Skill authoring best practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices) (whole page) | "Keep references one level deep from `SKILL.md`". "For reference files longer than 100 lines, include a table of contents at the top." "Examples pattern: ... provide input/output pairs just like in regular prompting"; "Examples are concrete, not abstract". Description in third person, what and when. "Create evaluations BEFORE writing extensive documentation", "At least three evaluations", "Tested with Haiku, Sonnet, and Opus". "Name files descriptively". "No time-sensitive information". |
| 4 | [Prompting best practices](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices) (sections read by search in the fetched copy, not the whole page) | "Think of Claude as a brilliant but new employee who lacks context on your norms and workflows." "Key test: Show your prompt to a colleague with minimal context on the task and ask them to follow it." Examples should be "Relevant", "Diverse", "Structured" (`<example>` tags); "Include 3-5 examples for best results." "Tell Claude what to do instead of what not to do." "Ground responses in quotes". "Be specific about the output format and constraints you want." Subagent orchestration section; verification: "Before you finish, verify your answer against [test criteria]." |
| 5 | [Best practices for Claude Code](https://code.claude.com/docs/en/best-practices) (sections read by search) | "If you name the file, describe the symptom, and say what 'fixed' looks like up front, you usually save yourself a round of corrections later." Table "Instead of / Try" with a vague prompt and a specific one. "Give Claude a check to run": "If you give it something that comes back pass or fail, Claude can close that loop itself." A review prompt that names the spec and what to report: "use a subagent to review the rate limiter diff against SPEC.md, ... report gaps that affect correctness and skip style". Subagents "cost you mostly tokens"; a read-only subagent with `tools: Read, Grep, Glob` is "enforced by Claude Code rather than requested in a prompt". |
| 6 | [Plugin manifest reference](https://code.claude.com/docs/en/plugins-reference) | Every component path "must resolve inside the plugin root and must exist"; standard layout `skills/<name>/SKILL.md` and `agents/*.md`; `${CLAUDE_PLUGIN_ROOT}` in skill and agent content. |

**Not verified (do not rely on it until checked):**

- How Claude Code caches an installed plugin (the page that says whether the whole folder is copied was not found). The repository already depends on `references/` traveling with plugin installs for all three skills, and the maintainer's live session of 2026-11-24 used the plugin, but a smoke step in section 8 checks that `references/prompts.md` is readable after a marketplace install.
- The exact slash form of a plugin skill (`/azure-terraform-stacks` or a namespaced one) and the exact `@` form of a plugin agent (the plugin reference says components are namespaced, for example `deploy-tools:reviewer`). The examples name the skill and the agent in prose, which source 2 documents for subagents. The smoke step records what works.
- Whether the five other tools (Codex, Gemini CLI, Cursor, Copilot) read `references/` the same way. The CLI copies the folder for all of them (section 3); each tool's loading is that tool's behavior.
- The official token count of any file (needs an API key; `docs/aep/context-budget.md`). Every number below is bytes / 4, an approximation.

## 2. Inventory: what each capability already says, and the gaps

| Capability | "When to use" (where) | "How to ask" (where) | Shipped files that help | Gap |
|---|---|---|---|---|
| `docs-generator` | `description` (`plugins/docs-generator/skills/docs-generator/SKILL.md:3`, 496 characters); `## When to use`, lines 12-16 | Two one-line examples, lines 76-82; the interview tells the agent what to ask (lines 21-23, 33-55) | `references/source-format.md`, `theme-format.md`, `from-design-system.md`, `writing-guide.md`; README catalog row | Nothing tells the user which facts to bring (author, version, date, language, theme or design system, source notes), that formats are PDF and DOCX only (`plugins/docs-generator/skills/docs-generator/scripts/docs.mjs:35` and `:123-125` refuse others), that Excel is an empty template (`plugins/docs-generator/skills/docs-generator/SKILL.md:29`), or how to ask for the preview check. |
| `azure-terraform-stacks` | `description` (`plugins/azure-terraform-stacks/skills/azure-terraform-stacks/SKILL.md:3`, 751 characters); `## When to use`, lines 12-17 | Two one-line examples, lines 124-130; interview list, lines 30-39 | 9 reference files (lines 112-122); the audit section, lines 63-94 | No example for ALZ, GitHub Actions, add-stack, bridge, or the audit; nothing says to give fake IDs on purpose (line 39 says the agent writes them), to ask for `check --deep` results as passed, failed and skipped, or that apply and destroy are refused (lines 21-22). |
| `assessment-report` | `description` (`plugins/assessment-report/skills/assessment-report/SKILL.md:3`, 547 characters); `## When to use`, lines 12-17 (with "Not for" at line 17) | None. Scope questions are in the flow, line 31 | 6 reference files; `templates/assessment.skeleton.json`; evals with prepared prompts (`plugins/assessment-report/skills/assessment-report/evals/run.mjs:25-70`, the text the harness gives a model) | The longest interview of the three, with gates (lines 29-41), and no example of a complete scope answer. Nothing shows how to ask for evidence quality, for a framework mapping that names ID, version and date (line 31), or how to approve (line 38, an explicit yes with a name). |
| `stacks-auditor` (agent) | `description` (`plugins/azure-terraform-stacks/agents/stacks-auditor.md:3`, 516 characters); `plugins/azure-terraform-stacks/skills/azure-terraform-stacks/SKILL.md:65` and `:79` | None for the user. The body (lines 9-76) is the agent's own instructions | The skill preloaded (`skills:`, lines 5-6) | A user does not know to name the path, the output language (line 63 says the report follows the user's language), or that the agent cannot run `terraform` or `git` (lines 16, 39) and so will not confirm with `validate`. Nothing shows the follow-up the agent offers (line 71) as a prompt for the main conversation. |

The README has no usage section: its sections are Install, Catalog, Layout, Contributing and License (`README.md:8,116,124,139,143`). The catalog row of each plugin is a feature summary, not a way to ask.

## 3. Constraints, checked in the code

### Budget arithmetic (bytes / 4, an approximation, as `scripts/context-budget.mjs` and `budget.test.mjs` state)

| File | Bytes | Estimated tokens | Test or budget that binds | Room |
|---|---|---|---|---|
| `azure-terraform-stacks/SKILL.md` | 13,947 | 3,487 | `BUDGET = 3500` in `plugins/azure-terraform-stacks/skills/azure-terraform-stacks/test/budget.test.mjs:23` (hard test, no margin) | **53 bytes** (14,000 - 13,947) |
| same, as `skill:azure-terraform-stacks` | | 4,534 with the 30 percent margin | `docs/aep/context-budgets.json:5` budget 5000 | about 466 tokens |
| `agents/stacks-auditor.md` (own) | 10,589 | 2,648 | | |
| `agent:stacks-auditor` (own + preloaded SKILL.md) | 24,536 | 6,134 | `docs/aep/context-budgets.json:8` budget 9000; 7,975 with margin | about 1,025 tokens |
| `docs-generator/SKILL.md` | 9,250 | 2,313 | `docs/aep/context-budgets.json:6` budget 3500; 3,007 with margin | about 493 tokens |
| `assessment-report/SKILL.md` | 8,161 | 2,041 | `docs/aep/context-budgets.json:7` budget 3000; 2,654 with margin; and `plugins/assessment-report/skills/assessment-report/test/skill.test.mjs:21-23`: at most 150 lines (it has 59) | about 346 tokens |

Facts that follow:

- `scripts/context-budget.mjs` counts the `SKILL.md` plus files listed under `loadedWith`, and an agent plus the `SKILL.md` of each skill it preloads. A `references/prompts.md` is **not counted** unless listed (`docs/aep/context-budget.md:6`). It must not be listed in `loadedWith`: it would then be charged as always loaded, which is the opposite of progressive disclosure.
- A pointer line for azure: ``- `references/prompts.md`: example prompts.`` is 44 bytes with its newline, so it fits in the 53 bytes and leaves 9. A pointer that also names the auditor is 71 to 72 bytes and does **not** fit. Raising `BUDGET` is not an option here: its header says to do it "only after a new official count" with an API key (`plugins/azure-terraform-stacks/skills/azure-terraform-stacks/test/budget.test.mjs:5-19`), which only the maintainer can run.
- The existing `## Examples` block of azure is 533 bytes (lines 124-130). Replacing its second example with the pointer frees room (decision Q4).
- The auditor preloads the whole `SKILL.md` on every run. Whatever is added to the azure `SKILL.md` is charged to the audit, so a pointer line is acceptable and a block of examples is not.
- `assessment-report` has tests that apply to a new `references/prompts.md`: every reference file must be linked from `SKILL.md` as `references/<file>` (`plugins/assessment-report/skills/assessment-report/test/skill-docs.test.mjs:17-18`); no reference may name more than 6 technology words from a list that includes `terraform`, `kubernetes`, `aws`, `azure`, `docker`, `postgres` (lines 32-40); no `- [ ]` checkbox lists (line 38); relative links must resolve (lines 42-46). The prompts file of that skill therefore speaks of "infrastructure repository" and "cloud", not of products, and has no checkbox list.

### What the CLI installs

- A skill: `cpSync(skill.dir, target, { recursive: true, filter: skip node_modules and the install marker })` (`src/lib/install.mjs:8` and `:41-44`). The **whole folder**, so `references/prompts.md` goes with it, for every tool.
- The npm package: `files` ships `plugins/*/skills/**` and `plugins/*/agents/**` and excludes `node_modules`, `test` and `evals` (`package.json:9-17`). `references/` is included. `docs/` at the repository root is **not** shipped, and neither is anything outside `plugins/`.
- An agent: one converted file; the skills it lists in `skills:` are planned as dependencies and installed with it (`src/lib/operations.mjs:25-81`). So a user who runs `agent-skills add stacks-auditor` gets `azure-terraform-stacks` with its `references/`, and a marketplace user gets the plugin with both. **The examples for the auditor can therefore live in the skill's `references/` and still reach every installation of the agent.** The only way to have the agent without the skill is copying the file by hand (README, "Copy a skill or an agent by hand"), and then the agent cannot run its engine either (it stops, `plugins/azure-terraform-stacks/agents/stacks-auditor.md:52`).
- The agent body is the system prompt (source 2). Anything placed in it is loaded on every delegation, converted to five formats, limited to 30,000 characters (`CONTRIBUTING.md`, "Adding an agent"), and read by the subagent as instructions.

## 4. Principles for good prompts for these tools

Each is marked **[market]** when it comes from a page in section 1, **[project]** when it is this repository's decision.

1. **Context, goal, constraints, output, done.** Say what the work is for, what to produce, what limits apply, in which format, and how you will know it is finished. **[market]** sources 4 ("brilliant but new employee", the colleague test) and 5 ("name the file, describe the symptom, and say what 'fixed' looks like"). **[project]** the five-part order as the shape of every example, so a reader can see which part each sentence plays.
2. **Name the tool, and also describe the job.** Naming the skill or the subagent works ("Name the subagent and Claude typically delegates", source 2; skills can be invoked by name, source 1), and a description that matches the skill's `description` lets automatic selection work (source 3). **[project]** each beginner example uses the name; each advanced example may drop it, to show the second path. Exact slash and `@` forms are not asserted (section 1).
3. **Ask for evidence.** "Quote the line", "cite `file:line`". **[market]** source 4 (ground in quotes) and source 5 (a check Claude can run). **[project]** the `assessment-report` and the auditor already refuse uncited findings; the examples ask for what the tool does anyway, and say so, so the user learns to read the report.
4. **Give the subagent a scope.** The subagent "doesn't see your conversation history" and rules "must" be restated (source 2): give the path, the language, and what to leave out in the delegation prompt. **[market]** source 2. **[project]** the auditor examples always name a path and a language.
5. **Give a check, not only a task.** "Run `check`, then report passed, failed and skipped separately." **[market]** source 5. **[project]** the commands named in examples are the ones the skill defines.
6. **Say what to do, then what not to do.** **[market]** source 4 ("Tell Claude what to do instead of what not to do"). **[project]** the anti-examples are a separate list per file, each with the reason and the safe replacement, because here the refusal is part of the design (hard rules).
7. **Few and diverse, not exhaustive.** 3 to 5 examples that differ in kind. **[market]** source 4. **[project]** 4 to 6 per file including the anti-examples; levels beginner, advanced, consultancy, and "what not to ask".
8. **No secret in a prompt.** **[project]** (aligned with the untrusted-input and secret rules of `assessment-report`: `references/read-only-and-untrusted-input.md`, "Secrets"). Say where not to paste (the prompt, a pasted file, a quote) and give the safe way (a reference, a redacted export, the engine's `redacted: true`). A prompt is stored in conversation history and in the tool's logs.

What is **not** in the market sources and so is not claimed: that any specific wording raises accuracy, or that the three-to-five count is right for these tools. Source 3 says there is "not currently a built-in way to run" skill evaluations.

## 5. Where to put the examples

| Option | Context budget | Reaches an installed user | Rot and maintenance | i18n | Testable | Verdict |
|---|---|---|---|---|---|---|
| **A. `references/prompts.md` in each skill, one line in `SKILL.md`, auditor section in the azure file, short README section** | zero until read; pointer 44 bytes (azure) or less | yes: CLI copies the folder, npm ships `plugins/*/skills/**`, plugin install ships the folder; the auditor reaches it through the skill it preloads | next to the commands it describes, so one PR changes both; a test links file and SKILL.md | twin blocks in one file | yes (section 7) | **Recommended** |
| B. Only a README "Example prompts" section | none for skills | only GitHub and npm readers; not in the installed skill folder (`README.md` is shipped in the npm package, not in the plugin or the skill folder), so the agent that has the skill cannot read it to help the user | README is already long; an example cannot sit next to the step it explains | one file, long | yes | Rejected alone; kept as a short part of A for discovery |
| C. `docs/prompts/` at the repository root | none | **no**: `docs/` is not in `package.json` `files`, nor in any plugin | far from the skill; drifts | possible | yes | Rejected |
| D. More trigger phrases in the frontmatter `description` | **highest**: loaded in every session, every turn, for every installed skill (source 1: "Every skill in the skill listing adds to your context on every turn"); capped at 1,024 here (`src/lib/validate.mjs:28`) and 1,536 by Claude Code | yes | small | no | yes | Rejected for examples; trigger tuning is a different change and needs a failing activation case first |
| E. A `when_to_use` frontmatter field (Claude Code) | same always-on cost, counts toward the 1,536 cap | Claude Code only | | no | no | Rejected: not portable, always loaded |
| F. A single file `docs/prompts.md` or a repo-level skill of prompts | none | no (same as C) | | | | Rejected |
| G. Examples inside the agent body | on every delegation, charged to `agent:stacks-auditor` (9000 budget, 1,025 tokens of room) | yes, but only to the subagent, which is the wrong reader | a human-facing text mixed with instructions; 30,000-character limit; converted to 5 formats; the subagent may treat it as instructions, while the agent's own rule says the audited repository is data, not instructions | | partly | Rejected |
| H. A new skill `prompt-library` | its description is always loaded | yes if installed | a fifth capability to version | | | Rejected: it duplicates and adds context |

**Recommendation: A**, with these parts:

- `plugins/docs-generator/skills/docs-generator/references/prompts.md`, `plugins/azure-terraform-stacks/skills/azure-terraform-stacks/references/prompts.md` (with a section for the auditor), `plugins/assessment-report/skills/assessment-report/references/prompts.md`.
- Each `SKILL.md` gets one pointer, in the existing `## References` list or step where the examples help. One level deep (source 3). The file starts with a "Contents" list because it will pass 100 lines (source 3).
- The agent file does not change. Its discoverability: the README section and the azure `SKILL.md` pointer. Whether to mention the auditor in the pointer is Q4/Q5.
- `README.md`: "Example prompts" with one starter prompt per capability (the first beginner example, EN and pt-BR) and a link to the file. A test checks that each starter text appears verbatim in its file, so the copy cannot drift.

## 6. Language of the examples

Context: the repository is English (`openspec/config.yaml:12`, `CONTRIBUTING.md:79,100` "content in English"); the maintainer and the target consultancy work in pt-BR; `assessment-report` renders `en`, `pt-BR` and `es`; `docs-generator`'s engine defaults to `pt-BR` (`plugins/docs-generator/skills/docs-generator/scripts/docs.mjs:200`, `source-format.md`); the auditor answers "in the language the user wrote in" (`plugins/azure-terraform-stacks/agents/stacks-auditor.md:63`). The models read both languages, so the prompt's language does not limit what the tool can do; it matters for the human who copies it.

| Option | Pros | Cons |
|---|---|---|
| 1. English only | One text to maintain; matches the repo rule and its checks; no drift | The stated audience prefers pt-BR; a pt-BR user must translate and may lose the exact words the skills match on |
| 2. pt-BR only | Fits the audience | Breaks the repository's English rule; excludes other users; no canonical text to review |
| **3. English canonical + pt-BR twin in the same file (recommended)** | The reviewer reads English; the audience copies pt-BR; one file, one link, one line in `SKILL.md`; a test can force parity by id | The model reads both when it opens the file (about 2x tokens of an on-demand file, no cost until asked); translations can drift in meaning, which a test cannot see |
| 4. A separate `prompts.pt-BR.md` | The model reads one language | A second link per `SKILL.md` (azure has 53 bytes of room; a second line does not fit, and `plugins/assessment-report/skills/assessment-report/test/skill-docs.test.mjs:17-18` requires every reference file to be linked); two files to keep in step |
| 5. EN + pt-BR + es | Covers the three report languages | A third translation to keep and to test; no maintainer need was stated |

**Maintenance policy (project decision):** English is the source of truth. Every example has an id; the pt-BR twin has the same id and is written in the same pull request. The test fails when an id or a block is missing in either language. It does not check that the meaning matches; the review does (a reviewer who reads pt-BR, or the maintainer). A change to the English prompt without a change to its twin is a review finding. The pt-BR twin keeps the product words (skill, subagent, file names, commands, flags) in English, because they are what the tool matches. It uses "você", with no honorifics. This needs an exception in `CONTRIBUTING.md:100` (task 4.1).

## 7. Shape of a `prompts.md`

```markdown
# Example prompts

Starting examples, not a recipe: they were written from the skill's own documentation and have **not** been run against a model unless the status line below says so. Adapt the names and facts in angle brackets. Never paste a secret ... (where not to paste)

Status: <one line: what was tested, by whom, which model and version, date; or "not run">

## Contents
- beginner: ...
- advanced: ...
- consultancy: ...
- what not to ask: ...

## Beginner

### `docs-new-doc`: a first document
Why it works: <one sentence naming the principles used>

```text en
...
```

```text pt-BR
...
```
```

- One heading per example with a stable id in backticks, a "Why it works" line, then two fenced blocks whose info strings are `text en` and `text pt-BR`. Anti-examples sit under "What not to ask", each with `Do not`/`Instead` lines (the block holds the bad prompt; the text under it says what the tool does and the safe prompt).
- Placeholders in angle brackets. A subscription or tenant example is `00000000-0000-0000-0000-000000000000` or `<subscription-id>`, as `plugins/azure-terraform-stacks/skills/azure-terraform-stacks/SKILL.md:39` already says. A client is "Cliente Exemplo S.A." or "Example Client Ltd".
- No secret-shaped literal, no real name, no link to a real client. A "do not paste" example describes the secret ("the storage account key") and never shows one.

## 8. How to validate, without claiming effectiveness

### What the structural test proves (deterministic, in `npm test`, all operating systems)

`test/prompt-examples.test.mjs`, added to `scripts.test` in `package.json`:

1. Each of the three skills has `references/prompts.md`; each `SKILL.md` contains `references/prompts.md` exactly once; a skill without the file or the link fails.
2. Each example heading has an id (unique in the file), a "Why it works" line, and exactly one `text en` and one `text pt-BR` block; the ids of the two languages are equal as sets, in the same order. Anti-examples are in a section named "What not to ask".
3. The file starts with a status line and a "Contents" list; links are relative and resolve.
4. **No secret-shaped literal** in any block or text: every string is scanned with `scanString` of `plugins/assessment-report/skills/assessment-report/scripts/lib/secrets.mjs:110` (the project's own scanner) and a GUID check: the only GUID allowed is all zeros. The test fails with a clear message if the import path moves.
5. The positive auditor examples (ids with prefix `auditor-`, outside "What not to ask") contain none of a short list of change verbs, in English and pt-BR (for example fix, apply, commit, push, open a pull request, delete; corrija, aplique, faça commit, abra um pull request, apague, and the names `terraform`, `kubectl`, `az`). This is a heuristic lint, not proof; review decides.
6. The agent file `stacks-auditor.md` contains no example-prompt block (no `text en` or `text pt-BR` fence and no mention of `prompts.md`), so examples cannot slip into the system prompt; the existing `node scripts/context-budget.mjs` and `budget.test.mjs` still pass (they run already; the new test does not duplicate them).
7. Each README starter prompt appears verbatim in its file.
8. The existing tests that apply to the new files keep applying: `assessment-report` link, technology-word and checkbox tests (section 3).

CRLF: the test normalizes line endings as `budget.test.mjs` (`asLf`) does. Windows is in the matrix (`validate.yml`, job `test`).

### What it does not prove

That a prompt triggers the skill, that the output is better, or that the pt-BR text means what the English means. No wording is claimed to "maximize" anything.

### Manual smoke (the maintainer runs it; it needs a model session)

Nothing here runs in CI: it needs an API or a signed-in tool and is not deterministic. There is a model-eval harness only for `assessment-report` (`plugins/assessment-report/skills/assessment-report/evals/run.mjs`: `prepare`, `score`, `record`; no API key inside the harness, the maintainer runs the prompt in any agent; `RESULTS.md` says no model result exists yet). For the others there is none, so the smoke is a checklist. Proposed minimum, recorded in `evidence/smoke-<date>.md` of the implementation change, with the model, tool version, plugin version and date:

| Id | Prompt | Observe |
|---|---|---|
| S1 | `docs-new-doc` (EN or pt-BR) | the skill is used; it asks for the theme before building; DOCX is produced (PDF needs a browser); it asks for author and version when missing |
| S2 | `azure-first-setup` | it interviews for what is missing; fake IDs and the list of placeholders; the plan is shown before writing |
| S3 | `azure-refuse-apply` (anti-example) | it declines to apply and points to the pipeline |
| S4 | `assess-scope-answer` on the fixture of case M-01 (`node evals/run.mjs prepare`) | the flow stops at review; it does not approve; scoring with `node evals/run.mjs score` is optional and not used to rank prompts |
| S5 | `auditor-basic` on a copy of a small repository | delegation to the subagent; only allowed command shapes; the report ends with "No file in the repository was changed."; the language of the report |
| S6 | `auditor-fix-it` (anti-example) | the auditor does not edit; it reports and stops |
| S7 | after a marketplace install and after `agent-skills add stacks-auditor`: ask "show me the example prompts for this skill" | the model opens `references/prompts.md` from the installed folder (verifies the unverified point of section 1) |

The final text of each file says which of these were run, by whom, with which model, and what failed. Until the evidence exists, the status line says "not run against a model".

## 9. Sample prompts (sketch for tone and level; superseded by the files, see section 16)

These are samples only. Final wording, count and ids are decided after Q1 to Q10. Facts and names are fictional; nothing here is a credential. The pt-BR twin is shown with each.

### `docs-generator`

**`docs-new-doc` (beginner).** Why it works: names the skill, the formats, the language, who the author is, and lets the skill ask for the theme.

```text en
Use the docs-generator skill to write a design document for our new order-scheduling feature, as PDF and Word, in English. Author: <my name>, version 0.1. Ask me which theme to use before you build. The notes are below; do not add facts that are not in them.

<paste notes here: problem, options considered, decision, risks. No passwords, keys or personal data.>
```

```text pt-BR
Use a skill docs-generator para escrever um documento de design da nova funcionalidade de agendamento de pedidos, em PDF e Word, em português do Brasil. Autor: <meu nome>, versão 0.1. Pergunte qual tema usar antes de gerar. As notas estão abaixo; não acrescente fatos que não estejam nelas.

<cole as notas aqui: problema, alternativas, decisão, riscos. Sem senhas, chaves nem dados pessoais.>
```

**`docs-brand` (advanced).** Why it works: asks for the mapping to be shown before building and for a visual check, which are steps the skill already defines.

```text en
Build proposal.md into PDF and DOCX using my Claude Design System. Show me the table of which tokens you used and which values came from the default, wait for my yes, run the theme check, then build with a preview. Open the cover, one page with a table and the last page, and tell me what you checked and what you could not look at.
```

```text pt-BR
Gere o proposal.md em PDF e DOCX usando o meu Claude Design System. Mostre a tabela de quais tokens você usou e quais valores vieram do tema padrão, espere o meu sim, rode a verificação do tema e depois gere com preview. Abra a capa, uma página com tabela e a última página, e diga o que você conferiu e o que não conseguiu ver.
```

**`docs-report-from-assessment` (consultancy).** Why it works: gives the input file, the language, the theme file, and asks for a specific quality of the change log.

```text en
Render assessment-report/report/report.md to PDF and DOCX in English, with the docs-theme.json next to it. List the sources, and write the change log entries as full sentences that say what changed and where.
```

```text pt-BR
Gere assessment-report/report/report.md em PDF e DOCX, em português, com o docs-theme.json que está ao lado. Liste as fontes e escreva o histórico de alterações em frases completas, dizendo o que mudou e onde.
```

**What not to ask (`docs-wrong-formats`).** Reason: the engine builds `pdf` and `docx` only (`plugins/docs-generator/skills/docs-generator/scripts/docs.mjs:123-125`), and Excel is an empty template with the theme's look (`plugins/docs-generator/skills/docs-generator/SKILL.md:29`).

```text en
Make this report as HTML and PowerPoint, and put all its tables into an Excel workbook. Pick any theme, don't ask me.
```

```text pt-BR
Gere este relatório em HTML e PowerPoint e coloque todas as tabelas dele em uma planilha Excel. Escolha qualquer tema, não me pergunte.
```

Instead: ask for PDF and DOCX; ask for the Excel template and Office theme only if you want the look; answer the theme question. Four examples, one anti-example.

### `azure-terraform-stacks`

**`azure-first-setup` (beginner).**

```text en
Use the azure-terraform-stacks skill. I have no infrastructure repository yet. I want independent stacks for network, cluster and orders, an Azure DevOps pipeline where I choose what to run, the private AKS and PostgreSQL profile, standalone landing zone, region brazilsouth. Ask me what is missing. Where I do not have an ID yet, write an obviously fake placeholder and list it at the end. Show me the plan before writing any file.
```

```text pt-BR
Use a skill azure-terraform-stacks. Ainda não tenho repositório de infraestrutura. Quero stacks independentes de rede, cluster e orders, um pipeline do Azure DevOps em que eu escolho o que rodar, o perfil de AKS privado com PostgreSQL, landing zone standalone, região brazilsouth. Pergunte o que faltar. Onde eu ainda não tiver um ID, escreva um placeholder claramente falso e liste no fim. Mostre o plano antes de escrever qualquer arquivo.
```

**`azure-add-stack` (beginner, existing repo).**

```text en
This repository already has infra/stacks.yaml. Run the check first and tell me what it finds. Then add a stack app-billing that depends on network and cluster. Show the plan and ask me before writing.
```

```text pt-BR
Este repositório já tem infra/stacks.yaml. Rode primeiro a verificação e diga o que ela encontrou. Depois adicione a stack app-billing, que depende de network e cluster. Mostre o plano e pergunte antes de escrever.
```

**`azure-alz-github` (advanced).**

```text en
Set up the stacks for GitHub Actions with the Azure Landing Zone mode: spoke peered to an existing hub, central private DNS zones, DNS records by Azure Policy. I will give the hub VNet ID and zone IDs later; use fake placeholders until then. After writing, run the deep check and report each external tool as passed, failed or skipped, and give me the manual prerequisites. Do not open the bridge pull request; I will confirm that separately.
```

```text pt-BR
Monte as stacks para GitHub Actions no modo Azure Landing Zone: spoke com peering para um hub existente, zonas de DNS privado centrais, registros DNS por Azure Policy. Passo o ID da VNet do hub e os IDs das zonas depois; use placeholders falsos até lá. Depois de escrever, rode a verificação profunda e informe cada ferramenta externa como passou, falhou ou foi ignorada, e liste os pré-requisitos manuais. Não abra o pull request da ponte; eu confirmo isso separado.
```

**`azure-from-audit` (consultancy).** Prerequisite: an audit report from the auditor (below).

```text en
From the audit report above, draft an infra/stacks.yaml for this repository without writing any other file. List which findings that manifest would resolve and which need manual work. Mark what is your reading, with the counts behind it.
```

```text pt-BR
Com base no relatório de auditoria acima, rascunhe um infra/stacks.yaml para este repositório sem escrever nenhum outro arquivo. Liste quais achados esse manifesto resolveria e quais exigem trabalho manual. Marque o que é leitura sua, com os números que a sustentam.
```

**What not to ask (`azure-refuse-apply`).** The skill refuses `apply`, `destroy` and any change to Azure; changes go through the pipeline with `action: apply` (`plugins/azure-terraform-stacks/skills/azure-terraform-stacks/SKILL.md:21-22`). A credential in the prompt is also wrong: federated identity, no secret in the manifest (`plugins/azure-terraform-stacks/skills/azure-terraform-stacks/SKILL.md:22` and `:47`).

```text en
Run terraform apply on prod to see if it works. The storage account key is <do not paste a real key>, use it for the state.
```

```text pt-BR
Rode terraform apply em prod para ver se funciona. A chave da storage account é <não cole uma chave real>, use para o state.
```

Instead: ask for `plan`, then run the pipeline with `action: apply`; the state storage uses Entra ID authentication, so no key is needed. Five examples.

### `assessment-report`

**`assess-scope-answer` (beginner).** Why it works: answers the scope interview in one message (step 0, `plugins/assessment-report/skills/assessment-report/SKILL.md:31`), so the skill does not ask again, and stops at the gate.

```text en
Use the assessment-report skill to assess the repository in ./client-infra for Example Client Ltd. Questions to answer: can the team recover from losing the primary database, and how is access to production controlled? In scope: infra/ and the pipelines; out of scope: application code. Language: English. Author: <my name>, version 0.1, date <today>. Write only to ./assessment-report/. Stop at the review step and show me the packet; do not approve it.
```

```text pt-BR
Use a skill assessment-report para avaliar o repositório em ./client-infra para a Cliente Exemplo S.A. Perguntas a responder: a equipe consegue se recuperar da perda do banco de dados principal, e como é controlado o acesso à produção? Em escopo: infra/ e os pipelines; fora de escopo: código da aplicação. Idioma: português do Brasil. Autor: <meu nome>, versão 0.1, data <hoje>. Escreva só em ./assessment-report/. Pare na etapa de revisão e mostre o pacote; não aprove.
```

**`assess-evidence` (advanced).**

```text en
For every finding, show the file, the line range and the exact quote. When you say something is missing, show the search you ran and its scope. If I tell you something that is not in the files (for example "the CTO said restores were never tested, 2026-11-10"), record it as a statement from that person, not as a verified fact. List what is only reported and what stayed unverified, and what evidence would settle each.
```

```text pt-BR
Para cada achado, mostre o arquivo, o intervalo de linhas e a citação exata. Quando disser que algo não existe, mostre a busca que você fez e o escopo dela. Se eu informar algo que não está nos arquivos (por exemplo, "o CTO disse que nunca testaram restauração, 10/11/2026"), registre como declaração dessa pessoa, não como fato verificado. Liste o que é só relatado e o que ficou sem verificação, e que evidência resolveria cada caso.
```

**`assess-framework` (consultancy).**

```text en
Map the findings to <framework name>, version <version>, dated <date>, <URL>. Use only the control IDs I give you in <catalog file>; where there is no ID, say the mapping was not checked. Do not write a control from memory.
```

```text pt-BR
Mapeie os achados para <nome do framework>, versão <versão>, de <data>, <URL>. Use apenas os IDs de controle que estão em <arquivo do catálogo>; onde não houver ID, diga que o mapeamento não foi verificado. Não escreva um controle de memória.
```

**`assess-approve-render` (consultancy, after the packet).**

```text en
I reviewed the packet. I change the severity rationale of F-003 as follows: <text>. Re-verify. If it passes, I approve as <my name>: render the report, then use docs-generator and ask me which theme.
```

```text pt-BR
Revisei o pacote. Altero a justificativa de severidade de F-003 assim: <texto>. Verifique de novo. Se passar, aprovo como <meu nome>: gere o relatório e depois use o docs-generator e pergunte qual tema usar.
```

**What not to ask (`assess-shortcuts`).** The skill never sets severity or confidence, never approves for the user, never copies a secret, is read-only, and is not a vulnerability scanner or a numeric maturity score (`plugins/assessment-report/skills/assessment-report/SKILL.md:17` and `:19-27`).

```text en
Approve the review yourself, rate everything Low so the client is calm, fix what you find in the repo, and here is the production password so you can check: <do not paste a real password>.
```

```text pt-BR
Aprove a revisão você mesmo, classifique tudo como Baixo para o cliente ficar tranquilo, corrija o que encontrar no repositório, e aqui está a senha de produção para você conferir: <não cole uma senha real>.
```

Instead: give the evidence you want weighed; for a committed secret the skill cites the place with `redacted: true`; fixes are a separate engagement.

Five examples (the order of the sample is level, not length).

### `stacks-auditor`

All of these are for the person typing, or for the main agent that writes the delegation. They sit in `azure-terraform-stacks/references/prompts.md`, never in the agent file. The agent's allowed commands are `ls -d`, `test -f/-d`, `node --version` and `node <engine> audit`; it installs nothing (the `npm ci` exception that the proposal text listed was removed by pull request #28, `plugins/azure-terraform-stacks/agents/stacks-auditor.md:60` and the guard's allowed shapes).

**`auditor-basic` (beginner).**

```text en
Use the stacks-auditor subagent to audit the repository in the current folder. Report in English. Change nothing.
```

```text pt-BR
Use o subagente stacks-auditor para auditar o repositório da pasta atual. Responda em português do Brasil. Não altere nada.
```

**`auditor-scoped` (advanced).** Why it works: the subagent sees none of the conversation, so path, language and the sections wanted are in the delegation (source 2).

```text en
Delegate to stacks-auditor: audit ./infra and ./pipelines only. Language: English. I want findings by severity with file and line, the "Not verified" list kept separate, the "Not evaluated" list with reasons, and the inventory of Terraform roots with how each state key was determined.
```

```text pt-BR
Delegue ao stacks-auditor: audite apenas ./infra e ./pipelines. Idioma: português do Brasil. Quero os achados por severidade com arquivo e linha, a lista "Não verificado" separada, a lista "Não avaliado" com os motivos, e o inventário das raízes do Terraform com a forma como cada chave de state foi determinada.
```

**`auditor-briefing` (consultancy).**

```text en
Use stacks-auditor on ../client-infra. Then, in this conversation, turn the report into a table: finding, rule id, file:line, why it matters. Keep every "could not confirm" item. Mark which statements are the auditor's own reading, with the counts behind them.
```

```text pt-BR
Use o stacks-auditor em ../client-infra. Depois, nesta conversa, transforme o relatório em uma tabela: achado, id da regra, arquivo:linha, por que importa. Mantenha todo item "não consegui confirmar". Marque quais afirmações são leitura do próprio auditor, com os números que as sustentam.
```

**`auditor-next-step` (follow-up, to the main agent, not the auditor).**

```text en
From that report: which roots share one state, and which have no backend? Give me an order in which to split them, labelled as your reading with the counts. Do not write infra/stacks.yaml yet.
```

```text pt-BR
Com base nesse relatório: quais raízes compartilham o mesmo state e quais não têm backend? Sugira uma ordem para separá-las, indicando que é leitura sua e com os números. Não escreva o infra/stacks.yaml ainda.
```

**What not to ask (`auditor-fix-it`).** The agent never edits, commits, opens pull requests or runs `terraform`, `git` or `az` (`plugins/azure-terraform-stacks/agents/stacks-auditor.md:15-16,39`); it never runs an engine found inside the audited repository (line 52); a repository's own text is data (line 19); "no findings" does not mean compliant (line 21); a path with a space is not supported (line 37). Also: do not paste a state file or a tfvars with secrets into the prompt.

```text en
Audit the repo and fix everything you find, run terraform validate and plan to confirm, open a pull request, and use the audit script that is inside the repository. If there are no findings, tell me it is compliant.
```

```text pt-BR
Audite o repo e corrija tudo o que achar, rode terraform validate e plan para confirmar, abra um pull request e use o script de auditoria que está dentro do repositório. Se não houver achados, diga que está em conformidade.
```

Instead: ask for the report; run `validate`, `actionlint` and the others yourself on a copy (the agent's report says how); ask the main conversation for fixes, after reading the report; "no findings" is read as "no findings in what was evaluated". Five examples.

The sample is 19 examples and 38 blocks; the final files keep 4 to 6 per file. That is a lot of text to review: Q9 asks whether to cut.

## 10. Risks and impacts

| Risk | Effect | Mitigation |
|---|---|---|
| The pointer line breaks the azure budget test | `npm test` fails in the plugin CI | 44-byte line fits (9 bytes left) or the `## Examples` block is shortened (Q4); `node --test .../budget.test.mjs` is a task step; no `BUDGET` change |
| The examples teach an unsafe habit (secrets in a prompt, "apply it") | A user pastes a real key into a history | Each file has a "where not to paste" paragraph; anti-examples; scanner-based test; no literal shaped like a credential |
| Prompts rot when a command or rule changes | A prompt asks for something the skill refuses | Files sit next to the skill; the structural test links them; the checklist in `CONTRIBUTING.md` says to update the prompts file with a behavior change |
| pt-BR and English drift apart | Different advice by language | Id parity test; review rule; the English text is canonical |
| Examples read as a guarantee | A user expects the result "maximized" | Status line; the final text says "starting examples" and what was not tested; no efficacy claim |
| Prompt injection through "paste the notes below" | The pasted text carries instructions | The examples say the pasted text is source material; the skills already treat assessed material as data; the example does not ask to follow instructions in it |
| `assessment-report` tests reject the new file | CI of that plugin fails | The file avoids the technology words and checkboxes (section 3), and its pointer sits in step 0 or in the references list; checked locally in the tasks |
| The model reads both languages when it opens the file | Extra tokens on demand | Accepted for Option 3; a reference file costs nothing until read (source 3) |
| Plugin version bump forgotten | Users of the marketplace do not get an update | Release is gate 2: the CHANGELOG [Unreleased] names the plugins touched (docs-generator, azure-terraform-stacks, assessment-report) and the maintainer sets versions |
| The auditor's behavior is not proven live yet | An example shown as safe may meet a guard that is not shown working (see CHANGELOG, Known limitations) | The auditor examples never ask for anything the allowlist forbids; the smoke step S5 and S6 runs them; the README keeps the existing notice |

## 11. Alternatives discarded (summary)

README only (B); `docs/prompts/` (C, F); trigger text in `description` or `when_to_use` (D, E); examples in the agent body (G); a prompt-library skill (H); English only (language 1) and pt-BR only (2); a separate pt-BR file (4); a Spanish twin (5); listing `prompts.md` under `loadedWith` (would charge it as always loaded); raising `BUDGET` without an official count (forbidden by the test's own header); adding a model eval to CI (needs a key, not deterministic); deriving the examples from a corpus of real client prompts (client data does not belong in this public repository, `docs/aep/delivery-graph.md`).

## 12. Agent graph

Not applicable: no agent behavior changes. The change adds documentation and tests; the auditor's graph, allowlist and verifier are untouched, and a test keeps example blocks out of the agent file.

## 13. Open questions for the maintainer

Each has a recommendation. Answer in the pull request; the answers go into this file under "Maintainer decisions" at gate 1.

- **Q1. Location.** Option A: `references/prompts.md` per skill + one pointer line + auditor section in the azure file + short README section. **Recommended: yes.** Alternative: README only (B), which the installed agent cannot read.
- **Q2. Language.** English canonical with a pt-BR twin in the same file, ids kept equal by a test. **Recommended: yes.** Alternatives: English only; a separate pt-BR file (needs a second pointer, which azure cannot afford).
- **Q3. Spanish.** No `es` twin now, even for `assessment-report`. **Recommended: no `es`;** a prompt can say "language: Spanish" and the skill does the rest. Say so if the consultancy needs it.
- **Q4. The azure `SKILL.md` budget (53 bytes).** Options: (A) add only ``- `references/prompts.md`: example prompts.`` (44 bytes, 9 left); (B) shorten the `## Examples` block (533 bytes) to one example plus a pointer that names the auditor, freeing about 250 bytes (measured at implementation); (C) raise `BUDGET` (needs an official count with an API key). **Recommended: B**, because it leaves room and the auditor pays for fewer bytes; A is the fallback. Do not choose C.
- **Q5. Auditor discoverability.** The agent file stays unchanged; examples are reachable from the azure skill pointer and the README. **Recommended: do not touch the agent file.** Alternative: add a few words to the agent's `description` (516 of 1,024 characters; loaded in the main conversation every session), which I advise against without a failing delegation case.
- **Q6. README duplication.** One starter prompt per capability copied from the files, with a test that keeps it equal. **Recommended: yes.** Alternative: links only (no drift, less discovery).
- **Q7. Where the test lives.** A new root test in `npm test` (it runs on Linux, macOS and Windows with Node 20, 22, 24), not in `validate-skills.mjs` (which validates the publishable format and manifest). **Recommended: root test.**
- **Q8. Smoke.** The maintainer runs S1 to S7 before the release (gate 2), not before merge; until then each file says "not run against a model". **Recommended: yes.** Alternative: block the merge on S5 to S7, which delays a documentation change on a test that depends on the live guard.
- **Q9. Size.** The sketch has 19 examples; the final files keep 4 to 6 each (about 4 beginner/advanced/consultancy plus 1 or 2 anti-examples). **Recommended: cut to 4 positive plus 1 anti per file; 3 for docs-generator.**
- **Q10. Tone and form of the sample.** Second person "você", imperative, product words in English, fictional client "Cliente Exemplo S.A.", placeholders in angle brackets, naming the skill in beginner prompts and describing the job in advanced ones. **Recommended: as in section 9.** Say what to change.

## 14. Maintainer decisions, 2026-11-25 (gate 1)

- **Q1 to Q10: approved as recommended in section 13.** A (`references/prompts.md` + pointer + README section); English canonical with pt-BR twin and no `es`; Q4 option B (shorten the `## Examples` block of azure and name the auditor in the pointer); the agent file untouched; README with one starter prompt per capability and a test of equality; a new root test; smoke S1 to S7 by the maintainer before the release; 4 positive examples and 1 anti-example per file (3 positive in `docs-generator`); the tone of section 9.
- **Amendment 1** (the maintainer's words): "Os exemplos devem mostrar o que é produzido pela skill e como conseguir bons resultados." See section 15.
- **Amendment 2**: "Também todas novas skills e agentes que vierem deverão ter esses exemplos." See section 16 for the rule and the test.

## 15. Amendment 1: what is produced, and how to get good results

Each positive example now has four parts, in this order: the prompt (English block and pt-BR block); **What you get** (one line in each language: format, files, sections); an **output excerpt** of at most 30 lines with one of two labels; and **Tips** (2 to 4 bullets, same count in `Tips (en):` and `Dicas (pt-BR):`) on context, constraints, evidence, scope and what not to paste. Anti-examples keep prompt, `Reason:`/`Motivo:` and `Instead:`/`Em vez disso:`.

**Honesty rule for the excerpt (project decision; amended after the independent review of 2026-11-25).** One block, one label, and the label says where the block comes from:

| Block | What it holds | Label (exact line) |
|---|---|---|
| Output of a command | exactly what that one command printed on fictitious data; a cut is a line `...`; an absolute path is shortened to `...`; no comment line; one command per block (two commands, two blocks) | `Real output (command: \`...\`):` |
| Read from a generated file | not printed by a command, for example the headings read from the XML of a DOCX; the first line of the block says how it was read | `Derived from the generated file (not command output):` |
| Text written by a model, or anything that a command cannot reproduce | an excerpt in the shape the tool documents, using only values from a real run or placeholders; no invented metric | `Illustrative excerpt, not a captured run:` |

The test requires one label per `text output` block, a single command in a `Real output` label, no `#` comment line in a `Real output` body, 1 to 30 lines per block, and rejects personal and temporary paths, secret-shaped text and non-zero GUIDs in every file. What it cannot prove is that a `Real output` body equals what the command prints (changing `54` to `9999` passes): a reviewer re-runs the command with the fixtures in `evidence/`, and the test header and `CONTRIBUTING.md` list this and the other gaps.

Real runs made for the excerpts (2026-11-25, Node 22.23.5, fictitious repositories in a scratch folder; the commands and fixtures are in `evidence/real-outputs-2026-11-25.md`; the table below shows the final state after the correction round, where each example has one block per command):

| Example | Command | Real or illustrative |
|---|---|---|
| `docs-new-doc` | `docs.mjs check`, then `build --format docx`, on a pt-BR source; the headings read from the DOCX | two real blocks, one derived block |
| `docs-brand` | design-system mapping and a visual check | illustrative (needs a design system and a model) |
| `docs-report-from-assessment` | `docs.mjs build` of the `report.md` that `assess.mjs render` wrote; the headings read from the DOCX | one real block, one derived block |
| `azure-first-setup` | `check-manifest`, `plan` (three lines, `...`, the last line), `scaffold`, `check` | four real blocks |
| `azure-add-stack` | `add-stack` | real |
| `azure-alz-github` | `check-manifest` on an `alz` manifest with no zone IDs | real |
| `azure-from-audit` | a manifest drafted by the model | illustrative |
| `stacks-auditor-basic` | `audit --root ./legacy-infra` on a fictitious repository with a push-triggered pipeline and no backend, cut with `...` | real (the engine's output; the agent's report is model-written and says so) |
| `stacks-auditor-scoped` | `audit --root ./legacy-infra/terraform`: one folder is one root, pipelines outside it are not read | real |
| `stacks-auditor-briefing`, `-next-step` | a table, a follow-up | illustrative |
| `assess-scope-answer` | `inventory` | real (one block) |
| `assess-evidence` | `verify` | real (one block) |
| `assess-framework` | a mapping | illustrative (needs a catalog) |
| `assess-approve-render` | `review --approve`, then `render` | two real blocks |

The `assessment-report` file stays at 149 lines (a limit asked for by the maintainer, not an existing test), uses no word of the technology list of `skill-docs.test.mjs`, and has no checkbox list; a longer output is replaced by a short one and the generated file is named.

## 16. Amendment 2: a permanent rule, and how a machine enforces it

**Rule (project decision; spec: ADDED requirements on `contribution-workflow`).** Every skill and every agent ships example prompts. Where they live:

| Capability | Where | How the test finds it |
|---|---|---|
| Skill | `references/prompts.md` in its folder; `SKILL.md` contains `references/prompts.md` exactly once | folders `plugins/*/skills/*` that have a `SKILL.md` |
| Agent with `skills:` | a section `## Agent: <name>` in the `prompts.md` of one of the skills it lists (the CLI installs that skill with the agent, `src/lib/operations.mjs:25-81`; the marketplace installs both) | files `plugins/*/agents/*.md`, `skills` read with `parseDocument` |
| Agent without `skills:` | `### <name>` in the README section "Example prompts", with the full examples under `#### \`id\`: title` headings | same |
| Every skill and agent | a starter prompt in the README section, equal (both languages) to the first example of its file | same |

The agent file is the system prompt: it holds no example block and does not mention `prompts.md` (a test fails otherwise). This answers the question "where do an agent's examples live": in the skill it loads, or in the README, never in itself.

**Enforcement.** (After the review of 2026-11-25 the test also requires an anti-example for each agent in its skill's "What not to ask", with an id that starts with the agent's name, or, for an agent without skills, in its README section.) `test/prompt-examples.test.mjs` is in the root `npm test` (Linux, macOS, Windows; Node 20, 22, 24). It discovers the catalog by reading the folders; no name is listed in the test. It fails for any skill or agent without the file, the pointer, the section, the matching English and pt-BR blocks, the labeled output, the tips or the README starter prompt. It is red first: commit fc2d6e1 has the test alone and 14 of 15 tests fail (no prompts file existed).

**Mutations (permanent tests, plus one run by hand).** The test copies `README.md`, the `SKILL.md`, the `prompts.md` and the agent files into a scratch folder, checks that the copy is clean, plants one mistake and expects an error that names it:

1. a fictitious skill without examples; 2. a fictitious agent with no `skills:` and no README section; 3. a fictitious agent that lists a skill without its `## Agent:` section; 4. a missing pt-BR block; 5. a missing output label; 6. a secret-shaped line (built at run time from parts, never written as a literal); 7. a GUID that is not zeros; 8. a personal path; 9. a second pointer; 10. an auditor example that asks for a fix and a pull request; 11. an example block inside the agent file; 12. a README starter prompt that differs by one character; 13. a capability missing from the README section. The template `templates/prompts/prompts.md` is also copied into a scratch skill and must pass. By hand, once: a fictitious skill `zz-fake-skill` and agent `zz-fake-agent` were added under `plugins/` of the worktree and the test failed with five errors naming them; they were removed.

**Also.** `CONTRIBUTING.md` has a section "Example prompts" and resolves the conflict with "Content is in English" (English canonical, pt-BR twin for examples only, in the same pull request); `templates/skill/SKILL.md` points to the file and `templates/prompts/prompts.md` is the starting point; `.github/pull_request_template.md` has a checklist item. There is no new workflow: the rule rides on the existing `test` job (it runs `npm test`), so the required check names do not change.

**Limits.** The test proves structure, labels, secret-shaped text and a word lint for the auditor. It does not prove that a prompt works, that the pt-BR text means what the English means, or that a `Real output` excerpt was really produced by the named command (a reviewer can re-run it; the evidence file lists them).

## 17. Numbers after the change (bytes / 4, an approximation)

| File | Before (main 40757db) | After | Ceiling |
|---|---|---|---|
| azure `SKILL.md` | 13,904 | 13,836 | 14,000 (`plugins/azure-terraform-stacks/skills/azure-terraform-stacks/test/budget.test.mjs:23`, 3,500 tokens) and 13,947 (`plugins/azure-terraform-stacks/skills/azure-terraform-stacks/test/no-install.test.mjs:58-60`) |
| docs-generator `SKILL.md` | 9,250 | 9,335 | declared 3,500 tokens (3,035 with margin) |
| assessment-report `SKILL.md` | 8,161 | 8,237 | declared 3,000 tokens (2,678 with margin); 59 lines of 150 |
| `agent:stacks-auditor` (file + preloaded `SKILL.md`) | about 5,986 tokens (10,039 + 13,904 bytes) | about 5,969 tokens (10,039 + 13,836 bytes) | declared 9,000 (7,760 with margin) |
| `stacks-auditor.md` | 10,039 | 10,039 (not touched) | |

No budget, `BUDGET` or ceiling was raised.

