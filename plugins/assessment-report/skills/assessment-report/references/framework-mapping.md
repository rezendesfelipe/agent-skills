# Framework mapping

Read this at the scope and investigate nodes, only if the user wants findings mapped to a framework. Mapping is optional; with none, the report has no framework annex and no empty section.

## Register before you reference

Put each framework in the scope file as:

```json
{ "id": "cis-azure", "name": "CIS Microsoft Azure Foundations Benchmark", "version": "2.0.0", "date": "2023-02-23", "url": "https://...", "retrievedAt": "2026-11-01" }
```

`id` is a short lowercase key you choose; `version` and `date` (the publication date of that version) and `url` are required. Ask the user for them. If the user does not know the version or date, ask them to find it, or leave the mapping out. Do not state a version from memory, because control numbering changes between versions.

A finding then maps with `controls: [ { "framework": "cis-azure", "controlId": "3.15" } ]`. `check` fails on a control that points to an unregistered framework, and on a framework without version or date.

## Checked and unchecked mappings

- If the user supplies a catalog file for a framework (a JSON list of control IDs, or any text the IDs appear in), pass `verify --catalog cis-azure=<file>`. Each `controlId` must exist in it, or `verify` fails that mapping.
- With no catalog the mapping is kept and the annex labels it "unchecked". Say so in the final message.

## What this skill does not do

- It ships no framework catalogs and quotes no control text. Control wording belongs to the framework's owner and changes by version.
- It does not claim compliance. A mapping says "this finding relates to this control", not "the client passes or fails".

Registered frameworks are also written to the `sources` of the document, with version and date.
