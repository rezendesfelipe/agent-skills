// Every skill and every agent of the catalog must ship example prompts (OpenSpec change add-prompt-examples).
// The catalog is DISCOVERED (plugins/*/skills/* and plugins/*/agents/*), never listed here, so a new skill or agent without
// examples fails this test. The same checks run on a scratch copy with planted mistakes (the mutation tests at the end).
//
// Rule for where the examples live:
//   - a skill: plugins/<plugin>/skills/<skill>/references/prompts.md, linked once from its SKILL.md;
//   - an agent with `skills:`: a section "## Agent: <name>" in the prompts.md of one of the skills it lists;
//   - an agent without `skills:`: the full examples under "### <name>" in the README section "Example prompts";
//   - every skill and agent also has a starter prompt in the README section, equal to the first example in its file.
// What is checked is structure, secrets and safety words. That a prompt works well is NOT checked here (see the smoke
// checklist of the change).
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { parseDocument } from "../src/lib/frontmatter.mjs";
import { scanString } from "../plugins/assessment-report/skills/assessment-report/scripts/lib/secrets.mjs";
import { REPO_ROOT } from "./helpers.mjs";

const POINTER = "references/prompts.md";
const MAX_OUTPUT_LINES = 30;
const LEVELS = ["Beginner", "Advanced", "Consultancy"];
const lf = (t) => t.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
const read = (p) => lf(readFileSync(p, "utf8"));
const subdirs = (d) => (existsSync(d) ? readdirSync(d).filter((n) => statSync(join(d, n)).isDirectory()).sort() : []);

/** Skills and agents found by looking at the folders. */
export function discover(root) {
  const skills = [];
  const agents = [];
  for (const plugin of subdirs(join(root, "plugins"))) {
    for (const skill of subdirs(join(root, "plugins", plugin, "skills")))
      if (existsSync(join(root, "plugins", plugin, "skills", skill, "SKILL.md"))) skills.push({ name: skill, dir: join(root, "plugins", plugin, "skills", skill) });
    const ad = join(root, "plugins", plugin, "agents");
    if (existsSync(ad))
      for (const f of readdirSync(ad).sort())
        if (f.endsWith(".md") && statSync(join(ad, f)).isFile()) {
          const file = join(ad, f);
          const doc = parseDocument(read(file));
          agents.push({ name: f.slice(0, -3), file, skills: doc?.has("skills") ? doc.list("skills") ?? [] : [] });
        }
  }
  return { skills, agents };
}

