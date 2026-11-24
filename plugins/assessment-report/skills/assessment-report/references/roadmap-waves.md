# Roadmap in waves

Read this at the roadmap node. `check` enforces the rules; this page says how to write actions that pass.

## Waves

Wave 1, 2 and 3 are days 0-30, 31-60 and 61-90. Wave 4 is "later than 90 days" and is labelled as such in the report; use it only when the user needs a longer horizon.

## An action

```json
{ "id": "A-001", "title": "Raise the storage TLS floor", "addresses": ["F-001"], "wave": 1, "effort": "S", "risk": "low", "dependsOn": [] }
```

- `addresses`: the findings it resolves. One action may address several.
- `effort`: `S`, `M`, `L` or `XL`, as for findings.
- `risk`: `low`, `medium` or `high`: the risk of making the change (downtime, data migration), not the risk being fixed.
- `dependsOn`: actions that must finish first.
- `reason`: required when a Critical finding is addressed only after wave 1.

The engine adds wave-1 actions named "Collect evidence for F-0xx" for findings that were demoted. Leave them in place.

## What `check` fails on

- A dependency cycle (it prints the cycle).
- An action in an earlier wave than one of its dependencies.
- A finding of severity Medium or above that no action addresses and that has no `disposition`.
- A Critical finding addressed only after wave 1 without a `reason`.
- A reference to a missing finding or action, or an action with no wave.

After two failed retries the remaining roadmap violations are listed in the report, so do not try to hide them.

## Dispositions

Not every finding is fixed. If the client accepts or postpones one, record `"disposition": { "status": "accepted" or "deferred", "reason": "...", "owner": "..." }` on the finding. The owner and the reason come from the client, not from you.

## Capacity

If the user states how many person-days the client team can spend per wave, put it in the scope file as `capacity` (`{"1": 20, "2": 30}`). The report shows each wave's effort total and warns when the total exceeds the capacity. A warning does not fail `check`.

## Decisions

`decisions` lists what the client must decide, each with `text` and optionally `relatesTo` (finding or action IDs): a maintenance window, an acceptance of risk, a budget.
