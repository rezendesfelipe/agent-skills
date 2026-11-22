# Architecture diagram (draw.io)

`stacks.mjs diagram` writes `docs/architecture/<env>-<instance>.drawio`, an editable draw.io file derived from the manifest only. Practices for the XML, layout, export and review come from [Agents365-ai/drawio-skill](https://github.com/Agents365-ai/drawio-skill) (MIT License, Copyright (c) 2026 Agents365-ai). This skill reuses its rules; it copies none of its code.

## Content

- One container per subscription (the environment's; in `alz` mode also the connectivity subscription with the hub and central zones, dashed and marked external).
- The VNet with one container per subnet (delegated PostgreSQL subnet, NSG name in each title, agents subnet dashed).
- Every resource with its official icon, derived name, a short note, and a badge naming its owning stack (as in Figure 2 of Parte 2). Each resource is a `UserObject` with `kind`, `resource` and `stack` attributes, which `check-diagram` reads.
- Private Endpoints with an edge to their target, Private DNS zones (local or central), the Argo CD flow (Git → Argo CD → pods), the pipeline flow (pipeline → agents → state and cluster API), and a legend built from the stacks present.

## XML rules (from drawio-skill's xml-authoring guide)

- `<mxfile>` → `<diagram>` → `<mxGraphModel>` → `<root>` with reserved cells `<mxCell id="0" />` and `<mxCell id="1" parent="0" />`.
- Stable ids from the derived names, so regenerating gives a minimal diff; `html=1` on labels; entities escaped.
- Edges always expanded: `<mxCell edge="1" ...><mxGeometry relative="1" as="geometry" /></mxCell>`; a self-closing edge does not render.
- Edge style `edgeStyle=orthogonalEdgeStyle;rounded=1;orthogonalLoop=1;jettySize=auto;html=1;` with `endArrow=block;endSize=8`.
- Containers are `swimlane;startSize=30;` with children in relative coordinates; every coordinate and size is a multiple of 10; slots of 170 px between resources.

## Icons

`diagram/icons.json` is a closed map from resource kind to a draw.io built-in Azure stencil (`img/lib/azure2/...`). drawio-skill warns that a guessed shape renders as a blank box, so an unknown kind or path fails `check-diagram`. Every path was checked against the draw.io repository. The [Azure Architecture Icons](https://learn.microsoft.com/azure/architecture/icons/) terms apply: do not reshape icons, keep the product name next to the icon. Argo CD and Git are drawn as labeled boxes (no third-party logos).

## Theme

`diagram.theme` in the manifest: `default` (neutral light), `dark`, or custom tokens:

```yaml
diagram:
  theme:
    background: "#0b1326"
    surface: "#171f33"
    border: "#45464d"
    text: "#dae2fd"
    textSecondary: "#c6c6cd"
    accent: "#2fd9f4"
    fontHeading: Space Grotesk
    fontBody: Manrope
```

Custom tokens are contrast-checked (WCAG: text and secondary text ≥ 4.5:1 on the background, text ≥ 4.5:1 on surfaces, accent ≥ 3:1). Map a user's design system to these tokens and show them the mapping before generating. Stack badges use a fixed palette whose white text passes 4.5:1.

## Export and review

With the draw.io desktop app installed (`DRAWIO_BIN`, `drawio` on `PATH`, `/Applications/draw.io.app/Contents/MacOS/draw.io`, `%ProgramFiles%\draw.io\draw.io.exe` or `%LOCALAPPDATA%\Programs\draw.io\draw.io.exe`):

- `--export svg,png`: final SVG (`-x -f svg -e --embed-svg-images`) and PNG (`-x -f png -e -s 2`), with the diagram embedded so they stay editable.
- `--draft`: one PNG at `--width 2000` without `-e` (never combined with `-s`), for your own review. Look at it at most twice (drawio-skill's limit for automatic repair), fixing overlaps or unreadable labels through the manifest or by asking the user, then show it.
- On headless Linux the engine runs draw.io under `xvfb-run -a` with `--disable-gpu --no-sandbox`.

Without draw.io, the `.drawio` file is still written and the exports are reported as skipped with the install hint.

## Manual edits

The file carries a content hash. If someone edits it in draw.io, `diagram` refuses to overwrite it without `--force` and says so. Ask the user before forcing.
