// "diagram": editable draw.io architecture diagram generated from the manifest.
// XML, layout and export rules follow Agents365-ai/drawio-skill (MIT); see references/diagram.md.
import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { literalName, literalRg } from "./naming.mjs";
import { SUBNETS } from "./gen-terraform.mjs";

export const ICONS = JSON.parse(readFileSync(new URL("../../diagram/icons.json", import.meta.url), "utf8"));
delete ICONS.$comment;

// ---------- theme ----------
const THEMES = {
  default: {
    background: "#ffffff", surface: "#f5f7fa", border: "#6b7280", text: "#1f2933", textSecondary: "#52606d",
    accent: "#0f6cbd", fontHeading: "Helvetica", fontBody: "Helvetica",
  },
  dark: {
    background: "#111827", surface: "#1f2937", border: "#9ca3af", text: "#f3f4f6", textSecondary: "#d1d5db",
    accent: "#60a5fa", fontHeading: "Helvetica", fontBody: "Helvetica",
  },
};
// Stack badge colors: white text on each passes WCAG AA (4.5:1).
const BADGES = ["#1d4ed8", "#047857", "#b45309", "#6d28d9", "#be185d", "#0e7490", "#4d7c0f", "#9f1239"];

function luminance(hex) {
  const c = hex.replace("#", "").match(/../g).map((x) => parseInt(x, 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
export function contrast(a, b) {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

export function resolveTheme(theme) {
  const errors = [];
  let t;
  if (typeof theme === "string") {
    if (!THEMES[theme]) return { errors: [`unknown theme ${theme}; use default, dark or custom tokens`] };
    t = THEMES[theme];
  } else {
    t = { ...THEMES.default, ...theme };
    for (const k of ["background", "surface", "border", "text", "textSecondary", "accent"]) {
      if (!/^#[0-9a-f]{6}$/i.test(t[k])) errors.push(`diagram.theme.${k} must be a #rrggbb color`);
    }
    if (!errors.length) {
      const pairs = [["text", "background", 4.5], ["textSecondary", "background", 4.5], ["text", "surface", 4.5], ["accent", "background", 3]];
      for (const [a, b, min] of pairs) {
        const r = contrast(t[a], t[b]);
        if (r < min) errors.push(`diagram.theme: ${a} ${t[a]} on ${b} ${t[b]} has contrast ${r.toFixed(2)}:1, below ${min}:1`);
      }
    }
  }
  return { theme: t, errors };
}

// ---------- model ----------
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const slug = (s) => s.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase();
const snap = (v) => Math.round(v / 10) * 10;

class Doc {
  constructor(theme) { this.t = theme; this.cells = []; this.ids = new Set(); this.badge = new Map(); }
  id(base) { let id = slug(base) || "cell"; let i = 2; while (this.ids.has(id)) id = `${slug(base)}-${i++}`; this.ids.add(id); return id; }
  badgeColor(stack) { if (!this.badge.has(stack)) this.badge.set(stack, BADGES[this.badge.size % BADGES.length]); return this.badge.get(stack); }
  container(key, label, parent, x, y, w, h, opts = {}) {
    const t = this.t;
    const id = this.id(key);
    const style = `swimlane;startSize=30;html=1;rounded=1;arcSize=4;whiteSpace=wrap;fontFamily=${t.fontHeading};fontStyle=1;fontSize=13;fontColor=${t.text};fillColor=${opts.fill ?? t.surface};swimlaneFillColor=${opts.fill ?? t.surface};strokeColor=${opts.stroke ?? t.border};${opts.dashed ? "dashed=1;" : ""}`;
    this.cells.push({ id, kind: opts.kind ?? "container", label, parent, x, y, w, h, style, attrs: opts.attrs });
    return id;
  }
  node(key, kind, name, stack, parent, x, y, extra = "") {
    const t = this.t;
    const id = this.id(key);
    const badge = stack ? `<br><span style="background-color:${this.badgeColor(stack)};color:#ffffff;font-size:10px;border-radius:4px;padding:1px 4px;">${esc(stack)}</span>` : "";
    const label = `${esc(name)}${extra ? `<br><span style="color:${t.textSecondary};font-size:10px;">${esc(extra)}</span>` : ""}${badge}`;
    const style = `image;aspect=fixed;html=1;points=[];align=center;verticalLabelPosition=bottom;verticalAlign=top;fontSize=11;fontFamily=${t.fontBody};fontColor=${t.text};image=${ICONS[kind]};`;
    this.cells.push({ id, kind, label, parent, x, y, w: 50, h: 50, style, attrs: { kind, resource: name, ...(stack ? { stack } : {}) } });
    return id;
  }
  box(key, label, parent, x, y, w, h, opts = {}) {
    const t = this.t;
    const id = this.id(key);
    const style = `rounded=1;whiteSpace=wrap;html=1;fontFamily=${t.fontBody};fontSize=11;fontColor=${t.text};fillColor=${opts.fill ?? t.background};strokeColor=${opts.stroke ?? t.border};${opts.dashed ? "dashed=1;" : ""}`;
    this.cells.push({ id, kind: opts.kind ?? "box", label, parent, x, y, w, h, style, attrs: opts.attrs });
    return id;
  }
  edge(key, source, target, label = "", opts = {}) {
    const t = this.t;
    const id = this.id(key);
    const style = `edgeStyle=orthogonalEdgeStyle;rounded=1;orthogonalLoop=1;jettySize=auto;html=1;endArrow=block;endSize=8;strokeColor=${opts.color ?? t.textSecondary};fontColor=${t.textSecondary};fontSize=10;fontFamily=${t.fontBody};${opts.dashed ? "dashed=1;" : ""}`;
    this.cells.push({ id, edge: true, label: esc(label), source, target, style });
    return id;
  }
}

function legend(d, x, y, roles) {
  const id = d.container("legend", "Legend", "1", x, y, 300, 40 + roles.length * 30, { kind: "legend" });
  roles.forEach(([color, text], i) => {
    d.box(`legend-${i}`, `<span style="background-color:${color};color:#ffffff;font-size:10px;border-radius:4px;padding:1px 4px;">stack</span> ${esc(text)}`, id, 20, 40 + i * 30, 260, 20, { fill: d.t.surface, stroke: d.t.surface });
  });
}

export function buildModel(m, env, inst, theme) {
  const d = new Doc(theme);
  const name = (type, owner) => literalName(m, type, owner, env, inst);
  const alz = m.landingZone.mode === "alz";
  const net = m.networkStack, aks = m.clusterStack, apps = m.appStacks;
  const gitApps = m.gitops?.apps ?? [];
  const SLOT = 170;

  // external column
  const extX = 40;
  const git = m.gitops ? d.box("git", `Git repository<br><span style="font-size:10px;">${esc(m.gitops.repoURL)}</span>`, "1", extX, 140, 180, 60, { kind: "external", dashed: true, attrs: { kind: "external" } }) : null;
  const ci = d.box("pipeline", `Pipeline<br><span style="font-size:10px;">${esc(m.ci.join(" · "))}</span>`, "1", extX, 260, 180, 60, { kind: "external", dashed: true, attrs: { kind: "external" } });
  const state = d.node("state", "storageAccount", m.state.storageAccount, null, "1", extX + 60, 400, "tfstate (outside the stacks)");

  // subnets and their items
  const items = {
    aks: 2 + gitApps.length, // cluster, Argo CD, one pod box per app
    endpoints: 1 + apps.length,
    postgres: Math.max(1, apps.length),
    agents: 1,
  };
  const subW = Object.fromEntries(SUBNETS.map((s) => [s, Math.max(1, items[s]) * SLOT + 30]));
  const subH = 190;
  const vnetW = SUBNETS.reduce((a, s) => a + subW[s], 0) + 40 * (SUBNETS.length - 1) + 60;
  const vnetH = 30 + 40 + subH + 40;
  const paasY = 50 + vnetH + 60;
  const dnsW = 300;
  const subsW = vnetW + 60 + (alz ? 0 : dnsW + 60);
  const subsH = paasY + 190 + 30;
  const subsX = 300, subsY = 40;

  const subs = d.container(`subscription-${env}`, `Subscription · ${env} · ${m.environments[env].subscriptionId}`, "1", subsX, subsY, subsW, subsH, { kind: "subscription", fill: theme.background, attrs: { kind: "subscription" } });
  const vnetName = name("vnet", net.owner);
  const vnet = d.container(vnetName, `${vnetName} · VNet · ${literalRg(m, "vnet", net.owner, env, inst)}`, subs, 30, 50, vnetW, vnetH, { kind: "vnet", attrs: { kind: "vnet", resource: vnetName, stack: net.name } });

  let sx = 30;
  const subnet = {};
  for (const p of SUBNETS) {
    const sn = name("snet", p);
    subnet[p] = d.container(sn, `${sn}${p === "postgres" ? " · delegated" : ""} · ${name("nsg", p)}`, vnet, sx, 70, subW[p], subH, {
      kind: "subnet", fill: theme.background, dashed: p === "agents",
      attrs: { kind: "subnet", resource: sn, stack: net.name },
    });
    sx += subW[p] + 40;
  }
  const at = (i) => 40 + i * SLOT + 20;
  const Y = 60;

  // AKS subnet: cluster, Argo CD, app pods
  const cluster = d.node(name("aks", aks.owner), "aks", name("aks", aks.owner), aks.name, subnet.aks, at(0), Y, "private API");
  let argocd = null;
  const pods = {};
  if (m.gitops) {
    argocd = d.box("argocd", "Argo CD<br><span style=\"font-size:10px;\">in the cluster, outside Terraform</span>", subnet.aks, at(1) - 30, Y, 120, 50, { kind: "gitops", attrs: { kind: "gitops" } });
    gitApps.forEach((a, i) => {
      pods[a.stack] = d.box(`pods-${a.name}`, `${esc(a.name)} pods<br><span style="font-size:10px;">ns ${esc(a.namespace)} · sa ${esc(a.serviceAccount)}</span>`, subnet.aks, at(2 + i) - 30, Y, 120, 50, { kind: "workload", attrs: { kind: "workload" } });
    });
  }

  // PaaS row
  const acr = d.node(name("cr", aks.owner), "acr", name("cr", aks.owner), aks.name, subs, 70, paasY, "Premium · public access off");
  const kv = {}, pg = {}, id = {};
  apps.forEach((a, i) => {
    kv[a.name] = d.node(name("kv", a.owner), "keyVault", name("kv", a.owner), a.name, subs, 70 + (1 + i * 2) * SLOT, paasY, "RBAC · public access off");
    id[a.name] = d.node(name("id", a.owner), "managedIdentity", name("id", a.owner), a.name, subs, 70 + (2 + i * 2) * SLOT, paasY, "workload identity");
    pg[a.name] = d.node(name("pgsql", a.owner), "postgresql", name("pgsql", a.owner), a.name, subnet.postgres, at(i), Y, "flexible server · private access");
  });

  // Private Endpoints
  const sep = m.namingConfig.separator;
  const pepCr = d.node(name("pep", ["cr", aks.owner].join(sep)), "privateEndpoint", name("pep", ["cr", aks.owner].join(sep)), aks.name, subnet.endpoints, at(0), Y, "registry");
  d.edge(`${pepCr}-to-acr`, pepCr, acr, "Private Link", { color: theme.accent });
  apps.forEach((a, i) => {
    const pep = d.node(name("pep", ["kv", a.owner].join(sep)), "privateEndpoint", name("pep", ["kv", a.owner].join(sep)), a.name, subnet.endpoints, at(1 + i), Y, "vault");
    d.edge(`${pep}-to-kv`, pep, kv[a.name], "Private Link", { color: theme.accent });
    const pod = pods[a.name];
    if (pod) {
      d.edge(`${pod}-to-pg`, pod, pg[a.name], "5432");
      d.edge(`${pod}-to-pep`, pod, pep, "secrets (Workload ID)");
      d.edge(`${id[a.name]}-to-pod`, id[a.name], pod, "federated", { dashed: true });
    }
  });
  d.edge("aks-to-pep-cr", cluster, pepCr, "pull images");

  // agents
  const agents = d.node("agents", "agents", "self-hosted agents", null, subnet.agents, at(0), Y, "outside the stacks");
  d.edge("ci-to-agents", ci, agents, "runs on", { dashed: true });
  d.edge("agents-to-state", agents, state, "tfstate (Entra ID)", { dashed: true });
  if (m.gitops) {
    d.edge("agents-to-aks", agents, cluster, "bootstrap (once)", { dashed: true });
    d.edge("argocd-to-git", argocd, git, "pulls manifests");
    for (const a of gitApps) if (pods[a.stack]) d.edge(`argocd-to-${a.name}`, argocd, pods[a.stack], "syncs");
  }

  // DNS zones
  const zones = [
    ["privatelink.azurecr.io", "acr"],
    ["privatelink.vaultcore.azure.net", "keyVault"],
    [`${env}-${inst}.postgres.database.azure.com`, "postgres"],
  ];
  if (!alz) {
    const dz = d.container("private-dns-zones", "Private DNS zones · linked to the VNet", subs, 30 + vnetW + 60, 50, dnsW, 60 + zones.length * 110, { kind: "dns", attrs: { kind: "dns", stack: net.name } });
    zones.forEach(([z], i) => d.node(`zone-${z}`, "privateDnsZone", z, net.name, dz, 40, 50 + i * 110));
    d.edge("dns-to-vnet", dz, vnet, "VNet link", { dashed: true });
  } else {
    const lz = m.landingZone;
    const hubX = subsX + subsW + 80;
    const conn = d.container("connectivity", "Connectivity subscription · platform team (external)", "1", hubX, subsY, 360, 140 + (zones.length + 1) * 110, { kind: "external", dashed: true, attrs: { kind: "external" } });
    const hubName = (lz.hubVnetId ?? "hub VNet").split("/").pop();
    const hub = d.node("hub", "vnet", hubName, null, conn, 40, 50, `hub · DNS ${lz.dnsServers.join(", ") || "Azure"}`);
    zones.forEach(([z, k], i) => {
      const zid = lz.privateDnsZoneIds?.[k] ?? z;
      d.node(`zone-${k}`, "privateDnsZone", zid.split("/").pop(), null, conn, 40, 160 + i * 110, lz.dnsByPolicy ? "records by Azure Policy" : "central zone");
    });
    d.node("zone-aks", "privateDnsZone", (lz.privateDnsZoneIds?.aks ?? "privatelink.<region>.azmk8s.io").split("/").pop(), null, conn, 40, 160 + zones.length * 110, "AKS API (custom zone)");
    d.edge("vnet-to-hub", vnet, hub, lz.peering === "managed" ? "peering (spoke side by vnet stack)" : "peering (platform team)", { dashed: true });
  }

  // legend from the stacks present
  const roles = m.stacks.map((s) => [d.badgeColor(s.name), `${s.name}: owns the resources with this label`]);
  roles.push([theme.border, "dashed: outside the stacks (agents, pipeline, external)"]);
  legend(d, extX, subsY + subsH + 60, roles);
  return d;
}

// ---------- XML ----------
const HASH_ATTR = "generatorHash";

export function toXml(d, title) {
  const out = [];
  for (const c of d.cells) {
    if (c.edge) {
      out.push(`        <mxCell id="${c.id}" value="${c.label}" style="${c.style}" edge="1" parent="1" source="${c.source}" target="${c.target}">\n          <mxGeometry relative="1" as="geometry" />\n        </mxCell>`);
      continue;
    }
    const geo = `<mxGeometry x="${snap(c.x)}" y="${snap(c.y)}" width="${snap(c.w)}" height="${snap(c.h)}" as="geometry" />`;
    const attrs = Object.entries(c.attrs ?? {}).map(([k, v]) => ` ${k}="${esc(v)}"`).join("");
    if (attrs) {
      out.push(`        <UserObject id="${c.id}" label="${esc(c.label)}"${attrs}>\n          <mxCell style="${c.style}" vertex="1" parent="${c.parent}">\n            ${geo}\n          </mxCell>\n        </UserObject>`);
    } else {
      out.push(`        <mxCell id="${c.id}" value="${esc(c.label)}" style="${c.style}" vertex="1" parent="${c.parent}">\n          ${geo}\n        </mxCell>`);
    }
  }
  const body = `  <diagram id="${slug(title)}" name="${esc(title)}">
    <mxGraphModel dx="1600" dy="1000" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="0" pageScale="1" math="0" shadow="0" background="${d.t.background}">
      <root>
        <mxCell id="0" />
        <mxCell id="1" parent="0" />
${out.join("\n")}
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>
`;
  const hash = createHash("sha256").update(body).digest("hex").slice(0, 16);
  return `<mxfile host="azure-terraform-stacks" ${HASH_ATTR}="${hash}">\n${body}`;
}

// true when the file on disk is exactly what the generator wrote
export function untouched(text) {
  const m = new RegExp(`^<mxfile host="azure-terraform-stacks" ${HASH_ATTR}="([0-9a-f]{16})">\\n`).exec(text);
  if (!m) return false;
  return createHash("sha256").update(text.slice(m[0].length)).digest("hex").slice(0, 16) === m[1];
}

export function generateDiagrams(m, { env, instance, all = false } = {}) {
  const { theme, errors } = resolveTheme(m.diagram.theme);
  if (errors.length) return { errors };
  if (m.profile !== "private-aks-postgres") return { errors: ["the diagram covers the private-aks-postgres profile; with profile none there is no fixed topology to draw"] };
  const envs = all ? m.envNames : [env ?? (m.envNames.includes("prod") ? "prod" : m.envNames.at(-1))];
  const insts = all ? m.instances : [instance ?? m.instances[0]];
  const files = new Map();
  for (const e of envs) {
    if (!m.envNames.includes(e)) return { errors: [`unknown environment ${e}`] };
    for (const i of insts) {
      if (!m.instances.includes(i)) return { errors: [`unknown instance ${i}`] };
      files.set(`docs/architecture/${e}-${i}.drawio`, toXml(buildModel(m, e, i, theme), `Architecture ${e}-${i}`));
    }
  }
  return { files, errors: [] };
}

// ---------- check-diagram ----------
const attrsOf = (tag) => Object.fromEntries([...tag.matchAll(/([\w:-]+)="([^"]*)"/g)].map((x) => [x[1], x[2]]));

export function checkDiagram(text, m) {
  const problems = [];
  const cells = [];
  const re = /<UserObject\b([^>]*)>\s*<mxCell\b([^>]*?)>([\s\S]*?)<\/mxCell>\s*<\/UserObject>|<mxCell\b([^>]*?)\/>|<mxCell\b([^>]*?)>([\s\S]*?)<\/mxCell>/g;
  for (const x of text.matchAll(re)) {
    if (x[1] !== undefined) cells.push({ ...attrsOf(x[2]), ...attrsOf(x[1]), selfClosing: false, inner: x[3] });
    else if (x[4] !== undefined) cells.push({ ...attrsOf(x[4]), selfClosing: true, inner: "" });
    else cells.push({ ...attrsOf(x[5]), selfClosing: false, inner: x[6] });
  }
  const byId = new Map();
  for (const c of cells) {
    if (byId.has(c.id)) problems.push(`duplicate id ${c.id}`);
    byId.set(c.id, c);
  }
  if (!byId.has("0")) problems.push('reserved cell id="0" is missing');
  if (byId.get("1")?.parent !== "0") problems.push('reserved cell id="1" with parent="0" is missing');
  const geo = (c) => { const g = /<mxGeometry\b([^>]*)\/?>/.exec(c.inner); return g ? attrsOf(g[1]) : null; };
  for (const c of cells) {
    if (c.id === "0" || c.id === "1") continue;
    if (c.parent && !byId.has(c.parent)) problems.push(`${c.id}: parent ${c.parent} does not exist`);
    if (c.edge === "1") {
      for (const k of ["source", "target"]) if (!c[k] || !byId.has(c[k])) problems.push(`${c.id}: edge ${k} ${c[k] ?? "(none)"} does not exist`);
      if (c.selfClosing || !/<mxGeometry\b[^>]*relative="1"/.test(c.inner)) problems.push(`${c.id}: edge must use the expanded form with <mxGeometry relative="1" as="geometry" />`);
      continue;
    }
    const g = geo(c);
    if (c.vertex === "1") {
      if (!g) { problems.push(`${c.id}: vertex without geometry`); continue; }
      for (const k of ["x", "y", "width", "height"]) if (Number(g[k] ?? 0) % 10 !== 0) problems.push(`${c.id}: ${k}=${g[k]} is off the 10 px grid`);
      const img = /image=([^;"]+)/.exec(c.style ?? "")?.[1];
      if (img && !Object.values(ICONS).includes(img)) problems.push(`${c.id}: icon ${img} is not in diagram/icons.json`);
      if (c.kind && /^image;/.test(c.style ?? "") && !ICONS[c.kind]) problems.push(`${c.id}: unknown icon kind ${c.kind}`);
      c.box = { x: Number(g.x ?? 0), y: Number(g.y ?? 0), w: Number(g.width ?? 0), h: Number(g.height ?? 0) };
    }
  }
  // overlapping siblings
  const byParent = new Map();
  for (const c of cells) if (c.box) { if (!byParent.has(c.parent)) byParent.set(c.parent, []); byParent.get(c.parent).push(c); }
  for (const sib of byParent.values()) for (let i = 0; i < sib.length; i++) for (let j = i + 1; j < sib.length; j++) {
    const a = sib[i].box, b = sib[j].box;
    if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) problems.push(`${sib[i].id} and ${sib[j].id} overlap`);
  }
  // coverage
  if (m) {
    const envInst = /<diagram id="architecture-([a-z0-9]+)-([a-z0-9]+-\d+)"/.exec(text);
    if (envInst) {
      const [, env, inst] = envInst;
      const want = [
        [literalName(m, "vnet", m.networkStack.owner, env, inst), m.networkStack.name],
        [literalName(m, "aks", m.clusterStack.owner, env, inst), m.clusterStack.name],
        [literalName(m, "cr", m.clusterStack.owner, env, inst), m.clusterStack.name],
        ...m.appStacks.flatMap((a) => [
          [literalName(m, "pgsql", a.owner, env, inst), a.name],
          [literalName(m, "kv", a.owner, env, inst), a.name],
          [literalName(m, "id", a.owner, env, inst), a.name],
        ]),
      ];
      for (const [res, stack] of want) {
        const c = cells.find((x) => x.resource === res);
        if (!c) problems.push(`missing resource ${res}`);
        else if (c.stack !== stack) problems.push(`${res}: stack label is ${c.stack ?? "(none)"}, expected ${stack}`);
      }
    }
  }
  return problems;
}

// ---------- export ----------
export function findDrawio() {
  const candidates = [];
  if (process.env.DRAWIO_BIN) candidates.push(process.env.DRAWIO_BIN);
  candidates.push("drawio", "draw.io");
  if (process.platform === "darwin") candidates.push("/Applications/draw.io.app/Contents/MacOS/draw.io");
  if (process.platform === "win32") {
    if (process.env.ProgramFiles) candidates.push(join(process.env.ProgramFiles, "draw.io", "draw.io.exe"));
    if (process.env.LOCALAPPDATA) candidates.push(join(process.env.LOCALAPPDATA, "Programs", "draw.io", "draw.io.exe"));
  }
  for (const c of candidates) {
    if (c.includes("/") || c.includes("\\")) { if (existsSync(c)) return c; continue; }
    const r = spawnSync(process.platform === "win32" ? "where" : "which", [c], { encoding: "utf8" });
    if (r.status === 0) return r.stdout.trim().split("\n")[0];
  }
  return null;
}

export function exportDiagram(file, formats, { draft = false } = {}) {
  const bin = findDrawio();
  if (!bin) return { exported: [], skipped: formats, hint: "install the draw.io desktop app (https://github.com/jgraph/drawio-desktop/releases) or set DRAWIO_BIN; on headless Linux also install xvfb" };
  const headless = process.platform === "linux" && !process.env.DISPLAY;
  const exported = [];
  const failed = [];
  for (const f of formats) {
    const out = draft ? file.replace(/\.drawio$/, ".draft.png") : file.replace(/\.drawio$/, `.${f}`);
    const args = f === "svg" ? ["-x", "-f", "svg", "-e", "--embed-svg-images", "-o", out, file]
      : draft ? ["-x", "-f", "png", "--width", "2000", "-o", out, file] // draft: no -e, never with -s
      : ["-x", "-f", "png", "-e", "-s", "2", "-o", out, file];
    const cmd = headless ? "xvfb-run" : bin;
    const full = headless ? ["-a", bin, ...args, "--disable-gpu", "--no-sandbox"] : [...args, ...(process.platform === "linux" ? ["--no-sandbox"] : [])];
    const r = spawnSync(cmd, full, { encoding: "utf8", env: { ...process.env, HOME: process.env.HOME || "/tmp" } });
    if (r.status === 0 && existsSync(out)) exported.push(out); else failed.push(`${f}: ${(r.stderr || r.error?.message || "").trim().split("\n").slice(-3).join(" ")}`);
  }
  return { exported, failed, skipped: [] };
}
