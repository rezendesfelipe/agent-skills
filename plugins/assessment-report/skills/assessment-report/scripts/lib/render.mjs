// Renders assessment.json to Markdown in the docs-generator source format. No layout, PDF or DOCX code lives here:
// the skill hands report/report.md to docs-generator for that. Only constructs docs-generator supports are
// emitted: no raw HTML, footnotes, reference links or horizontal rules; GitHub tables; fenced code blocks.
import { buildMatrix, effortDays, expandTokens, notVerifiedFindings, quickWins, shownFindings, tokenValues, verifyFirst } from "./classify.mjs";
import { fmt, loadLabels } from "./locales.mjs";
import { WAVES, checkRoadmap } from "./roadmap.mjs";
import { SEVERITIES } from "./assessment.mjs";
import { scanString } from "./secrets.mjs";

// ---- Markdown helpers ------------------------------------------------------------------------------------
/** Escapes text for a table cell or a line of prose, so model-written text can never become markup. */
export const inline = (s) =>
  String(s ?? "")
    .replace(/\s*[\r\n]+\s*/g, " ")
    .replace(/[\\`*_[\]<>|~&]/g, "\\$&")
    .trim();

/** Escapes a paragraph: every line as inline text, plus line starts that would turn into a list or heading. */
export const para = (s) =>
  String(s ?? "")
    .split(/\r?\n/)
    .map((line) => inline(line).replace(/^(#{1,6}(?=\s)|[-+](?=\s)|\d+[.)](?=\s)|=+$)/, "\\$1"))
    .join("\n")
    .trim();

/** Inline code that never contains a backtick. */
export const code = (s) => `\`${String(s ?? "").replace(/`/g, "'").replace(/\s*[\r\n]+\s*/g, " ")}\``;

