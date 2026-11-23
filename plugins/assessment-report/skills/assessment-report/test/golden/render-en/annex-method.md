# Run metadata

|  |  |
|---|---|
| Skill version | 0.1.0 |
| Engine version | 0.1.0 |
| Model | test-model; identifier reported by: the agent itself, which may be wrong |
| Assessed revision | inventory:0e6da176a1aecf04 |
| Date | 2026-11-20 |
| Reviewer | Marcos Lima, 2026-11-21 |

# What the verifier does and does not prove

It proves that each cited excerpt exists at the cited lines of the inventoried files, that an absence search found no match in a non-empty scope, and that saved output has not changed since capture.

It does not prove that an excerpt supports the claim, that an absence search covers every place a control could live, or that a statement, document or web page is true.

A heuristic scan looks for secrets in the data and in this report. It cannot prove there are none: a person must still look before the report leaves the team.

# Conventions

Confidence, severity and effort follow fixed rules computed by code, not by the model. The thresholds are conventions of this skill, not findings of research.

Confidence: Verified means at least one machine-checked citation passes; Corroborated means two independent sources and none machine-checked; Reported means one source; Not verified means no evidence or every citation failed. Only Verified findings can be Critical or High; Corroborated and Reported are capped at Medium.

Effort in person-days: S 1-2; M 3-10; L 11-30; XL \>30.

Default severity and effort scales were used.
