## Why

The technical-assessment report is the deliverable a consultant sells, and the agent-skills ecosystem has no skill that produces it well. A survey of public skills (November 2026) found three partial neighbors and no complete answer:

- `trailofbits/skills` → `code-maturity-assessor`: strong on evidence (every claim cites `file:line`, scored 0-4, roadmap labelled CRITICAL/HIGH/MEDIUM) but written for smart contracts.
- `netresearch/enterprise-readiness-skill`: report templates, partial.
- The official AWS skill `aws-well-architected-review` (`assets/report-template.md`): impact x probability risk matrix and canonical IDs, but tied to one framework and one cloud.

None of them (1) says formally what "not verified" means, (2) checks by code that a cited excerpt exists, (3) builds a roadmap in waves with dependencies, effort and risk, or (4) hands over client-ready formats (executive document plus technical annex). The failure that matters most to a client is a confident finding that points at a line that does not say what the report claims. Research on LLM judgement argues against asking the model to police itself: LLM-only evaluation of findings is unreliable, and users of code assistants show excess confidence (Ullah et al., arXiv:2312.12575; Perry et al., arXiv:2211.03622). So the check has to be code, not a second model opinion. At the same time, research on skills argues for short, focused skills (SkillsBench, arXiv:2602.12670) and warns that heavy verification checklists inside a skill become mandatory work and cause failures (Agent Skills Can Be Harmful, arXiv:2608.11888). So the rigor lives in scripts and `SKILL.md` stays small.

This repository already renders Markdown to PDF and DOCX (`docs-generator`) and already has a mature pattern for a skill with an engine, tests, evals and a manifest (`azure-terraform-stacks`). This change reuses both.

## What Changes

- **New plugin `assessment-report` with skill `assessment-report`** (`plugins/assessment-report/skills/assessment-report/`). Name and packaging are decided in `design.md` (Decision 1).
- **Evidence is mandatory.** Every finding cites at least one evidence item: a file excerpt with path, line range and quoted text; an *absence* search (scope plus pattern that must return zero matches); or a non-machine source (command output file, document, URL snapshot, interview statement) that is labelled as such.
- **A deterministic verifier** (`scripts/assess.mjs verify`) checks that every machine-checkable citation exists: path inside the assessed root, valid line range, quoted text equal to the lines, absence pattern really with zero matches in a non-empty scope. Failures are never argued away: the finding is repaired with new evidence (bounded cycle) or demoted by code.
- **Confidence and "Not verified".** Four levels (`verified`, `corroborated`, `reported`, `unverified`) computed from the evidence by a fixed rule. Only `verified` findings may be Critical or High. A finding with no passing evidence moves to a "Not verified" section and becomes a verification action in the roadmap; it is not presented as a finding.
- **Severity by rule, effort by scale, matrix.** The model proposes impact, likelihood and effort with a rationale; code computes severity from a 4x4 table, applies the confidence cap and builds the severity x effort matrix.
- **Roadmap in waves 30/60/90** with action IDs, the findings each action addresses, effort, change risk and dependencies; code checks that the dependency graph is acyclic and that no action comes before its dependency.
- **Optional framework mapping.** A control reference is accepted only with the framework ID, its version and its date; if a catalog file is supplied the control ID is checked against it, otherwise the mapping is labelled unchecked.
- **Executive deliverable plus technical annex.** The engine renders `assessment.json` to Markdown in the exact source format of `docs-generator` (frontmatter, executive body, annexes) and the skill delegates PDF and DOCX to `docs-generator`. Rendering is not reimplemented.
- **Read-only by default.** The skill reads the assessed material and writes only to its own output folder. It never changes the assessed repository or any cloud resource, and its scripts have no network access.
- **Outputs:** Markdown (for `docs-generator`) and JSON (`schema/assessment.schema.json`). SARIF is not produced in this change (Decision 8).
- **A graph, not an open loop.** The workflow is a fixed graph with code nodes, model nodes, one bounded investigation agent node, conditional edges, persisted state, two bounded cycles and human interrupts; the engine refuses out-of-order steps (Decision 2). Reasoning stays open inside the model nodes.
- **Public evals** (`assessment-evals` capability): deterministic cases that run in CI, and model-in-the-loop cases on synthetic repositories with planted flaws and an answer key. Every published result carries the model identifier and the skill version.
- **A validation task with 5-10 working consultants** (tasks section 9). Nothing is known today about what consultants dislike in AI-generated assessment reports; this change records that as an open risk and invents no results.
- The marketplace manifest and README catalog will list the new plugin (implementation phase, not in this proposal).

## Capabilities

### New Capabilities
- `assessment-report`: the workflow graph, evidence model, verifier, confidence rules, severity/effort/roadmap rules, framework mapping, outputs and the delegation contract with `docs-generator`.
- `assessment-evals`: the public eval suite, planted-flaw fixtures with answer keys, scoring and the result format with model version.

### Modified Capabilities
<!-- none: the skill follows the existing skill-catalog and marketplace-distribution requirements; docs-generator is consumed, not changed. -->

## Non-goals

- Implementing anything in this change. It adds a proposal only: no skill, no plugin, no change to `README.md`, `.claude-plugin/marketplace.json`, `package.json`, `src/` or workflows.
- Changing `docs-generator`. If the contract test shows its source format cannot express something the report needs, that is a separate change to `docs-generator`.
- Redistributing framework control catalogs (CIS, NIST, ISO, well-architected frameworks, and so on). The skill maps to controls the user supplies or confirms; it ships no catalog and quotes no control text.
- A numeric maturity score (for example 0-4 per domain). No validated rubric exists and numbers invite false precision. Revisit after the consultant validation.
- SARIF output, until a real consumer is identified (Decision 8).
- Fixing or remediating the assessed system, or opening pull requests against it. The skill recommends; it does not change.
- Cloud discovery by the skill itself. Evidence from a live cloud comes from exports or command output the user provides or explicitly approves, read-only verbs only.
- Judging by code whether a finding is true. The verifier proves that a citation exists and has not drifted; it does not prove that the excerpt supports the claim. Humans review Critical and High findings (Decision 5).
- A subagent variant. A read-only exploration subagent can be proposed later, as `stacks-auditor` was.
- Re-assessment deltas between report versions, and a findings database or dashboard.
- Domain checklists. The skill ships no mandatory list of checks per technology; the user's questions and the supplied framework define the lens.

## Impact

- New (implementation phase): `plugins/assessment-report/.claude-plugin/plugin.json`; the skill folder (`SKILL.md`, `references/`, `schema/`, `scripts/`, `locales/`, `templates/`, `evals/`, `test/`); a plugin entry in `.claude-plugin/marketplace.json`; a catalog row in `README.md`; a CI job.
- No runtime dependencies: the engine uses Node.js built-ins only (Node 20 or later), so there is no `npm ci` step before first use.
- Depends at runtime on the `docs-generator` skill only for PDF and DOCX. Without it, the user still gets the Markdown source and the JSON.
- This change itself adds only files under `openspec/changes/add-assessment-report-skill/`.