/** Splits a Markdown text into level 2 sections with their examples (`### `id`: title`) and fenced blocks. */
export function parse(text) {
  const lines = lf(text).split("\n");
  const sections = [];
  let sec = { h2: "", examples: [], lines: [] };
  sections.push(sec);
  let ex = null;
  let fence = null;
  for (const line of lines) {
    if (fence) {
      if (line.startsWith("```")) {
        fence = null;
      } else fence.content.push(line);
      continue;
    }
    const f = line.match(/^```(.*)$/);
    if (f) {
      fence = { info: f[1].trim(), content: [] };
      (ex ?? sec).fences = [...((ex ?? sec).fences ?? []), fence];
      (ex ?? sec).lines.push(line);
      continue;
    }
    const h2 = line.match(/^## (.+)$/);
    const h3 = line.match(/^###+ `([^`]+)`: (.+)$/);
    const hOther = /^###+ /.test(line);
    if (h2) {
      sec = { h2: h2[1].trim(), examples: [], lines: [] };
      sections.push(sec);
      ex = null;
    } else if (h3) {
      ex = { id: h3[1], title: h3[2], lines: [], fences: [] };
      sec.examples.push(ex);
    } else if (hOther) {
      ex = null;
      sec.lines.push(line);
    } else (ex ?? sec).lines.push(line);
  }
  return sections;
}

const bullets = (lines, marker) => {
  const i = lines.findIndex((l) => l.startsWith(marker));
  if (i < 0) return null;
  const out = [];
  for (let j = i + 1; j < lines.length && lines[j].startsWith("- "); j++) out.push(lines[j]);
  return out;
};
const block = (ex, info) => ex.fences.filter((f) => f.info === info);

/** Errors of one example. `anti` examples sit under "What not to ask". */
function checkExample(where, ex, anti) {
  const e = [];
  const at = `${where}: example \`${ex.id}\``;
  const en = block(ex, "text en");
  const pt = block(ex, "text pt-BR");
  if (en.length !== 1) e.push(`${at}: needs exactly one \`text en\` block (found ${en.length})`);
  if (pt.length !== 1) e.push(`${at}: needs exactly one \`text pt-BR\` block (found ${pt.length})`);
  for (const f of [...en, ...pt]) if (!f.content.join("").trim()) e.push(`${at}: an empty prompt block`);
  if (anti) {
    for (const m of ["Reason:", "Motivo:", "Instead:", "Em vez disso:"])
      if (!ex.lines.some((l) => l.startsWith(m))) e.push(`${at}: an anti-example needs a line starting with "${m}"`);
    return e;
  }
  for (const m of ["What you get:", "O que você recebe:"]) if (!ex.lines.some((l) => l.startsWith(m))) e.push(`${at}: missing a line starting with "${m}"`);
  const real = ex.lines.filter((l) => /^Real output \(command: `[^`]+`\):$/.test(l));
  const ill = ex.lines.filter((l) => l === "Illustrative excerpt, not a captured run:");
  if (real.length + ill.length !== 1) e.push(`${at}: needs exactly one output label: "Real output (command: \`...\`):" or "Illustrative excerpt, not a captured run:"`);
  const out = block(ex, "text output");
  if (out.length !== 1) e.push(`${at}: needs exactly one \`text output\` block (found ${out.length})`);
  else if (out[0].content.length > MAX_OUTPUT_LINES || !out[0].content.join("").trim()) e.push(`${at}: the output block must have 1 to ${MAX_OUTPUT_LINES} lines (point to the generated file for more)`);
  const tEn = bullets(ex.lines, "Tips (en):");
  const tPt = bullets(ex.lines, "Dicas (pt-BR):");
  if (!tEn || !tPt) e.push(`${at}: needs "Tips (en):" and "Dicas (pt-BR):" lists`);
  else {
    if (tEn.length < 2 || tEn.length > 4) e.push(`${at}: 2 to 4 tips are expected (found ${tEn.length})`);
    if (tEn.length !== tPt.length) e.push(`${at}: ${tEn.length} tips in en and ${tPt.length} in pt-BR`);
  }
  return e;
}

// A positive auditor example must not ask for a change or for a command outside the agent's allowlist (a heuristic lint).
const UNSAFE_EN = /\b(fix(es|ing)?|apply|commit|push|pull request|delete|remove|rewrite|edit|terraform|kubectl|git|az|gh|validate|plan)\b/i;
const UNSAFE_PT = /\b(corrij\w*|aplic\w*|commit|push|pull request|apag\w*|remov\w*|reescrev\w*|edit\w*|terraform|kubectl|git|az|gh|validate|plan)\b/i;
const NEGATED = /\b(do not|don't|never|without|nothing|não|nunca|sem|nada)\b/i;

/** Examples (positive) of a list of sections, with the "where" label. */
const positives = (sections) => sections.flatMap((s) => (s.h2 === "What not to ask" ? [] : s.examples));

function checkFileText(where, text) {
  const e = [];
  const found = scanString(text);
  if (found.length) e.push(`${where}: text that looks like a secret (${found.join(", ")})`);
  for (const g of text.match(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi) ?? [])
    if (!/^0{8}-0{4}-0{4}-0{4}-0{9}[0-9a-f]{3}$/i.test(g)) e.push(`${where}: a GUID that is not a placeholder of zeros (${g})`);
  if (/(\/home\/|\/Users\/|\/root\/|\/tmp\/|\/var\/folders\/|[A-Za-z]:\\Users\\)/.test(text)) e.push(`${where}: a personal or temporary path`);
  return e;
}

/** Checks one prompts file (a skill's) and returns errors. Agent sections are validated here too. */
function checkPromptsFile(where, text, { agentsOfThisSkill }) {
  const e = [...checkFileText(where, text)];
  const secs = parse(text);
  const head = lf(text).split("\n").slice(0, 12).join("\n");
  if (!/^Status: /m.test(head)) e.push(`${where}: missing the "Status:" line near the top`);
  if (!/starting examples/i.test(text)) e.push(`${where}: must call the prompts "starting examples"`);
  if (/\b(maximi[sz]e|guarantee[sd]?|optimal prompt)\b/i.test(text.replace(/\bnever guarantee[sd]?\b/gi, ""))) e.push(`${where}: claims a guarantee or an optimum`);
  for (const m of ["Where not to paste:", "Onde não colar:"]) if (!new RegExp(`^${m}`, "m").test(text)) e.push(`${where}: missing a line starting with "${m}"`);
  if (!secs.some((s) => s.h2 === "Contents")) e.push(`${where}: missing the "Contents" section`);
  for (const lv of LEVELS) {
    const s = secs.find((x) => x.h2 === lv);
    if (!s || !s.examples.length) e.push(`${where}: level "${lv}" needs at least one example`);
  }
  const anti = secs.find((s) => s.h2 === "What not to ask");
  if (!anti || !anti.examples.length) e.push(`${where}: "What not to ask" needs at least one example`);
  const ids = new Set();
  for (const s of secs) {
    for (const ex of s.examples) {
      if (ids.has(ex.id)) e.push(`${where}: duplicate id \`${ex.id}\``);
      ids.add(ex.id);
      e.push(...checkExample(where, ex, s.h2 === "What not to ask"));
    }
  }
  for (const a of agentsOfThisSkill) {
    const s = secs.find((x) => x.h2 === `Agent: ${a.name}`);
    if (!s || !s.examples.length) {
      e.push(`${where}: agent \`${a.name}\` preloads this skill, so its examples must be in a section "## Agent: ${a.name}"`);
      continue;
    }
    for (const ex of s.examples)
      for (const f of [...block(ex, "text en"), ...block(ex, "text pt-BR")]) {
        const body = f.content.join("\n");
        const bad = [f.info === "text en" ? UNSAFE_EN : UNSAFE_PT].map((re) => body.split(/[.\n]/).filter((sent) => re.test(sent) && !NEGATED.test(sent))).flat();
        if (bad.length) e.push(`${where}: example \`${ex.id}\` of agent \`${a.name}\` asks for something the agent cannot do: "${bad[0].trim().slice(0, 80)}"`);
      }
  }
  return e;
}

/** All errors of a repository root. */
export function checkRepo(root) {
  const e = [];
  const { skills, agents } = discover(root);
  const readmePath = join(root, "README.md");
  const readme = existsSync(readmePath) ? read(readmePath) : "";
  const rsecs = parse(readme);
  const rex = rsecs.find((s) => s.h2 === "Example prompts");
  const rsub = (name) => {
    const lines = readme.split("\n");
    const start = lines.findIndex((l) => l === "## Example prompts");
    if (start < 0) return null;
    let end = lines.findIndex((l, i) => i > start && /^## /.test(l));
    if (end < 0) end = lines.length;
    const part = lines.slice(start + 1, end);
    const i = part.findIndex((l) => l === `### ${name}`);
    if (i < 0) return null;
    let j = part.findIndex((l, k) => k > i && /^### /.test(l));
    if (j < 0) j = part.length;
    return { text: part.slice(i + 1, j).join("\n") };
  };
  if (!rex) e.push("README.md: missing the section \"## Example prompts\"");

  const firstExample = new Map(); // capability name -> example of its file
  for (const s of skills) {
    const where = `skill ${s.name}`;
    const skillMd = read(join(s.dir, "SKILL.md"));
    const n = skillMd.split(POINTER).length - 1;
    if (n !== 1) e.push(`${where}: SKILL.md must contain "${POINTER}" exactly once (found ${n})`);
    const pf = join(s.dir, "references", "prompts.md");
    if (!existsSync(pf)) {
      e.push(`${where}: missing references/prompts.md`);
      continue;
    }
    const text = read(pf);
    const mine = agents.filter((a) => a.skills.includes(s.name));
    e.push(...checkPromptsFile(`${where} (references/prompts.md)`, text, { agentsOfThisSkill: mine }));
    const secs = parse(text);
    const first = LEVELS.map((lv) => secs.find((x) => x.h2 === lv)?.examples[0]).find(Boolean);
    if (first) firstExample.set(s.name, first);
    for (const a of mine) {
      const sec = secs.find((x) => x.h2 === `Agent: ${a.name}`);
      if (sec?.examples[0]) firstExample.set(`agent:${a.name}`, sec.examples[0]);
    }
  }

  for (const a of agents) {
    const where = `agent ${a.name}`;
    const body = read(a.file);
    if (/^```text (en|pt-BR)\b/m.test(body) || body.includes("prompts.md")) e.push(`${where}: the agent file is its system prompt and must not hold example prompts or point to them`);
    if (a.skills.length) {
      const known = a.skills.filter((n) => skills.some((s) => s.name === n));
      if (!known.length) e.push(`${where}: lists skills that are not in the catalog, so there is nowhere to find its examples`);
      continue; // the section "## Agent: <name>" in the skill's file is checked above
    }
    // no skill to point to: the full examples live in the README
    const part = rsub(a.name);
    if (!part) {
      e.push(`${where}: has no \`skills:\`, so its examples must be under "### ${a.name}" in the README section "Example prompts"`);
      continue;
    }
    const exs = parse(part.text).flatMap((s) => s.examples);
    if (!exs.length) e.push(`${where}: the README section has no example`);
    for (const ex of exs) e.push(...checkExample(`README.md, ${a.name}`, ex, false));
    if (exs[0]) firstExample.set(`agent:${a.name}`, exs[0]);
  }

  // README starter prompts: every skill and every agent, equal to the first example of its file
  e.push(...checkFileText("README.md", readme));
  for (const cap of [...skills.map((s) => ({ key: s.name, name: s.name })), ...agents.map((a) => ({ key: `agent:${a.name}`, name: a.name }))]) {
    const part = rsub(cap.name);
    if (!part) {
      e.push(`README.md: "Example prompts" has no "### ${cap.name}"`);
      continue;
    }
    const sub = parse(part.text);
    const fences = sub.flatMap((s) => [...(s.fences ?? []), ...s.examples.flatMap((x) => x.fences)]);
    const en = fences.find((f) => f.info === "text en");
    const pt = fences.find((f) => f.info === "text pt-BR");
    if (!en || !pt) {
      e.push(`README.md: "### ${cap.name}" needs a \`text en\` and a \`text pt-BR\` starter prompt`);
      continue;
    }
    const src = firstExample.get(cap.key);
    if (src) {
      if (block(src, "text en")[0]?.content.join("\n") !== en.content.join("\n")) e.push(`README.md: the English starter prompt of "${cap.name}" differs from the first example of its file`);
      if (block(src, "text pt-BR")[0]?.content.join("\n") !== pt.content.join("\n")) e.push(`README.md: the pt-BR starter prompt of "${cap.name}" differs from the first example of its file`);
    }
  }
  return e;
}

test("every skill and every agent of the catalog has example prompts that pass the checks", () => {
  const { skills, agents } = discover(REPO_ROOT);
  assert.ok(skills.length >= 3 && agents.length >= 1, "the catalog was not found");
  const errors = checkRepo(REPO_ROOT);
  assert.deepEqual(errors, [], `\n${errors.join("\n")}`);
});

test("the discovery covers each folder of plugins/*/skills and plugins/*/agents", () => {
  const { skills, agents } = discover(REPO_ROOT);
  const onDisk = subdirs(join(REPO_ROOT, "plugins")).flatMap((p) => subdirs(join(REPO_ROOT, "plugins", p, "skills")));
  assert.deepEqual(skills.map((s) => s.name).sort(), onDisk.sort());
  assert.ok(agents.some((a) => a.name === "stacks-auditor"));
});

// ---- mutations: the same checks on a scratch copy with one planted mistake each --------------------------------------
function scratch() {
  const dir = mkdtempSync(join(tmpdir(), "prompt-examples-"));
  cpSync(join(REPO_ROOT, "README.md"), join(dir, "README.md"));
  const { skills, agents } = discover(REPO_ROOT);
  for (const s of skills) {
    const rel = s.dir.slice(REPO_ROOT.length);
    mkdirSync(join(dir, rel, "references"), { recursive: true });
    cpSync(join(s.dir, "SKILL.md"), join(dir, rel, "SKILL.md"));
    cpSync(join(s.dir, "references", "prompts.md"), join(dir, rel, "references", "prompts.md"));
  }
  for (const a of agents) {
    const rel = a.file.slice(REPO_ROOT.length);
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    cpSync(a.file, join(dir, rel));
  }
  return dir;
}
const edit = (file, fn) => writeFileSync(file, fn(readFileSync(file, "utf8")));
const prompts = (dir, skill) => {
  const { skills } = discover(dir);
  return join(skills.find((s) => s.name === skill).dir, "references", "prompts.md");
};
const mutate = (name, change, expected) =>
  test(`mutation: ${name}`, () => {
    const dir = scratch();
    try {
      assert.deepEqual(checkRepo(dir), [], "the scratch copy must start clean");
      change(dir);
      const errors = checkRepo(dir);
      assert.ok(errors.some((x) => expected.test(x)), `expected an error matching ${expected}, got:\n${errors.join("\n") || "(none)"}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

mutate("a new skill without examples fails", (d) => {
  mkdirSync(join(d, "plugins", "fake", "skills", "fake-skill"), { recursive: true });
  writeFileSync(join(d, "plugins", "fake", "skills", "fake-skill", "SKILL.md"), "---\nname: fake-skill\ndescription: A fictitious skill without examples.\n---\n# Fake\n");
}, /skill fake-skill: missing references\/prompts\.md/);

mutate("a new agent without skills and without a README section fails", (d) => {
  mkdirSync(join(d, "plugins", "fake", "agents"), { recursive: true });
  writeFileSync(join(d, "plugins", "fake", "agents", "fake-agent.md"), "---\nname: fake-agent\ndescription: A fictitious agent.\ntools: Read\n---\nYou read.\n");
}, /agent fake-agent: has no `skills:`/);

mutate("a new agent that preloads a skill without its section fails", (d) => {
  mkdirSync(join(d, "plugins", "fake", "agents"), { recursive: true });
  writeFileSync(join(d, "plugins", "fake", "agents", "fake-agent.md"), "---\nname: fake-agent\ndescription: A fictitious agent.\ntools: Read\nskills:\n  - docs-generator\n---\nYou read.\n");
}, /agent `fake-agent` preloads this skill/);

mutate("a missing pt-BR block fails", (d) => {
  const f = prompts(d, "docs-generator");
  edit(f, (t) => t.replace(/```text pt-BR\n[\s\S]*?\n```\n/, ""));
}, /needs exactly one `text pt-BR` block/);

mutate("a missing output label fails", (d) => {
  edit(prompts(d, "docs-generator"), (t) => t.replace(/^Illustrative excerpt, not a captured run:$/m, "Output:").replace(/^Real output \(command: `[^`]+`\):$/m, "Output:"));
}, /needs exactly one output label/);

mutate("a secret-shaped line fails", (d) => {
  const key = ["-----BEGIN ", "PRIVATE ", "KEY-----"].join("");
  edit(prompts(d, "assessment-report"), (t) => `${t}\n${key}\n`);
}, /looks like a secret/);

mutate("a GUID that is not zeros fails", (d) => {
  edit(prompts(d, "azure-terraform-stacks"), (t) => `${t}\nsubscription 3f2b8c1e-5a4d-4e6f-9b7a-1c2d3e4f5a6b\n`);
}, /GUID that is not a placeholder/);

mutate("a personal path fails", (d) => {
  edit(prompts(d, "docs-generator"), (t) => `${t}\nSee /home/someone/work\n`);
}, /personal or temporary path/);

mutate("a second pointer in SKILL.md fails", (d) => {
  const { skills } = discover(d);
  const s = skills.find((x) => x.name === "docs-generator");
  edit(join(s.dir, "SKILL.md"), (t) => `${t}\nSee also references/prompts.md\n`);
}, /exactly once/);

mutate("an auditor example that asks for a fix fails", (d) => {
  edit(prompts(d, "azure-terraform-stacks"), (t) => t.replace("Change nothing.", "Fix every finding and open a pull request."));
}, /agent `stacks-auditor` asks for something the agent cannot do/);

mutate("an example block inside the agent file fails", (d) => {
  const { agents } = discover(d);
  edit(agents[0].file, (t) => `${t}\n\`\`\`text en\nAudit this.\n\`\`\`\n`);
}, /must not hold example prompts/);

mutate("a README starter prompt that differs by one character fails", (d) => {
  edit(join(d, "README.md"), (t) => t.replace("Use the docs-generator skill", "Use the docs-generator skil"));
}, /English starter prompt of "docs-generator" differs/);

mutate("a missing README entry for a capability fails", (d) => {
  edit(join(d, "README.md"), (t) => t.replace(/^### assessment-report$/m, "### assessment-report-renamed"));
}, /no "### assessment-report"/);