/** A fenced block for a quote. Runs of three or more backticks are replaced by a visible substitute. */
export function fence(text, escapedLabel) {
  const raw = String(text ?? "").replace(/\r\n?/g, "\n").replace(/\n+$/, "");
  const safe = raw.replace(/`{3,}/g, (m) => "‵".repeat(m.length));
  return `\`\`\`\n${safe}\n\`\`\`${safe !== raw ? `\n${escapedLabel}` : ""}`;
}

const table = (headers, rows) => `| ${headers.map(inline).join(" | ")} |\n|${headers.map(() => "---").join("|")}|\n${rows.map((r) => `| ${r.map((c) => (c === "" ? "-" : c)).join(" | ")} |`).join("\n")}`;

const yamlStr = (s) => JSON.stringify(String(s));
function yamlBlock(text, indent = 2) {
  const pad = " ".repeat(indent);
  return `|${indent}\n${String(text).split(/\r?\n/).map((l) => (l ? pad + l : "")).join("\n")}`;
}

// ---- Shared computations -----------------------------------------------------------------------------
const sevOrder = (f) => -SEVERITIES.indexOf(f.severity);
const byRank = (a, b) => sevOrder(a) - sevOrder(b) || a.id.localeCompare(b.id);

function confidenceText(L, f) {
  return L.confidenceNames[f.confidence];
}
function failureCodesOf(a, f) {
  const results = a.verification?.results ?? [];
  const codes = [...new Set(f.evidence.map((id) => results.find((r) => r.evidence === id)).filter((r) => r?.status === "fail").map((r) => r.code))];
  return codes.length ? codes.join(", ") : "no-evidence";
}
function citedBy(a, evId) {
  return a.findings.filter((f) => f.evidence.includes(evId)).map((f) => f.id);
}
function effortRanges(scale) {
  const d = effortDays(scale);
  return Object.fromEntries(Object.entries(d).map(([k, [lo, hi]]) => [k, hi === null ? `>${lo - 1}` : lo === hi ? `${lo}` : `${lo}-${hi}`]));
}
const dayText = (min, max) => (max === null ? `${min}+` : min === max ? `${min}` : `${min}-${max}`);

export function matrixMarkdown(a, L) {
  const m = buildMatrix(a);
  const ranges = effortRanges(a.scope?.scale);
  const headers = [`${L.severity} / ${L.effort}`, ...m.efforts.map((e) => `${e} (${ranges[e]})`)];
  const rows = m.rows.map((r) => [L.severityNames[r.severity], ...m.efforts.map((e) => r.cells[e].join(", "))]);
  return table(headers, rows);
}

// ---- Body --------------------------------------------------------------------------------------------
function body(a, L, { unreviewed }) {
  const out = [];
  const shown = shownFindings(a).sort(byRank);
  const nv = notVerifiedFindings(a);
  const tokens = tokenValues(a);
  const qw = quickWins(a);

  if (unreviewed) out.push(`> **${L.notReviewed}**`);

  out.push(`# ${inline(L.headline)}`);
  out.push(
    para(
      shown.length
        ? fmt(L.headlineText, {
            client: a.meta.client, findings: shown.length, critical: tokens["count.critical"], high: tokens["count.high"],
            medium: tokens["count.medium"], low: tokens["count.low"], info: tokens["count.info"], unverified: nv.length, quickwins: qw.length,
          })
        : `${L.noFindings} ${fmt(L.headlineText, { client: a.meta.client, findings: 0, critical: 0, high: 0, medium: 0, low: 0, info: 0, unverified: nv.length, quickwins: 0 })}`,
    ),
  );

  out.push(`# ${inline(L.mainFindings)}`);
  if (shown.length) {
    const top = shown.slice(0, 10);
    if (shown.length > top.length) out.push(para(fmt(L.topFindingsNote, { shown: top.length, total: shown.length })));
    out.push(table([L.id, L.finding, L.severity, L.confidence, L.effort], top.map((f) => [f.id, inline(f.title), L.severityNames[f.severity], inline(confidenceText(L, f)), f.effort])));
    for (const f of top.filter((x) => x.severity === "Critical" || x.severity === "High").slice(0, 6)) {
      out.push(`## ${inline(`${f.id}: ${f.title}`)}`);
      out.push(para(f.statement));
      if (f.recommendation) out.push(`**${inline(L.recommendation)}.** ${para(f.recommendation)}`);
    }
  } else out.push(para(L.noFindings));

  const vf = verifyFirst(a).sort(byRank);
  if (vf.length) {
    out.push(`## ${inline(L.verifyFirst)}`);
    out.push(para(L.verifyFirstIntro));
    out.push(table([L.id, L.finding, L.potentialSeverity, L.confidence], vf.map((f) => [f.id, inline(f.title), L.severityNames[f.potentialSeverity], inline(confidenceText(L, f))])));
  }

  out.push(`# ${inline(L.matrix)}`);
  out.push(para(L.matrixIntro));
  out.push(matrixMarkdown(a, L));
  out.push(`## ${inline(L.quickWins)}`);
  if (qw.length) {
    out.push(para(L.quickWinsIntro));
    out.push(qw.map((f) => `- ${inline(`${f.id}: ${f.title} (${L.severityNames[f.severity]}, ${L.effort} ${f.effort})`)}`).join("\n"));
  } else out.push(para(L.noQuickWins));

  out.push(`# ${inline(L.roadmap)}`);
  const rm = checkRoadmap(a);
  for (const w of [1, 2, 3, 4]) {
    const acts = a.actions.filter((x) => x.wave === w);
    if (w === 4 && !acts.length) continue;
    out.push(`## ${inline(w === 4 ? L.waveLater : fmt(L.waveTitle, { n: w, days: WAVES[w].days }))}`);
    if (!acts.length) {
      out.push(para(L.waveEmpty));
      continue;
    }
    out.push(table([L.id, L.action, L.addresses, L.effort, L.risk, L.dependsOn], acts.map((x) => [x.id, inline(x.title), x.addresses.join(", "), x.effort, L.riskNames[x.risk], x.dependsOn.join(", ")])));
    const t = rm.totals[w];
    out.push(para(t.max === null ? fmt(L.waveTotalOpen, { min: t.min }) : fmt(L.waveTotal, { total: dayText(t.min, t.max) })));
    for (const wr of rm.warnings.filter((x) => x.message.startsWith(`wave ${w} `))) out.push(para(fmt(L.capacityWarning, { message: wr.message })));
  }
  if (a.roadmapViolations?.length) {
    out.push(`## ${inline(L.roadmapViolations)}`);
    out.push(para(L.roadmapViolationsIntro));
    out.push(a.roadmapViolations.map((v) => `- ${inline(v)}`).join("\n"));
  }

  out.push(`# ${inline(L.decisions)}`);
  if (a.decisions?.length) out.push(a.decisions.map((d) => `- ${inline(d.text)}${d.relatesTo?.length ? ` (${d.relatesTo.join(", ")})` : ""}`).join("\n"));
  else out.push(para(L.noDecisions));

  out.push(`# ${inline(L.notVerified)}`);
  if (nv.length) {
    out.push(para(L.notVerifiedIntro));
    out.push(
      table(
        [L.id, L.finding, L.failureCodes, L.action],
        nv.map((f) => [f.id, inline(f.title), inline(failureCodesOf(a, f)), a.actions.filter((x) => x.addresses.includes(f.id)).map((x) => x.id).join(", ")]),
      ),
    );
  } else out.push(para(L.noNotVerified));

  out.push(`# ${inline(L.scopeLimits)}`);
  const list = (title, items) => `**${inline(title)}**\n\n${items.length ? items.map((i) => `- ${inline(i)}`).join("\n") : para(L.none)}`;
  out.push(list(L.scopeIn, a.scope.in));
  out.push(list(L.scopeOut, a.scope.out));
  out.push(list(L.questions, a.scope.questions));
  out.push(list(L.assumptions, a.scope.assumptions));
  if (a.scope.scale) out.push(para(fmt(L.scaleOverride, { note: a.scope.scale.note })));
  out.push(para(L.limitsLine));
  return out.join("\n\n");
}

// ---- Annexes -----------------------------------------------------------------------------------------
function evidenceBlock(a, L, e) {
  const r = a.verification?.results.find((x) => x.evidence === e.id);
  const status = r ? L.resultNames[r.status] + (r.status === "fail" ? ` (${r.code})` : "") : "";
  const head = `**${e.id}** (${e.kind}, ${inline(status)})`;
  switch (e.kind) {
    case "file":
    case "document": {
      const loc = code(`${e.path}:${e.startLine}-${e.endLine}`);
      const extra = e.kind === "document" ? `, ${inline(fmt(L.documentText, { source: e.source }))}` : "";
      if (e.redacted) return `${head}: ${loc}, ${inline(fmt(L.redactedText, { kind: e.secretKind }))}`;
      return `${head}: ${loc}${extra}\n\n${fence(e.quote, L.escaped)}`;
    }
    case "absence":
      return `${head}: ${inline(fmt(L.absenceText, { scope: e.scope.join(", "), pattern: e.pattern }))}`;
    case "output":
      return `${head}: ${inline(fmt(L.outputText, { command: e.command, at: e.capturedAt }))}\n\n${fence(e.quote, L.escaped)}`;
    case "url":
      return `${head}: ${inline(fmt(L.urlText, { url: e.url, accessed: e.accessed }))}${e.snapshot ? "" : `, ${inline(L.urlNoSnapshot)}`}\n\n${fence(e.quote, L.escaped)}`;
    case "statement":
      return `${head}: ${inline(fmt(L.statementText, { source: e.source, date: e.date }))}\n\n${String(e.text).split(/\r?\n/).map((l) => `> ${inline(l)}`).join("\n")}`;
    default:
      return head;
  }
}

function annexFindings(a, L) {
  const out = [];
  for (const f of shownFindings(a).sort(byRank)) {
    out.push(`# ${inline(`${f.id}: ${f.title}`)}`);
    const facts = [`**${inline(L.severity)}:** ${L.severityNames[f.severity]}`, `**${inline(L.confidence)}:** ${inline(confidenceText(L, f))}`, `**${inline(L.effortLabel)}:** ${f.effort}${f.effortNote ? ` (${inline(f.effortNote)})` : ""}`];
    out.push(facts.join(" | "));
    if (f.severityUncapped) out.push(para(fmt(L.uncapped, { severity: L.severityNames[f.severityUncapped] })));
    out.push(`**${inline(L.statement)}.** ${para(f.statement)}`);
    out.push(`**${inline(L.evidenceLabel)}**`);
    for (const id of f.evidence) {
      const e = a.evidence.find((x) => x.id === id);
      if (e) out.push(evidenceBlock(a, L, e));
    }
    out.push(`**${inline(L.impactRationale)}.** ${para(f.rationale.impact)}`);
    out.push(`**${inline(L.likelihoodRationale)}.** ${para(f.rationale.likelihood)}`);
    if (f.recommendation) out.push(`**${inline(L.recommendation)}.** ${para(f.recommendation)}`);
    if (f.controls?.length) out.push(`**${inline(L.controlsLabel)}:** ${f.controls.map((c) => inline(`${c.framework} ${c.controlId}`)).join(", ")}`);
    if (f.disposition) out.push(`**${inline(L.dispositionLabel)}:** ${inline(`${f.disposition.status}; ${f.disposition.reason}; ${f.disposition.owner}`)}`);
  }
  if (!out.length) out.push(para(L.noFindings));
  return out.join("\n\n");
}

function annexEvidence(a, L) {
  const results = a.verification?.results ?? [];
  const out = [`# ${inline(L.evidenceIndex)}`];
  out.push(
    table(
      [L.id, L.kind, L.location, L.result, L.code, L.citedBy],
      a.evidence.map((e) => {
        const r = results.find((x) => x.evidence === e.id);
        const loc = r?.location ?? (e.path ? `${e.path}` : e.url ?? e.source ?? "");
        return [e.id, e.kind, loc ? code(loc) : "", r ? L.resultNames[r.status] : "", r?.code ?? "", citedBy(a, e.id).join(", ")];
      }),
    ),
  );
  out.push(`# ${inline(L.failuresTitle)}`);
  const fails = results.filter((r) => r.status === "fail");
  if (!fails.length && !(a.verification?.problems ?? []).length) out.push(para(L.noEvidenceFailures));
  for (const r of fails) {
    out.push(`- ${inline(fmt(L.failureLine, { id: r.evidence, code: r.code, location: r.location ?? "-", message: r.message ?? "" }))}`);
    for (const m of r.matches ?? []) out.push(`  - ${inline(m)}`);
  }
  const problems = a.verification?.problems ?? [];
  if (problems.length) {
    out.push(`## ${inline(L.problemsTitle)}`);
    out.push(problems.map((p) => `- ${inline(`[${p.code}] ${p.where}: ${p.message}`)}`).join("\n"));
  }
  return out.join("\n\n").replace(/\n\n(  - )/g, "\n$1");
}

function annexFrameworks(a, L) {
  const out = [`# ${inline(L.frameworksRegistered)}`];
  out.push(table([L.id, L.name, L.version, L.date, L.url], a.frameworks.map((f) => [inline(f.id), inline(f.name), inline(f.version), f.date, inline(f.url)])));
  out.push(`# ${inline(L.controlMapping)}`);
  const ctl = a.verification?.controls ?? [];
  if (ctl.length) {
    out.push(table([L.finding, L.framework, L.control, L.status], ctl.map((c) => [c.finding, inline(c.framework), inline(c.controlId), inline(L.controlStatus[c.status])])));
    if (ctl.some((c) => c.status === "unchecked")) out.push(para(L.mappingUnchecked));
  } else out.push(para(L.noControlMapped));
  return out.join("\n\n");
}

function annexMethod(a, L, { unreviewed }) {
  const m = a.meta;
  const modelText = m.model.id === "unknown" ? L.modelUnknown : `${m.model.id}; ${L.reportedBy}: ${L.reportedByNames[m.model.reportedBy]}`;
  const reviewer = m.review ? fmt(L.reviewedBy, { by: m.review.by, at: m.review.at }) : L.notHumanReviewed;
  const out = [`# ${inline(L.methodRun)}`];
  out.push(
    table(
      ["", ""],
      [
        [L.skillVersion, inline(m.skillVersion)],
        [L.engineVersion, inline(m.engineVersion)],
        [L.model, inline(modelText)],
        [L.revision, inline(m.revision || "-")],
        [L.date, inline(m.date)],
        [L.reviewer, inline(reviewer)],
      ],
    ),
  );
  if (unreviewed && !m.review) out.push(para(L.notReviewed));
  out.push(`# ${inline(L.verifierTitle)}`);
  out.push(para(L.verifierProves));
  out.push(para(L.verifierDoesNot));
  out.push(para(L.evidenceLimits));
  out.push(para(L.secretScan));
  out.push(`# ${inline(L.conventionsTitle)}`);
  out.push(para(L.conventionsIntro));
  out.push(para(L.confidenceRules));
  const ranges = effortRanges(a.scope.scale);
  out.push(para(fmt(L.effortRules, { ranges: Object.entries(ranges).map(([k, v]) => `${k} ${v}`).join("; ") })));
  out.push(para(a.scope.scale ? fmt(L.scaleOverride, { note: a.scope.scale.note }) : L.defaultScale));
  return out.join("\n\n");
}

// ---- Frontmatter and entry point -----------------------------------------------------------------------
function frontmatter(a, L, annexes) {
  const m = a.meta;
  const nv = notVerifiedFindings(a).length;
  const lines = ["---", `title: ${yamlStr(m.title)}`];
  lines.push(`subtitle: ${yamlStr(m.subtitle ?? m.client)}`);
  lines.push(`author: ${yamlStr(m.author)}`, `date: ${yamlStr(m.date)}`, `version: ${yamlStr(m.version)}`, `lang: ${yamlStr(m.lang)}`);
  lines.push(`summary: ${yamlBlock(expandTokens(a.summary, tokenValues(a)))}`);
  if (a.frameworks.length) {
    lines.push("sources:");
    for (const f of a.frameworks) {
      lines.push(`  - title: ${yamlStr(`${f.name} (${f.version})`)}`, `    url: ${yamlStr(f.url)}`, `    date: ${yamlStr(f.date)}`);
      if (f.retrievedAt) lines.push(`    accessed: ${yamlStr(f.retrievedAt)}`);
    }
  }
  lines.push("annexes:");
  for (const x of annexes) lines.push(`  - title: ${yamlStr(x.title)}`, `    file: ${yamlStr(x.file)}`);
  lines.push("changes:");
  const changes = m.changes?.length
    ? m.changes
    : [{ version: m.version, date: m.date, author: m.author, description: fmt(L.changeDescription, { findings: shownFindings(a).length, unverified: nv }) }];
  for (const c of changes) {
    lines.push(`  - version: ${yamlStr(c.version)}`, `    date: ${yamlStr(c.date)}`);
    if (c.author) lines.push(`    author: ${yamlStr(c.author)}`);
    lines.push(`    description: ${yamlStr(c.description)}`);
  }
  lines.push("---");
  return lines.join("\n");
}

/**
 * @param {object} a a classified, checked assessment
 * @returns {Record<string, string>} file name (inside report/) to text
 */
export function renderReport(a, { unreviewed = false } = {}) {
  const L = loadLabels(a.meta.lang);
  const annexes = [
    { title: L.annexFindings, file: "annex-findings.md", text: annexFindings(a, L) },
    { title: L.annexEvidence, file: "annex-evidence.md", text: annexEvidence(a, L) },
    ...(a.frameworks.length ? [{ title: L.annexFrameworks, file: "annex-frameworks.md", text: annexFrameworks(a, L) }] : []),
    { title: L.annexMethod, file: "annex-method.md", text: annexMethod(a, L, { unreviewed }) },
  ];
  const files = { "report.md": `${frontmatter(a, L, annexes)}\n\n${body(a, L, { unreviewed })}\n` };
  for (const x of annexes) files[x.file] = `${x.text}\n`;
  files["report.json"] = `${JSON.stringify(a, null, 2)}\n`;
  return files;
}

/** Secret scan of rendered files. @returns {{code: "secret-in-output", where: string, message: string}[]} */
export function scanRendered(files) {
  const out = [];
  for (const [name, text] of Object.entries(files))
    for (const kind of scanString(text)) out.push({ code: "secret-in-output", where: name, message: `looks like a secret (${kind}); nothing was written` });
  return out;
}
