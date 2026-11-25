## Purpose

Generates an editable draw.io architecture diagram from a topology JSON, at several levels so that a whole tenant stays legible, with a deterministic layout, the project's design system and checks that do not need draw.io installed.

## ADDED Requirements

### Requirement: Skill packaging
The skill SHALL live at `plugins/azure-waf-review/skills/architecture-diagram/` with `name: architecture-diagram`, a third-person `description` of at most 1024 characters, a `SKILL.md` of at most 70 lines, an engine `scripts/diagram.mjs` (Node.js 20 or later, no dependency) with the subcommands `build` and `check`, and a declared budget in `docs/aep/context-budgets.json`. It SHALL be generic: its input is a topology, and Azure is the first icon set.

#### Scenario: Valid packaging
- **WHEN** `node scripts/validate-skills.mjs` runs
- **THEN** it passes and the skill name is unique across skills and agents

### Requirement: Topology input
`build` SHALL read a topology JSON (`schemaVersion`, `title`, `nodes` with `id`, `kind`, `label`, `parent`, optional `badges` and `attributes`, `edges` with `from`, `to`, `kind`, optional `label`, and a `levels` list). The topology SHALL be produced by code from collected data (`waf.mjs topology`); the model MAY set `title`, `level` choice and short annotations and SHALL NOT write coordinates.

#### Scenario: Invalid topology
- **WHEN** an edge points to a node that does not exist
- **THEN** `build` exits 1 and names the edge

### Requirement: Levels and caps
The generator SHALL produce one page per view: L0 landscape (tenant, management group tree, subscriptions with counts), L1 subscription (resource groups with resource-type counts and the top resources by findings, at most the 12 largest subscriptions plus an aggregate), L2 network (VNets, subnets, peerings, gateways, firewalls, Private Endpoints, Private DNS zones across subscriptions) and optionally L3 workload when a grouping tag key is given. A page SHALL have at most 80 nodes and 120 edges; beyond that the generator SHALL draw a "+N more" node with the count and keep the full list in `topology.json`.

#### Scenario: Large tenant
- **WHEN** the topology has 2,000 resource nodes
- **THEN** no page exceeds the caps, "+N more" nodes carry the omitted counts, and `check` passes

### Requirement: Deterministic layout and stable ids
The layout SHALL be computed by the generator (tree rows for management groups, grid columns for children, coordinates in multiples of 10) so the same topology produces byte-identical output; cell ids SHALL be derived from a hash of the node id; the file SHALL be uncompressed `mxfile` XML with expanded edge cells, `html=1` labels, escaped entities and no XML comments.

#### Scenario: Reproducible
- **WHEN** `build` runs twice on the same topology
- **THEN** the two files are byte-identical

### Requirement: Design system
The diagram SHALL use the project's design system: background `#0b1326` with `adaptiveColors="none"`, surfaces `#171f33` and `#222a3d`, borders `#45464d`, text `#dae2fd`, secondary text `#c6c6cd`, accents `#2fd9f4`, `#7bd0ff`, `#5bbfae` and `#8dc63f`, titles in Space Grotesk and text in Manrope with Geist Sans as the documented fallback, rounded panels. Text MUST have a contrast ratio of at least 4.5:1 against its surface, computed by the generator. Severity SHALL be shown by a letter badge and never by color alone, and the severity data SHALL come only from `severity-summary.json` written by `waf.mjs cap-check` when it passes; `build` SHALL omit severity badges when that file is missing or its recorded hash differs from `assessment.json`. A color outside the palette MAY be used only in severity badges (approved by the user, decision Q6), never in panels, with its contrast checked and a legend.

#### Scenario: Palette
- **WHEN** `check` reads a generated file
- **THEN** every `fillColor`, `strokeColor` and `fontColor` is in the palette (plus approved badge colors) and every font family is allowed

#### Scenario: Severity source
- **WHEN** `cap-check` refused a Critical and `severity-summary.json` is absent
- **THEN** `build` draws no severity badges

#### Scenario: Contrast
- **WHEN** a theme token pair has a contrast below 4.5:1
- **THEN** `build` refuses it and names the pair

### Requirement: Icons
The generator SHALL map a resource kind to a built-in `img/lib/azure2/...` stencil through a closed map ported from `azure-terraform-stacks/diagram/icons.json`, SHALL draw an unknown kind as a labeled rounded box and never guess a shape, and SHALL NOT reference an external image URL. A parity test SHALL fail when a path of the map is absent from the source map while that plugin is present, and SHALL be skipped with a message when it is absent.

#### Scenario: Unknown kind
- **WHEN** a node has the kind `microsoft.example/things`
- **THEN** it is drawn as a labeled box and `check` passes

#### Scenario: No external images
- **WHEN** `check` finds an `image=https://` style
- **THEN** it fails

### Requirement: Structural validation
`check` SHALL verify, without draw.io, that the XML is well formed (an in-house tokenizer), ids are unique, every edge has an expanded geometry child and valid `source` and `target`, node and edge caps hold, labels are at most 60 characters, no string matches the secret scanner, and, unless `--arm-ids` is on, no ARM ID appears in a label. An export to SVG or PNG SHALL run only when the draw.io desktop CLI is found and SHALL be reported as skipped otherwise.

#### Scenario: Missing geometry
- **WHEN** an edge cell is self-closing
- **THEN** `check` exits 1 and names the cell

#### Scenario: Opens in draw.io
- **WHEN** the manual test M-4 runs
- **THEN** the file opens in draw.io without a repair prompt (a manual check, not part of CI)

### Requirement: Edit detection
The file SHALL carry a content hash; `build` SHALL refuse to overwrite a file whose content no longer matches its hash unless `--force` is given, and the skill SHALL tell the agent to ask the user before forcing.

#### Scenario: Edited by hand
- **WHEN** the user edited the `.drawio` and `build` runs again without `--force`
- **THEN** it exits 1 and says the file was edited

### Requirement: Example prompts
The skill SHALL ship `references/prompts.md` following `templates/prompts/prompts.md` with at least one positive example, an anti-example (asking the generator to place coordinates or to include client secrets), the pt-BR twins and a README starter prompt.

#### Scenario: Prompt test
- **WHEN** `npm test` runs
- **THEN** `test/prompt-examples.test.mjs` passes for `architecture-diagram`
